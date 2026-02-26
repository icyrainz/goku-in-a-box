# Goose Agent Variant Design

## Goal

Add Goose (by Block) as an alternative agent framework alongside OpenCode. Each sandbox instance specifies its agent type at creation time, preparing for future multi-instance support.

## Architecture

```
Dashboard --agentType--> Control Plane --picks image--> Docker
                                                          |
                                          goku-sandbox-opencode:latest
                                          goku-sandbox-goose:latest
```

## File Structure Changes

Reorganize `sandbox/` from flat to per-agent directories:

```
sandbox/
├── BOOTSTRAP.md              (canonical, shared by all agents)
├── opencode/
│   ├── Dockerfile
│   ├── agent-loop.sh         (moved from sandbox/)
│   └── opencode.json         (moved from sandbox/)
└── goose/
    ├── Dockerfile
    └── agent-loop.sh         (new, Goose-specific)
```

Images become `goku-sandbox-opencode:latest` and `goku-sandbox-goose:latest`.

## Goose Agent Loop

Same iteration structure as OpenCode: fetch prompt, read memory, compose instruction, run agent, stream events, collect vitals, sleep.

Key difference: runs `goose run --output-format stream-json --no-session -t "$INSTRUCTION"` and maps Goose's NDJSON events to our telemetry format:

| Goose StreamEvent | Telemetry event_type |
|---|---|
| `message` with `toolRequest` content | `tool_use` |
| `message` with `toolResponse` content | `tool_result` |
| `message` with `text` content | `text` |
| `message` with `thinking`/`reasoning` content | `thought` |
| `error` | `error` |
| `complete` | (ignored, iteration_end handles this) |

Goose provider config via env vars in the agent-loop:
- `GOOSE_PROVIDER=openai` (uses OpenAI-compatible API)
- `OPENAI_API_KEY=$LLM_API_KEY`
- `OPENAI_BASE_URL=$LLM_BASE_URL`
- `GOOSE_MODEL=$GOOSE_MODEL` (separate from OPENCODE_MODEL)

## Goose Dockerfile

Ubuntu 24.04 base, same system packages. Install Goose via official install script. Copy BOOTSTRAP.md from parent dir and agent-loop.sh. No config JSON needed (env vars only).

## Control Plane Changes

### `sandbox.ts` — SandboxManager

- `AgentType = "opencode" | "goose"`
- Image map: `{ opencode: "goku-sandbox-opencode:latest", goose: "goku-sandbox-goose:latest" }`
- `start(agentType, env)` picks image and names container `goku-sandbox-{agentType}`
- `status()` returns `agentType` alongside running state
- Track `agentType` as instance state

### `routes/sandbox.ts`

- `POST /start` accepts optional `{ agentType: "opencode" | "goose" }` body, defaults to `"opencode"`
- Passes agent-specific env vars: OpenCode gets `OPENCODE_MODEL`, Goose gets `GOOSE_MODEL`
- Both get `LLM_API_KEY`, `LLM_BASE_URL`, `ITERATION_SLEEP`
- Status response includes `agentType`

## Dashboard Changes

### Header

- Add agent type selector (dropdown or segmented control) next to Start button
- Options: "OpenCode" and "Goose"
- Pass selected `agentType` in POST to `/sandbox/start`
- Show active agent type in status display when running

## Environment Variables

New variables added to `.env.example`:

| Variable | Purpose | Default |
|---|---|---|
| `GOOSE_MODEL` | Model for Goose agent | (falls back to generic model name) |

Existing `LLM_API_KEY` and `LLM_BASE_URL` are shared by both agent types.

## Build Commands

```bash
# Build OpenCode sandbox
docker build -t goku-sandbox-opencode:latest -f sandbox/opencode/Dockerfile sandbox/

# Build Goose sandbox
docker build -t goku-sandbox-goose:latest -f sandbox/goose/Dockerfile sandbox/
```

Note: both use `sandbox/` as build context so they can access shared `BOOTSTRAP.md`.
