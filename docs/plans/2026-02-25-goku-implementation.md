# Goku-in-a-Box Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an autonomous AI sandbox: OpenCode agent in Docker, steered by humans via a control plane + dashboard.

**Architecture:** Three components -- (1) Sandbox: Docker container running `opencode serve` with a bash loop wrapper that uses `opencode run --attach --format json` per iteration, streaming NDJSON to the control plane. (2) Control Plane: Bun/Hono server managing Docker containers, prompt state, telemetry ingestion, and WebSocket broadcasting. Uses `bun:sqlite` for storage and Bun's native `fetch()` with `unix` socket option for Docker API. (3) Dashboard: React/Vite SPA with TanStack Query, WebSocket, Monaco Editor, Recharts, and Tailwind CSS.

**Tech Stack:** Bun, Hono, bun:sqlite, React, Vite, TanStack Query, Tailwind CSS, Monaco Editor, Recharts, Docker, OpenCode

---

## Task 1: Control Plane -- Project Scaffolding

**Files:**
- Create: `control-plane/package.json`
- Create: `control-plane/tsconfig.json`
- Create: `control-plane/src/index.ts`

**Step 1: Initialize the Bun project**

```bash
cd control-plane && bun init -y
```

**Step 2: Install Hono**

```bash
cd control-plane && bun add hono
```

**Step 3: Write the entrypoint with a health check route**

```typescript
// control-plane/src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

export default {
  port: 3000,
  fetch: app.fetch,
};
```

**Step 4: Verify it runs**

Run: `cd control-plane && bun run src/index.ts &`
Then: `curl http://localhost:3000/health`
Expected: `{"status":"ok"}`

**Step 5: Commit**

```bash
git add control-plane/
git commit -m "feat: scaffold control plane with Hono"
```

---

## Task 2: Control Plane -- Database Layer

**Files:**
- Create: `control-plane/src/db.ts`
- Test: `control-plane/src/db.test.ts`

**Step 1: Write the failing test**

```typescript
// control-plane/src/db.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { createDb } from "./db";

describe("db", () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("creates tables on init", () => {
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("iterations");
    expect(names).toContain("vitals");
    expect(names).toContain("prompt_history");
    expect(names).toContain("events");
  });

  it("inserts and retrieves a prompt", () => {
    db.insertPrompt("Hello world");
    const prompt = db.getLatestPrompt();
    expect(prompt?.content).toBe("Hello world");
  });

  it("returns null when no prompt exists", () => {
    const prompt = db.getLatestPrompt();
    expect(prompt).toBeNull();
  });

  it("creates an iteration and retrieves it", () => {
    const id = db.startIteration();
    db.endIteration(id, "Did some work", 3, 0);
    const iter = db.getIteration(id);
    expect(iter?.summary).toBe("Did some work");
    expect(iter?.action_count).toBe(3);
  });

  it("inserts events for an iteration", () => {
    const iterId = db.startIteration();
    db.insertEvent(iterId, "thought", "Thinking about something");
    db.insertEvent(iterId, "tool_call", "Running ls");
    const events = db.getEventsByIteration(iterId);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("thought");
  });

  it("inserts and retrieves vitals", () => {
    db.insertVitals(45.2, 512, 2048);
    const vitals = db.getVitals(10);
    expect(vitals).toHaveLength(1);
    expect(vitals[0].cpu_pct).toBe(45.2);
  });

  it("lists iterations with pagination", () => {
    for (let i = 0; i < 5; i++) db.startIteration();
    const page1 = db.getIterations(2, 0);
    const page2 = db.getIterations(2, 2);
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
  });

  it("tracks prompt history versions", () => {
    db.insertPrompt("v1");
    db.insertPrompt("v2");
    db.insertPrompt("v3");
    const latest = db.getLatestPrompt();
    expect(latest?.content).toBe("v3");
    const history = db.getPromptHistory();
    expect(history).toHaveLength(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd control-plane && bun test src/db.test.ts`
Expected: FAIL - module not found

**Step 3: Write the database module**

