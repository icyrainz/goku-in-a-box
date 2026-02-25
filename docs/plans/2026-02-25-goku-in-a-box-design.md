# Goku-in-a-Box: Autonomous AI Sandbox

## Overview

An autonomous AI agent running in an infinite loop inside a Docker container, steerable by humans via a mutable prompt, with full observability via a dashboard. The AI uses OpenCode as its agent engine, giving it full coding-agent capabilities (multi-turn tool use, file operations, shell access). The human observes and steers via a web dashboard.

## Architecture

```
Human (Browser)
    │
    ▼
React Dashboard ──── WebSocket ────┐
    │                               │
    ▼ HTTP                          │
Control Plane (TypeScript/Bun) ◄────┘
    │
    ▼ Docker API + HTTP
Docker Container (Sandbox)
    ├── OpenCode (agent engine, persistent server)
    ├── agent-loop.sh (thin infinite-loop wrapper)
    ├── /state/BOOTSTRAP.md (central state file)
    └── /workspace/ (AI's working directory)
    │
    ▼ OpenAI-compatible API
LLM Endpoint (configurable)
```

### Three Components

1. **Sandbox** (Docker container): Runs OpenCode in server mode with a thin shell wrapper that loops forever. Has full internet access and a complete Linux environment.

2. **Control Plane** (TypeScript/Bun): Manages the prompt, ingests telemetry, stores data in SQLite, streams events to the dashboard via WebSocket, and manages the sandbox container lifecycle via Docker API.

3. **Dashboard** (React): Prompt editor, live thought stream, system vitals, iteration timeline.

## The Agent Loop

### How It Works

OpenCode runs as a persistent server inside the container. A thin shell script (`agent-loop.sh`) wraps it in an infinite loop:

