# Getting Started

## Prerequisites

- [Bun](https://bun.sh) `>= 1.3`
- PostgreSQL `>= 14`
- `psql` (recommended, for one-time schema bootstrap)

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

Or create a `.env` file (auto-loaded by the CLI):

```bash
PORTFOLIO_DB_URL=postgresql://postgres:postgres@localhost:5432/portfolio
```

### Supabase (Cloud)

1. Create a project at [supabase.com](https://supabase.com)
2. Copy the PostgreSQL connection string from Project Settings > Database
3. Set `export PORTFOLIO_DB_URL="postgresql://postgres:...@db.xxx.supabase.co:5432/postgres"`

## Schema Bootstrap

Apply the SQL schema files once:

```bash
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/schema.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/functions.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/procedures.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/views.sql
psql "$PORTFOLIO_DB_URL" -v ON_ERROR_STOP=1 -f portfolio_db/sql/triggers.sql
```

## Install and Initialize

```bash
cd portfolio-ts
bun install
bun src/cli.ts init
```

## Key Commands

```bash
cd portfolio-ts
bun src/cli.ts --help
bun src/cli.ts health
bun src/cli.ts add --date 2026-03-15 --asset AAPL --action buy --quantity 10 --price 150 --exchange InteractiveBrokers
bun src/cli.ts status
bun test
bun run typecheck
```