```typescript
// control-plane/src/db.ts
import { Database } from "bun:sqlite";

export function createDb(path: string) {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS iterations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_time TEXT NOT NULL DEFAULT (datetime('now')),
      end_time TEXT,
      summary TEXT,
      action_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS vitals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      cpu_pct REAL,
      memory_mb REAL,
      disk_mb REAL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS prompt_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iteration_id INTEGER REFERENCES iterations(id),
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      type TEXT NOT NULL,
      summary TEXT
    )
  `);

  const stmts = {
    insertPrompt: db.prepare("INSERT INTO prompt_history (content) VALUES (?)"),
    getLatestPrompt: db.prepare("SELECT * FROM prompt_history ORDER BY id DESC LIMIT 1"),
    getPromptHistory: db.prepare("SELECT * FROM prompt_history ORDER BY id DESC"),
    startIteration: db.prepare("INSERT INTO iterations (start_time) VALUES (datetime('now'))"),
    endIteration: db.prepare(
      "UPDATE iterations SET end_time = datetime('now'), summary = ?, action_count = ?, error_count = ? WHERE id = ?"
    ),
    getIteration: db.prepare("SELECT * FROM iterations WHERE id = ?"),
    getIterations: db.prepare("SELECT * FROM iterations ORDER BY id DESC LIMIT ? OFFSET ?"),
    insertEvent: db.prepare(
      "INSERT INTO events (iteration_id, type, summary) VALUES (?, ?, ?)"
    ),
    getEventsByIteration: db.prepare(
      "SELECT * FROM events WHERE iteration_id = ? ORDER BY timestamp ASC"
    ),
    insertVitals: db.prepare("INSERT INTO vitals (cpu_pct, memory_mb, disk_mb) VALUES (?, ?, ?)"),
    getVitals: db.prepare("SELECT * FROM vitals ORDER BY timestamp DESC LIMIT ?"),
  };

  return {
    raw: db,

    insertPrompt(content: string) {
      stmts.insertPrompt.run(content);
    },

    getLatestPrompt() {
      return stmts.getLatestPrompt.get() as { id: number; content: string; updated_at: string } | null;
    },

    getPromptHistory() {
      return stmts.getPromptHistory.all() as { id: number; content: string; updated_at: string }[];
    },

    startIteration() {
      const result = stmts.startIteration.run();
      return Number(result.lastInsertRowid);
    },

    endIteration(id: number, summary: string, actionCount: number, errorCount: number) {
      stmts.endIteration.run(summary, actionCount, errorCount, id);
    },

    getIteration(id: number) {
      return stmts.getIteration.get(id) as {
        id: number; start_time: string; end_time: string | null;
        summary: string | null; action_count: number; error_count: number;
      } | null;
    },

    getIterations(limit: number, offset: number) {
      return stmts.getIterations.all(limit, offset) as any[];
    },

    insertEvent(iterationId: number, type: string, summary: string) {
      stmts.insertEvent.run(iterationId, type, summary);
    },

    getEventsByIteration(iterationId: number) {
      return stmts.getEventsByIteration.all(iterationId) as {
        id: number; iteration_id: number; timestamp: string; type: string; summary: string;
      }[];
    },

    insertVitals(cpu: number, memory: number, disk: number) {
      stmts.insertVitals.run(cpu, memory, disk);
    },

    getVitals(limit: number) {
      return stmts.getVitals.all(limit) as {
        id: number; timestamp: string; cpu_pct: number; memory_mb: number; disk_mb: number;
      }[];
    },
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd control-plane && bun test src/db.test.ts`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add control-plane/src/db.ts control-plane/src/db.test.ts
git commit -m "feat: add SQLite database layer with full test coverage"
```

---

## Task 3: Control Plane -- Prompt Routes

**Files:**
- Create: `control-plane/src/routes/prompt.ts`
- Test: `control-plane/src/routes/prompt.test.ts`
- Modify: `control-plane/src/index.ts`

**Step 1: Write the failing test**

```typescript
// control-plane/src/routes/prompt.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createDb } from "../db";
import { promptRoutes } from "./prompt";

describe("prompt routes", () => {
  let app: Hono;

  beforeEach(() => {
    const db = createDb(":memory:");
    app = new Hono();
    app.route("/api/prompt", promptRoutes(db));
  });

  it("GET returns empty when no prompt set", async () => {
    const res = await app.request("/api/prompt");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.content).toBe("");
  });

  it("PUT saves a prompt and GET retrieves it", async () => {
    const putRes = await app.request("/api/prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Build a web scraper" }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/api/prompt");
    const body = await getRes.json();
    expect(body.content).toBe("Build a web scraper");
  });

  it("PUT returns previous version in response", async () => {
    await app.request("/api/prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v1" }),
    });

    const res = await app.request("/api/prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "v2" }),
    });
    const body = await res.json();
    expect(body.previous).toBe("v1");
    expect(body.current).toBe("v2");
  });

  it("PUT rejects empty content", async () => {
    const res = await app.request("/api/prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd control-plane && bun test src/routes/prompt.test.ts`
Expected: FAIL

**Step 3: Write the prompt routes**

```typescript
// control-plane/src/routes/prompt.ts
import { Hono } from "hono";
import type { createDb } from "../db";

export function promptRoutes(db: ReturnType<typeof createDb>) {
  const app = new Hono();

  app.get("/", (c) => {
    const prompt = db.getLatestPrompt();
    return c.json({ content: prompt?.content ?? "", updated_at: prompt?.updated_at ?? null });
  });

  app.put("/", async (c) => {
    const body = await c.req.json<{ content: string }>();
    if (!body.content) {
      return c.json({ error: "content is required" }, 400);
    }

    const previous = db.getLatestPrompt();
    db.insertPrompt(body.content);

    return c.json({
      previous: previous?.content ?? null,
      current: body.content,
    });
  });

  return app;
}
```

**Step 4: Wire up the route in index.ts**

```typescript
// control-plane/src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createDb } from "./db";
import { promptRoutes } from "./routes/prompt";

const db = createDb("data/sandbox.db");
const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/prompt", promptRoutes(db));

export default {
  port: 3000,
  fetch: app.fetch,
};
```

**Step 5: Run tests to verify they pass**

Run: `cd control-plane && bun test src/routes/prompt.test.ts`
Expected: All 4 tests PASS

**Step 6: Commit**

```bash
git add control-plane/src/routes/prompt.ts control-plane/src/routes/prompt.test.ts control-plane/src/index.ts
git commit -m "feat: add prompt GET/PUT routes with version history"
```

---

## Task 4: Control Plane -- Docker Integration

**Files:**
- Create: `control-plane/src/docker.ts`
- Test: `control-plane/src/docker.test.ts`

The Docker module uses Bun's native `fetch()` with the `unix` option to talk to the Docker socket directly. No dockerode dependency.

**Step 1: Write the failing test**

Tests mock the Docker API responses since we can't depend on Docker in unit tests. We test the API construction logic and the higher-level sandbox helpers.

```typescript
// control-plane/src/docker.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { DockerClient } from "./docker";

describe("DockerClient", () => {
  it("constructs with default socket path", () => {
    const client = new DockerClient();
    expect(client.socketPath).toBe("/var/run/docker.sock");
  });

  it("constructs with custom socket path", () => {
    const client = new DockerClient("/custom/docker.sock");
    expect(client.socketPath).toBe("/custom/docker.sock");
  });

  it("builds correct create container payload", () => {
    const client = new DockerClient();
    const payload = client.buildCreatePayload({
      image: "goku-sandbox:latest",
      name: "goku-sandbox",
      env: ["FOO=bar"],
      binds: ["/host:/container"],
    });
    expect(payload.Image).toBe("goku-sandbox:latest");
    expect(payload.Env).toContain("FOO=bar");
    expect(payload.HostConfig.Binds).toContain("/host:/container");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd control-plane && bun test src/docker.test.ts`
Expected: FAIL

**Step 3: Write the Docker client**

```typescript
// control-plane/src/docker.ts
const DOCKER_API_VERSION = "v1.47";

export class DockerClient {
  readonly socketPath: string;
  private baseUrl: string;

  constructor(socketPath = "/var/run/docker.sock") {
    this.socketPath = socketPath;
    this.baseUrl = `http://localhost/${DOCKER_API_VERSION}`;
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      unix: this.socketPath,
    } as any);
  }

  buildCreatePayload(config: {
    image: string;
    name: string;
    cmd?: string[];
    env?: string[];
    binds?: string[];
    networkMode?: string;
    extraHosts?: string[];
  }) {
    return {
      Image: config.image,
      Cmd: config.cmd,
      Env: config.env ?? [],
      Tty: false,
      HostConfig: {
        Binds: config.binds ?? [],
        NetworkMode: config.networkMode ?? "host",
        ExtraHosts: config.extraHosts ?? [],
      },
    };
  }

  async createContainer(config: {
    image: string;
    name: string;
    cmd?: string[];
    env?: string[];
    binds?: string[];
    networkMode?: string;
    extraHosts?: string[];
  }) {
    const payload = this.buildCreatePayload(config);
    const res = await this.fetch(`/containers/create?name=${config.name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Create container failed: ${await res.text()}`);
    return (await res.json()) as { Id: string };
  }

  async startContainer(id: string) {
    const res = await this.fetch(`/containers/${id}/start`, { method: "POST" });
    if (!res.ok && res.status !== 304) {
      throw new Error(`Start container failed: ${await res.text()}`);
    }
  }

  async stopContainer(id: string, timeout = 10) {
    const res = await this.fetch(`/containers/${id}/stop?t=${timeout}`, { method: "POST" });
    if (!res.ok && res.status !== 304 && res.status !== 404) {
      throw new Error(`Stop container failed: ${await res.text()}`);
    }
  }

  async removeContainer(id: string) {
    const res = await this.fetch(`/containers/${id}?force=true`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Remove container failed: ${await res.text()}`);
    }
  }

  async inspectContainer(id: string) {
    const res = await this.fetch(`/containers/${id}/json`);
    if (!res.ok) throw new Error(`Inspect container failed: ${await res.text()}`);
    return res.json();
  }

  async listContainers(filters?: Record<string, string[]>) {
    const params = filters ? `?filters=${encodeURIComponent(JSON.stringify(filters))}` : "";
    const res = await this.fetch(`/containers/json${params}`);
    if (!res.ok) throw new Error(`List containers failed: ${await res.text()}`);
    return res.json() as Promise<any[]>;
  }

  async streamLogs(id: string, onData: (line: string) => void, signal?: AbortSignal) {
    const res = await this.fetch(
      `/containers/${id}/logs?follow=true&stdout=true&stderr=true&timestamps=true`,
      { signal }
    );
    if (!res.ok || !res.body) throw new Error(`Stream logs failed: ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n")) {
          if (line.trim()) onData(line);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd control-plane && bun test src/docker.test.ts`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add control-plane/src/docker.ts control-plane/src/docker.test.ts
git commit -m "feat: add Docker client using Bun native fetch over unix socket"
```

---

## Task 5: Control Plane -- Sandbox Manager & Routes

**Files:**
- Create: `control-plane/src/sandbox.ts`
- Create: `control-plane/src/routes/sandbox.ts`
- Test: `control-plane/src/routes/sandbox.test.ts`
- Modify: `control-plane/src/index.ts`

The sandbox manager wraps the Docker client with sandbox-specific lifecycle logic (create, start, stop, status). The routes expose this via HTTP.

**Step 1: Write the failing test**

```typescript
// control-plane/src/routes/sandbox.test.ts
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { sandboxRoutes } from "./sandbox";
import { SandboxManager } from "../sandbox";

describe("sandbox routes", () => {
  let app: Hono;
  let manager: SandboxManager;

  beforeEach(() => {
    // Use a mock docker client
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
```

**Step 2: Run test to verify it fails**

Run: `cd control-plane && bun test src/routes/sandbox.test.ts`
Expected: FAIL

**Step 3: Write the sandbox manager**

```typescript
// control-plane/src/sandbox.ts
import type { DockerClient } from "./docker";

const SANDBOX_IMAGE = "goku-sandbox:latest";
const SANDBOX_NAME = "goku-sandbox";

export class SandboxManager {
  containerId: string | null = null;
  private docker: DockerClient;

  constructor(docker: DockerClient) {
    this.docker = docker;
  }

  async start(env: Record<string, string> = {}) {
    // Remove existing container if any
    if (this.containerId) {
      await this.stop();
    }

    const envArr = Object.entries(env).map(([k, v]) => `${k}=${v}`);

    const { Id } = await this.docker.createContainer({
      image: SANDBOX_IMAGE,
      name: SANDBOX_NAME,
      env: [
        `CONTROL_PLANE_URL=http://host.docker.internal:3000`,
        ...envArr,
      ],
      extraHosts: ["host.docker.internal:host-gateway"],
    });

    await this.docker.startContainer(Id);
    this.containerId = Id;
    return Id;
  }

  async stop() {
    if (!this.containerId) return;
    await this.docker.stopContainer(this.containerId);
    await this.docker.removeContainer(this.containerId);
    this.containerId = null;
  }

  async status() {
    if (!this.containerId) return { status: "not_running" as const };
    try {
      const info = await this.docker.inspectContainer(this.containerId);
      return {
        status: info.State.Running ? ("running" as const) : ("stopped" as const),
        containerId: this.containerId,
      };
    } catch {
      this.containerId = null;
      return { status: "not_running" as const };
    }
  }
}
```

**Step 4: Write the sandbox routes**

```typescript
// control-plane/src/routes/sandbox.ts
import { Hono } from "hono";
import type { SandboxManager } from "../sandbox";

