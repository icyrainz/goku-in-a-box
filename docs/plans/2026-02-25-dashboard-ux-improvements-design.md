# Dashboard UX Improvements Design

## Problem

1. Live stream shows truncated event summaries (200 chars max). OpenCode's full thinking, reasoning, and tool outputs are discarded in agent-loop.sh before reaching the control plane.
2. The prompt editor is hidden in a collapsible bottom drawer — easy to miss.
3. No way to see what files the agent has created/modified in the sandbox.

## Design

### 1. Rich Live Stream (Full-Depth Events)

**Backend (agent-loop.sh):**
- Send full event content alongside the truncated summary.
- New event payload shape:
  ```json
  { "type": "text", "summary": "first 200 chars...", "content": "full text/thinking content" }
  ```
- `tool_use`: include full input params in `content`.
- `tool_result`: include full output in `content`.
- `thought`: include full reasoning in `content`.

**Backend (control-plane):**
- Add `content TEXT` column to `events` table.
- Store and broadcast `content` via WebSocket.
- Return `content` in iteration detail endpoint.

**Frontend (LiveStream.tsx):**
- Events become expandable — click to reveal full content below the summary line.
- Thinking/reasoning events get distinct styling (indented, lighter color).
- Tool use events show tool name prominently with expandable input/output.

### 2. Prompt Button + Modal

- Remove bottom drawer PromptEditor from layout.
- Add "Prompt" button in Header (next to Start/Stop).
- Modal overlay with:
  - Read-only view of current prompt (default)
  - "Edit" toggle switches to Monaco editor
  - Save button (PUT /api/prompt)
  - Last-updated timestamp display

### 3. File Browser

**Backend (control-plane):**
- `GET /api/sandbox/files?path=/workspace` — docker exec `ls -la`, returns `{ name, type, size, modified }[]`.
- `GET /api/sandbox/files/read?path=/workspace/foo.ts` — docker exec `cat`, returns file content.

**Frontend (FileBrowser.tsx):**
- "Files" button in Header opens a modal/panel.
- Tree-style directory navigator.
- Click directories to expand, click files to view in read-only code viewer.
- Auto-refreshes file tree every 10s when sandbox is running.

### Layout

```
+---------------------------------------------------+
|  Header: [Status] [Start] [Stop] [Prompt] [Files] |
+-------------------------+-------------------------+
|                         |  Vitals (chart)         |
|  LiveStream             +-------------------------+
|  (expandable events)    |  IterationTimeline      |
|                         |                         |
+-------------------------+-------------------------+

[Prompt] -> modal overlay with view/edit
[Files]  -> modal with file tree + viewer
```

## Decisions

- Fix event truncation at the source (agent-loop.sh) rather than dashboard-only cosmetics.
- File access via docker exec (no host mount changes needed).
- Prompt as header button + modal (not sidebar or drawer).
