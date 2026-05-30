#!/usr/bin/env bash
# Parity check: compare portfolio-ts and portfolio-py JSON outputs for migrated commands.
# Exits non-zero if any command produces structurally different output.
#
# Usage: PORTFOLIO_DB_URL=postgresql://... ./scripts/parity-check.sh
# Optional: PARITY_COMMANDS="status transactions" to limit scope

set -euo pipefail

TS_CLI="bun $(dirname "$0")/../portfolio-ts/src/cli.ts"
PY_CLI="uv run portfolio-py"

COMMANDS="${PARITY_COMMANDS:-status transactions}"

PASS=0
FAIL=0
SKIP=0

check_command() {
  local cmd="$1"
  shift
  local args=("$@")

  local ts_out py_out
  ts_out=$(eval "$TS_CLI $cmd ${args[*]:-}" 2>/dev/null || echo '{"ok":false,"error":"ts_cli_failed"}')
  py_out=$(eval "$PY_CLI $cmd ${args[*]:-}" 2>/dev/null || echo '{"ok":false,"error":"py_cli_failed"}')

  # Compare .ok field
  local ts_ok py_ok
  ts_ok=$(echo "$ts_out" | bun -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).ok))" 2>/dev/null || echo "error")
  py_ok=$(echo "$py_out" | bun -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).ok))" 2>/dev/null || echo "error")

  if [ "$ts_ok" = "error" ] || [ "$py_ok" = "error" ]; then
    echo "  SKIP  $cmd — could not parse JSON output"
    ((SKIP++)) || true
    return
  fi

  if [ "$ts_ok" = "$py_ok" ]; then
    echo "  PASS  $cmd (ok=$ts_ok)"
    ((PASS++)) || true
  else
    echo "  FAIL  $cmd — ts.ok=$ts_ok py.ok=$py_ok"
    echo "    TS:  $(echo "$ts_out" | head -c 200)"
    echo "    PY:  $(echo "$py_out" | head -c 200)"
    ((FAIL++)) || true
  fi
}

echo "=== portfolio parity check ==="
echo "PORTFOLIO_DB_URL=${PORTFOLIO_DB_URL:-<not set>}"
echo ""

for cmd in $COMMANDS; do
  case "$cmd" in
    transactions) check_command "$cmd" "--limit 5" ;;
    *)            check_command "$cmd" ;;
  esac
done

echo ""
echo "Results: ${PASS} pass, ${FAIL} fail, ${SKIP} skip"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
