import { query, querySingle } from "../db.js";
import { STALE_MAX_AGE_DAYS } from "../validators.js";
import type { PriceRow } from "../providers/yahoo.js";
import { fetchAssetMetadata } from "../asset_kind.js";
import type { AssetMetadata } from "../asset_kind.js";
import { verifyPrices } from "./verify_prices.js";

type MetadataFetchFn = (ticker: string) => Promise<AssetMetadata | null>;

interface RepairPricesUnresolved {
  missing: Array<{ ticker: string; issues: string[] }>;
  stale: Array<{ ticker: string; last_price_date: string; age_days: number }>;
}

export interface RepairPricesResult {
  tickers: string[];
  rows_loaded: number;
  rows_per_ticker: Record<string, number>;
  range: { start: string; end: string };
  skipped_fresh: string[];
  status: "ok" | "degraded";
  unresolved: RepairPricesUnresolved;
}

export interface RepairPricesDryRunResult {
  dry_run: true;
  would_repair: string[];
  would_skip_fresh: string[];
  range: { start: string; end: string };
}

export type FetchFn = (
  ticker: string,
  startDate: string,
  endDate: string,
) => Promise<PriceRow[]>;

async function getRequiredTickers(): Promise<string[]> {
  const rows = await query<{ ticker: string }>(
    "SELECT ticker FROM discover_required_tickers_sql() WHERE NOT is_cash_like_sql(ticker) ORDER BY ticker",
  );
  return rows.map((r) => r.ticker);
}

async function getFreshTickers(maxAgeDays: number): Promise<Set<string>> {
  const today = new Date().toISOString().split("T")[0];
  const rows = await query<{ ticker: string }>(
    `SELECT ticker FROM prices
     WHERE date >= ($1::date - $2)
     GROUP BY ticker
     ORDER BY ticker`,
    [today, maxAgeDays],
  );
  return new Set(rows.map((r) => r.ticker));
}

async function getDateRange(): Promise<{ start: string | null; end: string | null }> {
  const row = await querySingle<{ start_date: string | null; end_date: string | null }>(
    "SELECT MIN(date)::text AS start_date, MAX(date)::text AS end_date FROM transactions",
  );
  return { start: row?.start_date ?? null, end: row?.end_date ?? null };
}

async function upsertPrices(rows: PriceRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let count = 0;
  for (const row of rows) {
    await query(
      `INSERT INTO prices (ticker, date, price)
       VALUES ($1, $2, $3)
       ON CONFLICT (date, ticker) DO UPDATE SET price = EXCLUDED.price`,
      [row.ticker, row.date, row.price],
    );
    count++;
  }
  return count;
}

