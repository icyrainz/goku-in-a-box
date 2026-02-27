import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createDb } from "../db";
import { WsBroadcaster } from "../ws";
import { telemetryRoutes } from "./telemetry";

describe("telemetry routes", () => {
  let app: Hono;
  let db: ReturnType<typeof createDb>;
  let broadcaster: WsBroadcaster;

  beforeEach(() => {
    db = createDb(":memory:");
    broadcaster = new WsBroadcaster();
    app = new Hono();
    app.route("/api/telemetry", telemetryRoutes(db, broadcaster));
  });

  it("POST /stream ingests events and broadcasts them", async () => {
    // Create session so the route can resolve the seq
    db.createSession("c1", "opencode");

    const broadcasted: any[] = [];
    const fakeWs = { send: (m: string) => broadcasted.push(JSON.parse(m)) };
    broadcaster.register(fakeWs as any);

    const res = await app.request("/api/telemetry/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iterationId: 1, // seq number
        events: [
          { type: "thought", summary: "Thinking about the problem" },
          { type: "tool_call", summary: "Running bash: ls" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.received).toBe(2);

    // Route creates a DB iteration; find it by session
    const iters = db.getIterationsBySession("c1", 10, 0);
    expect(iters).toHaveLength(1);
    const dbId = iters[0].id;

    const events = db.getEventsByIteration(dbId);
    expect(events).toHaveLength(2);
    expect(broadcasted).toHaveLength(2);
    // Broadcast uses seq, not DB id
    expect(broadcasted[0].data.iterationId).toBe(1);
  });

  it("POST /summary records end-of-iteration data", async () => {
    db.createSession("c1", "opencode");

    // First stream to create the iteration
    await app.request("/api/telemetry/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iterationId: 1,
        events: [{ type: "thought", summary: "test" }],
      }),
    });

    const res = await app.request("/api/telemetry/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iterationId: 1,
        summary: "Explored the environment",
        actionCount: 5,
        errorCount: 0,
        vitals: { cpu: 12.5, memory: 256, disk: 1024 },
      }),
    });

    expect(res.status).toBe(200);
    const iters = db.getIterationsBySession("c1", 10, 0);
    const iter = db.getIteration(iters[0].id);
    expect(iter?.summary).toBe("Explored the environment");
    expect(iter?.action_count).toBe(5);

    const vitals = db.getVitals(1);
    expect(vitals[0]!.cpu_pct).toBe(12.5);
  });

  it("GET /iterations returns paginated list", async () => {
    for (let i = 0; i < 5; i++) db.startIteration();

    const res = await app.request("/api/telemetry/iterations?limit=2&offset=0");
    const body = (await res.json()) as any;
    expect(body.iterations).toHaveLength(2);
  });

  it("GET /iteration/:id returns full detail", async () => {
    const iterId = db.startIteration();
    db.insertEvent(iterId, "thought", "test");

    const res = await app.request(`/api/telemetry/iteration/${iterId}`);
    const body = (await res.json()) as any;
    expect(body.iteration.id).toBe(iterId);
    expect(body.events).toHaveLength(1);
  });

  it("GET /vitals returns time-series data", async () => {
    db.insertVitals(10, 100, 500);
    db.insertVitals(20, 200, 600);

    const res = await app.request("/api/telemetry/vitals?limit=10");
    const body = (await res.json()) as any;
    expect(body.vitals).toHaveLength(2);
  });

  it("GET /iterations?session=current returns only current session iterations", async () => {
    db.createSession("c1", "opencode");
    db.startIteration(1, "c1");
    db.startIteration(2, "c1");
    db.endSession("c1");

    db.createSession("c2", "goose");
    db.startIteration(3, "c2");

    const res = await app.request("/api/telemetry/iterations?limit=50&session=current");
    const body = (await res.json()) as any;
    expect(body.iterations).toHaveLength(1);
    expect(body.iterations[0].id).toBe(3);
  });

  it("GET /iterations without session param returns all iterations", async () => {
    db.createSession("c1", "opencode");
    db.startIteration(1, "c1");
    db.startIteration(2);

    const res = await app.request("/api/telemetry/iterations?limit=50");
    const body = (await res.json()) as any;
    expect(body.iterations).toHaveLength(2);
  });

  it("POST /stream auto-creates iteration scoped to active session", async () => {
    db.createSession("c1", "opencode");

    const res = await app.request("/api/telemetry/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iterationId: 42, // seq number from agent
        events: [{ type: "thought", summary: "test" }],
      }),
    });
    expect(res.status).toBe(200);

    // Verify iteration is scoped to session with correct seq
    const sessionIters = db.getIterationsBySession("c1", 10, 0);
    expect(sessionIters).toHaveLength(1);
    expect(sessionIters[0].seq).toBe(42);
  });

  it("POST /stream deduplicates repeated events within same iteration", async () => {
    db.createSession("c1", "opencode");

    const broadcasted: any[] = [];
    const fakeWs = { send: (m: string) => broadcasted.push(JSON.parse(m)) };
    broadcaster.register(fakeWs as any);

    // Send same event twice
    for (let i = 0; i < 2; i++) {
      await app.request("/api/telemetry/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          iterationId: 1,
          events: [{ type: "thought", summary: "Same thought" }],
        }),
      });
    }

    // Should only have one event despite two POSTs
    const iters = db.getIterationsBySession("c1", 10, 0);
    const events = db.getEventsByIteration(iters[0].id);
    expect(events).toHaveLength(1);
    expect(broadcasted).toHaveLength(1);
  });
});
