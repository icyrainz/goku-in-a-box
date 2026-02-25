import { Hono } from "hono";
import type { createDb } from "../db";
import type { WsBroadcaster } from "../ws";
import type { createLlm } from "../llm";

export function telemetryRoutes(
  db: ReturnType<typeof createDb>,
  broadcaster: WsBroadcaster,
  llm?: ReturnType<typeof createLlm>,
) {
  const app = new Hono();

  const knownIterations = new Set<number>();

  app.post("/stream", async (c) => {
    const body = await c.req.json<{
      iterationId: number;
      events: { type: string; summary: string; timestamp?: string }[];
    }>();

    // Auto-create iteration row if we haven't seen this ID
    if (!knownIterations.has(body.iterationId)) {
      if (!db.getIteration(body.iterationId)) {
        db.startIteration();
      }
      knownIterations.add(body.iterationId);
    }

    const dbIterationId = body.iterationId;

    for (const event of body.events) {
      db.insertEvent(dbIterationId, event.type, event.summary);
      broadcaster.broadcast({
        type: event.type,
        data: { iterationId: dbIterationId, summary: event.summary },
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

    // Fire-and-forget: generate LLM summary and update
    if (llm) {
      const iterationId = body.iterationId;
      const actionCount = body.actionCount;
      const errorCount = body.errorCount;
      const events = db.getEventsByIteration(iterationId);
      console.log(`[llm] Summarizing iteration ${iterationId} with ${events.length} events...`);
      llm.summarizeIteration(iterationId, events).then((summary) => {
        console.log(`[llm] Iteration ${iterationId} summary: "${summary}"`);
        if (summary) {
          db.endIteration(iterationId, summary, actionCount, errorCount);
          broadcaster.broadcast({
            type: "iteration_summary",
            data: { iterationId, summary },
          });
        }
      }).catch((err) => {
        console.error(`[llm] Summary failed for iteration ${iterationId}:`, err);
      });
    }

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
