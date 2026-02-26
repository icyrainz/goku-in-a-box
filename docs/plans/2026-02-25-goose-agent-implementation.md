# Goose Agent Variant — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Goose as an alternative agent alongside OpenCode, selectable from the dashboard.

**Architecture:** Two self-contained sandbox directories (opencode/, goose/) each with their own Dockerfile (debian:bookworm-slim), agent-loop.sh, and config. The control plane picks the right image based on `agentType`. Dashboard gets a selector next to Start.

**Tech Stack:** Bun/Hono (control plane), React 19 + TailwindCSS (dashboard), Docker, Goose CLI v1.22.2, bash

---

### Task 1: Restructure sandbox/ directory

Move existing files into `sandbox/opencode/` subdirectory.

**Files:**
- Move: `sandbox/Dockerfile` → `sandbox/opencode/Dockerfile`
- Move: `sandbox/agent-loop.sh` → `sandbox/opencode/agent-loop.sh`
- Move: `sandbox/opencode.json` → `sandbox/opencode/opencode.json`
- Keep: `sandbox/BOOTSTRAP.md` (stays at root, shared)
- Delete: `sandbox/Dockerfile`, `sandbox/agent-loop.sh`, `sandbox/opencode.json` (originals after move)

**Step 1: Move files**

```bash
mkdir -p sandbox/opencode
git mv sandbox/Dockerfile sandbox/opencode/Dockerfile
git mv sandbox/agent-loop.sh sandbox/opencode/agent-loop.sh
git mv sandbox/opencode.json sandbox/opencode/opencode.json
```

**Step 2: Update OpenCode Dockerfile base image and COPY paths**

The Dockerfile currently copies from the build context root. Since the build context will be `sandbox/`, paths to `BOOTSTRAP.md` use `../` relative. But Docker build context is `sandbox/`, so `BOOTSTRAP.md` is at the context root and agent files are in `opencode/`.

Update `sandbox/opencode/Dockerfile`:

```dockerfile
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    curl git jq wget python3 build-essential nodejs npm \
    procps sysstat \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://opencode.ai/install | bash
ENV PATH="/root/.opencode/bin:${PATH}"

RUN mkdir -p /state /workspace

COPY BOOTSTRAP.md /state/BOOTSTRAP.md
COPY opencode/opencode.json /workspace/opencode.json
COPY opencode/agent-loop.sh /usr/local/bin/agent-loop.sh
RUN chmod +x /usr/local/bin/agent-loop.sh

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/agent-loop.sh"]
```

**Step 3: Update opencode.json to use new env var name**

Change `{env:LLM_BASE_URL}` to `{env:LLM_BASE_URL}` — this stays the same because the control plane route will set `LLM_BASE_URL=$OPENCODE_LLM_HOST` when passing env to the container. No change needed in opencode.json itself.

**Step 4: Verify build works**

```bash
docker build -t goku-sandbox-opencode:latest -f sandbox/opencode/Dockerfile sandbox/
```

Expected: successful build.

**Step 5: Commit**

```bash
git add sandbox/
git commit -m "refactor: restructure sandbox/ into opencode/ subdirectory"
```

---

### Task 2: Create Goose sandbox

**Files:**
- Create: `sandbox/goose/Dockerfile`
- Create: `sandbox/goose/agent-loop.sh`

**Step 1: Write Goose Dockerfile**

Create `sandbox/goose/Dockerfile`:

```dockerfile
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    curl git jq wget python3 build-essential nodejs npm \
    procps sysstat \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash
ENV PATH="/root/.local/bin:${PATH}"

RUN mkdir -p /state /workspace

COPY BOOTSTRAP.md /state/BOOTSTRAP.md
COPY goose/agent-loop.sh /usr/local/bin/agent-loop.sh
RUN chmod +x /usr/local/bin/agent-loop.sh

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/agent-loop.sh"]
```

**Step 2: Write Goose agent-loop.sh**

