# Portfolio Tracker

Transaction-based portfolio tracking with FIFO cost basis calculation.

## Features

- Track investment transactions (buys, sells, transfers)
- Calculate cost basis using FIFO (First-In-First-Out) method
- Import transactions from CSV or JSON
- CLI interface for portfolio management
- Support for multiple asset types and data sources

## Installation

```bash
uv sync
```

## Usage

```bash
# Add a transaction
portfolio add --symbol BTC-USD --type buy --price 45000 --quantity 0.5 --date 2024-01-01

# List all transactions
portfolio list

# Show portfolio summary
portfolio summary

# Show allocation
portfolio allocation

# Get cash balance
portfolio cash
```

## Development

Install development dependencies:

```bash
uv sync --all-extras
```

Run tests:

```bash
pytest
```

## Requirements

- Python 3.13+
- See `pyproject.toml` for full dependency list
