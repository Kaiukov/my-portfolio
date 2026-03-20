# Production Roadmap

Canonical source: `docs/production-ready-plan.md`
Skill reference: this file (summary for agent context)

## Completed

- **Product Baseline** — domain model, JSON contract frozen, workflows documented
- **Data Integrity** — single price pipeline, strict validation, explicit failures, stale/refresh state
- **Transaction Engine** — all actions normalized, validation per action, edit flow, audit columns
- **Reporting Consistency** — single snapshot builder, `--as-of-date` on all read commands
- **CLI and UX** — symmetric command set, error codes, `--dry-run` (edit/repair_prices/recalculate), snake_case
- **Testing** — unit + integration + golden snapshot tests (30 tests, deterministic fixture DBs)
- **Packaging** — `pyproject.toml`, console script entrypoint (`portfolio = "portfolio_db.cli:cli"`)
- **Health command** — DB reachable, price coverage, recalc freshness, stale tickers
- **Structured logs** — JSON lines to `logs/portfolio.log` (configurable via `PORTFOLIO_LOG_PATH`)
  - Events: `price_refresh`, `price_refresh_skipped`, `price_coverage_failure`, `recalc_start`, `recalc_done`, `recalc_failure`, `transaction_add`, `transaction_edit`, `transaction_delete`, `failure`
- **Bootstrap** — `init` command (idempotent DB init), `.env.example`

## In Progress — Milestone 2: Operator Readiness

- [ ] backup strategy (DB snapshot + restore procedure)
- [ ] structured log rotation / retention policy

## Remaining — Milestone 3: Deployment Readiness

- [ ] `uv sync` bootstrap documentation
- [ ] CI setup (GitHub Actions)
- [ ] import isolation verification

## Remaining — Milestone 3+

- [ ] `TRANSFER` semantics (account dimension, internal vs external)
- [ ] `delete --dry-run`
- [ ] missing FX coverage regression fixtures
- [ ] MWR/IRR, benchmark reports (Milestone 4)

## Next Sprint

1. backup strategy
2. CI (GitHub Actions)
3. `TRANSFER` semantics
4. `delete --dry-run`
