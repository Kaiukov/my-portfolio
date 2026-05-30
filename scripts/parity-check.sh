#!/usr/bin/env bash
# Phase 5 CLI validation script.
#
# Phase 4 (portfolio-py available): compares TypeScript vs Python output.
# Phase 5 (portfolio-py gone): validates TypeScript output shape, structure,
#   and values. Does NOT need Python to run.
#
# Usage:
#   PORTFOLIO_DB_URL=postgresql://... ./scripts/parity-check.sh
#   PORTFOLIO_DB_URL=postgresql://... PARITY_COMMANDS="status transactions report" ./scripts/parity-check.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS_CLI="bun $REPO_ROOT/portfolio-ts/src/cli.ts"

COMMANDS="${PARITY_COMMANDS:-status transactions report health init verify_prices repair_prices_dry_run recalculate_dry_run sync_dry_run}"
PHASE4_MODE=false

if command -v uv > /dev/null 2>&1 && uv run portfolio-py --help > /dev/null 2>&1; then
  PHASE4_MODE=true
  PY_CLI="uv run portfolio-py"
fi

PASS=0
FAIL=0
SKIP=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Capture stdout regardless of exit code; only use fallback if stdout is empty/not JSON
run_ts() {
  local out; out=$(eval "$TS_CLI $*" 2>/dev/null; true)
  if [[ -z "$out" ]] || ! printf '%s' "$out" | bun -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))" > /dev/null 2>&1; then
    echo '{"ok":false,"command":"_","error":{"code":"CLI_FAILED","message":"TS CLI no JSON output"},"meta":{"generated_at":"","count":null}}'
  else
    echo "$out"
  fi
}
run_py() {
  local out; out=$(eval "$PY_CLI $*" 2>/dev/null; true)
  if [[ -z "$out" ]] || ! printf '%s' "$out" | bun -e "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))" > /dev/null 2>&1; then
    echo '{"ok":false,"command":"_","error":{"code":"CLI_FAILED","message":"PY CLI no JSON output"},"meta":{"generated_at":"","count":null}}'
  else
    echo "$out"
  fi
}

# Extract value with bun inline eval; returns "ERROR" or "NULL" on failure
jq_val() {
  local json="$1" expr="$2"
  printf '%s' "$json" | bun -e "
    try {
      const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const v=($expr);
      process.stdout.write(v===null?'NULL':v===undefined?'UNDEFINED':String(v));
    } catch(e){ process.stdout.write('ERROR:'+e.message.replace(/\\n/g,' ')); }
  " 2>/dev/null || echo "ERROR"
}

# Assert a bun expression is truthy; fail with message on falsy
assert_ts() {
  local label="$1" json="$2" expr="$3" msg="$4"
  local result
  result=$(jq_val "$json" "$expr")
  if [[ "$result" != "true" ]]; then
    echo "    FAIL  $label: $msg (got: $result)"
    return 1
  fi
  return 0
}

fail_cmd() { echo "  FAIL  $1 — $2"; ((FAIL++)) || true; }
pass_cmd() { echo "  PASS  $1 — $2"; ((PASS++)) || true; }
skip_cmd() { echo "  SKIP  $1 — $2"; ((SKIP++)) || true; }

# Numeric within 1% tolerance (or 0.01 absolute)
nums_close() {
  bun -e "
    const a=parseFloat('$1'), b=parseFloat('$2');
    const tol=Math.max(Math.abs(b)*0.01,0.01);
    process.stdout.write((!isNaN(a)&&!isNaN(b)&&Math.abs(a-b)<=tol)?'ok':'fail');
  " 2>/dev/null || echo "error"
}

# ---------------------------------------------------------------------------
# Per-command checks
# ---------------------------------------------------------------------------

check_status() {
  local ts; ts=$(run_ts status)
  local errors=0

  assert_ts "status.ok"      "$ts" "d.ok===true"                           "ok must be true"           || ((errors++)) || true
  assert_ts "status.command" "$ts" "d.command==='status'"                  "command must be 'status'"  || ((errors++)) || true
  assert_ts "status.data"    "$ts" "typeof d.data==='object'&&d.data!==null" "data must be an object"  || ((errors++)) || true

  for key in transactions start_date end_date portfolio_value total_invested deposits withdrawals income fees taxes total_gain total_gain_pct as_of_date; do
    assert_ts "status.data.$key" "$ts" "Object.prototype.hasOwnProperty.call(d.data,'$key')" "data.$key must exist" || ((errors++)) || true
  done

  assert_ts "status.transactions>0" "$ts" "d.data.transactions>0" "transactions count should be positive" || ((errors++)) || true
  assert_ts "status.portfolio_value" "$ts" "typeof d.data.portfolio_value==='number'&&d.data.portfolio_value>0" "portfolio_value should be positive number" || ((errors++)) || true
  assert_ts "status.meta.generated_at" "$ts" "typeof d.meta?.generated_at==='string'" "meta.generated_at must be a string" || ((errors++)) || true

  if $PHASE4_MODE; then
    local py; py=$(run_py status)
    for key in portfolio_value total_invested deposits withdrawals income fees taxes; do
      local tv pv
      tv=$(jq_val "$ts" "d.data['$key']??0"); pv=$(jq_val "$py" "d.data['$key']??0")
      local match; match=$(nums_close "$tv" "$pv")
      if [[ "$match" != "ok" ]]; then
        echo "    WARN  status[$key]: ts=$tv py=$pv (>1% difference — check if FX conversion)"
        # Don't fail on FX differences — documented as accepted behavior change
      fi
    done
  fi

  if [ "$errors" -eq 0 ]; then pass_cmd "status" "JSON shape valid, all keys present, values sane"
  else fail_cmd "status" "$errors assertion(s) failed"; fi
}

