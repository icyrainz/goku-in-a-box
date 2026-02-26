# Dashboard UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add rich expandable live stream events, a prompt view/edit modal, and a file browser to the dashboard.

**Architecture:** Three vertical slices — each adds backend support (where needed) and the corresponding frontend component. The sandbox agent-loop.sh sends full event content; the control plane stores it in a new `content` column; the dashboard renders expandable events, a prompt modal, and a file browser modal.

**Tech Stack:** Bun/Hono (control plane), React 19 + TailwindCSS + Monaco Editor (dashboard), Docker API (file browser), bash (agent-loop.sh)

---

### Task 1: Add `content` column to events table

**Files:**
- Modify: `control-plane/src/db.ts:37-45` (events table schema)
- Modify: `control-plane/src/db.ts:58-59` (insertEvent prepared statement)
- Modify: `control-plane/src/db.ts:107-109` (insertEvent function)
- Modify: `control-plane/src/db.ts:111-115` (getEventsByIteration return type)

**Step 1: Add `content` column to CREATE TABLE**

In `control-plane/src/db.ts`, change the events table creation:
```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER REFERENCES iterations(id),
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,
  summary TEXT,
  content TEXT
)
```

**Step 2: Update insertEvent statement and function**

Change the prepared statement:
```typescript
insertEvent: db.prepare(
  "INSERT INTO events (iteration_id, type, summary, content) VALUES (?, ?, ?, ?)"
),
```

Change the function signature:
```typescript
insertEvent(iterationId: number, type: string, summary: string, content?: string) {
  stmts.insertEvent.run(iterationId, type, summary, content ?? null);
},
```

Update the return type of `getEventsByIteration`:
```typescript
getEventsByIteration(iterationId: number) {
  return stmts.getEventsByIteration.all(iterationId) as {
    id: number; iteration_id: number; timestamp: string; type: string; summary: string; content: string | null;
  }[];
},
```

**Step 3: Delete the old SQLite database so the new schema takes effect**

Run: `rm -f control-plane/data/sandbox.db`

Note: This is safe — it only contains telemetry history. The sandbox will repopulate on next run.

**Step 4: Commit**

```bash
git add control-plane/src/db.ts
git commit -m "feat: add content column to events table for full event data"
```

---

### Task 2: Update telemetry route to accept and broadcast `content`

**Files:**
- Modify: `control-plane/src/routes/telemetry.ts:16-19` (stream body type)
- Modify: `control-plane/src/routes/telemetry.ts:32-39` (event insert + broadcast)

**Step 1: Update the stream endpoint body type**

```typescript
const body = await c.req.json<{
  iterationId: number;
  events: { type: string; summary: string; content?: string; timestamp?: string }[];
}>();
```

**Step 2: Pass content through insert and broadcast**

```typescript
for (const event of body.events) {
  db.insertEvent(dbIterationId, event.type, event.summary, event.content);
  if (event.type === "tool_use") actionCount++;
  broadcaster.broadcast({
    type: event.type,
    data: { iterationId: dbIterationId, summary: event.summary, content: event.content },
    timestamp: event.timestamp,
  });
}
```

**Step 3: Update iteration detail endpoint to include content**

The `getEventsByIteration` already returns all columns, so the `/iteration/:id` endpoint at line 104-109 will automatically include `content` — no change needed.

**Step 4: Commit**

```bash
git add control-plane/src/routes/telemetry.ts
git commit -m "feat: pass event content through telemetry stream and broadcast"
```

---

### Task 3: Update agent-loop.sh to send full event content

**Files:**
- Modify: `sandbox/agent-loop.sh:82-121` (event parsing and POST loop)

**Step 1: Extract full content alongside summary for each event type**

Replace the event parsing block (lines 82-121) with this version that captures both `summary` (truncated) and `content` (full):

