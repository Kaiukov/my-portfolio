# my-portfolio

A Python CLI tool for portfolio tracking powered by DuckDB. 

## Features

- **Pure JSON Output**: All commands output pure JSON, making it perfect for programmatic use, automation, and API integrations.
- **DuckDB Powered**: Uses DuckDB for fast, robust, and local data storage and cached price series.
- **Deterministic Valuation**: Time-Weighted Return (TWR) is the primary portfolio return metric. Read-path valuation relies exclusively on cached price and FX series to ensure fast, deterministic reporting without silent outside API calls.
- **Comprehensive Tracking**: Supports standard trade actions (`BUY`, `SELL`), cash flows (`DEPOSIT`, `WITHDRAW`, `TRANSFER`), income (`DIVIDEND`, `INTEREST`), expenses (`FEE`, `TAX`), and currency exchanges.
- **Multi-Currency**: Base currency is USD, with robust support and FX-conversion tracking for international assets.

## Prerequisites

- Python >= 3.13
- [uv](https://docs.astral.sh/uv/) package manager

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd my-portfolio

# Install using uv
uv sync
```

The CLI will be available as `portfolio`.

## Usage

Interact with the portfolio database through the `portfolio` CLI.

### Initialization & Setup

Initialize a new portfolio DB (safe to run on an existing DB; idempotent):
```bash
portfolio init
```

### Mutating State

Add or edit transactions:
```bash
# Add a transaction
portfolio add --help

# Edit an existing transaction (supports --dry-run)
portfolio edit --id <txn-id> --dry-run
```

Supported transaction types:
- `BUY` / `SELL`
- `DEPOSIT` / `WITHDRAW`
- `DIVIDEND` / `INTEREST`
- `FEE` / `TAX`
- `TRANSFER`
- `EXCHANGE` (via the dedicated `portfolio exchange` command)

### Reporting & Analysis

All read commands output purely in JSON and do not trigger hidden network calls. They use the most recent cached prices/FX rates up to the `--as-of-date`.

```bash
# View current portfolio status
portfolio status

# Check cash balances
portfolio cash

# Get portfolio allocation
portfolio allocation

# View performance metrics (TWR, CAGR, gains)
portfolio performance

# Comprehensive portfolio summary
portfolio summary

# List transactions
portfolio transactions
```

### Maintenance & Price Management

Mutating commands generally trigger a recalculation automatically, but maintenance commands are available:

```bash
# Verify integrity of price caches
portfolio verify_prices

# Fetch missing/incomplete price series and cache them
# Use --dry-run to preview what will be fetched
portfolio repair_prices --dry-run
portfolio repair_prices

# Force recalculation of daily returns
portfolio recalculate --force

# Check overall DB health, reachability, and price coverage
portfolio health
```

## Documentation

Additional design notes and operational references live in `docs/`:

- [API Response Standardization Plan](docs/api-response-standardization-plan.md)
- [Crontab Schedule](docs/crontab-schedule.md)
- [Production Ready Plan](docs/production-ready-plan.md)
- [Transaction Specification](docs/transaction-spec.md)

## Testing

The project uses `pytest`. Run tests locally with `uv`:

```bash
uv run pytest
```
