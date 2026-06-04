import { querySingle } from "../db.js";

export interface DecompositionData {
  as_of_date: string;
  total_growth_usd: number;
  total_growth_pct: number;
  from_contributions_usd: number;
  from_contributions_pct: number;
  from_returns_usd: number;
  from_returns_pct: number;
  initial_value: number;
  current_value: number;
  net_deposits: number;
  total_gain: number;
  total_income: number;
  total_fees_and_taxes: number;
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

export async function getDecomposition(
  asOfDate?: string,
): Promise<DecompositionData> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];

  const row = await querySingle<Record<string, unknown>>(
    "SELECT * FROM portfolio_decomposition_sql($1)",
    [actualDate],
  );

  if (!row) {
    return {
      as_of_date: actualDate,
      total_growth_usd: 0,
      total_growth_pct: 0,
      from_contributions_usd: 0,
      from_contributions_pct: 0,
      from_returns_usd: 0,
      from_returns_pct: 0,
      initial_value: 0,
      current_value: 0,
      net_deposits: 0,
      total_gain: 0,
      total_income: 0,
      total_fees_and_taxes: 0,
    };
  }

  return {
    as_of_date: str(row["as_of_date"]),
    total_growth_usd: num(row["total_growth_usd"]),
    total_growth_pct: num(row["total_growth_pct"]),
    from_contributions_usd: num(row["from_contributions_usd"]),
    from_contributions_pct: num(row["from_contributions_pct"]),
    from_returns_usd: num(row["from_returns_usd"]),
    from_returns_pct: num(row["from_returns_pct"]),
    initial_value: num(row["initial_value"]),
    current_value: num(row["current_value"]),
    net_deposits: num(row["net_deposits"]),
    total_gain: num(row["total_gain"]),
    total_income: num(row["total_income"]),
    total_fees_and_taxes: num(row["total_fees_and_taxes"]),
  };
}