export function sandboxRoutes(manager: SandboxManager) {
  const app = new Hono();

  app.post("/start", async (c) => {
    const containerId = await manager.start();
    return c.json({ containerId, status: "started" });
  });

  app.post("/stop", async (c) => {
    await manager.stop();
    return c.json({ status: "stopped" });
  });

  app.get("/status", async (c) => {
    const status = await manager.status();
    return c.json(status);
  });

  return app;
}
```

**Step 5: Wire into index.ts**

Add to `control-plane/src/index.ts`:
```typescript
import { DockerClient } from "./docker";
import { SandboxManager } from "./sandbox";
import { sandboxRoutes } from "./routes/sandbox";

const docker = new DockerClient();
const sandbox = new SandboxManager(docker);

// ... existing code ...
app.route("/api/sandbox", sandboxRoutes(sandbox));
```

**Step 6: Run tests to verify they pass**

Run: `cd control-plane && bun test src/routes/sandbox.test.ts`
Expected: All 3 tests PASS

**Step 7: Commit**

```bash
git add control-plane/src/sandbox.ts control-plane/src/routes/sandbox.ts control-plane/src/routes/sandbox.test.ts control-plane/src/index.ts
git commit -m "feat: add sandbox manager and start/stop/status routes"
```

---

## Task 6: Control Plane -- WebSocket Broadcasting

**Files:**
- Create: `control-plane/src/ws.ts`
- Test: `control-plane/src/ws.test.ts`
- Modify: `control-plane/src/index.ts`

**Step 1: Write the failing test**

```typescript
// control-plane/src/ws.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { WsBroadcaster } from "./ws";

