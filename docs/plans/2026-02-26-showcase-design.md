# Showcase: Agent Preview System

Date: 2026-02-26

## Problem

The agent builds things (websites, documents, CLI tools, images) but there's no way to see or try them from the dashboard. Different product types need different preview methods.

## Solution

A showcase manifest protocol where the agent declares what it built and how to preview it, the dashboard shows the declaration, and you confirm before launching.

## Showcase Manifest

Agent writes `/workspace/.showcase.json`:

```json
{
  "label": "Todo App",
  "type": "web",
  "command": "cd /workspace/todo-app && npm start",
  "port": 3001
}
```

### Supported Types

| Type | Required Fields | What Happens |
|------|----------------|--------------|
| `web` | `command`, `port` | Runs command in container, proxies port through control plane |
| `document` | `path` | Reads file, renders in dashboard (markdown, plain text, HTML) |
| `cli` | `command` | Runs command, streams stdout to terminal panel |
| `media` | `path` | Reads file via Docker archive API, serves as binary |

All types have an optional `label` field.

## Agent Instructions

One line added to `OPERATING.md`:

```
- When your work is ready to demo, read /state/SHOWCASE.md for the showcase protocol.
```

`/state/SHOWCASE.md` (baked into Docker image, ~20 lines) explains the JSON format and the 4 types. Agent only reads it when it decides to showcase.

## Control Plane API

New route group: `/api/showcase`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/showcase` | `GET` | Read `.showcase.json` from container via `docker exec cat`. Returns manifest or `null` |
| `/api/showcase/launch` | `POST` | Start the preview. `web`: detached `docker exec`, wait for port. `cli`: exec and return output. `document`/`media`: no-op |
| `/api/showcase/stop` | `POST` | Kill the preview process (`web` type only) |
| `/api/showcase/status` | `GET` | Is a preview running? Type? PID? |
| `/api/showcase/proxy/*` | `ALL` | Reverse proxy to container's preview port. Only active for `web` previews |

### Process Management (web type)

- `docker exec -d` runs the serve command detached inside the container
- Control plane tracks the exec PID
- `/stop` kills the process via `docker exec kill <pid>`
- On sandbox stop, preview dies automatically

### Reverse Proxy (web type)

- Container uses `host` network mode, so control plane reaches `localhost:<port>` directly
- `/api/showcase/proxy/index.html` proxies to `http://localhost:<port>/index.html`

### WebSocket Broadcast

When `.showcase.json` is detected, broadcast `{ type: "showcase_ready", data: manifest }` to dashboard.

## Dashboard UI

### Header

- Poll `/api/showcase` every 5s (or react to `showcase_ready` WebSocket event)
- Show "Preview Ready" badge when manifest detected (like mailbox notification)
- Click opens ShowcaseModal

### ShowcaseModal

```
+-------------------------------------------+
|  * Todo App                      [Launch] |
|  type: web / port: 3001                   |
|  cmd: cd /workspace/todo-app && npm ...   |
+-------------------------------------------+
|                                           |
|  (after launch, content appears here)     |
|                                           |
|  web:      iframe filling the panel       |
|  document: rendered markdown/HTML         |
|  cli:      terminal-style output block    |
|  media:    <img> tag                      |
|                                           |
+-------------------------------------------+
|                                [Stop]     |
+-------------------------------------------+
```

### Behavior by Type

- **web**: Launch -> POST `/api/showcase/launch` -> wait -> iframe `src="/api/showcase/proxy/"`. Stop kills server.
- **document**: Launch -> GET `/api/sandbox/files/read?path=...` -> render markdown or raw text. No process to stop.
- **cli**: Launch -> POST `/api/showcase/launch` -> display stdout in monospace pre block. No persistent process.
- **media**: Launch -> serve file through `/api/showcase/proxy/file` route. No process to stop.

## Data Flow

```
Agent writes /workspace/.showcase.json
  -> Control plane detects (poll / telemetry event)
  -> Broadcasts showcase_ready via WebSocket
  -> Dashboard Header shows "Preview Ready" badge
  -> User clicks -> ShowcaseModal opens
  -> User clicks [Launch]
  -> POST /api/showcase/launch
  -> Control plane handles by type:
       web:      docker exec -d -> wait for port -> proxy ready
       cli:      docker exec -> capture stdout -> return
       document: no-op (dashboard fetches directly)
       media:    no-op (dashboard fetches directly)
  -> Dashboard renders preview
  -> User clicks [Stop] (web only) -> kills server process
```

## What Changes

**New files:**
- `control-plane/src/routes/showcase.ts` — all showcase API routes + proxy
- `dashboard/src/components/ShowcaseModal.tsx` — preview UI
- `sandbox/SHOWCASE.md` — agent instructions for manifest format

**Modified files:**
- `sandbox/OPERATING.md` — one line added
- `sandbox/opencode/Dockerfile` — copy SHOWCASE.md to /state/
- `sandbox/goose/Dockerfile` — copy SHOWCASE.md to /state/
- `control-plane/src/index.ts` — mount showcase routes
- `dashboard/src/components/Header.tsx` — showcase badge + button
- `dashboard/src/hooks/useWebSocket.ts` — handle showcase_ready event (if not already generic)

**Unchanged:**
- Agent-loop.sh (no new iteration steps)
- Docker port exposure (proxy through existing port 3000)
- No Docker restarts needed for preview
