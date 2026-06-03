import { query } from "../db.js";

export interface IncomeRow {
  asset: string;
  action: string;
  total_quantity: number;
  usd_value: number;
  currency: string;
  transaction_count: number;
  first_date: string;
  last_date: string;
}

export interface IncomeResult {
  as_of_date: string;
  from_date: string | null;
  total_income_usd: number;
  total_dividends_usd: number;
  total_interest_usd: number;
  rows: IncomeRow[];
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

export async function getIncome(
  asOfDate?: string,
  fromDate?: string,
  asset?: string,
): Promise<IncomeResult> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];

  const rows = await query<Record<string, unknown>>(
    "SELECT asset, action, total_quantity, usd_value, currency, transaction_count, first_date, last_date FROM portfolio_income_sql($1, $2, $3)",
    [actualDate, fromDate ?? null, asset ?? null],
  );

  const incomeRows: IncomeRow[] = rows.map((r) => ({
    asset: str(r["asset"]),
    action: str(r["action"]),
    total_quantity: num(r["total_quantity"]),
    usd_value: num(r["usd_value"]),
    currency: str(r["currency"]),
    transaction_count: int(r["transaction_count"]),
    first_date: str(r["first_date"]),
    last_date: str(r["last_date"]),
  }));

  const total_income_usd = incomeRows.reduce((sum, r) => sum + r.usd_value, 0);
  const total_dividends_usd = incomeRows
    .filter((r) => r.action === "DIVIDEND")
    .reduce((sum, r) => sum + r.usd_value, 0);
  const total_interest_usd = incomeRows
    .filter((r) => r.action === "INTEREST")
    .reduce((sum, r) => sum + r.usd_value, 0);

  return {
    as_of_date: actualDate,
    from_date: fromDate ?? null,
    total_income_usd,
    total_dividends_usd,
    total_interest_usd,
    rows: incomeRows,
  };
}