describe("WsBroadcaster", () => {
  let broadcaster: WsBroadcaster;

  beforeEach(() => {
    broadcaster = new WsBroadcaster();
  });

  it("starts with zero clients", () => {
    expect(broadcaster.clientCount).toBe(0);
  });

  it("registers and removes clients", () => {
    const fakeWs = { send: () => {}, close: () => {} };
    broadcaster.register(fakeWs as any);
    expect(broadcaster.clientCount).toBe(1);
    broadcaster.remove(fakeWs as any);
    expect(broadcaster.clientCount).toBe(0);
  });

  it("broadcasts to all connected clients", () => {
    const messages: string[] = [];
    const fakeWs1 = { send: (m: string) => messages.push(m), close: () => {} };
    const fakeWs2 = { send: (m: string) => messages.push(m), close: () => {} };
    broadcaster.register(fakeWs1 as any);
    broadcaster.register(fakeWs2 as any);

    broadcaster.broadcast({ type: "test", data: { foo: "bar" } });

    expect(messages).toHaveLength(2);
    const parsed = JSON.parse(messages[0]);
    expect(parsed.type).toBe("test");
    expect(parsed.data.foo).toBe("bar");
    expect(parsed.timestamp).toBeDefined();
  });

  it("removes clients that throw on send", () => {
    const fakeWs = {
      send: () => { throw new Error("disconnected"); },
      close: () => {},
    };
    broadcaster.register(fakeWs as any);
    broadcaster.broadcast({ type: "test", data: {} });
    expect(broadcaster.clientCount).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd control-plane && bun test src/ws.test.ts`
Expected: FAIL

**Step 3: Write the WebSocket broadcaster**

```typescript
// control-plane/src/ws.ts

interface WsLike {
  send(data: string): void;
}

export class WsBroadcaster {
  private clients = new Set<WsLike>();

  get clientCount() {
    return this.clients.size;
  }

  register(ws: WsLike) {
    this.clients.add(ws);
  }

  remove(ws: WsLike) {
    this.clients.delete(ws);
  }

  broadcast(event: { type: string; data: unknown; timestamp?: string }) {
    const message = JSON.stringify({
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    });

    for (const ws of this.clients) {
      try {
        ws.send(message);
      } catch {
        this.clients.delete(ws);
      }
    }
  }
}
```

**Step 4: Wire into index.ts with Hono WebSocket**

Add to `control-plane/src/index.ts`:
```typescript
import { upgradeWebSocket, websocket } from "hono/bun";
import { WsBroadcaster } from "./ws";

const broadcaster = new WsBroadcaster();

app.get(
  "/ws/live",
  upgradeWebSocket(() => ({
    onOpen(_, ws) {
      broadcaster.register(ws);
    },
    onClose(_, ws) {
      broadcaster.remove(ws);
    },
  }))
);

export default {
  port: 3000,
  fetch: app.fetch,
  websocket,
};
```

**Step 5: Run tests to verify they pass**

Run: `cd control-plane && bun test src/ws.test.ts`
Expected: All 4 tests PASS

**Step 6: Commit**

```bash
git add control-plane/src/ws.ts control-plane/src/ws.test.ts control-plane/src/index.ts
git commit -m "feat: add WebSocket broadcaster for real-time dashboard streaming"
```

---

## Task 7: Control Plane -- Telemetry Routes

**Files:**
- Create: `control-plane/src/routes/telemetry.ts`
- Test: `control-plane/src/routes/telemetry.test.ts`
- Modify: `control-plane/src/index.ts`

**Step 1: Write the failing test**

```typescript
// control-plane/src/routes/telemetry.test.ts
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
    const body = await res.json();
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
    expect(vitals[0].cpu_pct).toBe(12.5);
  });

  it("GET /iterations returns paginated list", async () => {
    for (let i = 0; i < 5; i++) db.startIteration();

    const res = await app.request("/api/telemetry/iterations?limit=2&offset=0");
    const body = await res.json();
    expect(body.iterations).toHaveLength(2);
  });

  it("GET /iteration/:id returns full detail", async () => {
    const iterId = db.startIteration();
    db.insertEvent(iterId, "thought", "test");

    const res = await app.request(`/api/telemetry/iteration/${iterId}`);
    const body = await res.json();
    expect(body.iteration.id).toBe(iterId);
    expect(body.events).toHaveLength(1);
  });

  it("GET /vitals returns time-series data", async () => {
    db.insertVitals(10, 100, 500);
    db.insertVitals(20, 200, 600);

    const res = await app.request("/api/telemetry/vitals?limit=10");
    const body = await res.json();
    expect(body.vitals).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd control-plane && bun test src/routes/telemetry.test.ts`
Expected: FAIL

**Step 3: Write the telemetry routes**

```typescript
// control-plane/src/routes/telemetry.ts
import { Hono } from "hono";
import type { createDb } from "../db";
import type { WsBroadcaster } from "../ws";

export function telemetryRoutes(db: ReturnType<typeof createDb>, broadcaster: WsBroadcaster) {
  const app = new Hono();

  app.post("/stream", async (c) => {
    const body = await c.req.json<{
      iterationId: number;
      events: { type: string; summary: string; timestamp?: string }[];
    }>();

    for (const event of body.events) {
      db.insertEvent(body.iterationId, event.type, event.summary);
      broadcaster.broadcast({
        type: event.type,
        data: { iterationId: body.iterationId, summary: event.summary },
        timestamp: event.timestamp,
      });
    }

    return c.json({ received: body.events.length });
  });

  app.post("/summary", async (c) => {
    const body = await c.req.json<{
      iterationId: number;
      summary: string;
      actionCount: number;
      errorCount: number;
      vitals: { cpu: number; memory: number; disk: number };
    }>();

    db.endIteration(body.iterationId, body.summary, body.actionCount, body.errorCount);
    db.insertVitals(body.vitals.cpu, body.vitals.memory, body.vitals.disk);

    broadcaster.broadcast({
      type: "iteration_end",
      data: {
        iterationId: body.iterationId,
        summary: body.summary,
        vitals: body.vitals,
      },
    });

    return c.json({ ok: true });
  });

  app.get("/iterations", (c) => {
    const limit = Number(c.req.query("limit") ?? 20);
    const offset = Number(c.req.query("offset") ?? 0);
    return c.json({ iterations: db.getIterations(limit, offset) });
  });

  app.get("/iteration/:id", (c) => {
    const id = Number(c.req.param("id"));
    const iteration = db.getIteration(id);
    if (!iteration) return c.json({ error: "not found" }, 404);
    const events = db.getEventsByIteration(id);
    return c.json({ iteration, events });
  });

  app.get("/vitals", (c) => {
    const limit = Number(c.req.query("limit") ?? 100);
    return c.json({ vitals: db.getVitals(limit) });
  });

  return app;
}
```

**Step 4: Wire into index.ts**

Add to `control-plane/src/index.ts`:
```typescript
import { telemetryRoutes } from "./routes/telemetry";

app.route("/api/telemetry", telemetryRoutes(db, broadcaster));
```

**Step 5: Run tests to verify they pass**

Run: `cd control-plane && bun test src/routes/telemetry.test.ts`
Expected: All 5 tests PASS

**Step 6: Commit**

```bash
git add control-plane/src/routes/telemetry.ts control-plane/src/routes/telemetry.test.ts control-plane/src/index.ts
git commit -m "feat: add telemetry ingestion, summary, and query routes"
```

---

## Task 8: Control Plane -- Full Integration & Raw Log Storage

**Files:**
- Modify: `control-plane/src/index.ts` (final assembly)
- Create: `control-plane/src/logs.ts`
- Test: `control-plane/src/logs.test.ts`

Raw JSON event streams are stored as files: `data/logs/iteration-{id}.json`.

**Step 1: Write the failing test**

```typescript
// control-plane/src/logs.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { LogStore } from "./logs";

describe("LogStore", () => {
  let dir: string;
  let store: LogStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "goku-logs-"));
    store = new LogStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("appends events to an iteration log file", () => {
    store.append(1, { type: "thought", data: "hello" });
    store.append(1, { type: "tool_call", data: "ls" });
    const events = store.read(1);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("thought");
  });

  it("returns empty array for nonexistent iteration", () => {
    const events = store.read(999);
    expect(events).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd control-plane && bun test src/logs.test.ts`
Expected: FAIL

**Step 3: Write the log store**

```typescript
// control-plane/src/logs.ts
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join } from "path";

export class LogStore {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private path(iterationId: number) {
    return join(this.dir, `iteration-${iterationId}.jsonl`);
  }

  append(iterationId: number, event: Record<string, unknown>) {
    const line = JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + "\n";
    appendFileSync(this.path(iterationId), line);
  }

  read(iterationId: number): Record<string, unknown>[] {
    const p = this.path(iterationId);
    if (!existsSync(p)) return [];
    const content = readFileSync(p, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => JSON.parse(line));
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd control-plane && bun test src/logs.test.ts`
Expected: All 2 tests PASS

**Step 5: Assemble final index.ts**

Write the complete `control-plane/src/index.ts` with all components wired together:

```typescript
// control-plane/src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { upgradeWebSocket, websocket } from "hono/bun";
import { createDb } from "./db";
import { DockerClient } from "./docker";
import { SandboxManager } from "./sandbox";
import { WsBroadcaster } from "./ws";
import { LogStore } from "./logs";
import { promptRoutes } from "./routes/prompt";
import { sandboxRoutes } from "./routes/sandbox";
import { telemetryRoutes } from "./routes/telemetry";

const db = createDb("data/sandbox.db");
const docker = new DockerClient();
const sandbox = new SandboxManager(docker);
const broadcaster = new WsBroadcaster();
const logs = new LogStore("data/logs");

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api/prompt", promptRoutes(db));
app.route("/api/sandbox", sandboxRoutes(sandbox));
app.route("/api/telemetry", telemetryRoutes(db, broadcaster));

app.get(
  "/ws/live",
  upgradeWebSocket(() => ({
    onOpen(_, ws) {
      broadcaster.register(ws);
      ws.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));
    },
    onClose(_, ws) {
      broadcaster.remove(ws);
    },
  }))
);

export default {
  port: 3000,
  fetch: app.fetch,
  websocket,
};
```

**Step 6: Run all control plane tests**

Run: `cd control-plane && bun test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add control-plane/
git commit -m "feat: complete control plane with log storage and full integration"
```

---

## Task 9: Sandbox -- Dockerfile & OpenCode Config

**Files:**
- Create: `sandbox/Dockerfile`
- Create: `sandbox/opencode.json`
- Create: `sandbox/BOOTSTRAP.md`

**Step 1: Write the Dockerfile**

```dockerfile
# sandbox/Dockerfile
FROM ubuntu:24.04

# System packages
RUN apt-get update && apt-get install -y \
    curl git jq wget python3 build-essential nodejs npm \
    procps sysstat \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode
RUN curl -fsSL https://opencode.ai/install | bash

# Create directories
RUN mkdir -p /state /workspace

# Copy config files
COPY opencode.json /workspace/opencode.json
COPY BOOTSTRAP.md /state/BOOTSTRAP.md
COPY agent-loop.sh /usr/local/bin/agent-loop.sh
RUN chmod +x /usr/local/bin/agent-loop.sh

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/agent-loop.sh"]
```

**Step 2: Write the OpenCode config**

```json
// sandbox/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "{env:OPENCODE_MODEL}",
  "provider": {
    "default": {
      "name": "LLM Provider",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "apiKey": "{env:LLM_API_KEY}",
        "baseURL": "{env:LLM_BASE_URL}"
      },
      "models": {
        "default": {
          "name": "Default Model",
          "tool_call": true,
          "limit": {
            "context": 200000,
            "output": 65536
          }
        }
      }
    }
  },
  "permission": {
    "edit": "allow",
    "bash": "allow",
    "read": "allow",
    "write": "allow"
  },
  "share": "disabled",
  "disabled_providers": ["opencode"]
}
```

**Step 3: Write the bootstrap state file**

```markdown
<!-- sandbox/BOOTSTRAP.md -->
# Goku-in-a-Box - Bootstrap State

## Identity
I am an autonomous AI agent running in a sandboxed Docker container.

## Environment
- Control plane: ${CONTROL_PLANE_URL}
- Working directory: /workspace
- State file: /state/BOOTSTRAP.md

## Memory Systems
None set up yet.

## Current Task
No prompt assigned yet. Self-bootstrap mode.

## What I've Done
Nothing yet. First iteration.
```

**Step 4: Verify Dockerfile syntax**

Run: `docker build --check sandbox/` or `docker build -f sandbox/Dockerfile --no-cache --dry-run sandbox/` (if supported). Otherwise just verify the file exists and is valid.

**Step 5: Commit**

```bash
git add sandbox/Dockerfile sandbox/opencode.json sandbox/BOOTSTRAP.md
git commit -m "feat: add sandbox Dockerfile, OpenCode config, and bootstrap state"
```

---

## Task 10: Sandbox -- Agent Loop Script

**Files:**
- Create: `sandbox/agent-loop.sh`

This is the core loop: starts OpenCode server, then repeatedly fetches the prompt, composes an instruction, runs OpenCode, streams events to the control plane, and reports vitals.

**Step 1: Write the agent loop script**

```bash
#!/usr/bin/env bash
set -euo pipefail

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://host.docker.internal:3000}"
ITERATION_SLEEP="${ITERATION_SLEEP:-2}"
OPENCODE_PORT=4096

log() { echo "[agent-loop] $(date -Iseconds) $*"; }

# --- Start OpenCode server ---
log "Starting OpenCode server on port $OPENCODE_PORT..."
opencode serve --port "$OPENCODE_PORT" --hostname 0.0.0.0 &
OPENCODE_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$OPENCODE_PORT/health" > /dev/null 2>&1; then
    log "OpenCode server ready"
    break
  fi
  sleep 1
done

# --- Helper: collect vitals ---
collect_vitals() {
  local cpu mem disk
  cpu=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' 2>/dev/null || echo "0")
  mem=$(free -m | awk '/Mem:/{print $3}' 2>/dev/null || echo "0")
  disk=$(df -m /workspace | awk 'NR==2{print $3}' 2>/dev/null || echo "0")
  echo "{\"cpu\": $cpu, \"memory\": $mem, \"disk\": $disk}"
}

# --- Main loop ---
PREV_PROMPT=""
ITERATION=0

while true; do
  ITERATION=$((ITERATION + 1))
  log "=== Iteration $ITERATION ==="

  # 1. Fetch current prompt
  PROMPT_RESPONSE=$(curl -sf "$CONTROL_PLANE_URL/api/prompt" || echo '{"content":""}')
  CURRENT_PROMPT=$(echo "$PROMPT_RESPONSE" | jq -r '.content // ""')

  # 2. Read bootstrap state
  BOOTSTRAP=$(cat /state/BOOTSTRAP.md 2>/dev/null || echo "No bootstrap state found.")

  # 3. Compose instruction
  INSTRUCTION="## Bootstrap State\n$BOOTSTRAP\n\n"

  if [ -z "$CURRENT_PROMPT" ]; then
    INSTRUCTION+="## Mode: Self-Bootstrap\nNo prompt has been assigned. Explore your environment, install useful tools, set up your state file at /state/BOOTSTRAP.md, and report readiness."
  else
    INSTRUCTION+="## Current Prompt\n$CURRENT_PROMPT"

    if [ "$CURRENT_PROMPT" != "$PREV_PROMPT" ] && [ -n "$PREV_PROMPT" ]; then
      INSTRUCTION+="\n\n## Notice: Prompt Changed\nThe human has updated the prompt.\nPrevious: $PREV_PROMPT\nCurrent: $CURRENT_PROMPT"
    fi
  fi

  INSTRUCTION+="\n\n## Instructions\n- Update /state/BOOTSTRAP.md with your progress after completing work.\n- Your working directory is /workspace."

  # 4. Register iteration with control plane
  ITER_RESPONSE=$(curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/stream" \
    -H "Content-Type: application/json" \
    -d "{\"iterationId\": $ITERATION, \"events\": [{\"type\": \"iteration_start\", \"summary\": \"Starting iteration $ITERATION\"}]}" \
    || echo '{}')

  # 5. Run OpenCode and stream events
  ACTION_COUNT=0
  ERROR_COUNT=0
  SUMMARY=""

  opencode run \
    --attach "http://localhost:$OPENCODE_PORT" \
    --format json \
    "$(echo -e "$INSTRUCTION")" 2>/dev/null | while IFS= read -r line; do

    # Forward each NDJSON event to control plane
    EVENT_TYPE=$(echo "$line" | jq -r '.type // "unknown"' 2>/dev/null || echo "unknown")
    EVENT_SUMMARY=""

    case "$EVENT_TYPE" in
      text)
        EVENT_SUMMARY=$(echo "$line" | jq -r '.part.text // ""' 2>/dev/null | head -c 200)
        ;;
      tool_use)
        EVENT_SUMMARY=$(echo "$line" | jq -r '.part.state.title // .part.tool // "tool call"' 2>/dev/null)
        ACTION_COUNT=$((ACTION_COUNT + 1))
        ;;
      error)
        EVENT_SUMMARY=$(echo "$line" | jq -r '.error.data.message // "error"' 2>/dev/null)
        ERROR_COUNT=$((ERROR_COUNT + 1))
        ;;
      *)
        EVENT_SUMMARY="$EVENT_TYPE event"
        ;;
    esac

    curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/stream" \
      -H "Content-Type: application/json" \
      -d "{\"iterationId\": $ITERATION, \"events\": [{\"type\": \"$EVENT_TYPE\", \"summary\": $(echo "$EVENT_SUMMARY" | jq -Rs .)}]}" \
      > /dev/null 2>&1 || true
  done

  # 6. Report end-of-iteration summary + vitals
  VITALS=$(collect_vitals)

  curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/summary" \
    -H "Content-Type: application/json" \
    -d "{
      \"iterationId\": $ITERATION,
      \"summary\": \"Iteration $ITERATION completed\",
      \"actionCount\": $ACTION_COUNT,
      \"errorCount\": $ERROR_COUNT,
      \"vitals\": $VITALS
    }" > /dev/null 2>&1 || true

  log "Iteration $ITERATION complete. Actions: $ACTION_COUNT, Errors: $ERROR_COUNT"

  PREV_PROMPT="$CURRENT_PROMPT"

  # 7. Sleep before next iteration
  sleep "$ITERATION_SLEEP"
done
```

**Step 2: Verify script syntax**

Run: `bash -n sandbox/agent-loop.sh`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add sandbox/agent-loop.sh
git commit -m "feat: add agent loop script with OpenCode server and telemetry streaming"
```

---

## Task 11: Docker Compose & Build Verification

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Modify: `control-plane/package.json` (add scripts)

**Step 1: Write docker-compose.yml**

```yaml
# docker-compose.yml
services:
  control-plane:
    build: ./control-plane
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - NODE_ENV=production
  dashboard:
    build: ./dashboard
    ports:
      - "5173:5173"
    depends_on:
      - control-plane
```

Note: The sandbox container is NOT in docker-compose. It is created dynamically by the control plane.

**Step 2: Write .env.example**

```bash
# .env.example
# LLM Configuration (passed to sandbox container)
LLM_API_KEY=your-api-key-here
LLM_BASE_URL=https://api.openai.com/v1
OPENCODE_MODEL=openai/gpt-4o

# Optional: iteration delay in seconds
ITERATION_SLEEP=2
```

**Step 3: Add Dockerfile for control plane**

```dockerfile
# control-plane/Dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production

COPY src/ ./src/

RUN mkdir -p data/logs

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
```

**Step 4: Verify docker-compose config**

Run: `docker compose config`
Expected: Valid YAML output

**Step 5: Commit**

```bash
git add docker-compose.yml .env.example control-plane/Dockerfile
git commit -m "feat: add Docker Compose config and control plane Dockerfile"
```

---

## Task 12: Dashboard -- Project Scaffolding

**Files:**
- Create: `dashboard/` (via Vite scaffolding)

**Step 1: Scaffold the React project**

```bash
cd /path/to/goku-in-a-box
bun create vite dashboard --template react-ts
cd dashboard
bun install
```

**Step 2: Install dependencies**

```bash
cd dashboard
bun add @tanstack/react-query @monaco-editor/react recharts
bun add -d tailwindcss @tailwindcss/vite
```

**Step 3: Configure Tailwind**

Update `dashboard/vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
```

Add to `dashboard/src/index.css`:
```css
@import "tailwindcss";
```

**Step 4: Set up API client and QueryClient**

```typescript
// dashboard/src/api/client.ts
const API_BASE = "/api";

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return fetchJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function putJson<T>(path: string, body: unknown): Promise<T> {
  return fetchJson(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

**Step 5: Create WebSocket hook**

```typescript
// dashboard/src/hooks/useWebSocket.ts
import { useEffect, useRef, useCallback, useState } from "react";

type WsEvent = { type: string; data: unknown; timestamp: string };

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [events, setEvents] = useState<WsEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as WsEvent;
        setEvents((prev) => [...prev.slice(-500), event]);
      } catch {}
    };

    return () => ws.close();
  }, [url]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}
