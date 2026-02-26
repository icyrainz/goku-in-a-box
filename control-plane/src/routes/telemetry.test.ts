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
    const iterId = db.startIteration();
    const broadcasted: any[] = [];
    const fakeWs = { send: (m: string) => broadcasted.push(JSON.parse(m)) };
    broadcaster.register(fakeWs as any);

    const res = await app.request("/api/telemetry/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iterationId: iterId,
        events: [
          { type: "thought", summary: "Thinking about the problem" },
          { type: "tool_call", summary: "Running bash: ls" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.received).toBe(2);

    const events = db.getEventsByIteration(iterId);
    expect(events).toHaveLength(2);
    expect(broadcasted).toHaveLength(2);
  });

  it("POST /summary records end-of-iteration data", async () => {
    const iterId = db.startIteration();

    const res = await app.request("/api/telemetry/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        iterationId: iterId,
        summary: "Explored the environment",
        actionCount: 5,
        errorCount: 0,
        vitals: { cpu: 12.5, memory: 256, disk: 1024 },
      }),
    });

    expect(res.status).toBe(200);
    const iter = db.getIteration(iterId);
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
});
