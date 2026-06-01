---
name: my-portfolio-cli
description: Use when working on the `portfolio-ts` CLI (TypeScript/Bun), its JSON response contract, reporting snapshot rules, transaction writes, price repair/verification, or CLI help/tests in `portfolio-ts`.
---

# my-portfolio-cli

A navigation guide, not a copy of canonical docs. **This is the active runtime** — TypeScript/Bun (`portfolio-ts/`, run with `bun`). Do not add Python instructions here.

## Canonical docs (read these first)

Single source of truth — do not duplicate their content into this skill:

- `AGENTS.md` — project architecture layers, command classification, common traps, financial correctness invariants, style. **The richest single reference.**
- `README.md` — setup, prerequisites, `.env` / `PORTFOLIO_DB_URL`, schema bootstrap, full command list, JSON envelope, smoke tests, legacy/migration notes.
- `portfolio-ts/PARITY.md` — per-command CLI↔SQL behavior, accepted changes vs parity-tested commands, `sync` (TS-only), intentionally dropped Python commands.
- `docs/transaction-spec.md` — supported actions, validation rules, action groupings, exchange two-leg rules.
- `docs/api-response-standardization-plan.md` — JSON response contract and standardization plan.
- `docs/typescript-migration/` — migration plan: `stack.md`, `architecture.md`, `phases.md`, `decisions.md`, `out-of-scope.md`.
- `portfolio_db/sql/` — financial source of truth (`schema.sql`, `functions.sql`, `procedures.sql`, `views.sql`, `triggers.sql`, plus `job_*.sql`).

## Inspect before changing CLI or core behavior

Pointers only — read the actual files; do not paste excerpts into this skill.

- `portfolio-ts/src/cli.ts` — command names, help text, `parseArgs`, dispatch.
- `portfolio-ts/src/commands/*.ts` — per-command orchestration (status, add, edit, delete, exchange, recalculate, repair_prices, verify_prices, sync, report, cash, allocation, summary, concentration, performance, mwr, health, init, backup, transactions).
- `portfolio-ts/src/db.ts` + `portfolio-ts/src/tx.ts` + `portfolio-ts/src/tx_core.ts` — connection lifecycle, `query` / `querySingle`, pinned-connection `runTx` (BEGIN/COMMIT/ROLLBACK). No raw SQL outside `db.ts`.
- `portfolio-ts/src/validators.ts` — domain constants (`USER_ACTIONS`, `ALLOWED_CURRENCIES`, `STALE_MAX_AGE_DAYS`), `parseDate`.
- `portfolio-ts/src/response.ts` — JSON envelope (`success`, `error`, `buildPagination`).
- `portfolio-ts/src/providers/yahoo.ts` — Yahoo Finance price fetcher.
- `portfolio_db/sql/` — all financial math.
- `portfolio-ts/tests/*.test.ts` — Bun test coverage; mirrors the public contract.

## Running commands

- Local dev DB: `cd portfolio-ts && bun src/cli.ts <command> [flags]`
- Linked bin: `portfolio <command> [flags]` after `bun link` in `portfolio-ts/`
- Dockerized service: `docker compose -f portfolio-ts/docker-compose.yml exec portfolio bun run src/cli.ts <command> [flags]`
- Read-only HTTP: `curl localhost:8787/summary`

## Agent workflow rules (not in the docs above)

1. **Inspect code first.** If docs and code disagree, **the code wins** — fix the docs, do not copy more content into this skill.
2. **Confirm the current CLI surface** before editing:
   - `cd portfolio-ts && bun src/cli.ts --help`
   - `bun src/cli.ts <command> --help`
   - `docker compose -f portfolio-ts/docker-compose.yml exec portfolio bun run src/cli.ts <command> --help`
3. **Classify the command** before editing (read-only / mutating / file-level — see `AGENTS.md` for the canonical lists; do not fork them here).
4. **Do not invent features, flags, or defaults.** If the code does not prove it, leave it out.
5. **One canonical list per concern.** If you find yourself restating a list from `AGENTS.md` / `PARITY.md` / `transaction-spec.md` here, stop and link instead.
6. **Keep this skill a navigation guide.** When canonical docs change, update the link target, not the duplicated text.

## Verification (the only checks you need)

```bash
cd portfolio-ts
bun run typecheck                    # tsc --noEmit
bun test                             # full Bun test suite
bun test <related-test-file>         # narrow loop
bun src/cli.ts --help                # help-text sanity
```

For price/reporting behavior changes, also smoke-test `bun src/cli.ts health`, `bun src/cli.ts verify_prices`, and one read-only snapshot command. If you are targeting the Dockerized service, repeat the relevant read-only check via `docker compose -f portfolio-ts/docker-compose.yml exec portfolio bun run src/cli.ts health` or `curl localhost:8787/summary`.

## Related files

- Skill: `.agents/skills/my-portfolio-cli/SKILL.md` (this file)
- Project rules: `AGENTS.md`
- Runtime + commands: `README.md`
- CLI↔SQL behavior: `portfolio-ts/PARITY.md`
- Transaction model: `docs/transaction-spec.md`
- JSON response plan: `docs/api-response-standardization-plan.md`
- TS migration: `docs/typescript-migration/`
- Financial source of truth: `portfolio_db/sql/`