Each iteration:
1. Fetch the current PROMPT from the control plane API
2. Read `/state/BOOTSTRAP.md` (the AI's self-maintained state)
3. Run `opencode run --attach --format json` with the combined instruction
4. Stream JSON events to the control plane in real-time (every thought, tool call, result)
5. Report end-of-iteration summary + system vitals (CPU, memory, disk)
6. Sleep briefly, then repeat

### Bootstrap File (`/state/BOOTSTRAP.md`)

The AI reads this at the start of every iteration to understand who it is and what it has done. The AI itself updates this file as it evolves. Initial state:

```markdown
# Goku-in-a-Box - Bootstrap State
## Identity
I am an autonomous AI agent running in a sandboxed Docker container.
## Environment
- Control plane: http://host.docker.internal:3000
- LLM endpoint: (from env OPENAI_API_BASE)
- Working directory: /workspace
## Memory Systems
None set up yet.
## Current Task
No prompt assigned yet. Self-bootstrap mode.
## What I've Done
Nothing yet. First iteration.
```

Over time, the AI updates this with installed tools, memory systems it has set up (could be files, a graph database, anything), current task progress, etc.

### No-Prompt Behavior

When no prompt is set, the AI enters self-bootstrap mode: explores its environment, installs useful tools, sets up its state file, and reports readiness. It's alive and preparing.

### Prompt Change Detection

Each iteration compares the current prompt with the previous one. If changed, the instruction explicitly tells the LLM: "The human has updated the prompt. Here's what changed." This lets the AI consciously shift direction.

### Memory Model

The entire container filesystem IS the AI's memory. It can write notes to files, create structured data, or even spin up databases (graph DB, SQLite, etc.) to organize its knowledge. The BOOTSTRAP.md file is the coherent entry point that tells the AI what memory systems it has set up.

### Error Handling

The outer loop never exits. If OpenCode crashes or an iteration fails, the wrapper catches the error, reports it to the control plane, waits briefly, and continues. The AI is always alive.

## Control Plane API

### Endpoints

```
POST /api/sandbox/start          Start a new sandbox container
POST /api/sandbox/stop           Stop the sandbox
GET  /api/sandbox/status         Container status

GET  /api/prompt                 Get current prompt
PUT  /api/prompt                 Update prompt (saves previous version)

POST /api/telemetry/stream       Real-time event ingestion from agent
POST /api/telemetry/summary      End-of-iteration summary + vitals
GET  /api/telemetry/iterations   List iterations (paginated)
GET  /api/telemetry/iteration/:id  Full detail for one iteration
GET  /api/telemetry/vitals       Time-series vitals data

WS   /ws/live                    Real-time stream to dashboard
```

### Storage

SQLite database (`data/sandbox.db`) for structured data:

| Table | Columns | Purpose |
|-------|---------|---------|
| `iterations` | id, start_time, end_time, summary, action_count, error_count | Iteration history |
| `vitals` | timestamp, cpu_pct, memory_mb, disk_mb | System metrics time-series |
| `prompt_history` | id, content, updated_at | Versioned prompt snapshots |
| `events` | iteration_id, timestamp, type, summary | High-level event summaries |

Full raw JSON event streams stored as files: `data/logs/iteration-{id}.json`

Two observability levels:
- **Summary level** (default dashboard view): Derived from `events` table. What the AI thought, what actions it took, outcomes.
- **Full transparency** (available on demand): Raw JSON event files. Every LLM prompt/response, full command output, complete context.

## Dashboard

### Layout

- **Header**: Status indicator (running/stopped), iteration counter, uptime, start/stop buttons
- **Prompt Editor**: Monaco editor for the prompt. Save button. Shows diff from last version.
- **Live Stream**: Real-time feed of AI activity. Toggle between summary and detailed modes.
- **System Vitals**: Real-time CPU/mem/disk gauges + historical charts.
- **Iteration Timeline**: Scrollable list of past iterations. Click for full details.

### Tech Stack
- React + Vite
- TanStack Query (data fetching)
- WebSocket (real-time streaming)
- Recharts (vitals charts)
- Monaco Editor (prompt editing)
- Tailwind CSS (styling)

## Project Structure

```
goku-in-a-box/
├── control-plane/
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── prompt.ts
│   │   │   ├── telemetry.ts
│   │   │   └── sandbox.ts
│   │   ├── db.ts
│   │   ├── docker.ts
│   │   └── ws.ts
│   ├── package.json
│   └── tsconfig.json
│
├── dashboard/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── PromptEditor.tsx
│   │   │   ├── LiveStream.tsx
│   │   │   ├── Vitals.tsx
│   │   │   └── IterationTimeline.tsx
│   │   ├── hooks/
│   │   └── api/
│   ├── package.json
│   └── vite.config.ts
│
├── sandbox/
│   ├── Dockerfile
│   ├── agent-loop.sh
│   ├── opencode.json
│   └── BOOTSTRAP.md
│
├── docker-compose.yml
└── README.md
```

## Deployment

```yaml
# docker-compose.yml
services:
  control-plane:
    build: ./control-plane
    ports: ["3000:3000"]
    volumes:
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
  dashboard:
    build: ./dashboard
    ports: ["5173:5173"]
    depends_on: [control-plane]
```

The sandbox container is created dynamically by the control plane via Docker API (not in docker-compose), giving us start/stop/restart control from the dashboard.

### Sandbox Dockerfile

Based on Ubuntu 24.04 with: curl, git, jq, wget, python3, build-essential, nodejs, npm, and OpenCode pre-installed. The agent-loop.sh script runs as the container entrypoint.

## Configuration

- **LLM endpoint**: Set via environment variable or `opencode.json` in the sandbox. Supports any OpenAI-compatible API.
- **Control plane URL**: Passed to the sandbox container as an environment variable.
- **Iteration sleep**: Configurable pause between iterations (default: 2 seconds).

## Key Design Decisions

1. **OpenCode as agent engine** rather than custom agent: Mature multi-turn tool use, context management, and error recovery out of the box. We focus on the orchestration and observability layers.

2. **Filesystem as memory**: No special memory system. The AI can organize its own knowledge however it wants (files, databases, etc.). BOOTSTRAP.md is the coherent entry point.

3. **Two-level observability**: Full raw data always captured (JSON event streams), but the default view is human-readable summaries. Drill down when needed.

4. **Pull-based prompt model**: Agent polls for prompt changes each iteration. Simple, reliable, no push infrastructure needed.

5. **Sandbox created dynamically**: Not part of docker-compose. Control plane manages the container lifecycle, giving the dashboard start/stop control.
