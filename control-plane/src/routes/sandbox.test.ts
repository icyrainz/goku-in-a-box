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

    app = new Hono();
    app.route("/api/sandbox", sandboxRoutes(manager));
  });

  it("GET /status returns not_running when no container", async () => {
    manager.containerId = null;
    const res = await app.request("/api/sandbox/status");
    const body = await res.json();
    expect(body.status).toBe("not_running");
  });

  it("POST /start creates and starts the sandbox", async () => {
    const res = await app.request("/api/sandbox/start", { method: "POST" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.containerId).toBe("abc123");
  });

  it("POST /stop stops the sandbox", async () => {
    manager.containerId = "abc123";
    const res = await app.request("/api/sandbox/stop", { method: "POST" });
    expect(res.status).toBe(200);
  });
});
