# Getting Started

## Prerequisites

- Python 3.13+
- PostgreSQL 16+
- `uv` package manager

## Database Setup

### Local PostgreSQL

```bash
brew install postgresql@16
brew services start postgresql@16
createdb portfolio
createuser portfolio_user -P
```

### Environment Variable

```bash
export PORTFOLIO_DB_URL="postgresql://portfolio_user:password@localhost:5432/portfolio"
```

### Supabase (Cloud)

1. Create a project at [supabase.com](https://supabase.com)
2. Copy the PostgreSQL connection string from Project Settings > Database
3. Set `export PORTFOLIO_DB_URL="postgresql://postgres:...@db.xxx.supabase.co:5432/postgres"`

## Install and Initialize

```bash
uv sync
uv run portfolio init
```

## Key Commands

```bash
uv run portfolio --help
uv run portfolio health
uv run portfolio add --date 2026-03-15 --asset AAPL --action buy --quantity 10 --price 150 --exchange InteractiveBrokers
uv run portfolio status
uv run pytest -q
uv run ruff check .
```