```

**Step 6: Verify dev server runs**

Run: `cd dashboard && bun run dev`
Expected: Vite dev server starts on port 5173

**Step 7: Commit**

```bash
git add dashboard/
git commit -m "feat: scaffold dashboard with React, Vite, Tailwind, TanStack Query"
```

---

## Task 13: Dashboard -- Header & Status Component

**Files:**
- Create: `dashboard/src/components/Header.tsx`
- Modify: `dashboard/src/App.tsx`

**Step 1: Write the Header component**

```tsx
// dashboard/src/components/Header.tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, postJson } from "../api/client";

type SandboxStatus = { status: "running" | "stopped" | "not_running"; containerId?: string };

export function Header() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["sandbox-status"],
    queryFn: () => fetchJson<SandboxStatus>("/sandbox/status"),
    refetchInterval: 5000,
  });

  const startMutation = useMutation({
    mutationFn: () => postJson("/sandbox/start", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sandbox-status"] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => postJson("/sandbox/stop", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sandbox-status"] }),
  });

  const isRunning = status?.status === "running";

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-gray-900 text-white border-b border-gray-700">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold tracking-tight">Goku-in-a-Box</h1>
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${isRunning ? "bg-green-400 animate-pulse" : "bg-gray-500"}`}
          />
          <span className="text-sm text-gray-300 capitalize">
            {status?.status ?? "loading..."}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => startMutation.mutate()}
          disabled={isRunning || startMutation.isPending}
          className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
        >
          {startMutation.isPending ? "Starting..." : "Start"}
        </button>
        <button
          onClick={() => stopMutation.mutate()}
          disabled={!isRunning || stopMutation.isPending}
          className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
        >
          {stopMutation.isPending ? "Stopping..." : "Stop"}
        </button>
      </div>
    </header>
  );
}
```

