# TypeScript/Bun Migration

> This directory documents the COMPLETED Python → TypeScript/Bun migration. It is historical/archival and is NOT the current implementation plan.

**Replaced Python with TypeScript/Bun while keeping PostgreSQL as the financial source of truth.**

The `portfolio` CLI was migrated from Python to TypeScript/Bun. PostgreSQL remains the single source of truth for all financial data. Python was removed after the TypeScript implementation reached full parity. This was a platform migration — no new financial features were added.

## Pages

- [Architecture](architecture.md) — Architecture and data flow
- [Phases](phases.md) — Six-phase migration plan (Phase 0 documentation through Phase 5 removal) with scope and acceptance criteria
- [Stack](stack.md) — TypeScript tools, folder structure, conventions
- [Decisions](decisions.md) — Decision log with rationale and consequences
- [Out of Scope](out-of-scope.md) — Explicit list of what was not built

## Related Docs

- Current TypeScript/Bun architecture: `portfolio-ts/src/` and `portfolio_db/sql/`
- CLI documentation: `docs/wiki/`