Create `sandbox/goose/agent-loop.sh`. This follows the same structure as the OpenCode loop but:
- Runs `goose run --output-format stream-json --no-session -t "$INSTRUCTION"`
- Buffers text events by message `id`, flushes on id change
- Maps Goose camelCase content types to our telemetry event types

```bash
#!/usr/bin/env bash
set -euo pipefail

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://host.docker.internal:3000}"
ITERATION_SLEEP="${ITERATION_SLEEP:-2}"

log() { echo "[agent-loop] $(date -Iseconds) $*"; }

# --- Helper: collect vitals ---
collect_vitals() {
  local cpu mem disk
  cpu=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' 2>/dev/null || echo "0")
  mem=$(free -m | awk '/Mem:/{print $3}' 2>/dev/null || echo "0")
  disk=$(df -m /workspace | awk 'NR==2{print $3}' 2>/dev/null || echo "0")
  echo "{\"cpu\": $cpu, \"memory\": $mem, \"disk\": $disk}"
}

# --- Helper: flush buffered text event ---
CURRENT_MSG_ID=""
TEXT_BUFFER=""

flush_text_buffer() {
  local iteration_id="$1"
  if [ -n "$TEXT_BUFFER" ] && [ -n "$CURRENT_MSG_ID" ]; then
    local summary
    summary=$(echo "$TEXT_BUFFER" | head -c 200)
    local payload
    payload=$(jq -n \
      --argjson iterationId "$iteration_id" \
      --arg type "text" \
      --arg summary "$summary" \
      --arg content "$TEXT_BUFFER" \
      '{iterationId: $iterationId, events: [{type: $type, summary: $summary, content: $content}]}')
    curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/stream" \
      -H "Content-Type: application/json" \
      -d "$payload" > /dev/null 2>&1 || true
  fi
  TEXT_BUFFER=""
  CURRENT_MSG_ID=""
}

# --- Helper: send a single telemetry event ---
send_event() {
  local iteration_id="$1" event_type="$2" event_summary="$3" event_content="$4"
  local payload
  payload=$(jq -n \
    --argjson iterationId "$iteration_id" \
    --arg type "$event_type" \
    --arg summary "$event_summary" \
    --arg content "$event_content" \
    '{iterationId: $iterationId, events: [{type: $type, summary: $summary, content: $content}]}')
  curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/stream" \
    -H "Content-Type: application/json" \
    -d "$payload" > /dev/null 2>&1 || true
}

# --- Main loop ---
PREV_PROMPT=""

LATEST_ID=$(curl -sf "$CONTROL_PLANE_URL/api/telemetry/iterations?limit=1" | jq -r '.iterations[0].id // 0' 2>/dev/null || echo "0")
ITERATION=${LATEST_ID:-0}
log "Resuming from iteration $ITERATION"

while true; do
  ITERATION=$((ITERATION + 1))
  log "=== Iteration $ITERATION ==="

  # 1. Fetch current prompt
  PROMPT_RESPONSE=$(curl -sf "$CONTROL_PLANE_URL/api/prompt" || echo '{"content":""}')
  CURRENT_PROMPT=$(echo "$PROMPT_RESPONSE" | jq -r '.content // ""')

  # 2. Read bootstrap identity and memory
  BOOTSTRAP=$(cat /state/BOOTSTRAP.md 2>/dev/null || echo "No bootstrap state found.")
  MEMORY=$(cat /workspace/.memory.md 2>/dev/null || echo "No previous memory. This is a fresh start.")

  # 3. Compose instruction
  INSTRUCTION="## Identity\n$BOOTSTRAP\n\n"
  INSTRUCTION+="## Memory (from previous iteration)\n$MEMORY\n\n"

  if [ -z "$CURRENT_PROMPT" ]; then
    INSTRUCTION+="## Mode: Self-Bootstrap\nNo prompt has been assigned. Prepare to receive tasks."
  else
    INSTRUCTION+="## Current Prompt\n$CURRENT_PROMPT"

    if [ "$CURRENT_PROMPT" != "$PREV_PROMPT" ] && [ -n "$PREV_PROMPT" ]; then
      INSTRUCTION+="\n\n## Notice: Prompt Changed\nThe human has updated the prompt.\nPrevious: $PREV_PROMPT\nCurrent: $CURRENT_PROMPT"
    fi
  fi

  INSTRUCTION+="\n\n## Rules\n- This is iteration $ITERATION. Your environment: workdir=/workspace, control-plane=$CONTROL_PLANE_URL.\n- Your memory above tells you what you did last. Pick up EXACTLY where you left off.\n- Do NOT re-explore files you already know about from memory.\n- IMPORTANT: Do as much work as possible in this iteration. Write multiple files, run multiple commands. Do NOT stop after just one or two actions — keep going until you've made significant progress on the current task step.\n- As your FINAL action, write /workspace/.memory.md with:\n  1. What you accomplished this iteration\n  2. Current status of the task\n  3. Concrete next steps for the next iteration\n  This file is your only memory across iterations. Keep it concise."

  # 4. Register iteration with control plane
  curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/stream" \
    -H "Content-Type: application/json" \
    -d "{\"iterationId\": $ITERATION, \"events\": [{\"type\": \"iteration_start\", \"summary\": \"Starting iteration $ITERATION\"}]}" \
    > /dev/null 2>&1 || true

  # 5. Run Goose and stream events
  ACTION_COUNT=0
  ERROR_COUNT=0
  CURRENT_MSG_ID=""
  TEXT_BUFFER=""

  while IFS= read -r line; do
    TOP_TYPE=$(echo "$line" | jq -r '.type // "unknown"' 2>/dev/null || echo "unknown")

    case "$TOP_TYPE" in
      message)
        MSG_ID=$(echo "$line" | jq -r '.message.id // ""' 2>/dev/null)
        # Process each content item in the message
        CONTENT_COUNT=$(echo "$line" | jq '.message.content | length' 2>/dev/null || echo "0")

        for ((ci=0; ci<CONTENT_COUNT; ci++)); do
          CONTENT_TYPE=$(echo "$line" | jq -r ".message.content[$ci].type // \"\"" 2>/dev/null)

          case "$CONTENT_TYPE" in
            text)
              TEXT=$(echo "$line" | jq -r ".message.content[$ci].text // \"\"" 2>/dev/null)
              if [ "$MSG_ID" = "$CURRENT_MSG_ID" ]; then
                TEXT_BUFFER+="$TEXT"
              else
                flush_text_buffer "$ITERATION"
                CURRENT_MSG_ID="$MSG_ID"
                TEXT_BUFFER="$TEXT"
              fi
              ;;
            toolRequest)
              flush_text_buffer "$ITERATION"
              TOOL_NAME=$(echo "$line" | jq -r ".message.content[$ci].toolCall.name // \"tool\"" 2>/dev/null)
              TOOL_ARGS=$(echo "$line" | jq -r ".message.content[$ci].toolCall.arguments | if type == \"object\" then (to_entries | map(.key + \"=\" + (.value | tostring | .[0:80])) | join(\", \")) else \"\" end" 2>/dev/null | head -c 200)
              send_event "$ITERATION" "tool_use" "$TOOL_NAME${TOOL_ARGS:+: $TOOL_ARGS}" \
                "$(echo "$line" | jq -r ".message.content[$ci].toolCall | tostring" 2>/dev/null | head -c 5000)"
              ACTION_COUNT=$((ACTION_COUNT + 1))
              ;;
            toolResponse)
              flush_text_buffer "$ITERATION"
              RESULT=$(echo "$line" | jq -r ".message.content[$ci].toolResult // .message.content[$ci] | tostring" 2>/dev/null | head -c 10000)
              RESULT_SUMMARY=$(echo "$RESULT" | head -c 200)
              send_event "$ITERATION" "tool_result" "$RESULT_SUMMARY" "$RESULT"
              ;;
            thinking|reasoning)
              flush_text_buffer "$ITERATION"
              THOUGHT=$(echo "$line" | jq -r ".message.content[$ci].thinking // .message.content[$ci].text // \"\"" 2>/dev/null)
              send_event "$ITERATION" "thought" "$(echo "$THOUGHT" | head -c 200)" "$THOUGHT"
              ;;
            *)
              ;;
          esac
        done
        ;;
      error)
        flush_text_buffer "$ITERATION"
        ERROR_MSG=$(echo "$line" | jq -r '.error // "unknown error"' 2>/dev/null)
        send_event "$ITERATION" "error" "$ERROR_MSG" "$ERROR_MSG"
        ERROR_COUNT=$((ERROR_COUNT + 1))
        ;;
      complete)
        flush_text_buffer "$ITERATION"
        # Ignored — iteration_end handles this
        ;;
      *)
        ;;
    esac
  done < <(goose run --output-format stream-json --no-session -t "$(echo -e "$INSTRUCTION")" 2>/dev/null || true)

  # Flush any remaining buffered text
  flush_text_buffer "$ITERATION"

  # 6. Report end-of-iteration summary + vitals
  VITALS=$(collect_vitals)

  curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/summary" \
    -H "Content-Type: application/json" \
    -d "{
      \"iterationId\": $ITERATION,
      \"summary\": \"Completed: $ACTION_COUNT actions, $ERROR_COUNT errors\",
      \"actionCount\": $ACTION_COUNT,
      \"errorCount\": $ERROR_COUNT,
      \"vitals\": $VITALS
    }" > /dev/null 2>&1 || true

  log "Iteration $ITERATION complete. Actions: $ACTION_COUNT, Errors: $ERROR_COUNT"

  PREV_PROMPT="$CURRENT_PROMPT"

  # 7. Sleep before next iteration
  sleep "$ITERATION_SLEEP"
done
```

