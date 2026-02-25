# Goku-in-a-Box

An autonomous AI agent sandbox — like an aquarium where you can watch an AI navigate, think, and build things in real-time.

An [OpenCode](https://opencode.ai) agent runs inside a Docker container, controlled by a human-editable prompt, with all activity streamed live to a dashboard.

## Architecture

```
┌─────────────┐     ┌───────────────┐     ┌──────────────┐
│  Dashboard   │────▶│ Control Plane │────▶│   Sandbox    │
│  React/Vite  │ WS  │  Bun/Hono     │ API │  Docker +    │
│  :5173       │◀────│  :3000        │◀────│  OpenCode    │
└─────────────┘     └───────────────┘     └──────────────┘
```

- **Sandbox** — Docker container running `opencode serve` with a bash loop that executes `opencode run` per iteration, streaming NDJSON events to the control plane
- **Control Plane** — Bun/Hono server managing prompt state, Docker lifecycle, telemetry ingestion (SQLite), and WebSocket broadcasting
- **Dashboard** — React SPA with live WebSocket stream, system vitals charts, iteration timeline, and a collapsible prompt editor

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- [Docker](https://docs.docker.com/get-docker/)
- An OpenAI-compatible LLM endpoint

### Setup

```bash
# Configure your LLM endpoint
cp .env.example .env
# Edit .env with your LLM_BASE_URL, LLM_API_KEY, OPENCODE_MODEL

# Build the sandbox image
docker build -t goku-sandbox:latest -f sandbox/Dockerfile sandbox/

# Install dependencies
cd control-plane && bun install && cd ..
cd dashboard && bun install && cd ..
```

### Run

```bash
# Terminal 1: Start the control plane (pass env vars)
cd control-plane
source ../.env
export LLM_API_KEY LLM_BASE_URL OPENCODE_MODEL ITERATION_SLEEP
bun run src/index.ts

# Terminal 2: Start the dashboard
cd dashboard
bun run dev
```

Open `http://localhost:5173` in your browser.

Set a prompt via the collapsible drawer at the bottom, then click **Start** in the header to launch the sandbox. Watch the AI work in the live stream panel.

### Run with Docker Compose

```bash
docker compose up --build
```

## Configuration

| Variable | Description | Default |
|---|---|---|
| `LLM_API_KEY` | API key for your LLM provider | — |
| `LLM_BASE_URL` | OpenAI-compatible API base URL | `https://api.openai.com/v1` |
| `OPENCODE_MODEL` | Model identifier (`provider/model`) | `openai/gpt-4o` |
| `ITERATION_SLEEP` | Seconds between agent iterations | `2` |

## API

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/api/prompt` | GET/PUT | Get or set the agent prompt |
| `/api/sandbox/start` | POST | Start the sandbox container |
| `/api/sandbox/stop` | POST | Stop the sandbox container |
| `/api/sandbox/status` | GET | Get sandbox status |
| `/api/telemetry/iterations` | GET | List iterations |
| `/api/telemetry/vitals` | GET | Get system vitals history |
| `/ws/live` | WS | Real-time event stream |

## Tests

```bash
cd control-plane && bun test
```

29 tests across 7 files covering database, Docker client, WebSocket, logging, and all route handlers.
