import { Hono } from "hono";
import type { SandboxManager } from "../sandbox";
import type { DockerClient } from "../docker";
import type { WsBroadcaster } from "../ws";

export type ShowcaseManifest = {
  type: "web" | "document" | "cli" | "media";
  label?: string;
  command?: string;
  port?: number;
  path?: string;
};

type PreviewState = {
  manifest: ShowcaseManifest;
  execId: string | null;
  port: number | null;
};

/**
 * Read and parse .showcase.json from the sandbox container.
 * Standalone function so telemetry.ts can reuse it without importing the full route.
 */
export async function readShowcaseManifest(
  sandbox: { containerId: string | null },
  docker: { execInContainer: (id: string, cmd: string[]) => Promise<string> },
): Promise<ShowcaseManifest | null> {
  if (!sandbox.containerId) return null;
  try {
    const raw = await docker.execInContainer(sandbox.containerId, [
      "cat",
      "/workspace/.showcase.json",
    ]);
    return JSON.parse(raw.trim()) as ShowcaseManifest;
  } catch {
    return null;
  }
}

const MIME_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  html: "text/html",
};

export function showcaseRoutes(
  sandbox: SandboxManager,
  docker: DockerClient,
  broadcaster: WsBroadcaster,
) {
  const app = new Hono();

  // Module-level preview state (within the route factory closure)
  let activePreview: PreviewState | null = null;

  // --- GET / --- Read .showcase.json manifest from container
  app.get("/", async (c) => {
    const manifest = await readShowcaseManifest(sandbox, docker);
    return c.json({ manifest });
  });

  // --- GET /status --- Preview state
  app.get("/status", (c) => {
    // Clear stale preview if sandbox is gone
    if (activePreview && !sandbox.containerId) {
      activePreview = null;
    }
    if (!activePreview) {
      return c.json({ running: false, type: null, port: null, label: null });
    }
    return c.json({
      running: true,
      type: activePreview.manifest.type,
      port: activePreview.port,
      label: activePreview.manifest.label ?? null,
    });
  });

  // --- POST /launch --- Start a preview (reads everything from manifest)
  app.post("/launch", async (c) => {
    if (!sandbox.containerId) {
      return c.json({ error: "No sandbox container running" }, 503);
    }

    const manifest = await readShowcaseManifest(sandbox, docker);
    if (!manifest) {
      return c.json({ error: "No .showcase.json manifest found" }, 404);
    }

    // Stop any existing preview first
    if (activePreview) {
      await stopPreview(sandbox.containerId);
    }

    switch (manifest.type) {
      case "web": {
        if (!manifest.command || !manifest.port) {
          return c.json({ error: "web type requires command and port in manifest" }, 400);
        }
        const execId = await docker.execDetached(sandbox.containerId, [
          "sh", "-c", manifest.command,
        ]);
        activePreview = { manifest, execId, port: manifest.port };
        broadcaster.broadcast({
          type: "showcase_launched",
          data: { type: "web", port: manifest.port, label: manifest.label },
        });
        return c.json({
          launched: true, type: "web",
          proxyUrl: "/api/showcase/proxy/", port: manifest.port,
        });
      }

      case "cli": {
        if (!manifest.command) {
          return c.json({ error: "cli type requires command in manifest" }, 400);
        }
        const output = await docker.execInContainer(sandbox.containerId, [
          "sh", "-c", manifest.command,
        ]);
        activePreview = { manifest, execId: null, port: null };
        return c.json({ launched: true, type: "cli", output });
      }

      case "document": {
        if (!manifest.path) {
          return c.json({ error: "document type requires path in manifest" }, 400);
        }
        activePreview = { manifest, execId: null, port: null };
        return c.json({ launched: true, type: "document", path: manifest.path });
      }

      case "media": {
        if (!manifest.path) {
          return c.json({ error: "media type requires path in manifest" }, 400);
        }
        activePreview = { manifest, execId: null, port: null };
        return c.json({ launched: true, type: "media", path: manifest.path });
      }

      default:
        return c.json({ error: `Unknown showcase type: ${manifest.type}` }, 400);
    }
  });

  // --- POST /stop --- Kill preview
  app.post("/stop", async (c) => {
    if (!activePreview) {
      return c.json({ stopped: false });
    }

    if (sandbox.containerId) {
      await stopPreview(sandbox.containerId);
    }

    activePreview = null;
    broadcaster.broadcast({ type: "showcase_stopped", data: {} });
    return c.json({ stopped: true });
  });

  // --- ALL /proxy/* --- Reverse proxy for web previews
  app.all("/proxy/*", async (c) => {
    if (!activePreview || activePreview.manifest.type !== "web" || !activePreview.port) {
      return c.json({ error: "No web preview active" }, 503);
    }

    const port = activePreview.port;
    // Strip the /proxy prefix from the path
    const subpath = c.req.path.replace(/^\/api\/showcase\/proxy\/?/, "") || "";
    const url = new URL(c.req.url);
    const targetUrl = `http://127.0.0.1:${port}/${subpath}${url.search}`;

    try {
      const proxyRes = await fetch(targetUrl, {
        method: c.req.method,
        headers: { "Accept": c.req.header("accept") ?? "*/*" },
        body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
      });

      // Read full body to avoid socket issues with streamed passthrough
      const body = await proxyRes.arrayBuffer();
      const respHeaders = new Headers(proxyRes.headers);
      respHeaders.delete("transfer-encoding");

      return new Response(body, {
        status: proxyRes.status,
        headers: respHeaders,
      });
    } catch (err: any) {
      return c.json({ error: `Proxy error: ${err.message}` }, 502);
    }
  });

  // --- GET /file --- Serve binary files for media/document previews
  app.get("/file", async (c) => {
    if (!sandbox.containerId) {
      return c.json({ error: "No sandbox container running" }, 503);
    }

    const path = c.req.query("path");
    if (!path || !path.startsWith("/workspace") || path.includes("..")) {
      return c.json({ error: "path query param required, must start with /workspace, no traversal" }, 400);
    }

    try {
      const content = await docker.execInContainer(sandbox.containerId, [
        "cat",
        path,
      ]);

      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

      return new Response(content, {
        headers: { "Content-Type": contentType },
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  /** Stop the active preview, killing the web server if applicable. */
  async function stopPreview(containerId: string) {
    if (activePreview?.manifest.type === "web" && activePreview.port) {
      try {
        await docker.execInContainer(containerId, [
          "sh",
          "-c",
          `fuser -k ${activePreview.port}/tcp`,
        ]);
      } catch {
        // Process may have already exited
      }
    }
  }

  return app;
}