**Step 2: Wire up App.tsx**

```tsx
// dashboard/src/App.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Header } from "./components/Header";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
        <Header />
        <main className="flex-1 grid grid-cols-[1fr_350px] grid-rows-[1fr_1fr] gap-4 p-4 overflow-hidden">
          {/* Prompt Editor - top left */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <p className="text-gray-500">Prompt Editor</p>
          </div>
          {/* Live Stream - top right */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 row-span-2 overflow-auto">
            <p className="text-gray-500">Live Stream</p>
          </div>
          {/* Bottom left: Vitals + Timeline */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 flex gap-4">
            <div className="flex-1">
              <p className="text-gray-500">System Vitals</p>
            </div>
            <div className="flex-1">
              <p className="text-gray-500">Iteration Timeline</p>
            </div>
          </div>
        </main>
      </div>
    </QueryClientProvider>
  );
}
```

**Step 3: Verify it renders**

Run: `cd dashboard && bun run dev`
Open browser: `http://localhost:5173`
Expected: Header with status indicator and start/stop buttons, placeholder grid

**Step 4: Commit**

```bash
git add dashboard/src/components/Header.tsx dashboard/src/App.tsx
git commit -m "feat: add dashboard header with sandbox status and start/stop controls"
```

---

## Task 14: Dashboard -- Prompt Editor

