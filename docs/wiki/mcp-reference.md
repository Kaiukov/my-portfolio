# MCP Reference

Model Context Protocol (MCP) adapter for AI-agent integration. Lives in `portfolio-ts/src/mcp/`.

The MCP adapter is a full read+write peer adapter alongside the CLI and HTTP API. It reuses the same shared service layer (`src/commands/*`) — no duplicated business logic.

## Files

| File | Exports | Purpose |
|---|---|---|
| `read.ts` | `mcpRead(toolName, args)` | Read tools (23 tools) |
| `adapter.ts` | `mcpWrite(toolName, args, ctx)` | Write tools (5 tools) + arg helpers (`strField`, `floatField`, `intField`, `boolFlag`) |
| `server.ts` | `createPortfolioMcpServer()` / `runPortfolioMcpServer()` | Stdio MCP entrypoint for OpenAI tunnel-client |
| `index.ts` | Re-exports `mcpRead`, `mcpWrite`, `McpWriteContext` | Package entry point |

## JSON Envelope

All tools return the same envelope as the CLI and HTTP API (`portfolio-ts/src/response.ts`):

```json
{"ok": true, "command": "...", "data": ..., "meta": {"generated_at": "...", "count": null}}
```

Errors: `{"ok": false, "command": "...", "error": {"code": "X", "message": "..."}, "meta": {...}}`

Error codes use the same `toWriteErrorEnvelope` mapper as the HTTP API (`src/adapters/shared.ts`).

## Tool Counts

- **23 read tools** — full parity with CLI and REST API
- **5 write tools** — full parity with CLI and REST API
- **28 total tools** exposed via `tools/list`

## Transport Modes

| Mode | Entrypoint | Transport | Use case |
|------|-----------|-----------|----------|
| Stdio | `bun run mcp` (`src/mcp/server.ts`) | stdin/stdout JSON-RPC | tunnel-client child process |
| Streamable HTTP | `GET/POST/DELETE /mcp` on API server (`src/api/server.ts`) | HTTP + optional SSE upgrade | tunnel-client remote, containers |
| SSE (legacy) | `GET /sse` on API server | Server-Sent Events | Legacy SSE-only clients |

The streamable HTTP transport is served by the same `Bun.serve` instance as the REST API — no separate process required. See `src/api/server.ts` for the `/mcp` and `/sse` route handlers.

## Read Tools

Dispatched via `mcpRead(toolName, args)`. Each tool mirrors its CLI/API counterpart exactly.

| # | Tool name | CLI equivalent | Required args | Optional args | Freshness meta |
|---|-----------|---------------|---------------|---------------|---------------|
| 1 | `status` | `status` | — | `as_of` / `asOf` | Yes |
| 2 | `summary` | `summary` | — | `as_of` / `asOf` | Yes |
| 3 | `cash` | `cash` | — | `as_of` / `asOf` | Yes |
| 4 | `cash_drag` | `cash_drag` | — | `as_of` / `asOf`, `from_date` / `fromDate`, `benchmark_return_rate` / `benchmarkReturnRate`, `cash_return_rate` / `cashReturnRate` | Yes |
| 5 | `currency_exposure` | `currency_exposure` | — | `as_of` / `asOf` | Yes |
| 6 | `income` | `income` | — | `as_of` / `asOf`, `from_date` / `fromDate`, `asset` | — |
| 7 | `realized_gains` | `realized_gains` | — | `from_date` / `fromDate`, `to_date` / `toDate`, `asset`, `by_year` / `byYear` | — |
| 8 | `allocation` | `allocation` | — | `as_of` / `asOf` | Yes |
| 9 | `rebalance` | `rebalance` | `target` | `as_of` / `asOf` | — |
| 10 | `concentration` | `concentration` | — | `as_of` / `asOf`, `top_n` / `topN` | Yes |
| 11 | `diversification` | `diversification` | — | `as_of` / `asOf`, `lookback_days` / `lookbackDays`, `min_correlation` / `minCorrelation` | Yes |
| 12 | `decomposition` | `decomposition` | — | `as_of` / `asOf` | Yes |
| 13 | `performance` | `performance` | — | `as_of` / `asOf`, `benchmark`, `from_date` / `fromDate`, `period`, `inflation_rate` / `inflationRate` | Yes |
| 14 | `mwr` | `mwr` | — | `as_of` / `asOf` | Yes |
| 15 | `transactions` | `transactions` | — | `limit`, `offset`, `start_date` / `startDate`, `end_date` / `endDate` | — |
| 16 | `report` | `report` | — | `limit`, `offset`, `start_date` / `startDate`, `end_date` / `endDate` | — |
| 17 | `health` | `health` | — | `max_age_days` / `maxAgeDays` | — |
| 18 | `verify_prices` | `verify_prices` | — | `max_age_days` / `maxAgeDays` | — |
| 19 | `widget` | `widget` | `days` | `as_of` / `asOf` | — |
| 20 | `asset_metadata` | `asset_metadata` | — | `asset`, `refresh` | — |
| 21 | `projection` | `projection` | — | `as_of` / `asOf`, `monthly_contribution` / `monthlyContribution`, `annual_return_rate` / `annualReturnRate`, `target_value` / `targetValue`, `projection_years` / `projectionYears`, `inflation_rate` / `inflationRate` | — |
| 22 | `withdrawal` | `withdrawal` | — | `as_of` / `asOf`, `annual_withdrawal` / `annualWithdrawal`, `withdrawal_rate` / `withdrawalRate`, `time_horizon_years` / `timeHorizonYears`, `expected_return` / `expectedReturn`, `inflation_rate` / `inflationRate` | — |
| 23 | `asset_analysis` | `asset_analysis` | `ticker` or `asset` | `period`, `lookback_days` / `lookbackDays`, `benchmark`, `as_of` / `as_of_date` / `asOf` / `asOfDate`, `risk_free_rate` / `riskFreeRate` | — |

