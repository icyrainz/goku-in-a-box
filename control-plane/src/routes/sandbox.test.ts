import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { sandboxRoutes } from "./sandbox";
import { SandboxManager } from "../sandbox";

describe("sandbox routes", () => {
  let app: Hono;
  let manager: SandboxManager;

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

    const db = { closeOpenIterations: mock(() => {}) } as any;
    app = new Hono();
    app.route("/api/sandbox", sandboxRoutes(manager, db));
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
});