**Files:**
- Create: `dashboard/src/components/PromptEditor.tsx`
- Modify: `dashboard/src/App.tsx`

**Step 1: Write the PromptEditor component**

```tsx
// dashboard/src/components/PromptEditor.tsx
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import { fetchJson, putJson } from "../api/client";

type PromptData = { content: string; updated_at: string | null };

export function PromptEditor() {
  const queryClient = useQueryClient();
  const [localContent, setLocalContent] = useState<string | null>(null);

  const { data: prompt } = useQuery({
    queryKey: ["prompt"],
    queryFn: () => fetchJson<PromptData>("/prompt"),
  });

  const saveMutation = useMutation({
    mutationFn: (content: string) => putJson("/prompt", { content }),
    onSuccess: () => {
      setLocalContent(null);
      queryClient.invalidateQueries({ queryKey: ["prompt"] });
    },
  });

  const currentContent = localContent ?? prompt?.content ?? "";
  const isDirty = localContent !== null && localContent !== (prompt?.content ?? "");

  const handleSave = useCallback(() => {
    if (localContent) saveMutation.mutate(localContent);
  }, [localContent, saveMutation]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Prompt</h2>
        <div className="flex items-center gap-2">
          {isDirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
          <button
            onClick={handleSave}
            disabled={!isDirty || saveMutation.isPending}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs font-medium transition-colors"
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      <div className="flex-1 rounded overflow-hidden border border-gray-700">
        <Editor
          defaultLanguage="markdown"
          theme="vs-dark"
          value={currentContent}
          onChange={(value) => setLocalContent(value ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: "off",
            wordWrap: "on",
            padding: { top: 12 },
          }}
        />
      </div>
    </div>
  );
}
```

**Step 2: Add to App.tsx**

Replace the "Prompt Editor" placeholder in App.tsx with `<PromptEditor />`.

**Step 3: Verify it renders**

Run: `cd dashboard && bun run dev`
Expected: Monaco editor visible in top-left panel, Save button works

**Step 4: Commit**

```bash
git add dashboard/src/components/PromptEditor.tsx dashboard/src/App.tsx
git commit -m "feat: add Monaco-based prompt editor with save and dirty state"
```

---

## Task 15: Dashboard -- Live Stream

**Files:**
- Create: `dashboard/src/components/LiveStream.tsx`
- Modify: `dashboard/src/App.tsx`

**Step 1: Write the LiveStream component**