Tools with "Freshness meta" inject `needs_recalc`/`recalc_warning`/`stale`/`prices_as_of`/`price_age_days` into the response `meta` envelope (see [CLI Reference](cli-reference.md#freshness-meta-fields)).

## Write Tools

Dispatched via `mcpWrite(toolName, args, ctx)`. Each tool mirrors its CLI/API counterpart exactly.

| Tool name | CLI equivalent | Required args | Optional args |
|---|---|---|---|
| `add_transaction` | `add` | `date`, `asset`, `action`, `quantity`, `exchange` | `price`, `currency`, `fees`, `feeCurrency` / `fee_currency`, `account` |
| `edit_transaction` | `edit` | `id` / `transactionId` / `transaction_id` / `transId` | `date`, `asset`, `action`, `quantity`, `price`, `currency`, `fees`, `feeCurrency` / `fee_currency`, `exchange`, `dataSource` / `data_source`, `account`, `dry_run` / `dryRun` / `dry-run` |
| `delete_transaction` | `delete` | `id` / `transactionId` / `transaction_id` / `transId` | `dry_run` / `dryRun` / `dry-run`, `confirm` |
| `exchange_currency` | `exchange` | `date`, `fromAsset` / `from_asset` / `from`, `toAsset` / `to_asset` / `to`, `quantity`, `rate` | — |
| `split` | `split` | `date`, `asset`, `ratio` | `confirm` |

### Arg Aliases

MCP tools accept multiple key aliases per arg:

- `add_transaction`: `feeCurrency` or `fee_currency`
- `edit_transaction`: `id`, `transactionId`, `transaction_id`, or `transId`; `feeCurrency` or `fee_currency`; `dataSource` or `data_source`; `dry_run`, `dryRun`, or `dry-run`
- `delete_transaction`: same id aliases as edit; `dry_run`, `dryRun`, or `dry-run`
- `exchange_currency`: `fromAsset`, `from_asset`, or `from`; `toAsset`, `to_asset`, or `to`

## OpenAI Secure MCP Tunnel

The MCP server entrypoint is `portfolio-ts/src/mcp/server.ts` (or `bun run mcp`).
It is a stdio MCP server compatible with OpenAI `tunnel-client`.

Quick start:

```bash
cd portfolio-ts
bun run mcp
# in another terminal, point tunnel-client at the same command
# tunnel-client init --sample sample_mcp_stdio_local --profile portfolio --mcp-command "bun run mcp"
```

See the release link shared in the issue for the current tunnel-client build stream.

## Write Context

`mcpWrite` accepts an optional `ctx` parameter (`McpWriteContext`) with a `write` field for injecting custom `WriteHandlers` (useful for testing or overriding the default handlers from `src/adapters/shared.ts`).

## Dry-Run and Confirm

- `edit_transaction` and `delete_transaction` support dry-run via `dry_run: true` (or `dryRun`, `dry-run`).
- `delete_transaction` requires `confirm: true` unless dry-run.

## Dashboard MCP Endpoint (Cloudflare Worker)

The portfolio dashboard (<https://github.com/Kaiukov/my-portfolio-dashboard>) exposes a separate **9-tool read-only MCP endpoint** backed by Cloudflare KV. This is a deliberately simplified subset — it does **not** aim for full parity with the 28-tool portfolio MCP server.

| # | Dashboard MCP tool | Source |
|---|-------------------|--------|
| 1 | `status` | KV snapshot |
| 2 | `summary` | KV snapshot |
| 3 | `allocation` | KV snapshot |
| 4 | `cash` | KV snapshot |
| 5 | `concentration` | KV snapshot |
| 6 | `performance` | KV snapshot |
| 7 | `mwr` | KV snapshot |
| 8 | `widget` | KV snapshot |
| 9 | `projection` | KV snapshot |

The dashboard MCP endpoint is stateless and read-only. It serves latest-snapshot data for quick AI queries without needing a live PostgreSQL connection. Write and maintenance operations (`add`, `edit`, `delete`, `exchange`, `split`, `recalculate`, `repair_prices`, `sync`) are **only** available through the full portfolio MCP server.

> **v2 roadmap:** Dashboard live-write and real-time sync are deferred.

## Error Handling

Unknown tool names return:

```json
{"ok": false, "command": "mcp", "error": {"code": "NOT_FOUND", "message": "Unsupported MCP read/write tool: <name>"}}
```

All other errors pass through `toWriteErrorEnvelope` from `src/adapters/shared.ts`, producing the same error codes as the HTTP API:

| Error type | `error.code` |
|---|---|
| `ValidationError` | `"VALIDATION_ERROR"` |
| `NotFoundError` | `"NOT_FOUND"` |
| Any other error | `"INTERNAL_ERROR"` |

See [Platform Adapters](../platform-adapters.md) for a full reference.