```bash
while IFS= read -r line; do
    EVENT_TYPE=$(echo "$line" | jq -r '.type // "unknown"' 2>/dev/null || echo "unknown")
    EVENT_SUMMARY=""
    EVENT_CONTENT=""

    case "$EVENT_TYPE" in
      text)
        EVENT_CONTENT=$(echo "$line" | jq -r '.part.text // ""' 2>/dev/null)
        EVENT_SUMMARY=$(echo "$EVENT_CONTENT" | head -c 200)
        ;;
      tool_use)
        TOOL_NAME=$(echo "$line" | jq -r '.part.tool // "tool"' 2>/dev/null)
        TITLE=$(echo "$line" | jq -r '.part.state.title // ""' 2>/dev/null)
        if [ -n "$TITLE" ] && [ "$TITLE" != "null" ]; then
          EVENT_SUMMARY="$TOOL_NAME: $TITLE"
        else
          INPUT_DETAIL=$(echo "$line" | jq -r '.part.state.input | if type == "object" then (to_entries | map(.key + "=" + (.value | tostring | .[0:80])) | join(", ")) else "" end' 2>/dev/null | head -c 200)
          EVENT_SUMMARY="$TOOL_NAME${INPUT_DETAIL:+: $INPUT_DETAIL}"
        fi
        EVENT_CONTENT=$(echo "$line" | jq -r '.part.state.input // .part | tostring' 2>/dev/null | head -c 5000)
        ACTION_COUNT=$((ACTION_COUNT + 1))
        ;;
      tool_result)
        EVENT_SUMMARY=$(echo "$line" | jq -r '.part.state.title // "result"' 2>/dev/null | head -c 200)
        EVENT_CONTENT=$(echo "$line" | jq -r '.part.state.output // .part.state | tostring' 2>/dev/null | head -c 10000)
        ;;
      thought)
        EVENT_CONTENT=$(echo "$line" | jq -r '.part.text // .part | tostring' 2>/dev/null)
        EVENT_SUMMARY=$(echo "$EVENT_CONTENT" | head -c 200)
        ;;
      error)
        EVENT_SUMMARY=$(echo "$line" | jq -r '.error.data.message // "error"' 2>/dev/null)
        EVENT_CONTENT=$(echo "$line" | jq -r '.error | tostring' 2>/dev/null | head -c 5000)
        ERROR_COUNT=$((ERROR_COUNT + 1))
        ;;
      step_start|step_finish)
        continue
        ;;
      *)
        EVENT_SUMMARY="$EVENT_TYPE event"
        EVENT_CONTENT=$(echo "$line" | jq -r '. | tostring' 2>/dev/null | head -c 2000)
        ;;
    esac

    # Build JSON payload with jq to handle escaping
    PAYLOAD=$(jq -n \
      --argjson iterationId "$ITERATION" \
      --arg type "$EVENT_TYPE" \
      --arg summary "$EVENT_SUMMARY" \
      --arg content "$EVENT_CONTENT" \
      '{iterationId: $iterationId, events: [{type: $type, summary: $summary, content: $content}]}')

    curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/stream" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      > /dev/null 2>&1 || true
  done < <(opencode "${OPENCODE_ARGS[@]}" 2>/dev/null || true)
```

Key changes:
- Each event type now also captures `EVENT_CONTENT` (full text, capped at reasonable limits: 5-10KB)
- Uses `jq -n` to build the JSON payload safely (handles escaping of special chars in content)
- `thought` events are no longer skipped — they get full content

**Step 2: Commit**

```bash
git add sandbox/agent-loop.sh
git commit -m "feat: send full event content from agent-loop to control plane"
```

**NOTE:** This file is baked into the Docker image. After this change, rebuild with:
```bash
docker build -t goku-sandbox:latest -f sandbox/Dockerfile sandbox/
```

---

### Task 4: Make LiveStream events expandable

**Files:**
- Modify: `dashboard/src/components/LiveStream.tsx` (full rewrite of event rendering)

