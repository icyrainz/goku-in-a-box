#!/usr/bin/env bash
set -euo pipefail

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://host.docker.internal:3000}"
ITERATION_SLEEP="${ITERATION_SLEEP:-2}"
OPENCODE_PORT=4096

log() { echo "[agent-loop] $(date -Iseconds) $*"; }

# --- Start OpenCode server ---
log "Starting OpenCode server on port $OPENCODE_PORT..."
opencode serve --port "$OPENCODE_PORT" --hostname 0.0.0.0 &
OPENCODE_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$OPENCODE_PORT/health" > /dev/null 2>&1; then
    log "OpenCode server ready"
    break
  fi
  sleep 1
done

# --- Helper: collect vitals ---
collect_vitals() {
  local cpu mem disk
  cpu=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' 2>/dev/null || echo "0")
  mem=$(free -m | awk '/Mem:/{print $3}' 2>/dev/null || echo "0")
  disk=$(df -m /workspace | awk 'NR==2{print $3}' 2>/dev/null || echo "0")
  echo "{\"cpu\": $cpu, \"memory\": $mem, \"disk\": $disk}"
}

# --- Main loop ---
PREV_PROMPT=""

# Resume iteration count from control plane to avoid collisions after restart
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

  # 5. Run OpenCode and stream events
  ACTION_COUNT=0
  ERROR_COUNT=0

  # Build opencode run command (fresh session each time, memory file provides continuity)
  OPENCODE_ARGS=(run --attach "http://localhost:$OPENCODE_PORT" --format json "$(echo -e "$INSTRUCTION")")

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
  done < <(stdbuf -oL opencode "${OPENCODE_ARGS[@]}" 2>/dev/null || true)

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
