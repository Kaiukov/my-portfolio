import { query } from "../db.js";

export interface RealizedGainRow {
  sell_date: string;
  sell_id: number;
  asset: string;
  sell_quantity: number;
  proceeds_usd: number;
  cost_basis_usd: number;
  realized_gain: number;
  holding_days: number;
  matched_buy_id: number;
  matched_buy_date: string;
}

export interface TaxYearSummary {
  tax_year: number;
  total_realized_gain: number;
  short_term_gain: number;
  long_term_gain: number;
  transaction_count: number;
}

export interface RealizedGainsResult {
  as_of_date: string;
  from_date: string | null;
  to_date: string | null;
  asset: string | null;
  total_realized_gain: number;
  short_term_gain: number;
  long_term_gain: number;
  by_year: TaxYearSummary[];
  rows: RealizedGainRow[];
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

function int(val: unknown): number {
  const n = Number(val);
  return Number.isInteger(n) ? n : 0;
}

export async function getRealizedGains(opts?: {
  fromDate?: string;
  toDate?: string;
  asset?: string;
  byYear?: boolean;
}): Promise<RealizedGainsResult> {
  const toDate = opts?.toDate ?? new Date().toISOString().split("T")[0];
  const fromDate = opts?.fromDate ?? null;

  const rows = await query<Record<string, unknown>>(
    "SELECT sell_date, sell_id, asset, sell_quantity, proceeds_usd, cost_basis_usd, realized_gain, holding_days, matched_buy_id, matched_buy_date FROM portfolio_realized_gains_sql($1, $2, $3)",
    [fromDate, toDate, opts?.asset ?? null],
  );

  const gainRows: RealizedGainRow[] = rows.map((r) => ({
    sell_date: str(r["sell_date"]),
    sell_id: int(r["sell_id"]),
    asset: str(r["asset"]),
    sell_quantity: num(r["sell_quantity"]),
    proceeds_usd: num(r["proceeds_usd"]),
    cost_basis_usd: num(r["cost_basis_usd"]),
    realized_gain: num(r["realized_gain"]),
    holding_days: int(r["holding_days"]),
    matched_buy_id: int(r["matched_buy_id"]),
    matched_buy_date: str(r["matched_buy_date"]),
  }));

  const total_realized_gain = gainRows.reduce((s, r) => s + r.realized_gain, 0);
  const short_term_gain = gainRows
    .filter((r) => r.holding_days <= 365)
    .reduce((s, r) => s + r.realized_gain, 0);
  const long_term_gain = gainRows
    .filter((r) => r.holding_days > 365)
    .reduce((s, r) => s + r.realized_gain, 0);

  let byYear: TaxYearSummary[] = [];
  if (opts?.byYear) {
    const fromYear = fromDate ? Number(fromDate.split("-")[0]) : undefined;
    const toYear = Number(toDate.split("-")[0]);
    const yrRows = await query<Record<string, unknown>>(
      "SELECT tax_year, total_realized_gain, short_term_gain, long_term_gain, transaction_count FROM portfolio_realized_gains_by_year_sql($1, $2)",
      [fromYear ?? null, toYear ?? null],
    );
    byYear = yrRows.map((r) => ({
      tax_year: int(r["tax_year"]),
      total_realized_gain: num(r["total_realized_gain"]),
      short_term_gain: num(r["short_term_gain"]),
      long_term_gain: num(r["long_term_gain"]),
      transaction_count: int(r["transaction_count"]),
    }));
  }

  return {
    as_of_date: toDate,
    from_date: fromDate,
    to_date: toDate,
    asset: opts?.asset ?? null,
    total_realized_gain,
    short_term_gain,
    long_term_gain,
    rows: gainRows,
    by_year: byYear,
  };
}
