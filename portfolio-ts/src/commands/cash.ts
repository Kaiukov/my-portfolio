import { query } from "../db.js";

export interface CashRow {
  cash_key: string;
  currency: string;
  display_bucket: string;
  balance: number;
  usd_value: number;
}

export interface CashResult {
  as_of_date: string;
  total_usd: number;
  rows: CashRow[];
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

export async function getCash(asOfDate?: string): Promise<CashResult> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];

  const rows = await query<Record<string, unknown>>(
    "SELECT cash_key, currency, display_bucket, balance, usd_value FROM portfolio_cash_sql($1)",
    [actualDate],
  );

  const cashRows: CashRow[] = rows.map((r) => ({
    cash_key: str(r["cash_key"]),
    currency: str(r["currency"]),
    display_bucket: str(r["display_bucket"]),
    balance: num(r["balance"]),
    usd_value: num(r["usd_value"]),
  }));

  const total_usd = cashRows.reduce((sum, r) => sum + r.usd_value, 0);

  return { as_of_date: actualDate, total_usd, rows: cashRows };
}