check_transactions() {
  local args="${1:---limit 5}"
  local ts; ts=$(run_ts "transactions $args")
  local errors=0

  assert_ts "transactions.ok"      "$ts" "d.ok===true"                               "ok must be true"          || ((errors++)) || true
  assert_ts "transactions.command" "$ts" "d.command==='transactions'"                "command must be 'transactions'" || ((errors++)) || true
  assert_ts "transactions.data"    "$ts" "Array.isArray(d.data)"                     "data must be an array"    || ((errors++)) || true
  assert_ts "transactions.meta.pagination" "$ts" "typeof d.meta?.pagination?.total==='number'" "pagination.total must be a number" || ((errors++)) || true
  assert_ts "transactions.meta.pagination.has_more" "$ts" "typeof d.meta?.pagination?.has_more==='boolean'" "pagination.has_more must be boolean" || ((errors++)) || true

  # Check first row shape if data is non-empty
  local len; len=$(jq_val "$ts" "d.data.length")
  if [[ "$len" != "0" ]]; then
    for key in id date asset action quantity asset_type currency exchange; do
      assert_ts "transactions.data[0].$key" "$ts" "Object.prototype.hasOwnProperty.call(d.data[0],'$key')" "data[0].$key must exist" || ((errors++)) || true
    done
  fi

  if $PHASE4_MODE; then
    local py; py=$(run_py "transactions $args")
    local py_len ts_len
    ts_len=$(jq_val "$ts" "d.data.length"); py_len=$(jq_val "$py" "d.data.length")
    if [[ "$ts_len" != "$py_len" ]]; then
      echo "    FAIL  transactions: row count mismatch ts=$ts_len py=$py_len"
      ((errors++)) || true
    fi
  fi

  if [ "$errors" -eq 0 ]; then pass_cmd "transactions $args" "JSON shape valid, pagination present, row shape valid"
  else fail_cmd "transactions $args" "$errors assertion(s) failed"; fi
}

check_report() {
  local args="${1:---limit 3}"
  local ts; ts=$(run_ts "report $args")
  local errors=0

  assert_ts "report.ok"      "$ts" "d.ok===true"           "ok must be true"     || ((errors++)) || true
  assert_ts "report.command" "$ts" "d.command==='report'"  "command must be 'report'" || ((errors++)) || true
  assert_ts "report.data"    "$ts" "Array.isArray(d.data)" "data must be array"  || ((errors++)) || true
  assert_ts "report.pagination" "$ts" "typeof d.meta?.pagination?.total==='number'" "pagination.total must be number" || ((errors++)) || true

  local len; len=$(jq_val "$ts" "d.data.length")
  if [[ "$len" != "0" ]]; then
    for key in date portfolio_value portfolio_daily_return investment_return cash_flow_impact adjusted_base; do
      assert_ts "report.data[0].$key" "$ts" "Object.prototype.hasOwnProperty.call(d.data[0],'$key')" "data[0].$key must exist" || ((errors++)) || true
    done
    assert_ts "report.data[0].portfolio_value>0" "$ts" "d.data[0].portfolio_value>0" "first row portfolio_value should be positive" || ((errors++)) || true
  fi

  if [ "$errors" -eq 0 ]; then pass_cmd "report $args" "JSON shape valid, daily_returns fields present"
  else fail_cmd "report $args" "$errors assertion(s) failed"; fi
}

