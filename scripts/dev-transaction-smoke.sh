#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/portfolio-ts/docker-compose.yml"

DB_NAME="${1:-portfolio_smoke_tx_$(date +%Y%m%d_%H%M%S)}"
DB_URL="postgresql://portfolio_user:portfolio_password@postgres:5432/${DB_NAME}"
KEEP_DB="${KEEP_DB:-0}"
RECALC_FROM_DATE="2026-01-01"

cleanup() {
  if [[ "$KEEP_DB" == "1" ]]; then
    echo "Keeping disposable database: ${DB_NAME}"
    return
  fi

  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -U portfolio_user -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null
}

trap cleanup EXIT

portfolio_exec() {
  docker compose -f "$COMPOSE_FILE" exec -T \
    -e PORTFOLIO_DB_URL="$DB_URL" \
    portfolio sh -lc "$1"
}

postgres_exec() {
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -U portfolio_user -d "$DB_NAME" -v ON_ERROR_STOP=1
}

parse_json() {
  local mode="$1"
  shift
  local json_text="$1"
  shift
  JSON_TEXT="$json_text" python3 - "$mode" "$@" <<'PY'
import json
import os
import sys

mode = sys.argv[1]
payload = json.loads(os.environ["JSON_TEXT"])

if mode == "ok":
    if not payload.get("ok"):
        raise SystemExit(f"{payload.get('command')}: expected ok=true, got {payload}")
    print(payload["command"])
    raise SystemExit(0)

if mode == "transactions":
    expected_total = int(sys.argv[2])
    expected_actions = sys.argv[3:]
    if not payload.get("ok"):
        raise SystemExit(f"transactions: expected ok=true, got {payload}")
    total = payload["meta"]["pagination"]["total"]
    if total != expected_total:
        raise SystemExit(f"transactions: expected total {expected_total}, got {total}")
    rows = payload["data"]
    seen = {row["action"] for row in rows}
    for action in expected_actions:
      if action not in seen:
        raise SystemExit(f"transactions: missing action {action}; saw {sorted(seen)}")
    print(total)
    raise SystemExit(0)

if mode == "summary":
    if not payload.get("ok"):
        raise SystemExit(f"summary: expected ok=true, got {payload}")
    value = float(payload["data"]["portfolio_value_usd"])
    if value <= 0:
        raise SystemExit(f"summary: expected positive portfolio_value_usd, got {value}")
    print(value)
    raise SystemExit(0)

if mode == "cash":
    if not payload.get("ok"):
        raise SystemExit(f"cash: expected ok=true, got {payload}")
    rows = payload["data"]["rows"]
    if len(rows) == 0:
        raise SystemExit("cash: expected at least one row")
    print(len(rows))
    raise SystemExit(0)

if mode == "allocation":
    if not payload.get("ok"):
        raise SystemExit(f"allocation: expected ok=true, got {payload}")
    rows = payload["data"]["rows"]
    if len(rows) == 0:
        raise SystemExit("allocation: expected at least one row")
    print(len(rows))
    raise SystemExit(0)

raise SystemExit(f"unknown mode: {mode}")
PY
}

run_cli_json() {
  portfolio_exec "bun run src/cli.ts $1"
}

check_snapshots() {
  local as_of="$1"
  local expected_total="$2"
  shift 2
  local expected_actions=("$@")

  local recalc_json
  local summary_json
  local cash_json
  local allocation_json
  local transactions_json

  recalc_json="$(run_cli_json "recalculate --from-date ${RECALC_FROM_DATE} --force")"
  parse_json "ok" "$recalc_json" >/dev/null
  summary_json="$(run_cli_json "summary --as-of-date ${as_of} --include-dust")"
  cash_json="$(run_cli_json "cash --as-of-date ${as_of}")"
  allocation_json="$(run_cli_json "allocation --as-of-date ${as_of} --include-dust")"
  transactions_json="$(run_cli_json "transactions --end-date ${as_of} --limit 200")"

  parse_json "summary" "$summary_json" >/dev/null
  parse_json "cash" "$cash_json" >/dev/null
  parse_json "allocation" "$allocation_json" >/dev/null
  parse_json "transactions" "$transactions_json" "$expected_total" "${expected_actions[@]}" >/dev/null
}

echo "Creating disposable database ${DB_NAME}"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U portfolio_user -d postgres -v ON_ERROR_STOP=1 <<SQL >/dev/null
DROP DATABASE IF EXISTS ${DB_NAME};
CREATE DATABASE ${DB_NAME};
SQL

echo "Initializing schema"
init_json="$(run_cli_json "init")"
parse_json "ok" "$init_json" >/dev/null

echo "Seeding deterministic prices"
postgres_exec <<'SQL' >/dev/null
WITH dates AS (
  SELECT generate_series('2026-01-01'::date, '2026-01-14'::date, '1 day')::date AS d
)
INSERT INTO prices (date, ticker, price)
SELECT d, 'AAPL', 100 + EXTRACT(day FROM d)
FROM dates
UNION ALL
SELECT d, 'ETH-USD', 2000 + EXTRACT(day FROM d) * 10
FROM dates
UNION ALL
SELECT d, 'WBETH-USD', 2100 + EXTRACT(day FROM d) * 10
FROM dates
ON CONFLICT (date, ticker) DO UPDATE
SET price = EXCLUDED.price;
SQL

