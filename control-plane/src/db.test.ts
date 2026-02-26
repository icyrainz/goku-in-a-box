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
    expect(events[0]!.type).toBe("thought");
  });

  it("inserts and retrieves vitals", () => {
    db.insertVitals(45.2, 512, 2048);
    const vitals = db.getVitals(10);
    expect(vitals).toHaveLength(1);
    expect(vitals[0]!.cpu_pct).toBe(45.2);
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

  describe("sessions", () => {
    it("creates and retrieves a session", () => {
      db.createSession("container-1", "opencode");
      const session = db.getActiveSession();
      expect(session).not.toBeNull();
      expect(session!.container_id).toBe("container-1");
      expect(session!.agent_type).toBe("opencode");
      expect(session!.stopped_at).toBeNull();
    });

    it("ends a session", () => {
      db.createSession("container-1", "goose");
      db.endSession("container-1");
      const session = db.getActiveSession();
      expect(session).toBeNull();
      const ended = db.getSessionByContainerId("container-1");
      expect(ended).not.toBeNull();
      expect(ended!.stopped_at).not.toBeNull();
    });

    it("ends all open sessions", () => {
      db.createSession("c1", "opencode");
      db.createSession("c2", "goose");
      db.endAllOpenSessions();
      expect(db.getActiveSession()).toBeNull();
    });

    it("getLatestSession returns most recent", () => {
      db.createSession("c1", "opencode");
      db.endSession("c1");
      db.createSession("c2", "goose");
      db.endSession("c2");
      const latest = db.getLatestSession();
      expect(latest!.container_id).toBe("c2");
    });

    it("starts iteration with session_id", () => {
      db.createSession("container-1", "opencode");
      db.startIteration(1, "container-1");
      const iter = db.getIteration(1);
      expect(iter).not.toBeNull();
    });

    it("getIterationsBySession returns only matching iterations", () => {
      db.createSession("c1", "opencode");
      db.createSession("c2", "goose");
      db.startIteration(1, "c1");
      db.startIteration(2, "c1");
      db.startIteration(3, "c2");
      const c1Iters = db.getIterationsBySession("c1", 10, 0);
      expect(c1Iters).toHaveLength(2);
      const c2Iters = db.getIterationsBySession("c2", 10, 0);
      expect(c2Iters).toHaveLength(1);
      expect(c2Iters[0].id).toBe(3);
    });
  });
});
