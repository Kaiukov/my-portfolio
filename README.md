# Portfolio CLI

Transaction-based portfolio tracker built on DuckDB. Tracks stocks, ETFs, crypto, and multi-currency cash across brokers.

## Quick Start

```bash
cd /root/my-portfolio
uv run python -m portfolio_db.cli --help
```

## Commands

| Command | Description |
|---------|-------------|
| `status` | Portfolio overview: value, gain, total invested |
| `summary --filter open` | Open positions with gains/losses |
| `allocation` | Asset and cash allocation breakdown |
| `cash` | Cash balances (USD/EUR/GBP) with FX rates |
| `performance` | Risk metrics: Sharpe, drawdown, beta |
| `transactions --limit 20` | Transaction history |
| `recalculate --force` | Recalculate all daily returns |
| `add` | Add a transaction |
| `delete` | Delete a transaction by ID |
| `exchange` | Record currency exchange |
| `report` | Daily returns report |
| `verify-prices` | Check prices table integrity |

## Output Format

All commands return JSON:

```json
{ "ok": true, "command": "status", "data": {...}, "meta": {...} }
```

## AI Assistant (Claude)

To interact with the portfolio via Claude, use the **`portfolio_cli` skill**.

The skill knows how to:
- Connect to this LXC via `ssh root@192.168.1.137` + `pct exec 200`
- Run all CLI commands and parse JSON output
- Aggregate data for Smart DCA 3.1 analysis

**Trigger phrases:** "check my portfolio", "show positions", "portfolio status", "how much is SPYM worth", "cash breakdown"

The skill script:
```bash
python3 /root/.claude/skills/portfolio_cli/scripts/get_portfolio_state.py
```

## Stack

- **Database**: DuckDB (`portfolio.db`)
- **Prices**: yfinance + Binance API
- **Runtime**: Python 3.14 + uv
- **Location**: LXC 200 on Proxmox 192.168.1.137
