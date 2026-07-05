# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.1] - 2026-07-05

### Fixed
- **#333 adapter parity** — `recalculate force` is now wired consistently across
  CLI, REST API, and MCP. The REST API exposes `POST /recalculate`, MCP exposes
  the `recalculate` write tool, and both adapters delegate to the shared
  recalculate write path instead of duplicating service logic.
- **Boolean flag validation parity** — invalid boolean values such as
  `force=bogus` no longer silently enable force on the CLI/API/MCP path; all
  adapters now return the same `VALIDATION_ERROR` envelope/message.
- **#346 follow-up** — the shared `roundTo()` consolidation no longer changes MWR
  precision; `mwr_pct` keeps its 4-decimal public contract.
- **#347 docs follow-up** — the health/price-coverage docs now match the real
  `provisional` status behavior and the split `historical_coverage_issues` /
  `current_day_missing` diagnostics.
- **Live dev verification harness** — DB-gated `projection` / `withdrawal`
  coverage was moved out of module-mocked files, and live diversification parity
  checks now compare floating-point results with tolerance. This is the change
  set that allowed the full dev suite to run green on the prod-cloned fixture DB.
- **Dev transaction smoke workflow** — added `scripts/dev-transaction-smoke.sh`,
  a disposable-database smoke run that exercises `BUY`, `SELL`, `DEPOSIT`,
  `WITHDRAW`, `TRANSFER`, `DIVIDEND`, `INTEREST`, `FEE`, `TAX`, `SPLIT`,
  `STAKING_REWARD`, `WRAP`, and `UNWRAP`, checking summary/cash/allocation/history
  after each step without mutating the long-lived dev database.

## [0.10.0] - 2026-07-04

### Added
- **#334** — `STAKING_REWARD` transactions for non-cash crypto assets. Rewards now
  increase holdings without inventing cash movement or normal purchase cost basis,
  and the behavior is aligned across CLI, REST API, and MCP.
- **#335** — `wrap` / `unwrap` crypto conversions for basis-preserving asset moves
  such as `ETH-USD -> WBETH-USD`. The write path records the two-leg transaction
  group, recalculates from the event date, and preserves cost-basis continuity.

### Changed
- **#336** — read views now hide dust positions below `1%` allocation by default
  across allocation, summary, status, concentration, dashboard, and related adapter
  surfaces while preserving an explicit escape hatch for full-detail views.

### Fixed
- **#334/#335 integration follow-up** — wrap/unwrap now validates source holdings
  before writing, preventing negative source balances on invalid wraps.
- **#336 integration follow-up** — concentration metrics now derive from the same
  visible holdings set as allocation/status, so HHI and totals stay aligned when
  dust filtering hides tiny positions.
- **CI isolation follow-up** — GitHub CI now uses the canonical isolated Bun test
  script, matching the verified local/dev execution path and eliminating cross-file
  mock leakage in parity-heavy suites.
- **Live-DB parity follow-up** — diversification parity checks compare floating-point
  live-query metrics with tolerance instead of exact equality, removing a flaky
  `1e-15` class failure without weakening stable-field parity.
- **#326** — corrected the prod deploy runbook safety notes so production recreates use plain `docker compose up` from `/opt/portfolio`, preserving `docker-compose.override.yml` auto-merge and the real prod DB password.

## [0.9.0] - 2026-06-16

### Added
- **#307** — application version is now surfaced across every surface from the
  single `package.json` source of truth (`src/version.ts`): CLI `--version`/`-v`,
  `meta.version` in every JSON envelope (success and error), MCP `serverInfo.version`,
  and the `/health` response. No more hardcoded `"1.0.0"` in the MCP server.

### Changed
- **#293** — read/analytics commands now dispatch through a single shared
  read-registry (`src/adapters/read_shared.ts#dispatchRead`); CLI, REST API, and MCP
  all route reads through one source instead of three parallel implementations.
  Behavior-preserving except that the REST API error envelope now reports the real
  command name (e.g. `summary`) instead of the generic `api`.
- **#303 follow-up** — `test` script now runs `bun test --isolate`. The `bunfig.toml`
  `isolate = true` setting is not fully honored by bun 1.3.14 in a large
  DB-enabled run (cross-file `mock.module(db.js)` leakage reappeared, failing the
  real-DB `financial_parity`/`asset_metadata` tests); the explicit `--isolate`
  flag is reliable, so the canonical test command uses it.

## [0.8.0] - 2026-06-16

First tagged release. Retroactively versions the feature-complete pre-1.0 portfolio
tracker (CLI + REST API + MCP adapters over a PostgreSQL source of truth, with a
Cloudflare widget/dashboard and ChatGPT MCP tunnel). Bundles a financial-correctness
and MCP-hardening bug-fix batch validated against the dev PostgreSQL instance.

### Fixed
- **#306** — `portfolio_decomposition_sql` no longer mis-attributes dividend/interest
  income as market returns; `from_returns_usd` is now the realized+unrealized delta
  (dividend-only flat-price period → `from_returns_usd = 0`).
- **#301** — `realized-gains` emits canonical `YYYY-MM-DD` dates (UTC `formatDate`)
  instead of timezone-dependent `Date.toString()`; fixes day-shift on west-of-UTC
  servers (affects CLI, REST `GET /realized_gains`, MCP `realized_gains`).
- **#302 / #304** — `/mcp` HTTP transport is bounded: LRU session registry with
  `MCP_MAX_SESSIONS` cap + per-session idle TTL eviction, optional bearer auth
  (`PORTFOLIO_MCP_TOKEN`), closing the unauthenticated memory/connection-exhaustion
  DoS introduced with the stateful transport.
- **#297** — `POST /transactions?dry_run=true` no longer saves the transaction;
  it returns a `dry_run: true` preview via a shared validation path (`addDryRun`).
- **#300** — ChatGPT connector invocation loop resolved by the stateful per-session
  `/mcp` transport; tools now execute instead of re-emitting their schema.

### Changed
- **#303** — `bun test` runs with module isolation (`bunfig.toml` `isolate = true`),
  removing `mock.module(db.js)` cross-file leakage that produced spurious failures.
- **#305** — test-quality fixes: corrected hand-calculated income expectation,
  fixed `ANY($1::DATE[])` array binding to explicit placeholders, normalized raw
  `Date` assertions, and gated fixture-dependent projection/withdrawal DB tests
  behind `PORTFOLIO_TEST_FIXTURE_DB` for a deterministic suite.

[Unreleased]: https://github.com/Kaiukov/my-portfolio/compare/v0.10.1...HEAD
[0.10.1]: https://github.com/Kaiukov/my-portfolio/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/Kaiukov/my-portfolio/compare/v0.8.0...v0.10.0
[0.8.0]: https://github.com/Kaiukov/my-portfolio/releases/tag/v0.8.0
