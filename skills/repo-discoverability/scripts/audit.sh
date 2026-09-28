#!/usr/bin/env bash
# Thin wrapper around the RDK CLI for agents that do not have Node on PATH
# inside their own runtime. Usage: scripts/audit.sh [audit|fix|init|npm-surface] [extra flags]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CLI="$ROOT/packages/rdk-cli/bin/rdk.js"
COMMAND="${1:-audit}"
shift || true

if ! command -v node >/dev/null 2>&1; then
  echo "node is required (>= 18): https://nodejs.org" >&2
  exit 127
fi

exec node "$CLI" "$COMMAND" "$@"
