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
      summary TEXT,
      content TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const stmts = {
    insertPrompt: db.prepare("INSERT INTO prompt_history (content) VALUES (?)"),
    getLatestPrompt: db.prepare("SELECT * FROM prompt_history ORDER BY id DESC LIMIT 1"),
    getPromptHistory: db.prepare("SELECT * FROM prompt_history ORDER BY id DESC"),
    startIteration: db.prepare("INSERT INTO iterations (start_time) VALUES (datetime('now'))"),
    startIterationWithId: db.prepare("INSERT OR IGNORE INTO iterations (id, start_time) VALUES (?, datetime('now'))"),
    endIteration: db.prepare(
      "UPDATE iterations SET end_time = datetime('now'), summary = ?, action_count = ?, error_count = ? WHERE id = ?"
    ),
    getIteration: db.prepare("SELECT * FROM iterations WHERE id = ?"),
    getIterations: db.prepare("SELECT * FROM iterations ORDER BY id DESC LIMIT ? OFFSET ?"),
    insertEvent: db.prepare(
      "INSERT INTO events (iteration_id, type, summary, content) VALUES (?, ?, ?, ?)"
    ),
    getEventsByIteration: db.prepare(
      "SELECT * FROM events WHERE iteration_id = ? ORDER BY timestamp ASC"
    ),
    updateIterationCounts: db.prepare(
      "UPDATE iterations SET action_count = ?, error_count = ? WHERE id = ?"
    ),
    insertVitals: db.prepare("INSERT INTO vitals (cpu_pct, memory_mb, disk_mb) VALUES (?, ?, ?)"),
    getVitals: db.prepare("SELECT * FROM vitals ORDER BY timestamp DESC LIMIT ?"),
    closeOpenIterations: db.prepare(
      "UPDATE iterations SET end_time = datetime('now'), summary = 'Interrupted' WHERE end_time IS NULL"
    ),
    insertSnapshot: db.prepare(
      "INSERT INTO snapshots (label, agent_type, filename, size_bytes) VALUES (?, ?, ?, ?)"
    ),
    listSnapshots: db.prepare("SELECT * FROM snapshots ORDER BY id DESC LIMIT ?"),
    getSnapshot: db.prepare("SELECT * FROM snapshots WHERE id = ?"),
    deleteSnapshot: db.prepare("DELETE FROM snapshots WHERE id = ?"),
    updateSnapshotFilename: db.prepare("UPDATE snapshots SET filename = ? WHERE id = ?"),
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

    startIteration(id?: number) {
      if (id != null) {
        stmts.startIterationWithId.run(id);
        return id;
      }
      const result = stmts.startIteration.run();
      return Number(result.lastInsertRowid);
    },

    endIteration(id: number, summary: string, actionCount: number, errorCount: number) {
      stmts.endIteration.run(summary, actionCount, errorCount, id);
    },

    updateIterationCounts(id: number, actionCount: number, errorCount: number) {
      stmts.updateIterationCounts.run(actionCount, errorCount, id);
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

    insertEvent(iterationId: number, type: string, summary: string, content?: string) {
      stmts.insertEvent.run(iterationId, type, summary, content ?? null);
    },

    getEventsByIteration(iterationId: number) {
      return stmts.getEventsByIteration.all(iterationId) as {
        id: number; iteration_id: number; timestamp: string; type: string; summary: string; content: string | null;
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

    closeOpenIterations() {
      stmts.closeOpenIterations.run();
    },

    insertSnapshot(label: string, agentType: string, filename: string, sizeBytes: number) {
      const r = stmts.insertSnapshot.run(label, agentType, filename, sizeBytes);
      return Number(r.lastInsertRowid);
    },

    listSnapshots(limit = 20) {
      return stmts.listSnapshots.all(limit) as {
        id: number; label: string; agent_type: string;
        filename: string; size_bytes: number; created_at: string;
      }[];
    },

    getSnapshot(id: number) {
      return stmts.getSnapshot.get(id) as {
        id: number; label: string; agent_type: string;
        filename: string; size_bytes: number; created_at: string;
      } | null;
    },

    deleteSnapshot(id: number) {
      stmts.deleteSnapshot.run(id);
    },

    updateSnapshotFilename(id: number, filename: string) {
      stmts.updateSnapshotFilename.run(filename, id);
    },
  };
}
