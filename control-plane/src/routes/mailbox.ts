import { Hono } from "hono";
import type { createDb } from "../db";
import type { WsBroadcaster } from "../ws";

export function mailboxRoutes(
  db: ReturnType<typeof createDb>,
  broadcaster: WsBroadcaster,
) {
  const app = new Hono();

  function getActiveSessionId(): string | null {
    return db.getActiveSession()?.container_id ?? null;
  }

  // GET / — current mailbox state for active session
  app.get("/", (c) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      return c.json({ agent_msg: null, human_msg: null });
    }
    const row = db.getMailbox(sessionId);
    return c.json({
      agent_msg: row?.agent_msg ?? null,
      human_msg: row?.human_msg ?? null,
      agent_updated_at: row?.agent_updated_at ?? null,
      human_updated_at: row?.human_updated_at ?? null,
    });
  });

  // PUT /agent — agent writes its message
  app.put("/agent", async (c) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      return c.json({ error: "no active session" }, 400);
    }
    const body = await c.req.json<{ message: string }>();
    if (!body.message?.trim()) {
      return c.json({ error: "message is required" }, 400);
    }
    db.setMailboxAgent(sessionId, body.message.trim());
    broadcaster.broadcast({
      type: "mailbox_update",
      data: { side: "agent", message: body.message.trim() },
    });
    const row = db.getMailbox(sessionId);
    return c.json({
      agent_msg: row?.agent_msg ?? null,
      human_msg: row?.human_msg ?? null,
      agent_updated_at: row?.agent_updated_at ?? null,
      human_updated_at: row?.human_updated_at ?? null,
    });
  });

  // PUT /human — user writes their message
  app.put("/human", async (c) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      return c.json({ error: "no active session" }, 400);
    }
    const body = await c.req.json<{ message: string }>();
    if (!body.message?.trim()) {
      return c.json({ error: "message is required" }, 400);
    }
    db.setMailboxHuman(sessionId, body.message.trim());
    broadcaster.broadcast({
      type: "mailbox_update",
      data: { side: "human", message: body.message.trim() },
    });
    const row = db.getMailbox(sessionId);
    return c.json({
      agent_msg: row?.agent_msg ?? null,
      human_msg: row?.human_msg ?? null,
      agent_updated_at: row?.agent_updated_at ?? null,
      human_updated_at: row?.human_updated_at ?? null,
    });
  });

  return app;
}
