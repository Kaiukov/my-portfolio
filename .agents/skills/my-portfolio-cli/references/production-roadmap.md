# Production Roadmap

Canonical source: `docs/production-ready-plan.md`
Skill reference: this file (summary for agent context)

## Completed — Milestones 1–4

- **Product Baseline** — domain model, JSON contract frozen, workflows documented
- **Data Integrity** — single price pipeline, strict validation, explicit failures, stale/refresh state
- **Transaction Engine** — all actions normalized, validation per action, edit flow, audit columns
- **Reporting Consistency** — single snapshot builder, `--as-of-date` on all read commands
- **CLI and UX** — symmetric command set, error codes, `--dry-run` (edit/repair_prices/recalculate), snake_case
- **Testing** — unit + integration + golden snapshot + Milestone 4 tests (61 tests total)
- **Packaging** — `pyproject.toml`, console script entrypoint
- **Health command** — DB reachable, price coverage, recalc freshness, stale tickers
- **Structured logs** — JSON lines to `logs/portfolio.log`
- **Bootstrap** — `init` command (idempotent), `.env.example`
- **Backup** — `backup` command, timestamped DB snapshot
- **CI** — `.github/workflows/ci.yml` (uv + pytest)
- **Import isolation** — `pythonpath = ["."]`, `_WORKSPACE` sentinel, isolation test
- **Portfolio Intelligence (Milestone 4)**:
  - `MWR/IRR` — XIRR via Newton-Raphson (`PerformanceService.calculate_xirr`, `get_mwr_irr()`)
  - `benchmark` — SPY TWR, CAGR, up/down capture ratios, relative return, tracking error
  - `contribution_by_position` — per-position gain attribution, weight%, contribution_to_gain_pct
  - All three exposed in `performance` CLI command as dedicated sections

## Remaining — Milestone 5

- [ ] rebalancing / account layer
- [ ] MWR/IRR: dedicated `mwr` command with `--as-of-date`
- [ ] benchmark: configurable ticker (not just SPY)
- [ ] before/after audit values on transaction edits
- [ ] DB backup restore procedure
- [ ] optional write serialization lock
