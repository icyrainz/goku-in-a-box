# Showcase Preview System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users preview what the agent built (websites, documents, CLI output, images) directly from the dashboard.

**Architecture:** Agent writes a `.showcase.json` manifest declaring what it built and how to preview it. Control plane reads the manifest, runs commands in the container, and proxies web traffic. Dashboard shows a modal with a Launch button and renders the preview by type. Container uses host network mode, so preview servers are directly reachable at `localhost:<port>`.

**Tech Stack:** Bun/Hono (control plane routes), React 19 + TanStack Query (dashboard modal), Docker exec API (process management), HTTP reverse proxy (web previews).

**Design doc:** `docs/plans/2026-02-26-showcase-design.md`

---

### Task 1: Sandbox — Create SHOWCASE.md agent instructions

**Files:**
- Create: `sandbox/SHOWCASE.md`

**Step 1: Create the showcase instructions file**

```markdown
## Showcase Protocol

When your work is ready to demo, write `/workspace/.showcase.json` so the human operator can preview it.

### Format

```json
{
  "label": "My Project",
  "type": "web | document | cli | media",
  "command": "command to run (web/cli only)",
  "port": 3001,
  "path": "/workspace/path/to/file (document/media only)"
}
```

### Types

- **web** — Serve a website. Required: `command` (start command), `port` (server port). Example: `{"type":"web","command":"cd /workspace/app && npm start","port":3001,"label":"Todo App"}`
- **document** — Display a text file. Required: `path`. Supports markdown, plain text, HTML. Example: `{"type":"document","path":"/workspace/novel/chapter1.md","label":"Chapter 1"}`
- **cli** — Run a command and show output. Required: `command`. Example: `{"type":"cli","command":"cd /workspace && python main.py --demo","label":"Demo Run"}`
- **media** — Display an image or SVG. Required: `path`. Example: `{"type":"media","path":"/workspace/output/chart.svg","label":"Chart"}`

### Rules
- Only write `.showcase.json` when you have something meaningful to show.
- For web type: ensure the command starts a server that listens on the specified port.
- For web type: use port 3001 or higher (3000 is taken by control plane).
- The `label` field is optional but recommended.
```

**Step 2: Commit**

```bash
git add sandbox/SHOWCASE.md
git commit -m "feat(showcase): add agent showcase instructions"
```

---

### Task 2: Sandbox — Update Dockerfiles and OPERATING.md

**Files:**
- Modify: `sandbox/OPERATING.md` (add 1 line)
- Modify: `sandbox/opencode/Dockerfile` (add 1 COPY line)
- Modify: `sandbox/goose/Dockerfile` (add 1 COPY line)

**Step 1: Add showcase line to OPERATING.md**

After the "Quality Assurance" section (line 29), before "Memory Protocol", add:

```markdown
## Showcase
- When your work is ready to demo, read /state/SHOWCASE.md for the showcase protocol.
```

**Step 2: Add COPY to opencode Dockerfile**

After the line `COPY OPERATING.md /state/OPERATING.md`, add:

```dockerfile
COPY SHOWCASE.md /state/SHOWCASE.md
```

**Step 3: Add COPY to goose Dockerfile**

Same change — after the `COPY OPERATING.md` line, add:

```dockerfile
COPY SHOWCASE.md /state/SHOWCASE.md
```

**Step 4: Commit**

```bash
git add sandbox/OPERATING.md sandbox/opencode/Dockerfile sandbox/goose/Dockerfile
git commit -m "feat(showcase): add SHOWCASE.md to sandbox images and OPERATING.md"
```

---

### Task 3: Control Plane — Add detached exec to DockerClient

**Files:**
- Modify: `control-plane/src/docker.ts` (add `execDetached` method)
- Test: `control-plane/src/docker.test.ts`

**Step 1: Write the failing test**

