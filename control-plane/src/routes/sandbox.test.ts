import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { sandboxRoutes } from "./sandbox";
import { SandboxManager } from "../sandbox";
import { WsBroadcaster } from "../ws";

describe("sandbox routes", () => {
  let app: Hono;
  let manager: SandboxManager;
  let db: any;
  let broadcaster: WsBroadcaster;

  beforeEach(() => {
    manager = new SandboxManager({
      createContainer: mock(() => Promise.resolve({ Id: "abc123" })),
      startContainer: mock(() => Promise.resolve()),
      stopContainer: mock(() => Promise.resolve()),
      removeContainer: mock(() => Promise.resolve()),
      inspectContainer: mock(() =>
        Promise.resolve({ State: { Running: true, Status: "running" } })
      ),
    } as any);

    db = {
      closeOpenIterations: mock(() => {}),
      clearPrompt: mock(() => {}),
      endAllOpenSessions: mock(() => {}),
      createSession: mock(() => {}),
      endSession: mock(() => {}),
      getActiveSession: mock(() => null),
      getLatestSession: mock(() => null),
    } as any;
    broadcaster = new WsBroadcaster();
    app = new Hono();
    app.route("/api/sandbox", sandboxRoutes(manager, db, broadcaster));
  });

  it("GET /status returns not_running when no container", async () => {
    manager.containerId = null;
    const body = (await (await app.request("/api/sandbox/status")).json()) as any;
    expect(body.status).toBe("not_running");
  });

  it("POST /start creates and starts the sandbox (default opencode)", async () => {
    const res = await app.request("/api/sandbox/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.containerId).toBe("abc123");
    expect(body.agentType).toBe("opencode");
  });

  it("POST /start with agentType=goose starts goose sandbox", async () => {
    const res = await app.request("/api/sandbox/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentType: "goose" }),
    });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.agentType).toBe("goose");
  });

  it("GET /status includes agentType when running", async () => {
    await manager.start("opencode", {});
    const res = await app.request("/api/sandbox/status");
    const body = (await res.json()) as any;
    expect(body.status).toBe("running");
    expect(body.agentType).toBe("opencode");
  });

  it("POST /stop stops the sandbox", async () => {
    manager.containerId = "abc123";
    const res = await app.request("/api/sandbox/stop", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("POST /start creates a session and broadcasts session_start", async () => {
    const broadcasted: any[] = [];
    const fakeWs = { send: (m: string) => broadcasted.push(JSON.parse(m)) };
    broadcaster.register(fakeWs as any);

    await app.request("/api/sandbox/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(db.endAllOpenSessions).toHaveBeenCalled();
    expect(db.createSession).toHaveBeenCalledWith("abc123", "opencode");
    expect(broadcasted.some((e: any) => e.type === "session_start")).toBe(true);
  });

  it("POST /stop ends the session", async () => {
    manager.containerId = "abc123";
    await app.request("/api/sandbox/stop", { method: "POST" });
    expect(db.endSession).toHaveBeenCalledWith("abc123");
  });

  it("GET /status includes sessionId", async () => {
    manager.containerId = null;
    db.getActiveSession = mock(() => null);
    db.getLatestSession = mock(() => ({ container_id: "old-container", agent_type: "goose", started_at: "", stopped_at: "" }));
    const res = await app.request("/api/sandbox/status");
    const body = (await res.json()) as any;
    expect(body.sessionId).toBe("old-container");
  });
});
