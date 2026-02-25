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
ITERATION=0

while true; do
  ITERATION=$((ITERATION + 1))
  log "=== Iteration $ITERATION ==="

  # 1. Fetch current prompt
  PROMPT_RESPONSE=$(curl -sf "$CONTROL_PLANE_URL/api/prompt" || echo '{"content":""}')
  CURRENT_PROMPT=$(echo "$PROMPT_RESPONSE" | jq -r '.content // ""')

  # 2. Read bootstrap state
  BOOTSTRAP=$(cat /state/BOOTSTRAP.md 2>/dev/null || echo "No bootstrap state found.")

  # 3. Compose instruction
  INSTRUCTION="## Bootstrap State\n$BOOTSTRAP\n\n"

  if [ -z "$CURRENT_PROMPT" ]; then
    INSTRUCTION+="## Mode: Self-Bootstrap\nNo prompt has been assigned. Explore your environment, install useful tools, set up your state file at /state/BOOTSTRAP.md, and report readiness."
  else
    INSTRUCTION+="## Current Prompt\n$CURRENT_PROMPT"

    if [ "$CURRENT_PROMPT" != "$PREV_PROMPT" ] && [ -n "$PREV_PROMPT" ]; then
      INSTRUCTION+="\n\n## Notice: Prompt Changed\nThe human has updated the prompt.\nPrevious: $PREV_PROMPT\nCurrent: $CURRENT_PROMPT"
    fi
  fi

  INSTRUCTION+="\n\n## Instructions\n- Update /state/BOOTSTRAP.md with your progress after completing work.\n- Your working directory is /workspace."

  # 4. Register iteration with control plane
  curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/stream" \
    -H "Content-Type: application/json" \
    -d "{\"iterationId\": $ITERATION, \"events\": [{\"type\": \"iteration_start\", \"summary\": \"Starting iteration $ITERATION\"}]}" \
    > /dev/null 2>&1 || true

  # 5. Run OpenCode and stream events
  ACTION_COUNT=0
  ERROR_COUNT=0

  opencode run \
    --attach "http://localhost:$OPENCODE_PORT" \
    --format json \
    "$(echo -e "$INSTRUCTION")" 2>/dev/null | while IFS= read -r line; do

    EVENT_TYPE=$(echo "$line" | jq -r '.type // "unknown"' 2>/dev/null || echo "unknown")
    EVENT_SUMMARY=""

    case "$EVENT_TYPE" in
      text)
        EVENT_SUMMARY=$(echo "$line" | jq -r '.part.text // ""' 2>/dev/null | head -c 200)
        ;;
      tool_use)
        EVENT_SUMMARY=$(echo "$line" | jq -r '.part.state.title // .part.tool // "tool call"' 2>/dev/null)
        ACTION_COUNT=$((ACTION_COUNT + 1))
        ;;
      tool_result)
        EVENT_SUMMARY=$(echo "$line" | jq -r '.part.state.title // "result"' 2>/dev/null | head -c 200)
        ;;
      error)
        EVENT_SUMMARY=$(echo "$line" | jq -r '.error.data.message // "error"' 2>/dev/null)
        ERROR_COUNT=$((ERROR_COUNT + 1))
        ;;
      step_start|step_finish)
        # Skip verbose step boundary events
        continue
        ;;
      *)
        EVENT_SUMMARY="$EVENT_TYPE event"
        ;;
    esac

    curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/stream" \
      -H "Content-Type: application/json" \
      -d "{\"iterationId\": $ITERATION, \"events\": [{\"type\": \"$EVENT_TYPE\", \"summary\": $(echo "$EVENT_SUMMARY" | jq -Rs .)}]}" \
      > /dev/null 2>&1 || true
  done

  # 6. Report end-of-iteration summary + vitals
  VITALS=$(collect_vitals)

  curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/summary" \
    -H "Content-Type: application/json" \
    -d "{
      \"iterationId\": $ITERATION,
      \"summary\": \"Iteration $ITERATION completed\",
      \"actionCount\": $ACTION_COUNT,
      \"errorCount\": $ERROR_COUNT,
      \"vitals\": $VITALS
    }" > /dev/null 2>&1 || true

  log "Iteration $ITERATION complete. Actions: $ACTION_COUNT, Errors: $ERROR_COUNT"

  PREV_PROMPT="$CURRENT_PROMPT"

  # 7. Sleep before next iteration
  sleep "$ITERATION_SLEEP"
done
