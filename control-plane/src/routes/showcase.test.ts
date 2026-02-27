import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { showcaseRoutes } from "./showcase";

describe("showcase routes", () => {
  let app: Hono;
  let sandbox: any;
  let docker: any;
  let broadcaster: any;

  beforeEach(() => {
    sandbox = { containerId: "test-container" };
    docker = {
      execInContainer: mock(() => Promise.resolve("")),
      execDetached: mock(() => Promise.resolve("exec-123")),
    };
    broadcaster = { broadcast: mock(() => {}) };
    app = new Hono();
    app.route("/api/showcase", showcaseRoutes(sandbox, docker, broadcaster));
  });

  // --- GET / (manifest) ---

  it("GET / returns null manifest when no container", async () => {
    sandbox.containerId = null;
    const res = await app.request("/api/showcase");
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.manifest).toBeNull();
  });

  it("GET / returns null manifest when file doesn't exist", async () => {
    docker.execInContainer = mock(() => Promise.reject(new Error("file not found")));
    const res = await app.request("/api/showcase");
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.manifest).toBeNull();
  });

  it("GET / returns parsed manifest when file exists", async () => {
    const manifest = { type: "web", label: "My App", command: "npm start", port: 3001 };
    docker.execInContainer = mock(() => Promise.resolve(JSON.stringify(manifest) + "\n"));
    const res = await app.request("/api/showcase");
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.manifest).toEqual(manifest);
  });

  // --- GET /status ---

  it("GET /status returns not running when no preview", async () => {
    const res = await app.request("/api/showcase/status");
    const body = (await res.json()) as any;
    expect(body.running).toBe(false);
    expect(body.type).toBeNull();
    expect(body.port).toBeNull();
    expect(body.label).toBeNull();
  });

  it("GET /status clears stale preview when sandbox is gone", async () => {
    // Launch a web preview first
    docker.execInContainer = mock((_id: string, cmd: string[]) => {
      if (cmd[0] === "cat") {
        return Promise.resolve(JSON.stringify({ type: "web", command: "npm start", port: 3001 }));
      }
      return Promise.resolve("");
    });
    await app.request("/api/showcase/launch", { method: "POST" });

    // Now sandbox is gone
    sandbox.containerId = null;
    const res = await app.request("/api/showcase/status");
    const body = (await res.json()) as any;
    expect(body.running).toBe(false);
  });

  // --- POST /launch ---

  it("POST /launch returns 503 when no container", async () => {
    sandbox.containerId = null;
    const res = await app.request("/api/showcase/launch", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("POST /launch returns 404 when no manifest", async () => {
    docker.execInContainer = mock(() => Promise.reject(new Error("file not found")));
    const res = await app.request("/api/showcase/launch", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("POST /launch launches cli type and returns output", async () => {
    docker.execInContainer = mock((_id: string, cmd: string[]) => {
      if (cmd[0] === "cat") {
        return Promise.resolve(JSON.stringify({ type: "cli", label: "Test CLI", command: "echo hello" }));
      }
      return Promise.resolve("hello\n");
    });

    const res = await app.request("/api/showcase/launch", { method: "POST" });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.launched).toBe(true);
    expect(body.type).toBe("cli");
    expect(body.output).toBe("hello\n");
  });

  it("POST /launch launches web type and returns proxy info", async () => {
    docker.execInContainer = mock((_id: string, cmd: string[]) => {
      if (cmd[0] === "cat") {
        return Promise.resolve(JSON.stringify({ type: "web", label: "Web App", command: "npm start", port: 3001 }));
      }
      return Promise.resolve("");
    });

    const res = await app.request("/api/showcase/launch", { method: "POST" });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.launched).toBe(true);
    expect(body.type).toBe("web");
    expect(body.proxyUrl).toBe("/api/showcase/proxy/");
    expect(body.port).toBe(3001);
  });

  it("POST /launch launches document type", async () => {
    docker.execInContainer = mock((_id: string, cmd: string[]) => {
      if (cmd[0] === "cat") {
        return Promise.resolve(JSON.stringify({ type: "document", label: "README", path: "/workspace/README.md" }));
      }
      return Promise.resolve("");
    });

    const res = await app.request("/api/showcase/launch", { method: "POST" });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.launched).toBe(true);
    expect(body.type).toBe("document");
    expect(body.path).toBe("/workspace/README.md");
  });

  it("POST /launch launches media type", async () => {
    docker.execInContainer = mock((_id: string, cmd: string[]) => {
      if (cmd[0] === "cat") {
        return Promise.resolve(JSON.stringify({ type: "media", label: "Logo", path: "/workspace/logo.png" }));
      }
      return Promise.resolve("");
    });

    const res = await app.request("/api/showcase/launch", { method: "POST" });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.launched).toBe(true);
    expect(body.type).toBe("media");
    expect(body.path).toBe("/workspace/logo.png");
  });

  // --- POST /stop ---

  it("POST /stop returns stopped:false when no preview", async () => {
    const res = await app.request("/api/showcase/stop", { method: "POST" });
    const body = (await res.json()) as any;
    expect(body.stopped).toBe(false);
  });

  it("POST /stop kills web preview and returns stopped:true", async () => {
    // Launch a web preview first
    docker.execInContainer = mock((_id: string, cmd: string[]) => {
      if (cmd[0] === "cat") {
        return Promise.resolve(JSON.stringify({ type: "web", command: "npm start", port: 3001 }));
      }
      return Promise.resolve("");
    });
    await app.request("/api/showcase/launch", { method: "POST" });

    // Now stop it
    const res = await app.request("/api/showcase/stop", { method: "POST" });
    const body = (await res.json()) as any;
    expect(body.stopped).toBe(true);
    expect(broadcaster.broadcast).toHaveBeenCalled();
  });

  // --- GET /file ---

  it("GET /file returns 400 for path traversal", async () => {
    const res = await app.request("/api/showcase/file?path=/workspace/../../etc/passwd");
    expect(res.status).toBe(400);
  });

  // --- ALL /proxy/* ---

  it("ALL /proxy/ returns 503 when no web preview active", async () => {
    const res = await app.request("/api/showcase/proxy/");
    expect(res.status).toBe(503);
  });
});
