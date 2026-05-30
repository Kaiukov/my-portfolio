# Architecture

## Current Architecture (Python)

```
Python CLI (click) -> Python services/orchestration -> PostgreSQL database
                                                          |
                                                    SQL functions/views
                                                    (financial logic)
```

- Python owns all CLI binding, orchestration, and business logic.
- PostgreSQL owns persisted state and some financial calculations via SQL functions/views.
- Three-layer design: persistence (`database.py`), shared services, CLI adapter.

## Target Architecture (TypeScript/Bun)

```
TypeScript/Bun CLI -> TypeScript services/orchestration -> PostgreSQL database
                                                              |
                                                        SQL functions/views
                                                        (financial logic)
```

- TypeScript/Bun replaces the Python CLI and all non-SQL core/orchestration logic.
- PostgreSQL remains the financial source of truth — its functions, views, and persisted state are untouched.
- Python is removed after TypeScript reaches full behavioral parity.

## Key Principle

**No duplication of PostgreSQL-owned calculations in TypeScript.** If PostgreSQL already computes it via a function or view, TypeScript calls that function/view. If logic lives only in Python and is needed for the TypeScript CLI, decide whether to push it into PostgreSQL or temporarily port it to TypeScript (see [Decisions](decisions.md)).

## Migration State

| Layer | Python | TypeScript | PostgreSQL |
|-------|--------|------------|------------|
| CLI adapter | Phase 0-2 | Phase 1-3 | — |
| Service/orchestration | Phase 0-3 | Phase 1-3 | — |
| Persistence | — | — | Always |
| SQL functions/views | — | — | Always |
