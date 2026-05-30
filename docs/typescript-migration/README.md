# TypeScript/Bun Migration

**Replace Python with TypeScript/Bun while keeping PostgreSQL as the financial source of truth.**

The `portfolio` CLI is being migrated from Python to TypeScript/Bun. PostgreSQL stays as the single source of truth for all financial data. Python is removed after the TypeScript implementation reaches full parity. No new financial features — only a platform migration.

## Pages

- [Architecture](architecture.md) — Current vs target architecture, data flow
- [Phases](phases.md) — Six-phase migration plan (Phase 0 documentation through Phase 5 removal) with scope and acceptance criteria
- [Stack](stack.md) — TypeScript tools, folder structure, conventions
- [Decisions](decisions.md) — Decision log with rationale and consequences
- [Out of Scope](out-of-scope.md) — Explicit list of what is not being built yet

## Related Docs

- Existing Python CLI documentation: `docs/wiki/`
- Current Python architecture: `portfolio_db/`
