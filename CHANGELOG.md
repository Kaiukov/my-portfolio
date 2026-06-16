# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
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
