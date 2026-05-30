#!/usr/bin/env bash
# Parity check: compare portfolio-ts and portfolio-py JSON outputs.
# Compares .ok, top-level keys, data keys, and selected numeric values.
# Exits non-zero on any structural or value mismatch, or if Python is unavailable.
#
# Usage: PORTFOLIO_DB_URL=postgresql://... ./scripts/parity-check.sh
# Optional: PARITY_COMMANDS="status transactions" to limit scope

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS_CLI="bun $REPO_ROOT/portfolio-ts/src/cli.ts"
PY_CLI="uv run portfolio-py"

COMMANDS="${PARITY_COMMANDS:-status transactions}"

PASS=0
FAIL=0
SKIP=0

# Verify Python fallback is available before running
if ! eval "$PY_CLI --help" > /dev/null 2>&1; then
  echo "ERROR: Python fallback (portfolio-py) is not available. Parity check requires it."
  exit 2
fi

# Run command, capture JSON output; return error JSON on failure
run_cmd() {
  local cli="$1"; shift
  eval "$cli $*" 2>/dev/null || echo '{"ok":false,"error":{"code":"CLI_FAILED","message":"CLI execution failed"}}'
}

# Extract a jq value, return "ERROR" on failure
jq_get() {
  local json="$1" path="$2"
  echo "$json" | bun -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    try { process.stdout.write(String($path)); } catch(e) { process.stdout.write('ERROR'); }
  " 2>/dev/null || echo "ERROR"
}

check_status() {
  local ts_out py_out
  ts_out=$(run_cmd "$TS_CLI" status)
  py_out=$(run_cmd "$PY_CLI" status)

  local ts_ok py_ok
  ts_ok=$(jq_get "$ts_out" "d.ok")
  py_ok=$(jq_get "$py_out" "d.ok")

  if [ "$ts_ok" != "$py_ok" ]; then
    echo "  FAIL  status — ok mismatch: ts=$ts_ok py=$py_ok"; ((FAIL++)) || true; return
  fi

  # Check data keys are present in both
  local missing_keys=0
  for key in transactions start_date end_date portfolio_value total_invested deposits withdrawals as_of_date; do
    local ts_v py_v
    ts_v=$(jq_get "$ts_out" "d.data?.['$key']")
    py_v=$(jq_get "$py_out" "d.data?.['$key']")
    if [ "$ts_v" = "undefined" ] || [ "$ts_v" = "ERROR" ]; then
      echo "  WARN  status — key '$key' missing in TS output"
      missing_keys=$((missing_keys+1))
    fi
    if [ "$py_v" = "undefined" ] || [ "$py_v" = "ERROR" ]; then
      echo "  WARN  status — key '$key' missing in Python output"
      missing_keys=$((missing_keys+1))
    fi
  done

  # Compare numeric fields within 1% tolerance
  local numeric_fail=0
  for key in portfolio_value total_invested deposits withdrawals income fees taxes; do
    local ts_n py_n
    ts_n=$(jq_get "$ts_out" "d.data?.['$key'] ?? 0")
    py_n=$(jq_get "$py_out" "d.data?.['$key'] ?? 0")
    local match
    match=$(bun -e "
      const a = parseFloat('$ts_n'), b = parseFloat('$py_n');
      const tol = Math.max(Math.abs(b) * 0.01, 0.01);
      process.stdout.write((!isNaN(a) && !isNaN(b) && Math.abs(a-b) <= tol) ? 'ok' : 'fail:'+a.toFixed(2)+' vs '+b.toFixed(2));
    " 2>/dev/null || echo "error")
    if [[ "$match" != "ok" ]]; then
      echo "  WARN  status[$key] out of 1% tolerance: $match"
      numeric_fail=$((numeric_fail+1))
    fi
  done

  if [ "$missing_keys" -gt 0 ] || [ "$numeric_fail" -gt 0 ]; then
    echo "  FAIL  status — $missing_keys missing keys, $numeric_fail numeric mismatches"
    ((FAIL++)) || true
  else
    echo "  PASS  status (ok=$ts_ok, keys present, numerics within 1%)"
    ((PASS++)) || true
  fi
}

check_transactions() {
  local args="${1:---limit 5}"
  local ts_out py_out
  ts_out=$(run_cmd "$TS_CLI" "transactions $args")
  py_out=$(run_cmd "$PY_CLI" "transactions $args")

  local ts_ok py_ok
  ts_ok=$(jq_get "$ts_out" "d.ok")
  py_ok=$(jq_get "$py_out" "d.ok")

  if [ "$ts_ok" != "$py_ok" ]; then
    echo "  FAIL  transactions — ok mismatch: ts=$ts_ok py=$py_ok"; ((FAIL++)) || true; return
  fi

  # Check data is an array and lengths match
  local ts_len py_len
  ts_len=$(jq_get "$ts_out" "Array.isArray(d.data) ? d.data.length : -1")
  py_len=$(jq_get "$py_out" "Array.isArray(d.data) ? d.data.length : -1")

  if [ "$ts_len" != "$py_len" ]; then
    echo "  FAIL  transactions — row count mismatch: ts=$ts_len py=$py_len"
    ((FAIL++)) || true; return
  fi

  # Check pagination meta keys
  local has_pagination
  has_pagination=$(jq_get "$ts_out" "typeof d.meta?.pagination?.total")
  if [ "$has_pagination" = "undefined" ] || [ "$has_pagination" = "ERROR" ]; then
    echo "  FAIL  transactions — missing meta.pagination.total in TS output"
    ((FAIL++)) || true; return
  fi

  # Check first row has expected keys if there are rows
  if [ "$ts_len" != "0" ]; then
    for key in id date asset action quantity; do
      local ts_v
      ts_v=$(jq_get "$ts_out" "d.data[0]?.['$key']")
      if [ "$ts_v" = "undefined" ] || [ "$ts_v" = "ERROR" ]; then
        echo "  FAIL  transactions — key '$key' missing in first row"
        ((FAIL++)) || true; return
      fi
    done
  fi

  echo "  PASS  transactions (ok=$ts_ok, rows=$ts_len, pagination present)"
  ((PASS++)) || true
}

echo "=== portfolio parity check ==="
echo "PORTFOLIO_DB_URL=${PORTFOLIO_DB_URL:0:40}..."
echo ""

for cmd in $COMMANDS; do
  case "$cmd" in
    status)       check_status ;;
    transactions) check_transactions "--limit 5" ;;
    *)
      echo "  SKIP  $cmd — no comparison logic implemented"
      ((SKIP++)) || true
      ;;
  esac
done

echo ""
echo "Results: ${PASS} pass, ${FAIL} fail, ${SKIP} skip"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
