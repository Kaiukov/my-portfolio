import { query, querySingle } from "../db.js";

export interface StatusData {
  transactions: number;
  start_date: string | null;
  end_date: string | null;
  portfolio_value: number | null;
  total_invested: number | null;
  deposits: number;
  withdrawals: number;
  income: number;
  fees: number;
  taxes: number;
  total_gain: number | null;
  total_gain_pct: number | null;
  as_of_date: string | null;
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

export async function getStatus(): Promise<StatusData> {
  const countRow = await querySingle("SELECT COUNT(*)::int AS count FROM transactions");
  const transactions = num(countRow?.count ?? 0);

  const dateRow = await querySingle(
    "SELECT MIN(date)::text AS start_date, MAX(date)::text AS end_date FROM transactions",
  );

  const portfolioRow = await querySingle(
    "SELECT portfolio_value, date::text AS as_of_date FROM daily_returns ORDER BY date DESC LIMIT 1",
  );

  const actionRows = (await query(`
    SELECT
      action,
      COUNT(*)::int AS cnt,
      COALESCE(SUM(quantity), 0) AS total_quantity
    FROM transactions
    GROUP BY action
  `)) as { action: string; cnt: number; total_quantity: number }[];

  const actionQty: Record<string, number> = {};
  for (const row of actionRows) {
    actionQty[row.action] = num(row.total_quantity);
  }

  const deposits = actionQty["DEPOSIT"] ?? 0;
  const withdrawals = actionQty["WITHDRAW"] ?? 0;
  const income = (actionQty["DIVIDEND"] ?? 0) + (actionQty["INTEREST"] ?? 0);
  const fees = actionQty["FEE"] ?? 0;
  const taxes = actionQty["TAX"] ?? 0;
  const totalInvested = deposits - withdrawals;
  const portfolioValue = portfolioRow ? num(portfolioRow["portfolio_value"]) : null;
  const totalGain =
    portfolioValue !== null && totalInvested !== 0
      ? portfolioValue - totalInvested
      : null;
  const totalGainPct =
    totalInvested > 0 && totalGain !== null
      ? (totalGain / totalInvested) * 100
      : null;

  return {
    transactions,
    start_date: (dateRow?.start_date as string) ?? null,
    end_date: (dateRow?.end_date as string) ?? null,
    portfolio_value: portfolioValue,
    total_invested: totalInvested,
    deposits,
    withdrawals,
    income,
    fees,
    taxes,
    total_gain: totalGain,
    total_gain_pct: totalGainPct,
    as_of_date: (portfolioRow?.as_of_date as string) ?? null,
  };
}
