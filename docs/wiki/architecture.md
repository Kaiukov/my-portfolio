# Architecture

Three layers. Each owns its domain. No layer reaches into a layer below it that is not its direct dependency.

## PostgreSQL Persistence Layer

`portfolio-ts/src/db.ts` — Bun SQL driver, connection lifecycle, `PORTFOLIO_DB_URL` resolution, schema/bootstrap access, all repository/query helpers. The schema and SQL functions in `portfolio_db/sql/` are the financial source of truth.

**Rule**: No caller outside `src/db.ts` may use the raw SQL handle directly.

## Shared Service / Use-Case Layer

Files: `portfolio-ts/src/commands/*`, `portfolio-ts/src/validators.ts`, `portfolio-ts/src/asset_kind.ts`, `portfolio-ts/src/tx.ts`, `portfolio-ts/src/tx_core.ts`, `portfolio-ts/src/sql_apply.ts`

Owns business logic, financial invariants, transaction rules (SELL-as-of-date, exchange validation), recalculation orchestration, reporting, allocation, cash logic, performance metrics, price-cache behavior, asset/currency normalization.

**Rule**: No financial invariant lives in CLI, API, or MCP adapters. This layer is reused by all three without duplication.

## Adapter Layer

- **CLI**: `portfolio-ts/src/cli.ts` — argument parsing, user-facing validation, calls shared service layer, serializes JSON via `src/response.ts`.
- **REST API**: `portfolio-ts/src/api/server.ts` — HTTP routing, shared write handlers.
- **MCP**: `portfolio-ts/src/mcp/` (`read.ts` = read tools via `mcpRead`, `adapter.ts` = write tools via `mcpWrite`, `index.ts` re-exports). Full read+write peer adapter alongside CLI and HTTP API.

**Rules**: No SQL/Bun SQL imports. No business logic. No duplication of service logic. CLI, REST API, and MCP are peer adapters and must stay behavior-aligned.

## Data Flow

```
CLI/API/MCP -> Shared service layer (commands/*) -> PostgreSQL (db.ts + portfolio_db/sql/*)
```

PostgreSQL and `portfolio_db/sql/*` own financial data and calculations. TypeScript/Bun adapters only route, validate inputs, orchestrate commands, and emit JSON envelopes.
