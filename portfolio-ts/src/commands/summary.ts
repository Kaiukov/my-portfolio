import { querySingle } from "../db.js";

export interface SummaryData {
  holding_count: number;
  total_cash_usd: number;
  portfolio_value_usd: number;
  last_transaction_date: string | null;
  transaction_count: number;
  as_of_date: string;
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function strOrNull(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

export async function getSummary(asOfDate?: string): Promise<SummaryData> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];

  const row = await querySingle<Record<string, unknown>>(
    "SELECT * FROM portfolio_summary_sql($1)",
    [actualDate],
  );

  if (!row) {
    return {
      holding_count: 0,
      total_cash_usd: 0,
      portfolio_value_usd: 0,
      last_transaction_date: null,
      transaction_count: 0,
      as_of_date: actualDate,
    };
  }

  return {
    holding_count: num(row["holding_count"]),
    total_cash_usd: num(row["total_cash_usd"]),
    portfolio_value_usd: num(row["portfolio_value_usd"]),
    last_transaction_date: strOrNull(row["last_transaction_date"]),
    transaction_count: num(row["transaction_count"]),
    as_of_date: strOrNull(row["as_of_date"]) ?? actualDate,
  };
}
