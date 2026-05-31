import { querySingle } from "../db.js";

export interface StatusData {
  transactions: number;
  start_date: string | null;
  end_date: string | null;
  portfolio_value: number | null;
  /** Net contributed capital (deposits − withdrawals), NOT gross invested */
  total_invested: number | null;
  deposits: number;
  withdrawals: number;
  income: number;
  fees: number;
  taxes: number;
  total_gain: number | null;
  total_gain_pct: number | null;
  cost_basis: number | null;
  realized_gain: number | null;
  unrealized_gain: number | null;
  total_profit: number | null;
  as_of_date: string | null;
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export async function getStatus(asOfDate?: string): Promise<StatusData> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];

  // All financial metrics are owned by PostgreSQL via portfolio_status_sql().
  // TypeScript does not compute any financial values — it only formats the output.
  const row = await querySingle<Record<string, unknown>>(
    "SELECT * FROM portfolio_status_sql($1)",
    [actualDate],
  );

  if (!row) {
    return {
      transactions: 0,
      start_date: null,
      end_date: null,
      portfolio_value: null,
      total_invested: null,
      deposits: 0,
      withdrawals: 0,
      income: 0,
      fees: 0,
      taxes: 0,
      total_gain: null,
      total_gain_pct: null,
      cost_basis: null,
      realized_gain: null,
      unrealized_gain: null,
      total_profit: null,
      as_of_date: null,
    };
  }

  return {
    transactions: num(row["transactions_count"]),
    start_date: row["start_date"] != null ? String(row["start_date"]) : null,
    end_date: row["end_date"] != null ? String(row["end_date"]) : null,
    portfolio_value: numOrNull(row["portfolio_value"]),
    total_invested: numOrNull(row["total_invested"]),
    deposits: num(row["deposits"]),
    withdrawals: num(row["withdrawals"]),
    income: num(row["income"]),
    fees: num(row["fees"]),
    taxes: num(row["taxes"]),
    total_gain: numOrNull(row["total_gain"]),
    total_gain_pct: numOrNull(row["total_gain_pct"]),
    cost_basis: numOrNull(row["cost_basis"]),
    realized_gain: numOrNull(row["realized_gain"]),
    unrealized_gain: numOrNull(row["unrealized_gain"]),
    total_profit: numOrNull(row["total_profit"]),
    as_of_date: row["as_of_date"] != null ? String(row["as_of_date"]) : null,
  };
}