**Step 3: Verify Goose image builds**

```bash
docker build -t goku-sandbox-goose:latest -f sandbox/goose/Dockerfile sandbox/
```

Expected: successful build.

**Step 4: Commit**

```bash
git add sandbox/goose/
git commit -m "feat: add goose sandbox with agent-loop and Dockerfile"
```

---

### Task 3: Update SandboxManager for agent types

**Files:**
- Modify: `control-plane/src/sandbox.ts`

**Step 1: Write the failing test**

Add to existing `control-plane/src/routes/sandbox.test.ts` (or we test via the route — the manager changes are tested through the route). Actually, let's update the sandbox manager first, then test through routes in Task 4.

**Step 2: Update sandbox.ts**

Replace `control-plane/src/sandbox.ts` with:

```typescript
import type { DockerClient } from "./docker";

export type AgentType = "opencode" | "goose";

const IMAGE_MAP: Record<AgentType, string> = {
  opencode: "goku-sandbox-opencode:latest",
  goose: "goku-sandbox-goose:latest",
};

export class SandboxManager {
  containerId: string | null = null;
  agentType: AgentType | null = null;
  private docker: DockerClient;

  constructor(docker: DockerClient) {
    this.docker = docker;
  }

  async start(agentType: AgentType = "opencode", env: Record<string, string> = {}) {
    if (this.containerId) {
      await this.stop();
    }
    const image = IMAGE_MAP[agentType];
    const containerName = `goku-sandbox-${agentType}`;
    const envArr = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    const { Id } = await this.docker.createContainer({
      image,
      name: containerName,
      env: [
        `CONTROL_PLANE_URL=http://host.docker.internal:3000`,
        ...envArr,
      ],
      extraHosts: ["host.docker.internal:host-gateway"],
    });
    await this.docker.startContainer(Id);
    this.containerId = Id;
    this.agentType = agentType;
    return Id;
  }

  async stop() {
    if (!this.containerId) return;
    await this.docker.stopContainer(this.containerId);
    await this.docker.removeContainer(this.containerId);
    this.containerId = null;
    this.agentType = null;
  }

  async status() {
    if (!this.containerId) return { status: "not_running" as const };
    try {
      const info = await this.docker.inspectContainer(this.containerId);
      return {
        status: info.State.Running ? ("running" as const) : ("stopped" as const),
        containerId: this.containerId,
        agentType: this.agentType,
      };
    } catch {
      this.containerId = null;
      this.agentType = null;
      return { status: "not_running" as const };
    }
  }
}
```

**Step 3: Run tests to check nothing broke**

```bash
cd control-plane && bun test
```

Expected: all 29 tests pass (sandbox route tests use mock, so `start()` signature change may cause issues — fix in Task 4).

**Step 4: Commit**

```bash
git add control-plane/src/sandbox.ts
git commit -m "feat: add agent type support to SandboxManager"
```

---

### Task 4: Update sandbox routes for agent type selection

**Files:**
- Modify: `control-plane/src/routes/sandbox.ts`
- Modify: `control-plane/src/routes/sandbox.test.ts`

**Step 1: Update the route**

Replace `control-plane/src/routes/sandbox.ts`:

```typescript
import { Hono } from "hono";
import type { SandboxManager, AgentType } from "../sandbox";

