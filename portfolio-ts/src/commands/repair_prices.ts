import { query, querySingle } from "../db.js";
import type { PriceRow } from "../providers/yahoo.js";

export interface RepairPricesResult {
  tickers: string[];
  rows_loaded: number;
  rows_per_ticker: Record<string, number>;
  range: { start: string; end: string };
}

export interface RepairPricesDryRunResult {
  dry_run: true;
  would_repair: string[];
  range: { start: string; end: string };
}

export type FetchFn = (
  ticker: string,
  startDate: string,
  endDate: string,
) => Promise<PriceRow[]>;

async function getRequiredTickers(): Promise<string[]> {
  const rows = await query<{ ticker: string }>(
    "SELECT ticker FROM discover_required_tickers_sql() WHERE ticker NOT LIKE 'CASH %' ORDER BY ticker",
  );
  return rows.map((r) => r.ticker);
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

export async function repairPricesDryRun(params: {
  tickers?: string[];
  startDate?: string;
  endDate?: string;
}): Promise<RepairPricesDryRunResult> {
  const today = new Date().toISOString().split("T")[0];
  const txRange = await getDateRange();
  const start = params.startDate ?? txRange.start ?? today;
  const end = params.endDate ?? today;
  const targetTickers = params.tickers?.length ? params.tickers : await getRequiredTickers();

  return {
    dry_run: true,
    would_repair: targetTickers,
    range: { start, end },
  };
}

export async function repairPrices(
  params: { tickers?: string[]; startDate?: string; endDate?: string },
  fetchFn: FetchFn,
): Promise<RepairPricesResult> {
  const today = new Date().toISOString().split("T")[0];
  const txRange = await getDateRange();
  const start = params.startDate ?? txRange.start ?? today;
  const end = params.endDate ?? today;
  const targetTickers = params.tickers?.length ? params.tickers : await getRequiredTickers();

  const rowsPerTicker: Record<string, number> = {};
  let totalRows = 0;

  for (const ticker of targetTickers) {
    const rows = await fetchFn(ticker, start, end);
    const inserted = await upsertPrices(rows);
    rowsPerTicker[ticker] = inserted;
    totalRows += inserted;
  }

  return {
    tickers: targetTickers,
    rows_loaded: totalRows,
    rows_per_ticker: rowsPerTicker,
    range: { start, end },
  };
}