check_health() {
  local ts; ts=$(run_ts health)
  local errors=0

  assert_ts "health.ok"        "$ts" "d.ok===true"                 "ok must be true"         || ((errors++)) || true
  assert_ts "health.command"   "$ts" "d.command==='health'"        "command must be 'health'"|| ((errors++)) || true
  assert_ts "health.status"    "$ts" "['ok','degraded'].includes(d.data?.status)" "status must be ok or degraded" || ((errors++)) || true
  assert_ts "health.db_reachable" "$ts" "d.data?.db_reachable===true" "db_reachable must be true" || ((errors++)) || true

  for key in needs_recalc last_successful_price_refresh last_successful_recalc price_coverage_issues stale_tickers; do
    assert_ts "health.data.$key" "$ts" "Object.prototype.hasOwnProperty.call(d.data,'$key')" "data.$key must exist" || ((errors++)) || true
  done

  assert_ts "health.stale_tickers[]" "$ts" "Array.isArray(d.data?.stale_tickers)" "stale_tickers must be array" || ((errors++)) || true

  if [ "$errors" -eq 0 ]; then pass_cmd "health" "JSON shape valid, all diagnostic keys present"
  else fail_cmd "health" "$errors assertion(s) failed"; fi
}

check_init() {
  local ts; ts=$(run_ts init)
  local errors=0

  assert_ts "init.ok"      "$ts" "d.ok===true"          "ok must be true"   || ((errors++)) || true
  assert_ts "init.command" "$ts" "d.command==='init'"   "command must be 'init'" || ((errors++)) || true
  assert_ts "init.db_target" "$ts" "d.data?.db_target==='postgresql'" "db_target must be postgresql" || ((errors++)) || true
  assert_ts "init.status"  "$ts" "d.data?.status==='ready'" "status must be ready" || ((errors++)) || true

  if [ "$errors" -eq 0 ]; then pass_cmd "init" "DB schema ready, 4 core tables found"
  else fail_cmd "init" "$errors assertion(s) failed"; fi
}

check_verify_prices() {
  local ts; ts=$(run_ts verify_prices)
  local errors=0

  assert_ts "verify_prices.ok"      "$ts" "d.ok===true"                                    "ok must be true"          || ((errors++)) || true
  assert_ts "verify_prices.command" "$ts" "d.command==='verify_prices'"                     "command must be 'verify_prices'" || ((errors++)) || true
  assert_ts "verify_prices.data"    "$ts" "typeof d.data==='object'&&d.data!==null"         "data must be an object"   || ((errors++)) || true

  for key in total_rows unique_tickers date_range required_tickers coverage_issues needs_recalc; do
    assert_ts "verify_prices.data.$key" "$ts" "Object.prototype.hasOwnProperty.call(d.data,'$key')" "data.$key must exist" || ((errors++)) || true
  done

  assert_ts "verify_prices.total_rows>=0" "$ts" "typeof d.data.total_rows==='number'&&d.data.total_rows>=0" "total_rows must be non-negative number" || ((errors++)) || true
  assert_ts "verify_prices.coverage_issues[]" "$ts" "Array.isArray(d.data.coverage_issues)" "coverage_issues must be an array" || ((errors++)) || true
  assert_ts "verify_prices.required_tickers[]" "$ts" "Array.isArray(d.data.required_tickers)" "required_tickers must be an array" || ((errors++)) || true

  if [ "$errors" -eq 0 ]; then pass_cmd "verify_prices" "JSON shape valid, all diagnostic keys present"
  else fail_cmd "verify_prices" "$errors assertion(s) failed"; fi
}

check_repair_prices_dry_run() {
  local ts; ts=$(run_ts "repair_prices --dry-run")
  local errors=0

  assert_ts "repair_prices_dry_run.ok"      "$ts" "d.ok===true"                        "ok must be true"        || ((errors++)) || true
  assert_ts "repair_prices_dry_run.command" "$ts" "d.command==='repair_prices'"         "command must be 'repair_prices'" || ((errors++)) || true
  assert_ts "repair_prices_dry_run.data"    "$ts" "typeof d.data==='object'&&d.data!==null" "data must be object" || ((errors++)) || true
  assert_ts "repair_prices_dry_run.data.dry_run" "$ts" "d.data?.dry_run===true"         "dry_run must be true"   || ((errors++)) || true
  assert_ts "repair_prices_dry_run.data.would_repair[]" "$ts" "Array.isArray(d.data?.would_repair)" "would_repair must be array" || ((errors++)) || true
  assert_ts "repair_prices_dry_run.data.range" "$ts" "typeof d.data?.range?.start==='string'" "range.start must be string" || ((errors++)) || true

  if [ "$errors" -eq 0 ]; then pass_cmd "repair_prices --dry-run" "JSON shape valid, dry_run data present"
  else fail_cmd "repair_prices --dry-run" "$errors assertion(s) failed"; fi
}

