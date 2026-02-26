# Goku-in-a-Box

Autonomous AI agent platform: a sandboxed AI agent (OpenCode in Docker) controlled and observed via a Bun/Hono control plane and React dashboard.

## Architecture

```
Dashboard (React/Vite :5173) <--HTTP/WS--> Control Plane (Bun/Hono :3000) <--Docker API--> Sandbox (OpenCode in Docker)
```

- **Control Plane** (`control-plane/`): Bun + Hono server. Manages sandbox lifecycle, stores telemetry in SQLite, broadcasts events via WebSocket, generates LLM-powered iteration summaries.
- **Dashboard** (`dashboard/`): React 19 + Vite + TailwindCSS. Shows live event stream (WebSocket), iteration timeline, system vitals, and prompt editor.
- **Sandbox** (`sandbox/`): Docker container running `agent-loop.sh` which drives OpenCode in iteration loops. Each iteration: fetch prompt -> read memory -> run agent -> stream events -> save memory -> sleep.

## Quick Start (Development)

```bash
# 1. Configure environment
cp .env.example .env   # Set LLM_BASE_URL, LLM_API_KEY, OPENCODE_MODEL

# 2. Build sandbox image
docker build -t goku-sandbox:latest -f sandbox/Dockerfile sandbox/

# 3. Start control plane (terminal 1)
cd control-plane && bun install
export $(grep -v '^#' ../.env | xargs) && bun run src/index.ts

# 4. Start dashboard (terminal 2)
cd dashboard && npm install && npm run dev

# 5. Open http://localhost:5173, start the sandbox, set a prompt
```

## Key Files

| File | What it does |
|------|-------------|
| `control-plane/src/index.ts` | Server entry: routes, WebSocket, DB init |
| `control-plane/src/llm.ts` | LLM client for iteration summaries (OpenAI-compatible API) |
| `control-plane/src/db.ts` | SQLite schema and queries (iterations, events, vitals, prompts) |
| `control-plane/src/routes/telemetry.ts` | Event streaming, iteration lifecycle, LLM summary generation |
| `control-plane/src/routes/sandbox.ts` | Docker container start/stop/status |
| `control-plane/src/routes/prompt.ts` | GET/PUT prompt management |
| `control-plane/src/ws.ts` | WebSocket broadcaster |
| `control-plane/src/sandbox.ts` | Docker container lifecycle (SandboxManager) |
| `dashboard/src/App.tsx` | Main layout: LiveStream, Vitals, IterationTimeline, PromptEditor |
| `dashboard/src/components/LiveStream.tsx` | Real-time WebSocket event display |
| `dashboard/src/hooks/useWebSocket.ts` | WebSocket connection hook |
| `dashboard/vite.config.ts` | Vite dev server with proxy to control plane (:3000) |
| `sandbox/agent-loop.sh` | Main iteration loop (baked into Docker image) |
| `sandbox/opencode.json` | OpenCode LLM provider config |
| `sandbox/BOOTSTRAP.md` | Agent identity template |

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `LLM_BASE_URL` | LLM endpoint for sandbox agent | (required) |
| `LLM_API_KEY` | LLM API key | (required) |
| `OPENCODE_MODEL` | Model identifier (e.g. `custom/Qwen3.5-27B`) | (required) |
| `ITERATION_SLEEP` | Seconds between iterations | `2` |
| `CP_LLM_BASE_URL` | Control plane LLM (falls back to `LLM_BASE_URL`) | |
| `CP_LLM_MODEL` | Control plane model | `Qwen3.5-27B` |

## API Endpoints

- `GET /health` - Health check
- `GET/PUT /api/prompt` - Agent prompt
- `POST /api/sandbox/start|stop`, `GET /api/sandbox/status` - Container lifecycle
- `POST /api/telemetry/stream` - Ingest events from sandbox
- `POST /api/telemetry/summary` - End-of-iteration summary + vitals
- `GET /api/telemetry/iterations?limit=N` - List iterations
- `GET /api/telemetry/iteration/:id` - Iteration detail with events
- `GET /api/telemetry/vitals?limit=N` - System vitals
- `WS /ws/live` - Real-time event stream

## Data Flow

1. `agent-loop.sh` fetches prompt from control plane, reads `/workspace/.memory.md`
2. Composes instruction (identity + memory + prompt + rules), runs `opencode run --format json`
3. Parses NDJSON events, POSTs each to `/api/telemetry/stream`
4. Control plane inserts events in SQLite, broadcasts via WebSocket to dashboard
5. When iteration ends, agent-loop POSTs summary to `/api/telemetry/summary`
6. Control plane fires async LLM call to generate a human-readable iteration summary
7. Dashboard polls iterations list every 5s, live stream updates via WebSocket

## Agent Memory System

- `/workspace/.memory.md` - Written by the agent as its FINAL action each iteration
- Contains: what was accomplished, current status, next steps
- Read by `agent-loop.sh` at the start of each iteration and injected into the instruction
- This is the agent's ONLY memory between iterations (each `opencode run` is a fresh session)

## Important Patterns

- **Sandbox changes require Docker rebuild**: `agent-loop.sh`, `opencode.json`, and `BOOTSTRAP.md` are baked into the image via `sandbox/Dockerfile`
- **Control plane .env loading**: Use `export $(grep -v '^#' .env | xargs)` — plain `source` doesn't export vars to child processes
- **Iteration ID sync**: The sandbox generates its own iteration IDs (queried from API + incremented). The DB uses `INSERT OR IGNORE` with explicit IDs to stay in sync.
- **LLM summary is async**: The `iteration_summary` event arrives after `iteration_end` because the LLM call is fire-and-forget
- **Vite WS proxy**: Use `http://` (not `ws://`) as the target with `ws: true` flag

## Tests

```bash
cd control-plane && bun test
```

Covers: DB operations, Docker client, WebSocket broadcaster, all route handlers.
