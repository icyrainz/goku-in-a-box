import { Hono } from "hono";
import type { SandboxManager } from "../sandbox";
import type { DockerClient } from "../docker";

export function filesRoutes(sandbox: SandboxManager, docker: DockerClient) {
  const app = new Hono();

  app.get("/", async (c) => {
    const path = c.req.query("path") ?? "/workspace";
    if (!sandbox.containerId) {
      return c.json({ error: "Sandbox not running" }, 503);
    }

    if (!path.startsWith("/workspace")) {
      return c.json({ error: "Path must be under /workspace" }, 400);
    }

    try {
      const output = await docker.execInContainer(sandbox.containerId, [
        "find", path, "-maxdepth", "1", "-printf", "%y\\t%s\\t%T@\\t%f\\n"
      ]);

      const entries = output
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(1) // skip the directory itself
        .map((line) => {
          const [typeChar, size, mtime, name] = line.split("\t");
          return {
            name: name ?? "",
            type: typeChar === "d" ? "directory" : "file",
            size: Number(size),
            modified: new Date(Number(mtime) * 1000).toISOString(),
          };
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return c.json({ path, entries });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/read", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "path required" }, 400);
    if (!sandbox.containerId) {
      return c.json({ error: "Sandbox not running" }, 503);
    }

    if (!path.startsWith("/workspace")) {
      return c.json({ error: "Path must be under /workspace" }, 400);
    }

    try {
      const content = await docker.execInContainer(sandbox.containerId, ["cat", path]);
      return c.json({ path, content });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return app;
}