Add to `control-plane/src/docker.test.ts` (create file if it doesn't exist — check first):

```typescript
import { describe, it, expect, mock } from "bun:test";
import { DockerClient } from "./docker";

describe("DockerClient.execDetached", () => {
  it("creates exec with Detach: true and returns exec ID", async () => {
    const client = new DockerClient();
    // We'll test the payload construction via buildExecPayload
    const payload = client.buildExecPayload(["sh", "-c", "npm start"], true);
    expect(payload.Cmd).toEqual(["sh", "-c", "npm start"]);
    expect(payload.Detach).toBe(true);
    expect(payload.AttachStdout).toBe(false);
    expect(payload.AttachStderr).toBe(false);
  });

  it("creates exec with Detach: false for blocking exec", () => {
    const client = new DockerClient();
    const payload = client.buildExecPayload(["cat", "/workspace/.showcase.json"], false);
    expect(payload.Detach).toBe(false);
    expect(payload.AttachStdout).toBe(true);
    expect(payload.AttachStderr).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd control-plane && bun test docker.test.ts
```

Expected: FAIL — `buildExecPayload` does not exist.

**Step 3: Implement execDetached and buildExecPayload**

Add to `control-plane/src/docker.ts` class:

```typescript
buildExecPayload(cmd: string[], detach: boolean) {
  return {
    AttachStdout: !detach,
    AttachStderr: !detach,
    Detach: detach,
    Cmd: cmd,
  };
}

async execDetached(containerId: string, cmd: string[]): Promise<string> {
  const createRes = await this.fetch(`/containers/${containerId}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(this.buildExecPayload(cmd, true)),
  });
  if (!createRes.ok) throw new Error(`Create exec failed: ${await createRes.text()}`);
  const { Id: execId } = (await createRes.json()) as { Id: string };

  const startRes = await this.fetch(`/exec/${execId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Detach: true, Tty: false }),
  });
  if (!startRes.ok) throw new Error(`Start exec failed: ${await startRes.text()}`);

  return execId;
}
```

**Step 4: Run test to verify it passes**

```bash
cd control-plane && bun test docker.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add control-plane/src/docker.ts control-plane/src/docker.test.ts
git commit -m "feat(showcase): add detached exec capability to DockerClient"
```

---

### Task 4: Control Plane — Showcase routes (GET manifest, status)

**Files:**
- Create: `control-plane/src/routes/showcase.ts`
- Test: `control-plane/src/routes/showcase.test.ts`

**Step 1: Write failing tests for GET /showcase and GET /status**

Create `control-plane/src/routes/showcase.test.ts`:

```typescript
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { showcaseRoutes } from "./showcase";

describe("showcase routes", () => {
  let app: Hono;
  let mockSandbox: any;
  let mockDocker: any;
  let mockBroadcaster: any;

  beforeEach(() => {
    mockSandbox = { containerId: "test-container" };
    mockDocker = {
      execInContainer: mock(() => Promise.resolve("")),
      execDetached: mock(() => Promise.resolve("exec-123")),
    };
    mockBroadcaster = { broadcast: mock(() => {}) };

    app = new Hono();
    app.route("/api/showcase", showcaseRoutes(mockSandbox, mockDocker, mockBroadcaster));
  });

  describe("GET /", () => {
    it("returns null when no container running", async () => {
      mockSandbox.containerId = null;
      const res = await app.request("/api/showcase");
      const body = (await res.json()) as any;
      expect(body.manifest).toBeNull();
    });

    it("returns null when .showcase.json does not exist", async () => {
      mockDocker.execInContainer = mock(() => Promise.reject(new Error("not found")));
      const res = await app.request("/api/showcase");
      const body = (await res.json()) as any;
      expect(body.manifest).toBeNull();
    });

    it("returns parsed manifest when .showcase.json exists", async () => {
      const manifest = { type: "web", label: "Test App", command: "npm start", port: 3001 };
      mockDocker.execInContainer = mock(() => Promise.resolve(JSON.stringify(manifest)));
      const res = await app.request("/api/showcase");
      const body = (await res.json()) as any;
      expect(body.manifest).toEqual(manifest);
    });
  });

  describe("GET /status", () => {
    it("returns not_running when no preview active", async () => {
      const res = await app.request("/api/showcase/status");
      const body = (await res.json()) as any;
      expect(body.running).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd control-plane && bun test showcase.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement showcase route factory with GET / and GET /status**

Create `control-plane/src/routes/showcase.ts`:

```typescript
import { Hono } from "hono";
import type { SandboxManager } from "../sandbox";
import type { DockerClient } from "../docker";
import type { WsBroadcaster } from "../ws";

type ShowcaseManifest = {
  type: "web" | "document" | "cli" | "media";
  label?: string;
  command?: string;
  port?: number;
  path?: string;
};

type PreviewState = {
  manifest: ShowcaseManifest;
  execId: string | null;
  port: number | null;
};

export function showcaseRoutes(
  sandbox: SandboxManager,
  docker: DockerClient,
  broadcaster: WsBroadcaster,
) {
  const app = new Hono();
  let activePreview: PreviewState | null = null;

  async function readManifest(): Promise<ShowcaseManifest | null> {
    if (!sandbox.containerId) return null;
    try {
      const raw = await docker.execInContainer(sandbox.containerId, [
        "cat", "/workspace/.showcase.json",
      ]);
      return JSON.parse(raw.trim()) as ShowcaseManifest;
    } catch {
      return null;
    }
  }

  app.get("/", async (c) => {
    const manifest = await readManifest();
    return c.json({ manifest });
  });

  app.get("/status", (c) => {
    return c.json({
      running: activePreview !== null,
      type: activePreview?.manifest.type ?? null,
      port: activePreview?.port ?? null,
      label: activePreview?.manifest.label ?? null,
    });
  });

  return app;
}
```

**Step 4: Run test to verify it passes**

```bash
cd control-plane && bun test showcase.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add control-plane/src/routes/showcase.ts control-plane/src/routes/showcase.test.ts
git commit -m "feat(showcase): add GET manifest and status routes"
```

---

### Task 5: Control Plane — Showcase launch and stop routes

**Files:**
- Modify: `control-plane/src/routes/showcase.ts`
- Modify: `control-plane/src/routes/showcase.test.ts`

**Step 1: Write failing tests for POST /launch and POST /stop**

Add to `showcase.test.ts`:

```typescript
describe("POST /launch", () => {
  it("returns error when no container running", async () => {
    mockSandbox.containerId = null;
    const res = await app.request("/api/showcase/launch", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("returns error when no manifest exists", async () => {
    mockDocker.execInContainer = mock(() => Promise.reject(new Error("not found")));
    const res = await app.request("/api/showcase/launch", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("launches cli type and returns output", async () => {
    const manifest = { type: "cli", command: "python main.py", label: "Demo" };
    let callCount = 0;
    mockDocker.execInContainer = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(JSON.stringify(manifest));
      return Promise.resolve("Hello from CLI!");
    });
    const res = await app.request("/api/showcase/launch", { method: "POST" });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.output).toBe("Hello from CLI!");
  });

  it("launches web type and returns proxy info", async () => {
    const manifest = { type: "web", command: "npm start", port: 3001, label: "App" };
    mockDocker.execInContainer = mock(() => Promise.resolve(JSON.stringify(manifest)));
    mockDocker.execDetached = mock(() => Promise.resolve("exec-456"));
    const res = await app.request("/api/showcase/launch", { method: "POST" });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.proxyUrl).toBe("/api/showcase/proxy/");
    expect(body.port).toBe(3001);
  });

  it("launches document type with no-op", async () => {
    const manifest = { type: "document", path: "/workspace/readme.md", label: "Docs" };
    mockDocker.execInContainer = mock(() => Promise.resolve(JSON.stringify(manifest)));
    const res = await app.request("/api/showcase/launch", { method: "POST" });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.path).toBe("/workspace/readme.md");
  });

  it("launches media type with no-op", async () => {
    const manifest = { type: "media", path: "/workspace/chart.svg", label: "Chart" };
    mockDocker.execInContainer = mock(() => Promise.resolve(JSON.stringify(manifest)));
    const res = await app.request("/api/showcase/launch", { method: "POST" });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.path).toBe("/workspace/chart.svg");
  });
});

describe("POST /stop", () => {
  it("returns ok when no preview running", async () => {
    const res = await app.request("/api/showcase/stop", { method: "POST" });
    const body = (await res.json()) as any;
    expect(body.stopped).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd control-plane && bun test showcase.test.ts
```

Expected: FAIL — routes not defined.

**Step 3: Implement POST /launch and POST /stop**

Add to `showcaseRoutes` in `showcase.ts`, before the `return app`:

```typescript
app.post("/launch", async (c) => {
  if (!sandbox.containerId) {
    return c.json({ error: "Sandbox not running" }, 503);
  }

  const manifest = await readManifest();
  if (!manifest) {
    return c.json({ error: "No .showcase.json found" }, 404);
  }

  // Stop any existing preview first
  if (activePreview?.execId && sandbox.containerId) {
    try {
      await docker.execInContainer(sandbox.containerId, ["kill", activePreview.execId]);
    } catch {}
    activePreview = null;
  }

  switch (manifest.type) {
    case "web": {
      if (!manifest.command || !manifest.port) {
        return c.json({ error: "web type requires command and port" }, 400);
      }
      const execId = await docker.execDetached(sandbox.containerId, [
        "sh", "-c", manifest.command,
      ]);
      activePreview = { manifest, execId, port: manifest.port };
      broadcaster.broadcast({ type: "showcase_launched", data: { ...manifest, proxyUrl: "/api/showcase/proxy/" } });
      return c.json({ launched: true, type: "web", proxyUrl: "/api/showcase/proxy/", port: manifest.port });
    }

    case "cli": {
      if (!manifest.command) {
        return c.json({ error: "cli type requires command" }, 400);
      }
      const output = await docker.execInContainer(sandbox.containerId, [
        "sh", "-c", manifest.command,
      ]);
      activePreview = { manifest, execId: null, port: null };
      return c.json({ launched: true, type: "cli", output });
    }

    case "document": {
      if (!manifest.path) {
        return c.json({ error: "document type requires path" }, 400);
      }
      activePreview = { manifest, execId: null, port: null };
      return c.json({ launched: true, type: "document", path: manifest.path });
    }

    case "media": {
      if (!manifest.path) {
        return c.json({ error: "media type requires path" }, 400);
      }
      activePreview = { manifest, execId: null, port: null };
      return c.json({ launched: true, type: "media", path: manifest.path });
    }

    default:
      return c.json({ error: `Unknown showcase type: ${manifest.type}` }, 400);
  }
});

app.post("/stop", async (c) => {
  if (!activePreview) {
    return c.json({ stopped: false });
  }

  if (activePreview.manifest.type === "web" && activePreview.port && sandbox.containerId) {
    try {
      // Kill process listening on the preview port
      await docker.execInContainer(sandbox.containerId, [
        "sh", "-c", `fuser -k ${activePreview.port}/tcp 2>/dev/null || true`,
      ]);
    } catch {}
  }

  activePreview = null;
  broadcaster.broadcast({ type: "showcase_stopped", data: {} });
  return c.json({ stopped: true });
});
```

**Step 4: Run tests to verify they pass**

```bash
cd control-plane && bun test showcase.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add control-plane/src/routes/showcase.ts control-plane/src/routes/showcase.test.ts
git commit -m "feat(showcase): add launch and stop routes"
```

---

### Task 6: Control Plane — Reverse proxy route for web previews

**Files:**
- Modify: `control-plane/src/routes/showcase.ts`
- Modify: `control-plane/src/routes/showcase.test.ts`

**Step 1: Write failing test for proxy**

Add to `showcase.test.ts`:

```typescript
describe("ALL /proxy/*", () => {
  it("returns 503 when no web preview active", async () => {
    const res = await app.request("/api/showcase/proxy/");
    expect(res.status).toBe(503);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd control-plane && bun test showcase.test.ts
```

Expected: FAIL — 404 not 503.

**Step 3: Implement proxy route**

Add to `showcaseRoutes` in `showcase.ts`, before the `return app`:

```typescript
app.all("/proxy/*", async (c) => {
  if (!activePreview || activePreview.manifest.type !== "web" || !activePreview.port) {
    return c.json({ error: "No web preview active" }, 503);
  }

  const subPath = c.req.path.replace(/^\/proxy\/?/, "/");
  const targetUrl = `http://localhost:${activePreview.port}${subPath}`;

  try {
    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");

    const proxyRes = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
      redirect: "manual",
    });

    const responseHeaders = new Headers(proxyRes.headers);
    responseHeaders.delete("transfer-encoding");

    return new Response(proxyRes.body, {
      status: proxyRes.status,
      headers: responseHeaders,
    });
  } catch (err: any) {
    return c.json({ error: `Proxy error: ${err.message}` }, 502);
  }
});
```

**Step 4: Run tests to verify they pass**

```bash
cd control-plane && bun test showcase.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add control-plane/src/routes/showcase.ts control-plane/src/routes/showcase.test.ts
git commit -m "feat(showcase): add reverse proxy route for web previews"
```

---

### Task 7: Control Plane — Mount showcase routes

**Files:**
- Modify: `control-plane/src/index.ts`

**Step 1: Add showcase route import and mount**

Add import at top of `control-plane/src/index.ts`:

```typescript
import { showcaseRoutes } from "./routes/showcase";
```

Add route mount alongside the other `app.route()` calls:

```typescript
app.route("/api/showcase", showcaseRoutes(sandbox, docker, broadcaster));
```

**Step 2: Run all existing tests to verify nothing breaks**

```bash
cd control-plane && bun test
```

Expected: All existing tests PASS.

**Step 3: Commit**

```bash
git add control-plane/src/index.ts
git commit -m "feat(showcase): mount showcase routes on control plane"
```

---

### Task 8: Control Plane — Broadcast showcase_ready on telemetry events

**Files:**
- Modify: `control-plane/src/routes/telemetry.ts`

The control plane receives events from the agent every iteration. When an event mentions `.showcase.json` (e.g., a `tool_use` event writing the file), broadcast a `showcase_ready` event. This is simpler than polling.

**Step 1: Add showcase detection to the event stream handler**

In `control-plane/src/routes/telemetry.ts`, in the POST `/stream` handler, after broadcasting each event, add a check:

```typescript
// After the existing broadcaster.broadcast() call for each event:
if (
  event.summary?.includes(".showcase.json") ||
  event.content?.includes(".showcase.json")
) {
  // Fire-and-forget: read manifest and broadcast
  readShowcaseManifest(sandbox, docker).then((manifest) => {
    if (manifest) {
      broadcaster.broadcast({ type: "showcase_ready", data: manifest });
    }
  }).catch(() => {});
}
```

This requires importing the `readManifest` helper. To keep it DRY, export `readShowcaseManifest` as a standalone function from `showcase.ts`:

```typescript
// Add to showcase.ts, exported at module level (outside the route factory):
export async function readShowcaseManifest(
  sandbox: SandboxManager,
  docker: DockerClient,
): Promise<ShowcaseManifest | null> {
  if (!sandbox.containerId) return null;
  try {
    const raw = await docker.execInContainer(sandbox.containerId, [
      "cat", "/workspace/.showcase.json",
    ]);
    return JSON.parse(raw.trim()) as ShowcaseManifest;
  } catch {
    return null;
  }
}
```

Then `readManifest` inside the route factory calls this exported function.

**Step 2: Run all tests**

```bash
cd control-plane && bun test
```

Expected: PASS

**Step 3: Commit**

```bash
git add control-plane/src/routes/showcase.ts control-plane/src/routes/telemetry.ts
git commit -m "feat(showcase): broadcast showcase_ready on .showcase.json detection"
```

---

### Task 9: Dashboard — ShowcaseModal component

**Files:**
- Create: `dashboard/src/components/ShowcaseModal.tsx`

**Step 1: Create the ShowcaseModal component**

```tsx
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, postJson } from "../api/client";

type ShowcaseManifest = {
  type: "web" | "document" | "cli" | "media";
  label?: string;
  command?: string;
  port?: number;
  path?: string;
};

type ShowcaseStatus = {
  running: boolean;
  type: string | null;
  port: number | null;
  label: string | null;
};

type LaunchResult = {
  launched: boolean;
  type: string;
  output?: string;
  proxyUrl?: string;
  path?: string;
  port?: number;
};

export function ShowcaseModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);
  const [docContent, setDocContent] = useState<string | null>(null);

  const { data: showcaseData, isLoading } = useQuery({
    queryKey: ["showcase"],
    queryFn: () => fetchJson<{ manifest: ShowcaseManifest | null }>("/showcase"),
    refetchInterval: 5000,
  });

  const { data: statusData } = useQuery({
    queryKey: ["showcase-status"],
    queryFn: () => fetchJson<ShowcaseStatus>("/showcase/status"),
    refetchInterval: 3000,
  });

  const launchMutation = useMutation({
    mutationFn: () => postJson<LaunchResult>("/showcase/launch", {}),
    onSuccess: async (result) => {
      setLaunchResult(result);
      queryClient.invalidateQueries({ queryKey: ["showcase-status"] });

      // For document type, fetch the file content
      if (result.type === "document" && result.path) {
        try {
          const file = await fetchJson<{ content: string }>(
            `/sandbox/files/read?path=${encodeURIComponent(result.path)}`
          );
          setDocContent(file.content);
        } catch {
          setDocContent("Error loading document.");
        }
      }
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => postJson("/showcase/stop", {}),
    onSuccess: () => {
      setLaunchResult(null);
      setDocContent(null);
      queryClient.invalidateQueries({ queryKey: ["showcase-status"] });
    },
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const manifest = showcaseData?.manifest;
  const isRunning = statusData?.running ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
      onClick={onClose}
    >
      <div
        className="bg-washi-panel border border-washi-border rounded-lg w-[900px] max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-washi-border">
          <div className="flex items-center gap-3">
            <span className="kanji-accent text-base">展</span>
            <h2 className="section-heading">Showcase</h2>
            {manifest && (
              <span className="text-[10px] font-mono text-sumi-faint">
                {manifest.type}
                {manifest.port ? ` · port ${manifest.port}` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {manifest && !isRunning && (
              <button
                onClick={() => launchMutation.mutate()}
                disabled={launchMutation.isPending}
                className="btn-ink btn-matcha text-sm"
              >
                {launchMutation.isPending ? "Launching..." : "Launch"}
              </button>
            )}
            {isRunning && manifest?.type === "web" && (
              <button
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
                className="btn-ink btn-shu text-sm"
              >
                {stopMutation.isPending ? "Stopping..." : "Stop"}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-sumi-faint hover:text-sumi text-lg leading-none transition-colors ml-2"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto min-h-[400px]">
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-sumi-faint italic">Loading...</p>
            </div>
          )}

          {!isLoading && !manifest && (
            <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
              <span className="text-3xl font-serif text-sumi-faint/30">展</span>
              <p className="text-sumi-faint/60 text-xs">
                No showcase manifest found. The agent hasn't declared anything to preview yet.
              </p>
            </div>
          )}

          {!isLoading && manifest && !launchResult && (
            <div className="p-5 space-y-3">
              {manifest.label && (
                <h3 className="text-lg font-medium text-sumi">{manifest.label}</h3>
              )}
              <div className="space-y-1.5">
                {manifest.command && (
                  <div className="text-xs font-mono text-sumi-faint bg-washi rounded px-3 py-2 border border-washi-border">
                    {manifest.command}
                  </div>
                )}
                {manifest.path && (
                  <p className="text-xs font-mono text-sumi-faint">{manifest.path}</p>
                )}
              </div>
              <p className="text-xs text-sumi-faint">
                Click <strong>Launch</strong> to start the preview.
              </p>
            </div>
          )}

          {/* Web preview — iframe */}
          {launchResult?.type === "web" && launchResult.proxyUrl && (
            <iframe
              src={launchResult.proxyUrl}
              className="w-full h-full min-h-[500px] border-0"
              title={manifest?.label ?? "Preview"}
            />
          )}

          {/* CLI output */}
          {launchResult?.type === "cli" && (
            <pre className="p-5 text-sm font-mono text-sumi whitespace-pre-wrap bg-washi overflow-auto max-h-[600px]">
              {launchResult.output ?? "No output."}
            </pre>
          )}

          {/* Document */}
          {launchResult?.type === "document" && (
            <div className="p-5">
              {docContent === null ? (
                <p className="text-sm text-sumi-faint italic">Loading document...</p>
              ) : (
                <pre className="text-sm font-mono text-sumi whitespace-pre-wrap leading-relaxed">
                  {docContent}
                </pre>
              )}
            </div>
          )}

          {/* Media (image) */}
          {launchResult?.type === "media" && launchResult.path && (
            <div className="p-5 flex justify-center">
              <img
                src={`/api/sandbox/files/read?path=${encodeURIComponent(launchResult.path)}`}
                alt={manifest?.label ?? "Preview"}
                className="max-w-full max-h-[600px] object-contain"
              />
            </div>
          )}

          {launchMutation.isError && (
            <div className="p-5">
              <p className="text-xs text-shu">
                Launch failed:{" "}
                {launchMutation.error instanceof Error
                  ? launchMutation.error.message
                  : "Unknown error"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add dashboard/src/components/ShowcaseModal.tsx
git commit -m "feat(showcase): add ShowcaseModal dashboard component"
```

---

### Task 10: Dashboard — Wire up showcase in Header and App

**Files:**
- Modify: `dashboard/src/components/Header.tsx`
- Modify: `dashboard/src/App.tsx`

**Step 1: Add showcase button to Header**

In `Header.tsx`, add `onShowcaseClick` to the props and a button in the toolbar area (next to the Mailbox button):

```tsx
// Add to props type:
onShowcaseClick?: () => void;

// Add button in the toolbar, near other buttons:
{onShowcaseClick && (
  <button onClick={onShowcaseClick} className="btn-ink relative">
    <span className="kanji-accent text-xs mr-1.5">展</span>
    Showcase
  </button>
)}
```

**Step 2: Add showcase notification badge to Header**

The Header should poll `/api/showcase` to show a badge when a manifest exists. Add a `useQuery` for this:

```tsx
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../api/client";

// Inside the Header component:
const { data: showcaseData } = useQuery({
  queryKey: ["showcase"],
  queryFn: () => fetchJson<{ manifest: any }>("/showcase"),
  refetchInterval: 5000,
});
const hasShowcase = !!showcaseData?.manifest;

// On the button, add badge:
{hasShowcase && (
  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-matcha border border-washi-panel" />
)}
```

**Step 3: Wire up in App.tsx**

Add state and modal rendering following the existing pattern:

```tsx
import { ShowcaseModal } from "./components/ShowcaseModal";

// Add state:
const [showcaseOpen, setShowcaseOpen] = useState(false);

// Add to Header props:
onShowcaseClick={() => setShowcaseOpen(true)}

// Add modal render:
{showcaseOpen && <ShowcaseModal onClose={() => setShowcaseOpen(false)} />}
```

**Step 4: Verify dashboard compiles**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds with no errors.

**Step 5: Commit**

```bash
git add dashboard/src/components/Header.tsx dashboard/src/App.tsx
git commit -m "feat(showcase): wire showcase button and modal into dashboard"
```

---

### Task 11: Control Plane — Media file serving route

The current `/api/sandbox/files/read` returns JSON `{ content: string }` which works for text but not binary files (images). Add a raw binary route for media.

**Files:**
- Modify: `control-plane/src/routes/showcase.ts`

**Step 1: Add binary file route for media**

Add to `showcaseRoutes`, before the `return app`:

```typescript
app.get("/file", async (c) => {
  if (!sandbox.containerId) {
    return c.json({ error: "Sandbox not running" }, 503);
  }
  const path = c.req.query("path");
  if (!path || !path.startsWith("/workspace")) {
    return c.json({ error: "Valid /workspace path required" }, 400);
  }

  try {
    const stream = await docker.getArchive(sandbox.containerId, path);
    // Docker returns a TAR archive — extract the single file
    // For simplicity, pipe the raw file content via cat
    const content = await docker.execInContainer(sandbox.containerId, ["cat", path]);
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      svg: "image/svg+xml",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      html: "text/html",
    };
    return new Response(content, {
      headers: { "Content-Type": mimeMap[ext] ?? "application/octet-stream" },
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
```

**Step 2: Update ShowcaseModal media img src to use this route**

In `ShowcaseModal.tsx`, change the media `<img>` src:

```tsx
src={`/api/showcase/file?path=${encodeURIComponent(launchResult.path)}`}
```

**Step 3: Commit**

```bash
git add control-plane/src/routes/showcase.ts dashboard/src/components/ShowcaseModal.tsx
git commit -m "feat(showcase): add binary file serving for media previews"
```

---

### Task 12: Run all tests and verify

**Step 1: Run control plane tests**

```bash
cd control-plane && bun test
```

Expected: All tests PASS.

**Step 2: Build dashboard**

```bash
cd dashboard && npm run build
```

Expected: Build succeeds.

**Step 3: Commit any fixes if needed**

---

### Task 13: Final integration commit

**Step 1: Verify all files are committed**

```bash
git status
```

Expected: Clean working tree.

**Step 2: Rebuild Docker images** (note: this is informational — Docker builds require user action)

```bash
docker build -t goku-sandbox-opencode:latest -f sandbox/opencode/Dockerfile sandbox/
docker build -t goku-sandbox-goose:latest -f sandbox/goose/Dockerfile sandbox/
```
