import { Hono } from "hono";
import type { createDb } from "../db";
import type { WsBroadcaster } from "../ws";
import type { createLlm } from "../llm";
import type { SandboxManager } from "../sandbox";
import type { DockerClient } from "../docker";
import { readShowcaseManifest } from "./showcase";

export function telemetryRoutes(
  db: ReturnType<typeof createDb>,
  broadcaster: WsBroadcaster,
  llm?: ReturnType<typeof createLlm>,
  sandbox?: SandboxManager,
  docker?: DockerClient,
) {
  const app = new Hono();

  // Map (session-local seq) → DB iteration id for the current session
  const seqToDbId = new Map<number, number>();
  // Dedup: track recent (type, summary) per DB iteration id to skip duplicates from
  // streaming formats that re-emit full message state on each update (e.g. Goose)
  const recentEvents = new Map<number, Set<string>>();

  /** Resolve agent's session-local seq number to a DB iteration id, creating if needed. */
  function resolveIteration(seq: number): number {
    if (seqToDbId.has(seq)) return seqToDbId.get(seq)!;

    const session = db.getActiveSession() ?? db.getLatestSession();
    const sessionId = session?.container_id;

    let dbId: number;
    db.closeOpenIterations();
    if (sessionId) {
      dbId = db.startIterationBySeq(seq, sessionId);
    } else {
      // Fallback: no active session (shouldn't happen normally)
      dbId = db.startIteration(undefined, undefined);
    }

    seqToDbId.set(seq, dbId);
    recentEvents.set(dbId, new Set());
    return dbId;
  }

  app.post("/stream", async (c) => {
    const body = await c.req.json<{
      iterationId: number;
      events: { type: string; summary: string; content?: string; timestamp?: string }[];
    }>();

    const seq = body.iterationId; // Agent sends session-local seq
    const dbIterationId = resolveIteration(seq);
    const seen = recentEvents.get(dbIterationId)!;

    let actionCount = 0;
    for (const event of body.events) {
      // Dedup key: type + first 200 chars of summary (enough to identify repeats)
      const dedupKey = `${event.type}::${event.summary?.slice(0, 200) ?? ""}`;
      if (event.type !== "iteration_start" && event.type !== "iteration_end" && seen.has(dedupKey)) {
        continue;
      }
      seen.add(dedupKey);

      db.insertEvent(dbIterationId, event.type, event.summary, event.content);
      if (event.type === "tool_use") actionCount++;
      broadcaster.broadcast({
        type: event.type,
        data: { iterationId: seq, summary: event.summary, content: event.content },
        timestamp: event.timestamp,
      });

      // Detect showcase manifest changes
      if (
        sandbox &&
        docker &&
        (event.summary?.includes(".showcase.json") ||
          event.content?.includes(".showcase.json"))
      ) {
        readShowcaseManifest(sandbox, docker).then((manifest) => {
          if (manifest) {
            broadcaster.broadcast({ type: "showcase_ready", data: manifest });
          }
        }).catch(() => {});
      }
    }

    // Update action count in real-time so the dashboard shows progress (without setting end_time)
    if (actionCount > 0) {
      const iter = db.getIteration(dbIterationId);
      if (iter) {
        db.updateIterationCounts(dbIterationId, iter.action_count + actionCount, iter.error_count);
      }
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

    const seq = body.iterationId;
    const dbIterationId = resolveIteration(seq);

    db.endIteration(dbIterationId, body.summary, body.actionCount, body.errorCount);
    db.insertVitals(body.vitals.cpu, body.vitals.memory, body.vitals.disk);
    recentEvents.delete(dbIterationId);
    seqToDbId.delete(seq);

    broadcaster.broadcast({
      type: "iteration_end",
      data: {
        iterationId: seq,
        summary: body.summary,
        vitals: body.vitals,
      },
    });

    // Fire-and-forget: generate LLM summary and update
    if (llm) {
      const events = db.getEventsByIteration(dbIterationId);
      console.log(`[llm] Summarizing iteration ${seq} with ${events.length} events...`);
      llm.summarizeIteration(dbIterationId, events).then((llmSummary) => {
        console.log(`[llm] Iteration ${seq} summary: "${llmSummary}"`);
        if (llmSummary) {
          db.endIteration(dbIterationId, llmSummary, body.actionCount, body.errorCount);
          broadcaster.broadcast({
            type: "iteration_summary",
            data: { iterationId: seq, summary: llmSummary },
          });
        }
      }).catch((err) => {
        console.error(`[llm] Summary failed for iteration ${seq}:`, err);
      });
    }

    return c.json({ ok: true });
  });

  app.get("/iterations", (c) => {
    const limit = Number(c.req.query("limit") ?? 20);
    const offset = Number(c.req.query("offset") ?? 0);
    const sessionParam = c.req.query("session");

    if (sessionParam === "current") {
      const session = db.getActiveSession() ?? db.getLatestSession();
      if (session) {
        return c.json({ iterations: db.getIterationsBySession(session.container_id, limit, offset) });
      }
      return c.json({ iterations: [] });
    }

    return c.json({ iterations: db.getIterations(limit, offset) });
  });

  app.get("/iteration/:id", (c) => {
    const id = Number(c.req.param("id"));
    const iteration = db.getIteration(id);
    if (!iteration) return c.json({ error: "not found" }, 404);
    const events = db.getEventsByIteration(id);
    return c.json({ iteration, events });
  });

  app.get("/events/recent", (c) => {
    const limit = Number(c.req.query("limit") ?? 200);
    const session = db.getActiveSession() ?? db.getLatestSession();
    if (!session) return c.json({ events: [] });

    const rows = db.getRecentEventsBySession(session.container_id, limit);
    // Reverse so oldest first (query returns DESC)
    const events = rows.reverse().map((r) => ({
      type: r.type,
      data: { iterationId: r.seq, summary: r.summary, content: r.content },
      timestamp: r.timestamp,
    }));
    return c.json({ events });
  });

  app.get("/vitals", (c) => {
    const limit = Number(c.req.query("limit") ?? 100);
    return c.json({ vitals: db.getVitals(limit) });
  });

  return app;
}
