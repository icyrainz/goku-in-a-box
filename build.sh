#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

usage() {
  echo "Usage: ./build.sh [opencode|goose|all]"
  echo "  Defaults to 'all' if no argument given."
}

build_opencode() {
  echo "Building goku-sandbox-opencode:latest..."
  docker build -t goku-sandbox-opencode:latest -f "$ROOT/sandbox/opencode/Dockerfile" "$ROOT/sandbox/"
}

build_goose() {
  echo "Building goku-sandbox-goose:latest..."
  docker build -t goku-sandbox-goose:latest -f "$ROOT/sandbox/goose/Dockerfile" "$ROOT/sandbox/"
}

TARGET="${1:-all}"

case "$TARGET" in
  opencode) build_opencode ;;
  goose)    build_goose ;;
  all)      build_opencode; build_goose ;;
  *)        usage; exit 1 ;;
esac

echo "Done."