```tsx
// dashboard/src/components/LiveStream.tsx
import { useRef, useEffect } from "react";
import { useWebSocket } from "../hooks/useWebSocket";

const EVENT_COLORS: Record<string, string> = {
  thought: "text-blue-400",
  tool_call: "text-yellow-400",
  text: "text-gray-300",
  error: "text-red-400",
  iteration_start: "text-green-400",
  iteration_end: "text-green-400",
  connected: "text-purple-400",
};

export function LiveStream() {
  const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/live`;
  const { events, connected } = useWebSocket(wsUrl);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Live Stream</h2>
        <span className={`text-xs ${connected ? "text-green-400" : "text-red-400"}`}>
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs space-y-1">
        {events.length === 0 && (
          <p className="text-gray-600 italic">Waiting for events...</p>
        )}
        {events.map((event, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-gray-600 shrink-0">
              {new Date(event.timestamp).toLocaleTimeString()}
            </span>
            <span className={`font-semibold shrink-0 ${EVENT_COLORS[event.type] ?? "text-gray-400"}`}>
              [{event.type}]
            </span>
            <span className="text-gray-300 truncate">
              {typeof event.data === "object" && event.data !== null
                ? (event.data as any).summary ?? JSON.stringify(event.data)
                : String(event.data)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
```

**Step 2: Add to App.tsx**

Replace the "Live Stream" placeholder.

**Step 3: Verify it renders**

Expected: Live stream panel shows "Disconnected" (no backend running) or "Connected" + events when backend is running.

**Step 4: Commit**

```bash
git add dashboard/src/components/LiveStream.tsx dashboard/src/App.tsx
git commit -m "feat: add real-time live stream component with WebSocket"
```

---

## Task 16: Dashboard -- System Vitals

**Files:**
- Create: `dashboard/src/components/Vitals.tsx`
- Modify: `dashboard/src/App.tsx`

**Step 1: Write the Vitals component**

```tsx
// dashboard/src/components/Vitals.tsx
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchJson } from "../api/client";

type VitalPoint = { timestamp: string; cpu_pct: number; memory_mb: number; disk_mb: number };

export function Vitals() {
  const { data } = useQuery({
    queryKey: ["vitals"],
    queryFn: () => fetchJson<{ vitals: VitalPoint[] }>("/telemetry/vitals?limit=60"),
    refetchInterval: 10000,
  });

  const points = (data?.vitals ?? []).reverse().map((v) => ({
    ...v,
    time: new Date(v.timestamp).toLocaleTimeString(),
  }));

  const latest = data?.vitals?.[0];

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">System Vitals</h2>

      {latest && (
        <div className="flex gap-4 mb-3 text-xs">
          <div>
            <span className="text-gray-500">CPU</span>{" "}
            <span className="text-cyan-400 font-mono">{latest.cpu_pct.toFixed(1)}%</span>
          </div>
          <div>
            <span className="text-gray-500">MEM</span>{" "}
            <span className="text-green-400 font-mono">{latest.memory_mb}MB</span>
          </div>
          <div>
            <span className="text-gray-500">DISK</span>{" "}
            <span className="text-yellow-400 font-mono">{latest.disk_mb}MB</span>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#6b7280" />
            <YAxis tick={{ fontSize: 10 }} stroke="#6b7280" />
            <Tooltip
              contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
              labelStyle={{ color: "#9ca3af" }}
            />
            <Line type="monotone" dataKey="cpu_pct" stroke="#06b6d4" strokeWidth={2} dot={false} name="CPU %" />
            <Line type="monotone" dataKey="memory_mb" stroke="#22c55e" strokeWidth={2} dot={false} name="Memory MB" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

**Step 2: Add to App.tsx**

Replace the "System Vitals" placeholder.

**Step 3: Commit**

```bash
git add dashboard/src/components/Vitals.tsx dashboard/src/App.tsx
git commit -m "feat: add system vitals component with Recharts time-series"
```

---

## Task 17: Dashboard -- Iteration Timeline

**Files:**
- Create: `dashboard/src/components/IterationTimeline.tsx`
- Modify: `dashboard/src/App.tsx`

**Step 1: Write the IterationTimeline component**

```tsx
// dashboard/src/components/IterationTimeline.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../api/client";

type Iteration = {
  id: number;
  start_time: string;
  end_time: string | null;
  summary: string | null;
  action_count: number;
  error_count: number;
};

type IterationDetail = {
  iteration: Iteration;
  events: { id: number; type: string; summary: string; timestamp: string }[];
};

export function IterationTimeline() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ["iterations"],
    queryFn: () => fetchJson<{ iterations: Iteration[] }>("/telemetry/iterations?limit=50"),
    refetchInterval: 5000,
  });

  const { data: detail } = useQuery({
    queryKey: ["iteration", selectedId],
    queryFn: () => fetchJson<IterationDetail>(`/telemetry/iteration/${selectedId}`),
    enabled: selectedId !== null,
  });

  const iterations = data?.iterations ?? [];

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Iterations</h2>
      <div className="flex-1 overflow-auto space-y-1">
        {iterations.length === 0 && (
          <p className="text-gray-600 italic text-xs">No iterations yet</p>
        )}
        {iterations.map((iter) => (
          <button
            key={iter.id}
            onClick={() => setSelectedId(iter.id === selectedId ? null : iter.id)}
            className={`w-full text-left p-2 rounded text-xs transition-colors ${
              iter.id === selectedId ? "bg-gray-700" : "hover:bg-gray-800"
            }`}
          >
            <div className="flex justify-between">
              <span className="font-mono text-gray-400">#{iter.id}</span>
              <span className="text-gray-500">
                {iter.action_count} actions
                {iter.error_count > 0 && (
                  <span className="text-red-400 ml-1">({iter.error_count} errors)</span>
                )}
              </span>
            </div>
            {iter.summary && (
              <p className="text-gray-300 truncate mt-0.5">{iter.summary}</p>
            )}
          </button>
        ))}
      </div>

      {detail && (
        <div className="mt-2 pt-2 border-t border-gray-700 max-h-40 overflow-auto text-xs space-y-1">
          {detail.events.map((e) => (
            <div key={e.id} className="flex gap-2">
              <span className="text-gray-600 shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
              <span className="text-yellow-400 shrink-0">[{e.type}]</span>
              <span className="text-gray-300 truncate">{e.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add to App.tsx**

Replace the "Iteration Timeline" placeholder.

**Step 3: Verify full dashboard renders**

Run: `cd dashboard && bun run dev`
Expected: All four panels visible -- Prompt Editor, Live Stream, Vitals, Iteration Timeline

**Step 4: Commit**

```bash
git add dashboard/src/components/IterationTimeline.tsx dashboard/src/App.tsx
git commit -m "feat: add iteration timeline with expandable detail view"
```

---

## Task 18: Dashboard -- Dockerfile & Final Assembly

**Files:**
- Create: `dashboard/Dockerfile`
- Modify: `dashboard/src/App.tsx` (final version)

**Step 1: Write the Dashboard Dockerfile**

```dockerfile
# dashboard/Dockerfile
FROM oven/bun:1 AS build

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install

COPY . .
RUN bun run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
```

**Step 2: Write nginx config for SPA + proxy**

```nginx
# dashboard/nginx.conf
server {
    listen 5173;

    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://control-plane:3000;
    }

    location /ws/ {
        proxy_pass http://control-plane:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

**Step 3: Verify build works**

Run: `cd dashboard && bun run build`
Expected: Build succeeds, output in `dist/`

**Step 4: Commit**

```bash
git add dashboard/Dockerfile dashboard/nginx.conf
git commit -m "feat: add dashboard Dockerfile with nginx SPA serving and API proxy"
```

---

## Task 19: End-to-End Smoke Test

**Files:** None new -- this is verification only.

**Step 1: Build the sandbox image**

```bash
docker build -t goku-sandbox:latest ./sandbox
```

**Step 2: Start the control plane locally**

```bash
cd control-plane && bun run src/index.ts &
```

**Step 3: Verify all API endpoints**

```bash
# Health
curl http://localhost:3000/health

# Prompt
curl http://localhost:3000/api/prompt
curl -X PUT http://localhost:3000/api/prompt -H 'Content-Type: application/json' -d '{"content":"Hello world"}'
curl http://localhost:3000/api/prompt

# Sandbox status
curl http://localhost:3000/api/sandbox/status

# Telemetry (with seeded data)
curl http://localhost:3000/api/telemetry/iterations
curl http://localhost:3000/api/telemetry/vitals
```

**Step 4: Start the dashboard**

```bash
cd dashboard && bun run dev
```

Open `http://localhost:5173` -- verify all panels render and connect to the control plane.

**Step 5: Test full docker-compose flow**

```bash
docker compose up --build
```

Expected: Both services start, dashboard accessible at `:5173`, control plane at `:3000`.

**Step 6: Run all tests**

```bash
cd control-plane && bun test
```

Expected: All tests pass.

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete goku-in-a-box MVP with all three components"
```

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | Control Plane | Project scaffolding (Bun + Hono) |
| 2 | Control Plane | Database layer (bun:sqlite) |
| 3 | Control Plane | Prompt GET/PUT routes |
| 4 | Control Plane | Docker client (native fetch + unix socket) |
| 5 | Control Plane | Sandbox manager & routes |
| 6 | Control Plane | WebSocket broadcaster |
| 7 | Control Plane | Telemetry routes |
| 8 | Control Plane | Log storage & final assembly |
| 9 | Sandbox | Dockerfile, OpenCode config, Bootstrap |
| 10 | Sandbox | Agent loop script |
| 11 | Infrastructure | Docker Compose & env config |
| 12 | Dashboard | Project scaffolding (React + Vite + Tailwind) |
| 13 | Dashboard | Header & status component |
| 14 | Dashboard | Prompt editor (Monaco) |
| 15 | Dashboard | Live stream (WebSocket) |
| 16 | Dashboard | System vitals (Recharts) |
| 17 | Dashboard | Iteration timeline |
| 18 | Dashboard | Dockerfile & build |
| 19 | Integration | End-to-end smoke test |
