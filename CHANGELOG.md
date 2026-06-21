# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.1] - 2026-06-21

### Fixed
- **#325** — same-day whole-bucket price-fetch failures are no longer hidden until
  `stale_tickers_sql()` ages them out. A `price_refresh` row in `refresh_log` with
  `rows_affected > 0` now forces a `CURRENT_DATE` coverage checkpoint for every
  non-cash required ticker, surfaced immediately by `health`, `verify_prices`,
  `freshness`, and the repair/verify maintenance jobs. Closed-market days (zero-row
  refresh) are preserved — no false coverage gap. Verified against live postgres.

### Changed
- **#320** — hand-rolled `Math.round(n * 10^k) / 10^k` rounding consolidated into a
  single shared `roundTo()` helper (`src/utils.ts`), used by `rebalance`, `projection`,
  `mwr`, and `macro`.
- **#325 refactor** — the refresh-audit coverage logic is folded directly into
  `get_required_price_checkpoints_sql` as one `UNION` branch, so callers (CLI commands
  and the SQL maintenance jobs) issue a single checkpoint query instead of a second
  audit query merged in JS.

### Removed
- **#322** — deleted unused barrel files `src/asset_analysis/index.ts` and
  `src/mcp/index.ts` (no real consumers); imports now reference modules directly.

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

[Unreleased]: https://github.com/Kaiukov/my-portfolio/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/Kaiukov/my-portfolio/releases/tag/v0.8.0
