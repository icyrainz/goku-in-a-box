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

# --- Helper: flush buffered event ---
CURRENT_MSG_ID=""
BUFFER_TYPE=""
TEXT_BUFFER=""

flush_text_buffer() {
  local iteration_id="$1"
  if [ -n "$TEXT_BUFFER" ] && [ -n "$CURRENT_MSG_ID" ]; then
    local event_type="${BUFFER_TYPE:-text}"
    local summary
    summary=$(echo "$TEXT_BUFFER" | head -c 200)
    local payload
    payload=$(jq -n \
      --argjson iterationId "$iteration_id" \
      --arg type "$event_type" \
      --arg summary "$summary" \
      --arg content "$TEXT_BUFFER" \
      '{iterationId: $iterationId, events: [{type: $type, summary: $summary, content: $content}]}')
    curl -sf -X POST "$CONTROL_PLANE_URL/api/telemetry/stream" \
      -H "Content-Type: application/json" \
      -d "$payload" > /dev/null 2>&1 || true
  fi
  TEXT_BUFFER=""
  BUFFER_TYPE=""
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
BACKOFF=0
MAX_BACKOFF=60

# Each container starts fresh — control plane maps seq to DB ids
ITERATION=0
log "Starting iteration sequence from 0"

while true; do
  ITERATION=$((ITERATION + 1))
  log "=== Iteration $ITERATION ==="

  # 1. Fetch current prompt
  PROMPT_RESPONSE=$(curl -sf "$CONTROL_PLANE_URL/api/prompt" || echo '{"content":""}')
  CURRENT_PROMPT=$(echo "$PROMPT_RESPONSE" | jq -r '.content // ""')

  # 2. Read bootstrap identity, memory, tasks, and operating instructions
  BOOTSTRAP=$(cat /state/BOOTSTRAP.md 2>/dev/null || echo "No bootstrap state found.")
  MEMORY=$(cat /workspace/.memory.md 2>/dev/null || echo "No previous memory. This is a fresh start.")
  TASKS=$(cat /workspace/.tasks.md 2>/dev/null || echo "")
  OPERATING=$(cat /state/OPERATING.md 2>/dev/null || echo "")

  # 3. Compose instruction
  INSTRUCTION="## Identity\n$BOOTSTRAP\n\n"
  INSTRUCTION+="## Memory (from previous iteration)\n$MEMORY\n\n"

  if [ -n "$TASKS" ]; then
    INSTRUCTION+="## Tasks\n$TASKS\n\n"
  else
    INSTRUCTION+="## Tasks\nNo tasks file exists. Create /workspace/.tasks.md as your first action.\n\n"
  fi

  if [ -z "$CURRENT_PROMPT" ]; then
    INSTRUCTION+="## Mode: Self-Bootstrap\nNo objective assigned. Explore your environment and prepare to receive tasks."
  else
    INSTRUCTION+="## Objective\n$CURRENT_PROMPT"

    if [ "$CURRENT_PROMPT" != "$PREV_PROMPT" ] && [ -n "$PREV_PROMPT" ]; then
      INSTRUCTION+="\n\n## Notice: Objective Changed\nThe human has updated the objective.\nPrevious: $PREV_PROMPT\nCurrent: $CURRENT_PROMPT\nRevise your tasks to reflect the new objective."
    fi
  fi

  INSTRUCTION+="\n\n## Operating Instructions\n- This is iteration $ITERATION. workdir=/workspace, control-plane=$CONTROL_PLANE_URL.\n$OPERATING"

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
        CONTENT_COUNT=$(echo "$line" | jq '.message.content | length' 2>/dev/null || echo "0")

        for ((ci=0; ci<CONTENT_COUNT; ci++)); do
          CONTENT_TYPE=$(echo "$line" | jq -r ".message.content[$ci].type // \"\"" 2>/dev/null)

          case "$CONTENT_TYPE" in
            text)
              TEXT=$(echo "$line" | jq -r ".message.content[$ci].text // \"\"" 2>/dev/null)
              if [ "$MSG_ID" = "$CURRENT_MSG_ID" ] && [ "$BUFFER_TYPE" = "text" ]; then
                TEXT_BUFFER+="$TEXT"
              else
                flush_text_buffer "$ITERATION"
                CURRENT_MSG_ID="$MSG_ID"
                BUFFER_TYPE="text"
                TEXT_BUFFER="$TEXT"
              fi
              ;;
            thinking|reasoning)
              THOUGHT=$(echo "$line" | jq -r ".message.content[$ci].thinking // .message.content[$ci].text // \"\"" 2>/dev/null)
              if [ "$MSG_ID" = "$CURRENT_MSG_ID" ] && [ "$BUFFER_TYPE" = "thought" ]; then
                TEXT_BUFFER+="$THOUGHT"
              else
                flush_text_buffer "$ITERATION"
                CURRENT_MSG_ID="$MSG_ID"
                BUFFER_TYPE="thought"
                TEXT_BUFFER="$THOUGHT"
              fi
              ;;
            toolRequest)
              flush_text_buffer "$ITERATION"
              # Goose wraps in {"status":"success","value":{"name":"...","arguments":{...}}}
              TC=".message.content[$ci].toolCall"
              TOOL_NAME=$(echo "$line" | jq -r "$TC.value.name // $TC.name // \"tool\"" 2>/dev/null)
              TOOL_ARGS=$(echo "$line" | jq -r "($TC.value.arguments // $TC.arguments) | if type == \"object\" then (to_entries | map(.key + \"=\" + (.value | tostring | .[0:80])) | join(\", \")) else \"\" end" 2>/dev/null | head -c 200)
              send_event "$ITERATION" "tool_use" "$TOOL_NAME${TOOL_ARGS:+: $TOOL_ARGS}" \
                "$(echo "$line" | jq -r "$TC.value // $TC | tostring" 2>/dev/null | head -c 5000)"
              ACTION_COUNT=$((ACTION_COUNT + 1))
              ;;
            toolResponse)
              flush_text_buffer "$ITERATION"
              # Goose wraps in {"status":"success","value":{"content":[{"type":"text","text":"..."}],"isError":false}}
              TR=".message.content[$ci].toolResult"
              RESULT=$(echo "$line" | jq -r "($TR.value.content // $TR.content // [$TR]) | map(.text // (. | tostring)) | join(\"\n\")" 2>/dev/null | head -c 10000)
              RESULT_SUMMARY=$(echo "$RESULT" | head -c 200)
              send_event "$ITERATION" "tool_result" "$RESULT_SUMMARY" "$RESULT"
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

  # 7. Sleep before next iteration (backoff if LLM unavailable)
  if [ "$ACTION_COUNT" -eq 0 ]; then
    BACKOFF=$(( BACKOFF == 0 ? 2 : BACKOFF * 2 ))
    BACKOFF=$(( BACKOFF > MAX_BACKOFF ? MAX_BACKOFF : BACKOFF ))
    log "No actions produced — backing off ${BACKOFF}s"
    sleep "$BACKOFF"
  else
    BACKOFF=0
    sleep "$ITERATION_SLEEP"
  fi
done
