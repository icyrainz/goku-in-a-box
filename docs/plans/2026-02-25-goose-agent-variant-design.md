# Goose Agent Variant Design

## Goal

Add Goose (by Block) as an alternative agent framework alongside OpenCode. Each sandbox instance specifies its agent type at creation time. Both sandboxes use `debian:bookworm-slim` as the base image.

## Architecture

```
Dashboard --agentType--> Control Plane --picks image--> Docker
                                                          |
                                          goku-sandbox-opencode:latest
                                          goku-sandbox-goose:latest
```

## File Structure

Reorganize `sandbox/` from flat to per-agent directories:

```
sandbox/
├── BOOTSTRAP.md              (shared agent identity)
├── opencode/
│   ├── Dockerfile            (debian:bookworm-slim + opencode)
│   ├── agent-loop.sh         (moved from sandbox/)
│   └── opencode.json         (moved from sandbox/)
└── goose/
    ├── Dockerfile            (debian:bookworm-slim + goose)
    └── agent-loop.sh         (new, Goose-specific)
```

Old files removed: `sandbox/Dockerfile`, `sandbox/agent-loop.sh`, `sandbox/opencode.json`.

Images: `goku-sandbox-opencode:latest` and `goku-sandbox-goose:latest`.

Build commands:
```bash
docker build -t goku-sandbox-opencode:latest -f sandbox/opencode/Dockerfile sandbox/
docker build -t goku-sandbox-goose:latest -f sandbox/goose/Dockerfile sandbox/
```

Both use `sandbox/` as build context to access shared `BOOTSTRAP.md`.

## Goose Agent Loop

Same iteration structure as OpenCode: fetch prompt, read memory, compose instruction, run agent, stream events, collect vitals, sleep.

### Run command

```bash
goose run --output-format stream-json --no-session -t "$INSTRUCTION"
```

### Event parsing — buffered by message ID

Goose streams token-by-token, each token as a separate `message` event with the same `id`. The agent-loop buffers text by message `id` and flushes when the id changes or a non-message event arrives.

Tool events (`toolRequest`, `toolResponse`) are emitted immediately since they are single events.

### Event mapping

Goose wraps content in `message.content[]` array. Each content item has a `type` field in camelCase.

| Goose content type | Our event_type | Summary source |
|---|---|---|
| `text` | `text` | Buffered `.text` truncated |
| `toolRequest` | `tool_use` | `.toolCall.name` + args preview |
| `toolResponse` | `tool_result` | `.toolResult` truncated |
| `thinking` / `reasoning` | `thought` | `.thinking` or `.text` truncated |
| top-level `error` | `error` | `.error` |
| top-level `complete` | (ignored) | iteration_end handles this |

### Goose env vars (passed into container)

```bash
GOOSE_PROVIDER=openai
OPENAI_API_KEY=$LLM_API_KEY
OPENAI_HOST=$GOOSE_LLM_HOST    # No /v1 — Goose appends it automatically
GOOSE_MODEL=$GOOSE_MODEL
GOOSE_MODE=auto                 # Headless, no approval prompts
GOOSE_DISABLE_KEYRING=1         # No system keyring in container
```

### Goose Dockerfile

`debian:bookworm-slim` base, system packages (curl, git, jq, bash, procps). Install Goose via official install script. Copy BOOTSTRAP.md from parent dir and agent-loop.sh. No config JSON needed (env vars only).

## OpenCode Sandbox Changes

- Move `Dockerfile`, `agent-loop.sh`, `opencode.json` into `sandbox/opencode/`
- Switch base image from `ubuntu:24.04` to `debian:bookworm-slim`
- Update `opencode.json` to reference `OPENCODE_LLM_HOST` instead of `LLM_BASE_URL`

## Control Plane Changes

### `sandbox.ts` — SandboxManager

- `AgentType = "opencode" | "goose"`
- Image map: `{ opencode: "goku-sandbox-opencode:latest", goose: "goku-sandbox-goose:latest" }`
- `start(agentType, env)` picks image and names container `goku-sandbox-{agentType}`
- `status()` returns `agentType` alongside running state
- Track `agentType` as instance state

### `routes/sandbox.ts`

- `POST /start` accepts optional `{ agentType: "opencode" | "goose" }` body, defaults to `"opencode"`
- Passes agent-specific env vars:

| Agent | Env vars passed to container |
|---|---|
| OpenCode | `LLM_API_KEY`, `LLM_BASE_URL=$OPENCODE_LLM_HOST`, `OPENCODE_MODEL`, `ITERATION_SLEEP` |
| Goose | `OPENAI_API_KEY=$LLM_API_KEY`, `OPENAI_HOST=$GOOSE_LLM_HOST`, `GOOSE_MODEL`, `GOOSE_PROVIDER=openai`, `GOOSE_MODE=auto`, `GOOSE_DISABLE_KEYRING=1`, `ITERATION_SLEEP` |

- Both get `CONTROL_PLANE_URL=http://host.docker.internal:3000` (set by SandboxManager)
- `GET /status` response includes `agentType`

### No changes to

Telemetry routes, WebSocket, DB schema, LLM summary generation. The telemetry format is the same regardless of agent — the agent-loop handles the translation.

## Dashboard Changes

- Add agent type selector (dropdown or segmented control) next to Start button
- Options: "OpenCode" and "Goose"
- Disabled while sandbox is running
- Sends `{ agentType }` in POST to `/api/sandbox/start`
- Status display shows which agent is running

## Environment Variables

Updated `.env.example`:

| Variable | Purpose | Example |
|---|---|---|
| `LLM_API_KEY` | Shared API key | `noop` |
| `LLM_HOST` | Base host (control plane fallback) | `http://akio-fractal:8080` |
| `OPENCODE_LLM_HOST` | OpenCode endpoint (with `/v1`) | `http://akio-fractal:8080/v1` |
| `OPENCODE_MODEL` | OpenCode model (needs `custom/` prefix) | `custom/Qwen3.5-27B` |
| `GOOSE_LLM_HOST` | Goose endpoint (no `/v1`) | `http://akio-fractal:8080` |
| `GOOSE_MODEL` | Goose model | `Qwen3.5-27B` |
| `CP_LLM_BASE_URL` | Control plane LLM (optional) | falls back to `LLM_HOST` |
| `CP_LLM_API_KEY` | Control plane API key (optional) | falls back to `LLM_API_KEY` |
| `CP_LLM_MODEL` | Control plane model (optional) | `Qwen3.5-27B` |
| `ITERATION_SLEEP` | Seconds between iterations | `2` |

## Verified via dry run

Goose CLI v1.22.2 tested against `http://akio-fractal:8080` with `Qwen3.5-27B`:
- `goose run --output-format stream-json --no-session -t "..."` works
- `OPENAI_HOST` must NOT include `/v1` (Goose appends it)
- Token-by-token streaming confirmed — buffering by message `id` is necessary
