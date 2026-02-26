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
    expect(events[0]!.type).toBe("thought");
  });

  it("returns empty array for nonexistent iteration", () => {
    const events = store.read(999);
    expect(events).toHaveLength(0);
  });
});