export function sandboxRoutes(manager: SandboxManager) {
  const app = new Hono();

  app.post("/start", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const agentType: AgentType = body.agentType === "goose" ? "goose" : "opencode";

    const env: Record<string, string> = {};

    if (agentType === "opencode") {
      for (const [envKey, procKey] of [
        ["LLM_API_KEY", "LLM_API_KEY"],
        ["LLM_BASE_URL", "OPENCODE_LLM_HOST"],
        ["OPENCODE_MODEL", "OPENCODE_MODEL"],
        ["ITERATION_SLEEP", "ITERATION_SLEEP"],
      ]) {
        const val = process.env[procKey];
        if (val) env[envKey] = val;
      }
    } else {
      // Goose
      const apiKey = process.env.LLM_API_KEY;
      if (apiKey) env["OPENAI_API_KEY"] = apiKey;

      const host = process.env.GOOSE_LLM_HOST;
      if (host) env["OPENAI_HOST"] = host;

      const model = process.env.GOOSE_MODEL;
      if (model) env["GOOSE_MODEL"] = model;

      env["GOOSE_PROVIDER"] = "openai";
      env["GOOSE_MODE"] = "auto";
      env["GOOSE_DISABLE_KEYRING"] = "1";

      const sleep = process.env.ITERATION_SLEEP;
      if (sleep) env["ITERATION_SLEEP"] = sleep;
    }

    const containerId = await manager.start(agentType, env);
    return c.json({ containerId, agentType, status: "started" });
  });

  app.post("/stop", async (c) => {
    await manager.stop();
    return c.json({ status: "stopped" });
  });

  app.get("/status", async (c) => {
    const status = await manager.status();
    return c.json(status);
  });

  return app;
}
```

**Step 2: Update tests**

Replace `control-plane/src/routes/sandbox.test.ts`:

```typescript
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { sandboxRoutes } from "./sandbox";
import { SandboxManager } from "../sandbox";