async function upsertAssetMetadata(ticker: string, meta: AssetMetadata): Promise<void> {
  await query(
    `SELECT upsert_asset_metadata($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ticker,
      meta.yahoo_quote_type,
      meta.yahoo_type_disp ?? null,
      meta.yahoo_short_name ?? null,
      meta.yahoo_long_name ?? null,
      meta.currency ?? null,
      meta.exchange ?? null,
      new Date().toISOString(),
    ],
  );
}

export async function repairPricesDryRun(params: {
  tickers?: string[];
  startDate?: string;
  endDate?: string;
  maxAgeDays?: number;
}): Promise<RepairPricesDryRunResult> {
  const today = new Date().toISOString().split("T")[0];
  const txRange = await getDateRange();
  const start = params.startDate ?? txRange.start ?? today;
  const end = params.endDate ?? today;
  let targetTickers = params.tickers?.length ? params.tickers : await getRequiredTickers();

  let skippedFresh: string[] = [];
  if (params.maxAgeDays !== undefined && params.maxAgeDays > 0) {
    const freshSet = await getFreshTickers(params.maxAgeDays);
    skippedFresh = targetTickers.filter((t) => freshSet.has(t));
    targetTickers = targetTickers.filter((t) => !freshSet.has(t));
  }

  return {
    dry_run: true,
    would_repair: targetTickers,
    would_skip_fresh: skippedFresh,
    range: { start, end },
  };
}

async function recordRepair(ticker: string, startDate: string, endDate: string, status: string, rowsLoaded: number, message?: string): Promise<void> {
  await query(
    `INSERT INTO repair_log (ticker, start_date, end_date, status, rows_loaded, message)
     VALUES ($1, $2::date, $3::date, $4, $5, $6)`,
    [ticker, startDate, endDate, status, rowsLoaded, message ?? null],
  );
}

async function recordRefreshAudit(rowsAffected: number): Promise<void> {
  await query(
    `INSERT INTO refresh_log (refresh_date, refresh_type, rows_affected)
     VALUES (CURRENT_DATE, 'price_refresh', $1)`,
    [rowsAffected],
  );
  if (rowsAffected > 0) {
    const now = new Date().toISOString();
    await query(
      `INSERT INTO service_state (state_key, state_value, updated_at)
       VALUES ('last_successful_price_refresh', $1, $2)
       ON CONFLICT (state_key)
       DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = EXCLUDED.updated_at`,
      [now, now],
    );
    await query(
      `UPDATE service_state SET state_value = 'false', updated_at = NOW()
       WHERE state_key = 'prices_need_fetch'`,
    );
  }
}

export async function repairPrices(
  params: { tickers?: string[]; startDate?: string; endDate?: string; maxAgeDays?: number },
  fetchFn: FetchFn,
  metadataFetchFn: MetadataFetchFn = fetchAssetMetadata,
): Promise<RepairPricesResult> {
  const today = new Date().toISOString().split("T")[0];
  const txRange = await getDateRange();
  const start = params.startDate ?? txRange.start ?? today;
  const end = params.endDate ?? today;
  let targetTickers = params.tickers?.length ? params.tickers : await getRequiredTickers();

  let skippedFresh: string[] = [];
  if (params.maxAgeDays !== undefined && params.maxAgeDays > 0) {
    const freshSet = await getFreshTickers(params.maxAgeDays);
    skippedFresh = targetTickers.filter((t) => freshSet.has(t));
    for (const ticker of skippedFresh) {
      await recordRepair(ticker, start, end, "skipped_fresh", 0, "price already fresh");
    }
    targetTickers = targetTickers.filter((t) => !freshSet.has(t));
  }

  const rowsPerTicker: Record<string, number> = {};
  let totalRows = 0;

  for (const ticker of targetTickers) {
    try {
      const rows = await fetchFn(ticker, start, end);
      const inserted = await upsertPrices(rows);
      rowsPerTicker[ticker] = inserted;
      totalRows += inserted;
      await recordRepair(ticker, start, end, "success", inserted);

      try {
        const meta = await metadataFetchFn(ticker);
        if (meta) {
          await upsertAssetMetadata(ticker, meta);
        }
      } catch {
        // fail-soft: never abort price repair due to metadata fetch failure
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rowsPerTicker[ticker] = 0;
      await recordRepair(ticker, start, end, "failed", 0, msg);
    }
  }

  if ((params.tickers?.length ?? 0) === 0) {
    await recordRefreshAudit(totalRows);
  }

  // Final coverage/freshness check (issue #144). Only meaningful for
  // full-portfolio runs -- an explicit --ticker subset is not a coverage
  // guarantee. dry-run path is handled by repairPricesDryRun and stays
  // unchanged.
  const isFullPortfolio = (params.tickers?.length ?? 0) === 0;
  if (!isFullPortfolio) {
    return {
      tickers: targetTickers,
      rows_loaded: totalRows,
      rows_per_ticker: rowsPerTicker,
      range: { start, end },
      skipped_fresh: skippedFresh,
      status: "ok",
      unresolved: { missing: [], stale: [] },
    };
  }

  const coverage = await verifyPrices(params.maxAgeDays);
  const missing = coverage.coverage_issues;
  const stale = params.maxAgeDays !== undefined && params.maxAgeDays > 0
    ? coverage.stale_tickers
    : [];
  const status: "ok" | "degraded" =
    missing.length > 0 || stale.length > 0 ? "degraded" : "ok";

  return {
    tickers: targetTickers,
    rows_loaded: totalRows,
    rows_per_ticker: rowsPerTicker,
    range: { start, end },
    skipped_fresh: skippedFresh,
    status,
    unresolved: { missing, stale },
  };
}

export async function runDailyMaintenanceCheck(maxAgeDays?: number): Promise<void> {
  const maxAge = maxAgeDays ?? STALE_MAX_AGE_DAYS;
  await query("SELECT daily_maintenance_check($1)", [maxAge]);
}