**Step 1: Replace LiveStream.tsx with expandable events**

```tsx
import { useRef, useEffect, useState } from "react";
import { useWebSocket } from "../hooks/useWebSocket";

const EVENT_COLORS: Record<string, string> = {
  thought: "text-blue-400",
  tool_call: "text-yellow-400",
  tool_use: "text-yellow-400",
  tool_result: "text-orange-400",
  text: "text-gray-300",
  error: "text-red-400",
  iteration_start: "text-green-400",
  iteration_end: "text-green-400",
  iteration_summary: "text-green-400",
  connected: "text-purple-400",
};

const HIDDEN_EVENTS = new Set(["step_start", "step_finish", "connected"]);

function EventRow({ event, index }: { event: any; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const data = typeof event.data === "object" ? event.data : {};
  const summary = data?.summary ?? (typeof event.data === "string" ? event.data : "");
  const content = data?.content;
  const hasContent = content && content !== summary && content.length > 0;

  return (
    <div className="group">
      <div
        className={`flex gap-2 ${hasContent ? "cursor-pointer hover:bg-gray-800/50 rounded px-1 -mx-1" : ""}`}
        onClick={() => hasContent && setExpanded(!expanded)}
      >
        {hasContent && (
          <span className={`text-gray-600 shrink-0 transition-transform text-[10px] leading-4 ${expanded ? "rotate-90" : ""}`}>
            &#9656;
          </span>
        )}
        <span className="text-gray-600 shrink-0">
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>
        <span className={`font-semibold shrink-0 ${EVENT_COLORS[event.type] ?? "text-gray-400"}`}>
          [{event.type}]
        </span>
        <span className="text-gray-300 truncate">{summary}</span>
      </div>
      {expanded && content && (
        <pre className="mt-1 ml-6 p-2 bg-gray-800/60 rounded text-[11px] text-gray-300 whitespace-pre-wrap break-words max-h-64 overflow-auto border border-gray-700/50">
          {content}
        </pre>
      )}
    </div>
  );
}

export function LiveStream() {
  const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/live`;
  const { events, connected } = useWebSocket(wsUrl);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Live Stream</h2>
        <span className={`text-xs ${connected ? "text-green-400" : "text-red-400"}`}>
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs space-y-0.5">
        {events.length === 0 && (
          <p className="text-gray-600 italic">Waiting for events...</p>
        )}
        {events
          .filter((e) => !HIDDEN_EVENTS.has(e.type))
          .map((event, i) => (
            <EventRow key={i} event={event} index={i} />
          ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
```

**Step 2: Verify it renders**

Open http://localhost:5173 — the live stream should look the same as before when no content is available, and show expand arrows when content is present.

**Step 3: Commit**

```bash
git add dashboard/src/components/LiveStream.tsx
git commit -m "feat: expandable live stream events with full content view"
```

---

### Task 5: Prompt button in Header + modal

**Files:**
- Create: `dashboard/src/components/PromptModal.tsx`
- Modify: `dashboard/src/components/Header.tsx` (add Prompt button)
- Modify: `dashboard/src/App.tsx` (remove bottom drawer, add modal)

**Step 1: Create PromptModal.tsx**

```tsx
import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Editor from "@monaco-editor/react";
import { fetchJson, putJson } from "../api/client";

type PromptData = { content: string; updated_at: string | null };

export function PromptModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState<string | null>(null);

  const { data: prompt } = useQuery({
    queryKey: ["prompt"],
    queryFn: () => fetchJson<PromptData>("/prompt"),
  });

  const saveMutation = useMutation({
    mutationFn: (content: string) => putJson("/prompt", { content }),
    onSuccess: () => {
      setLocalContent(null);
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["prompt"] });
    },
  });

  const currentContent = localContent ?? prompt?.content ?? "";
  const isDirty = localContent !== null && localContent !== (prompt?.content ?? "");

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-[700px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Agent Prompt</h2>
            {prompt?.updated_at && (
              <span className="text-xs text-gray-500">
                Updated {new Date(prompt.updated_at).toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {editing && isDirty && <span className="text-xs text-amber-400">Unsaved</span>}
            {editing && (
              <button
                onClick={() => { if (localContent) saveMutation.mutate(localContent); }}
                disabled={!isDirty || saveMutation.isPending}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs font-medium transition-colors"
              >
                {saveMutation.isPending ? "Saving..." : "Save"}
              </button>
            )}
            <button
              onClick={() => { setEditing(!editing); setLocalContent(null); }}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium transition-colors"
            >
              {editing ? "Cancel" : "Edit"}
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 min-h-[300px]">
          {editing ? (
            <div className="h-full rounded overflow-hidden border border-gray-700">
              <Editor
                defaultLanguage="markdown"
                theme="vs-dark"
                value={currentContent}
                onChange={(value) => setLocalContent(value ?? "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: "off",
                  wordWrap: "on",
                  padding: { top: 12 },
                }}
              />
            </div>
          ) : (
            <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
              {prompt?.content || <span className="text-gray-600 italic">No prompt set</span>}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add Prompt button to Header.tsx**

Add a prop `onPromptClick` to `Header`:
```tsx
export function Header({ onPromptClick }: { onPromptClick?: () => void }) {
```

Add a button next to the Start/Stop buttons in the `<div className="flex gap-2">`:
```tsx
{onPromptClick && (
  <button
    onClick={onPromptClick}
    className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors"
  >
    Prompt
  </button>
)}
```

**Step 3: Update App.tsx — remove drawer, add modal**

Replace the full App component:
```tsx
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Header } from "./components/Header";
import { LiveStream } from "./components/LiveStream";
import { Vitals } from "./components/Vitals";
import { IterationTimeline } from "./components/IterationTimeline";
import { PromptModal } from "./components/PromptModal";

const queryClient = new QueryClient();

export default function App() {
  const [promptOpen, setPromptOpen] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
        <Header onPromptClick={() => setPromptOpen(true)} />
        <main className="flex-1 grid grid-cols-[1fr_350px] gap-4 p-4 overflow-hidden">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 overflow-auto">
            <LiveStream />
          </div>
          <div className="flex flex-col gap-4 overflow-hidden">
            <div className="flex-1 bg-gray-900 rounded-lg border border-gray-800 p-4 overflow-auto">
              <Vitals />
            </div>
            <div className="flex-1 bg-gray-900 rounded-lg border border-gray-800 p-4 overflow-auto">
              <IterationTimeline />
            </div>
          </div>
        </main>
        {promptOpen && <PromptModal onClose={() => setPromptOpen(false)} />}
      </div>
    </QueryClientProvider>
  );
}
```

**Step 4: Verify**

- Click "Prompt" in header — modal should open with current prompt text
- Click "Edit" — switches to Monaco editor
- Save — updates prompt, switches back to read-only
- Escape or click backdrop — closes modal

**Step 5: Commit**

```bash
git add dashboard/src/components/PromptModal.tsx dashboard/src/components/Header.tsx dashboard/src/App.tsx
git commit -m "feat: prompt view/edit modal accessible from header button"
```

**Step 6: Delete old PromptEditor.tsx**

```bash
rm dashboard/src/components/PromptEditor.tsx
git add -u && git commit -m "chore: remove unused PromptEditor drawer component"
```

---

### Task 6: Add file browser API endpoints to control plane

**Files:**
- Modify: `control-plane/src/docker.ts` (add exec methods)
- Create: `control-plane/src/routes/files.ts` (new route file)
- Modify: `control-plane/src/index.ts:42-44` (register file routes)

**Step 1: Add Docker exec methods to DockerClient**

Add these methods to the `DockerClient` class in `control-plane/src/docker.ts`:

```typescript
async execInContainer(containerId: string, cmd: string[]): Promise<string> {
  // Create exec instance
  const createRes = await this.fetch(`/containers/${containerId}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: cmd,
    }),
  });
  if (!createRes.ok) throw new Error(`Create exec failed: ${await createRes.text()}`);
  const { Id: execId } = (await createRes.json()) as { Id: string };

  // Start exec and get output
  const startRes = await this.fetch(`/exec/${execId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Detach: false, Tty: false }),
  });
  if (!startRes.ok) throw new Error(`Start exec failed: ${await startRes.text()}`);

  const raw = new Uint8Array(await startRes.arrayBuffer());
  return this.stripDockerStreamHeader(raw);
}

private stripDockerStreamHeader(raw: Uint8Array): string {
  // Docker multiplexed stream: each frame has 8-byte header [type(1) padding(3) size(4)]
  const decoder = new TextDecoder();
  let offset = 0;
  let output = "";
  while (offset + 8 <= raw.length) {
    const size = (raw[offset + 4] << 24) | (raw[offset + 5] << 16) | (raw[offset + 6] << 8) | raw[offset + 7];
    offset += 8;
    if (offset + size <= raw.length) {
      output += decoder.decode(raw.slice(offset, offset + size));
    }
    offset += size;
  }
  return output;
}
```

**Step 2: Create files route**

Create `control-plane/src/routes/files.ts`:

```typescript
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

    // Sanitize path — must start with /workspace
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
            name,
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
```

**Step 3: Register the route in index.ts**

Add import:
```typescript
import { filesRoutes } from "./routes/files";
```

Add route after existing routes:
```typescript
app.route("/api/sandbox/files", filesRoutes(sandbox, docker));
```

**Step 4: Commit**

```bash
git add control-plane/src/docker.ts control-plane/src/routes/files.ts control-plane/src/index.ts
git commit -m "feat: add file browser API endpoints via docker exec"
```

---

### Task 7: Add FileBrowser modal to dashboard

**Files:**
- Create: `dashboard/src/components/FileBrowser.tsx`
- Modify: `dashboard/src/components/Header.tsx` (add Files button)
- Modify: `dashboard/src/App.tsx` (add FileBrowser modal state)

**Step 1: Create FileBrowser.tsx**

```tsx
import { useState, useEffect } from "react";
import { fetchJson } from "../api/client";

type FileEntry = { name: string; type: "file" | "directory"; size: number; modified: string };
type FileList = { path: string; entries: FileEntry[] };
type FileContent = { path: string; content: string };

export function FileBrowser({ onClose }: { onClose: () => void }) {
  const [currentPath, setCurrentPath] = useState("/workspace");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDir = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<FileList>(`/sandbox/files?path=${encodeURIComponent(path)}`);
      setEntries(data.entries);
      setCurrentPath(path);
      setSelectedFile(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadFile = async (path: string) => {
    setLoading(true);
    try {
      const data = await fetchJson<FileContent>(`/sandbox/files/read?path=${encodeURIComponent(path)}`);
      setSelectedFile(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDir("/workspace"); }, []);

  // Auto-refresh every 10s
  useEffect(() => {
    const interval = setInterval(() => { if (!selectedFile) loadDir(currentPath); }, 10000);
    return () => clearInterval(interval);
  }, [currentPath, selectedFile]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const parentPath = currentPath !== "/workspace"
    ? currentPath.split("/").slice(0, -1).join("/") || "/workspace"
    : null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-[900px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Files</h2>
            <span className="text-xs text-gray-500 font-mono">{currentPath}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => loadDir(currentPath)} className="text-xs text-gray-400 hover:text-gray-200">
              Refresh
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden min-h-[400px]">
          {/* File list */}
          <div className="w-[300px] border-r border-gray-700 overflow-auto">
            {error && <p className="p-3 text-xs text-red-400">{error}</p>}
            {parentPath && (
              <button
                onClick={() => loadDir(parentPath)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800 text-gray-400 font-mono"
              >
                ..
              </button>
            )}
            {entries.map((entry) => (
              <button
                key={entry.name}
                onClick={() => {
                  const fullPath = `${currentPath}/${entry.name}`;
                  entry.type === "directory" ? loadDir(fullPath) : loadFile(fullPath);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800 flex items-center gap-2 ${
                  selectedFile?.path === `${currentPath}/${entry.name}` ? "bg-gray-800" : ""
                }`}
              >
                <span className={entry.type === "directory" ? "text-blue-400" : "text-gray-400"}>
                  {entry.type === "directory" ? "+" : " "}
                </span>
                <span className="text-gray-200 font-mono truncate flex-1">{entry.name}</span>
                {entry.type === "file" && (
                  <span className="text-gray-600 shrink-0">{formatSize(entry.size)}</span>
                )}
              </button>
            ))}
            {entries.length === 0 && !loading && (
              <p className="p-3 text-xs text-gray-600 italic">Empty directory</p>
            )}
          </div>

          {/* File content */}
          <div className="flex-1 overflow-auto p-4">
            {selectedFile ? (
              <div>
                <div className="text-xs text-gray-500 font-mono mb-2">{selectedFile.path}</div>
                <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-words">
                  {selectedFile.content}
                </pre>
              </div>
            ) : (
              <p className="text-gray-600 italic text-xs">Select a file to view its contents</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add Files button to Header.tsx**

Add `onFilesClick` prop:
```tsx
export function Header({ onPromptClick, onFilesClick }: { onPromptClick?: () => void; onFilesClick?: () => void }) {
```

Add button next to Prompt button:
```tsx
{onFilesClick && (
  <button
    onClick={onFilesClick}
    className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors"
  >
    Files
  </button>
)}
```

**Step 3: Update App.tsx to wire up FileBrowser**

Add import and state:
```tsx
import { FileBrowser } from "./components/FileBrowser";
// ...
const [filesOpen, setFilesOpen] = useState(false);
```

Update Header:
```tsx
<Header onPromptClick={() => setPromptOpen(true)} onFilesClick={() => setFilesOpen(true)} />
```

Add modal:
```tsx
{filesOpen && <FileBrowser onClose={() => setFilesOpen(false)} />}
```

**Step 4: Verify**

- Click "Files" in header with sandbox running — should show /workspace contents
- Navigate directories, click files to view
- Returns error message when sandbox not running

**Step 5: Commit**

```bash
git add dashboard/src/components/FileBrowser.tsx dashboard/src/components/Header.tsx dashboard/src/App.tsx
git commit -m "feat: add file browser modal with directory navigation and file viewing"
```

---

### Task 8: Restart control plane and verify end-to-end

**Step 1: Restart control plane**

Kill the existing control plane tmux session and relaunch:
```bash
tmux kill-session -t control-plane
tmux new-session -d -s control-plane -c /home/akio/repo/goku-in-a-box/control-plane \
  'bash -c "export $(grep -v \"^#\" /home/akio/repo/goku-in-a-box/.env | xargs) && bun run src/index.ts; exec bash"'
```

**Step 2: Verify dashboard loads**

Open http://localhost:5173:
- Header shows Prompt and Files buttons
- Live stream displays events
- Clicking Prompt opens modal with current prompt
- Clicking Files opens file browser (shows error if sandbox not running — that's correct)

**Step 3: Rebuild sandbox and test full flow (optional, requires sandbox running)**

```bash
docker build -t goku-sandbox:latest -f sandbox/Dockerfile sandbox/
```

Start sandbox from dashboard, verify:
- Live stream events have expand arrows for events with content
- Clicking expands to show full thinking/tool output
- File browser shows workspace files

**Step 4: Final commit of any remaining changes**

```bash
git add -A && git status
# If clean, no commit needed
```
