#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Load env
if [ ! -f "$ROOT/.env" ]; then
  echo "Missing .env — copy .env.example and configure it first"
  exit 1
fi
export $(grep -v '^#' "$ROOT/.env" | grep -v '^\s*$' | xargs)

# Ensure data dir exists for SQLite
mkdir -p "$ROOT/control-plane/data"

# Install deps if needed
[ -d "$ROOT/control-plane/node_modules" ] || (cd "$ROOT/control-plane" && bun install)
[ -d "$ROOT/dashboard/node_modules" ] || (cd "$ROOT/dashboard" && bun install)

echo "Starting control plane on :3000..."
cd "$ROOT/control-plane" && bun run src/index.ts &
CP_PID=$!

echo "Starting dashboard on :5173..."
cd "$ROOT/dashboard" && npx vite --host 2>&1 &
DASH_PID=$!

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$CP_PID" "$DASH_PID" 2>/dev/null || true
  wait "$CP_PID" "$DASH_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo ""
echo "  Dashboard: http://localhost:5173"
echo "  API:       http://localhost:3000"
echo ""
echo "  Select an agent (OpenCode / Goose) and click Start."
echo "  Press Ctrl+C to stop."
echo ""

wait