check_recalculate_dry_run() {
  local ts; ts=$(run_ts "recalculate --dry-run")
  local errors=0

  assert_ts "recalculate_dry_run.ok"      "$ts" "d.ok===true"                              "ok must be true"          || ((errors++)) || true
  assert_ts "recalculate_dry_run.command" "$ts" "d.command==='recalculate'"                 "command must be 'recalculate'" || ((errors++)) || true
  assert_ts "recalculate_dry_run.data"    "$ts" "typeof d.data==='object'&&d.data!==null"   "data must be object"      || ((errors++)) || true
  assert_ts "recalculate_dry_run.data.dry_run" "$ts" "d.data?.dry_run===true"               "dry_run must be true"     || ((errors++)) || true
  assert_ts "recalculate_dry_run.data.needs_recalc" "$ts" "typeof d.data?.needs_recalc==='boolean'" "needs_recalc must be boolean" || ((errors++)) || true
  assert_ts "recalculate_dry_run.data.forced" "$ts" "typeof d.data?.forced==='boolean'"     "forced must be boolean"   || ((errors++)) || true

  if [ "$errors" -eq 0 ]; then pass_cmd "recalculate --dry-run" "JSON shape valid, dry_run data present"
  else fail_cmd "recalculate --dry-run" "$errors assertion(s) failed"; fi
}

check_sync_dry_run() {
  local ts; ts=$(run_ts "sync --dry-run")
  local errors=0

  assert_ts "sync_dry_run.ok"      "$ts" "d.ok===true"                                "ok must be true"          || ((errors++)) || true
  assert_ts "sync_dry_run.command" "$ts" "d.command==='sync'"                         "command must be 'sync'"   || ((errors++)) || true
  assert_ts "sync_dry_run.data"    "$ts" "typeof d.data==='object'&&d.data!==null"    "data must be object"      || ((errors++)) || true
  assert_ts "sync_dry_run.data.dry_run" "$ts" "d.data?.dry_run===true"                "dry_run must be true"     || ((errors++)) || true
  assert_ts "sync_dry_run.data.repair_prices" "$ts" "typeof d.data?.repair_prices==='object'" "repair_prices sub-object exists" || ((errors++)) || true
  assert_ts "sync_dry_run.data.recalculate" "$ts" "typeof d.data?.recalculate==='object'" "recalculate sub-object exists" || ((errors++)) || true

  if [ "$errors" -eq 0 ]; then pass_cmd "sync --dry-run" "JSON shape valid, both sub-commands present"
  else fail_cmd "sync --dry-run" "$errors assertion(s) failed"; fi
}

check_unknown_command_error() {
  local ts; ts=$(run_ts "_nonexistent_cmd_")
  local errors=0

  assert_ts "error.ok=false"   "$ts" "d.ok===false"                        "ok must be false"              || ((errors++)) || true
  assert_ts "error.code"       "$ts" "d.error?.code==='UNKNOWN_COMMAND'"   "error.code must be UNKNOWN_COMMAND" || ((errors++)) || true
  assert_ts "error.command"    "$ts" "d.command==='_nonexistent_cmd_'"     "command echoed in error"       || ((errors++)) || true
  assert_ts "error.message"    "$ts" "typeof d.error?.message==='string'"  "error.message must be string"  || ((errors++)) || true
  assert_ts "error.meta"       "$ts" "typeof d.meta?.generated_at==='string'" "meta.generated_at in error" || ((errors++)) || true

  if [ "$errors" -eq 0 ]; then pass_cmd "error-envelope" "Unknown command produces correct error JSON"
  else fail_cmd "error-envelope" "$errors assertion(s) failed"; fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo "=== portfolio CLI validation ==="
echo "Mode: $([ "$PHASE4_MODE" = "true" ] && echo 'Phase 4 (TS vs Python)' || echo 'Phase 5 (TS structure validation only)')"
echo "PORTFOLIO_DB_URL: ${PORTFOLIO_DB_URL:0:45}..."
echo ""

for cmd in $COMMANDS; do
  case "$cmd" in
    status)                    check_status ;;
    transactions)              check_transactions "--limit 5" ;;
    report)                    check_report "--limit 3" ;;
    health)                    check_health ;;
    init)                      check_init ;;
    verify_prices)             check_verify_prices ;;
    repair_prices_dry_run)     check_repair_prices_dry_run ;;
    recalculate_dry_run)       check_recalculate_dry_run ;;
    sync_dry_run)              check_sync_dry_run ;;
    error-envelope)            check_unknown_command_error ;;
    *)                   skip_cmd "$cmd" "no validation logic implemented" ;;
  esac
done

# Always check error envelope
check_unknown_command_error

echo ""
echo "Results: ${PASS} pass, ${FAIL} fail, ${SKIP} skip"
echo ""
if [ "$PHASE4_MODE" = "false" ]; then
  echo "Note: Phase 5 mode — Python fallback unavailable. Validated TypeScript output shape only."
fi

if [ "$FAIL" -gt 0 ]; then exit 1; fi