declare -a STEP_NAMES=(
  "deposit"
  "buy_aapl"
  "buy_eth"
  "dividend"
  "interest"
  "fee"
  "tax"
  "transfer"
  "staking_reward"
  "wrap"
  "unwrap"
  "split"
  "sell"
  "withdraw"
)

declare -a STEP_DATES=(
  "2026-01-01"
  "2026-01-02"
  "2026-01-03"
  "2026-01-04"
  "2026-01-05"
  "2026-01-06"
  "2026-01-07"
  "2026-01-08"
  "2026-01-09"
  "2026-01-10"
  "2026-01-11"
  "2026-01-12"
  "2026-01-13"
  "2026-01-14"
)

declare -a STEP_COMMANDS=(
  "add --date 2026-01-01 --asset USD --action DEPOSIT --quantity 20000 --exchange Smoke"
  "add --date 2026-01-02 --asset AAPL --action BUY --quantity 10 --price 100 --fees 1 --exchange Smoke"
  "add --date 2026-01-03 --asset ETH-USD --action BUY --quantity 2 --price 2000 --fees 2 --exchange Smoke"
  "add --date 2026-01-04 --asset USD --action DIVIDEND --quantity 50 --exchange Smoke"
  "add --date 2026-01-05 --asset USD --action INTEREST --quantity 10 --exchange Smoke"
  "add --date 2026-01-06 --asset USD --action FEE --quantity 5 --exchange Smoke"
  "add --date 2026-01-07 --asset USD --action TAX --quantity 7 --exchange Smoke"
  "add --date 2026-01-08 --asset USD --action TRANSFER --quantity 100 --exchange Smoke --account Savings"
  "add --date 2026-01-09 --asset ETH-USD --action STAKING_REWARD --quantity 0.1 --exchange Smoke"
  "wrap --date 2026-01-10 --from-asset ETH-USD --to-asset WBETH-USD --from-quantity 0.5 --to-quantity 0.5"
  "unwrap --date 2026-01-11 --from-asset WBETH-USD --to-asset ETH-USD --from-quantity 0.2 --to-quantity 0.2"
  "split --date 2026-01-12 --asset AAPL --ratio 2 --exchange Smoke --confirm"
  "add --date 2026-01-13 --asset AAPL --action SELL --quantity 5 --price 110 --fees 1 --exchange Smoke"
  "add --date 2026-01-14 --asset USD --action WITHDRAW --quantity 200 --exchange Smoke"
)

declare -a STEP_TOTALS=(1 2 3 4 5 6 7 8 9 11 13 14 15 16)
declare -a STEP_ACTIONS=(
  "DEPOSIT"
  "DEPOSIT BUY"
  "DEPOSIT BUY"
  "DEPOSIT BUY DIVIDEND"
  "DEPOSIT BUY DIVIDEND INTEREST"
  "DEPOSIT BUY DIVIDEND INTEREST FEE"
  "DEPOSIT BUY DIVIDEND INTEREST FEE TAX"
  "DEPOSIT BUY DIVIDEND INTEREST FEE TAX TRANSFER"
  "DEPOSIT BUY DIVIDEND INTEREST FEE TAX TRANSFER STAKING_REWARD"
  "DEPOSIT BUY DIVIDEND INTEREST FEE TAX TRANSFER STAKING_REWARD WRAP UNWRAP"
  "DEPOSIT BUY DIVIDEND INTEREST FEE TAX TRANSFER STAKING_REWARD WRAP UNWRAP"
  "DEPOSIT BUY DIVIDEND INTEREST FEE TAX TRANSFER STAKING_REWARD WRAP UNWRAP SPLIT"
  "DEPOSIT BUY SELL DIVIDEND INTEREST FEE TAX TRANSFER STAKING_REWARD WRAP UNWRAP SPLIT"
  "DEPOSIT BUY SELL WITHDRAW DIVIDEND INTEREST FEE TAX TRANSFER STAKING_REWARD WRAP UNWRAP SPLIT"
)

for i in "${!STEP_NAMES[@]}"; do
  step_name="${STEP_NAMES[$i]}"
  step_date="${STEP_DATES[$i]}"
  step_command="${STEP_COMMANDS[$i]}"
  expected_total="${STEP_TOTALS[$i]}"

  echo "Running ${step_name}: ${step_command}"
  result_json="$(run_cli_json "$step_command")"
  parse_json "ok" "$result_json" >/dev/null

  IFS=' ' read -r -a expected_actions <<<"${STEP_ACTIONS[$i]}"
  check_snapshots "$step_date" "$expected_total" "${expected_actions[@]}"
done

echo "Final snapshot"
run_cli_json "summary --as-of-date 2026-01-14 --include-dust"
run_cli_json "cash --as-of-date 2026-01-14"
run_cli_json "allocation --as-of-date 2026-01-14 --include-dust"
run_cli_json "transactions --end-date 2026-01-14 --limit 200"

echo "Smoke pass complete for ${DB_NAME}"
