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
