import { Hono } from "hono";
import { mkdir } from "node:fs/promises";
import { createWriteStream, unlinkSync, existsSync, renameSync } from "node:fs";
import type { SandboxManager, AgentType } from "../sandbox";
import type { DockerClient } from "../docker";
import type { createDb } from "../db";
import type { WsBroadcaster } from "../ws";

const SNAPSHOT_DIR = "data/snapshots";

function buildEnv(agentType: AgentType): Record<string, string> {
  const env: Record<string, string> = {};
  if (agentType === "opencode") {
    for (const [envKey, procKey] of [
      ["LLM_API_KEY", "LLM_API_KEY"],
      ["LLM_BASE_URL", "OPENCODE_LLM_HOST"],
      ["OPENCODE_MODEL", "OPENCODE_MODEL"],
      ["ITERATION_SLEEP", "ITERATION_SLEEP"],
    ] as const) {
      const val = process.env[procKey];
      if (val) env[envKey] = val;
    }
  } else {
    if (process.env.LLM_API_KEY) env["OPENAI_API_KEY"] = process.env.LLM_API_KEY;
    if (process.env.GOOSE_LLM_HOST) env["OPENAI_HOST"] = process.env.GOOSE_LLM_HOST;
    if (process.env.GOOSE_MODEL) env["GOOSE_MODEL"] = process.env.GOOSE_MODEL;
    env["GOOSE_PROVIDER"] = "openai";
    env["GOOSE_MODE"] = "auto";
    env["GOOSE_DISABLE_KEYRING"] = "1";
    if (process.env.ITERATION_SLEEP) env["ITERATION_SLEEP"] = process.env.ITERATION_SLEEP;
  }
  return env;
}

export function snapshotRoutes(
  sandbox: SandboxManager,
  docker: DockerClient,
  db: ReturnType<typeof createDb>,
  broadcaster: WsBroadcaster,
) {
  const app = new Hono();

  app.post("/capture", async (c) => {
    if (!sandbox.containerId || !sandbox.agentType) {
      return c.json({ error: "Sandbox not running" }, 503);
    }

    const body = (await c.req.json().catch(() => ({}))) as { label?: string };
    const agentType = sandbox.agentType;

    await mkdir(SNAPSHOT_DIR, { recursive: true });

    const tmpFile = `${SNAPSHOT_DIR}/snapshot-tmp-${Date.now()}.tar`;
    let sizeBytes = 0;

    try {
      const tarStream = await sandbox.snapshot();

      await new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(tmpFile);
        ws.on("finish", resolve);
        ws.on("error", reject);
        const reader = tarStream.getReader();
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              sizeBytes += value.byteLength;
              ws.write(value);
            }
            ws.end();
          } catch (err) {
            ws.destroy();
            reject(err);
          }
        })();
      });
    } catch (err) {
      try { unlinkSync(tmpFile); } catch {}
      return c.json({ error: String(err) }, 500);
    }

    const label =
      body.label?.trim() ||
      `Snapshot — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const id = db.insertSnapshot(label, agentType, "pending", sizeBytes);

    const filename = `snapshot-${id}.tar`;
    try {
      renameSync(tmpFile, `${SNAPSHOT_DIR}/${filename}`);
    } catch (err) {
      try { unlinkSync(tmpFile); } catch {}
      db.deleteSnapshot(id);
      return c.json({ error: String(err) }, 500);
    }
    db.updateSnapshotFilename(id, filename);

    const row = db.getSnapshot(id)!;
    return c.json({
      id: row.id,
      label: row.label,
      agentType: row.agent_type,
      filename: row.filename,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
    });
  });

  app.get("/", (c) => {
    const limit = Number(c.req.query("limit") ?? 20);
    const snapshots = db.listSnapshots(limit).map((s) => ({
      id: s.id,
      label: s.label,
      agentType: s.agent_type,
      filename: s.filename,
      sizeBytes: s.size_bytes,
      createdAt: s.created_at,
    }));
    return c.json({ snapshots });
  });

  app.post("/:id/restore", async (c) => {
    const id = Number(c.req.param("id"));
    const row = db.getSnapshot(id);
    if (!row) return c.json({ error: "Snapshot not found" }, 404);

    const agentType = row.agent_type as AgentType;
    const tarPath = `${SNAPSHOT_DIR}/${row.filename}`;

    if (!existsSync(tarPath)) {
      return c.json({ error: "Snapshot file missing from disk" }, 500);
    }

    const tarBytes = await Bun.file(tarPath).arrayBuffer();
    const env = buildEnv(agentType);

    db.closeOpenIterations();
    db.endAllOpenSessions();
    const containerId = await sandbox.restoreStart(agentType, env, tarBytes);
    db.createSession(containerId, agentType);
    broadcaster.broadcast({ type: "session_start", data: { containerId, agentType } });

    return c.json({ containerId, agentType, snapshotId: id });
  });

  app.delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const row = db.getSnapshot(id);
    if (!row) return c.json({ error: "Snapshot not found" }, 404);

    const tarPath = `${SNAPSHOT_DIR}/${row.filename}`;
    if (existsSync(tarPath)) {
      unlinkSync(tarPath);
    }
    db.deleteSnapshot(id);
    return c.json({ ok: true });
  });

  return app;
}
