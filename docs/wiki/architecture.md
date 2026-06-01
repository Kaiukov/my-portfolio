# Architecture

Three layers. Each owns its domain. No layer reaches into a layer below it that is not its direct dependency.

## PostgreSQL Persistence Layer

`portfolio_db/database.py` — SQL, psycopg driver, schema setup, migrations, connection lifecycle, PORTFOLIO_DB_URL resolution, all repository/query methods.

**Rule**: No caller outside this file may use `db.con` directly.

## Shared Service Layer

Files: `portfolio_service.py`, `transaction_service.py`, `reporting_service.py`, `recalculation_service.py`, `performance_service.py`, `price_service.py`, `price_cache_service.py`, `calculator.py`, `domain.py`, `validators.py`

Owns business logic, financial invariants, transaction rules, recalculation orchestration, reporting, allocation, cash logic, performance metrics, price-cache behavior.

**Rule**: No financial invariant lives in CLI or API adapters.

## Adapter Layer (CLI)

`portfolio_db/cli.py` — Click argument parsing, user-facing validation, calls service layer, serializes JSON via `response.py`.

**Rules**: No SQL/psycopg imports. No business logic. No duplication of service logic.

## Data Flow

```
CLI (click) -> Service Layer (business logic) -> Database (psycopg + SQL)
```

## Legacy Code

`calculator.py` moved to `portfolio_db/_legacy/calculator.py`. AST scanner test enforces no production imports.