describe("sandbox routes", () => {
  let app: Hono;
  let manager: SandboxManager;

  beforeEach(() => {
    manager = new SandboxManager({
      createContainer: mock(() => Promise.resolve({ Id: "abc123" })),
      startContainer: mock(() => Promise.resolve()),
      stopContainer: mock(() => Promise.resolve()),
      removeContainer: mock(() => Promise.resolve()),
      inspectContainer: mock(() =>
        Promise.resolve({ State: { Running: true, Status: "running" } })
      ),
    } as any);

    app = new Hono();
    app.route("/api/sandbox", sandboxRoutes(manager));
  });

  it("GET /status returns not_running when no container", async () => {
    manager.containerId = null;
    const res = await app.request("/api/sandbox/status");
    const body = await res.json();
    expect(body.status).toBe("not_running");
  });

  it("POST /start creates and starts the sandbox (default opencode)", async () => {
    const res = await app.request("/api/sandbox/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.containerId).toBe("abc123");
    expect(body.agentType).toBe("opencode");
  });

  it("POST /start with agentType=goose starts goose sandbox", async () => {
    const res = await app.request("/api/sandbox/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentType: "goose" }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.agentType).toBe("goose");
  });

  it("GET /status includes agentType when running", async () => {
    await manager.start("opencode", {});
    const res = await app.request("/api/sandbox/status");
    const body = await res.json();
    expect(body.status).toBe("running");
    expect(body.agentType).toBe("opencode");
  });

  it("POST /stop stops the sandbox", async () => {
    manager.containerId = "abc123";
    const res = await app.request("/api/sandbox/stop", { method: "POST" });
    expect(res.status).toBe(200);
  });
});
```

**Step 3: Run tests**

```bash
cd control-plane && bun test
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add control-plane/src/routes/sandbox.ts control-plane/src/routes/sandbox.test.ts
git commit -m "feat: sandbox routes accept agentType, pass agent-specific env vars"
```

---

### Task 5: Update control plane LLM fallback for new env vars

**Files:**
- Modify: `control-plane/src/index.ts:23-35`

**Step 1: Update LLM fallback chain**

The control plane LLM config currently falls back from `CP_LLM_BASE_URL` to `LLM_BASE_URL`. Update it to fall back to `LLM_HOST` (with `/v1` appended) since `LLM_BASE_URL` no longer exists in `.env`.

In `control-plane/src/index.ts`, replace the `cpLlm` block:

```typescript
const cpLlm = process.env.CP_LLM_BASE_URL
  ? createLlm({
      baseUrl: process.env.CP_LLM_BASE_URL,
      apiKey: process.env.CP_LLM_API_KEY ?? process.env.LLM_API_KEY ?? "",
      model: process.env.CP_LLM_MODEL ?? "Qwen3.5-27B",
    })
  : process.env.LLM_HOST
    ? createLlm({
        baseUrl: `${process.env.LLM_HOST}/v1`,
        apiKey: process.env.LLM_API_KEY ?? "",
        model: process.env.CP_LLM_MODEL ?? "Qwen3.5-27B",
      })
    : undefined;
```

**Step 2: Run tests**

```bash
cd control-plane && bun test
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add control-plane/src/index.ts
git commit -m "fix: update control plane LLM fallback to use LLM_HOST"
```

---

### Task 6: Add agent type selector to dashboard Header

**Files:**
- Modify: `dashboard/src/components/Header.tsx`

**Step 1: Update Header component**

Add agent type state and selector dropdown next to Start button. The `agentType` is passed to the start mutation.

Update `dashboard/src/components/Header.tsx`:

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson, postJson } from "../api/client";

type AgentType = "opencode" | "goose";
type SandboxStatus = { status: "running" | "stopped" | "not_running"; containerId?: string; agentType?: AgentType };

export function Header({ onPromptClick, onFilesClick }: { onPromptClick?: () => void; onFilesClick?: () => void }) {
  const queryClient = useQueryClient();
  const [agentType, setAgentType] = useState<AgentType>("opencode");

  const { data: status } = useQuery({
    queryKey: ["sandbox-status"],
    queryFn: () => fetchJson<SandboxStatus>("/sandbox/status"),
    refetchInterval: 5000,
  });

  const startMutation = useMutation({
    mutationFn: () => postJson("/sandbox/start", { agentType }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sandbox-status"] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => postJson("/sandbox/stop", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sandbox-status"] }),
  });

  const isRunning = status?.status === "running";

  return (
    <header className="flex items-center justify-between px-6 py-3.5 bg-washi-panel brush-border-bottom">
      <div className="flex items-center gap-5">
        <div className="flex items-baseline gap-2.5">
          <span className="font-serif text-2xl font-extrabold text-sumi-deep tracking-tight leading-none">
            悟空
          </span>
          <span className="font-serif text-base font-semibold text-sumi-light tracking-wide">
            Goku-in-a-Box
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div className={`hanko ${isRunning ? "active shu-pulse" : ""}`}>
            {isRunning ? "活" : "止"}
          </div>
          <span className="text-sm text-sumi-light font-medium">
            {isRunning
              ? `稼働中 · ${status?.agentType ?? "opencode"}`
              : status?.status === "stopped" || status?.status === "not_running"
                ? "停止"
                : "..."}
          </span>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        {onPromptClick && (
          <button onClick={onPromptClick} className="btn-ink">
            <span className="kanji-accent text-xs mr-1.5">筆</span>
            Prompt
          </button>
        )}
        {onFilesClick && (
          <button onClick={onFilesClick} className="btn-ink">
            <span className="kanji-accent text-xs mr-1.5">巻</span>
            Files
          </button>
        )}
        <select
          value={agentType}
          onChange={(e) => setAgentType(e.target.value as AgentType)}
          disabled={isRunning}
          className="btn-ink bg-transparent text-sm cursor-pointer disabled:opacity-40"
        >
          <option value="opencode">OpenCode</option>
          <option value="goose">Goose</option>
        </select>
        <button
          onClick={() => startMutation.mutate()}
          disabled={isRunning || startMutation.isPending}
          className="btn-ink btn-matcha"
        >
          {startMutation.isPending ? "Starting..." : "Start"}
        </button>
        <button
          onClick={() => stopMutation.mutate()}
          disabled={!isRunning || stopMutation.isPending}
          className="btn-ink btn-shu"
        >
          {stopMutation.isPending ? "Stopping..." : "Stop"}
        </button>
      </div>
    </header>
  );
}
```

**Step 2: Verify dashboard builds**

```bash
cd dashboard && npx tsc --noEmit && npx vite build
```

Expected: no errors.

**Step 3: Commit**

```bash
git add dashboard/src/components/Header.tsx
git commit -m "feat: add agent type selector to dashboard header"
```

---

### Task 7: Update CLAUDE.md and .env.example

**Files:**
- Modify: `CLAUDE.md`
- Verify: `.env.example` (already updated)

**Step 1: Update CLAUDE.md**

Update the following sections:
- Build commands: add both sandbox images
- Environment variables table: reflect new vars
- Key files table: add goose agent-loop
- API endpoints: note agentType in POST /start

**Step 2: Commit**

```bash
git add CLAUDE.md .env.example
git commit -m "docs: update CLAUDE.md for multi-agent sandbox support"
```

---

### Task 8: Integration test — build both images and verify

**Step 1: Build both images**

```bash
docker build -t goku-sandbox-opencode:latest -f sandbox/opencode/Dockerfile sandbox/
docker build -t goku-sandbox-goose:latest -f sandbox/goose/Dockerfile sandbox/
```

**Step 2: Run control plane tests**

```bash
cd control-plane && bun test
```

Expected: all tests pass.

**Step 3: Run dashboard type check + build**

```bash
cd dashboard && npx tsc --noEmit && npx vite build
```

Expected: no errors.

**Step 4: Manual smoke test**

```bash
# Terminal 1: start control plane
cd control-plane && export $(grep -v '^#' ../.env | xargs) && bun run src/index.ts

# Terminal 2: start dashboard
cd dashboard && npm run dev

# Open http://localhost:5173
# - Select "Goose" from dropdown
# - Click Start
# - Verify events stream in live view
# - Click Stop
# - Select "OpenCode", Start, verify events
```

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration test fixes"
```
