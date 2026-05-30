import { query, querySingle } from "../db.js";

export interface DailyReturnRow {
  date: string;
  portfolio_value: number;
  portfolio_daily_return: number;
  investment_return: number;
  cash_flow_impact: number;
  adjusted_base: number;
}

export interface ReportResult {
  data: DailyReturnRow[];
  total: number;
}

function formatDate(val: unknown): string {
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, "0");
    const d = String(val.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return val != null ? String(val) : "";
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

export async function getReport(
  limit = 50,
  offset = 0,
  startDate?: string,
  endDate?: string,
): Promise<ReportResult> {
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (startDate) { whereClauses.push(`date >= $${params.length + 1}`); params.push(startDate); }
  if (endDate)   { whereClauses.push(`date <= $${params.length + 1}`); params.push(endDate); }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const countRow = await querySingle<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM daily_returns ${whereSQL}`, params,
  );
  const total = Number(countRow?.count ?? 0);

  const pageParams = [...params, limit, offset];
  const rows = await query<Record<string, unknown>>(
    `SELECT date, portfolio_value, portfolio_daily_return, investment_return,
            cash_flow_impact, adjusted_base
     FROM daily_returns ${whereSQL}
     ORDER BY date ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    pageParams,
  );

  return {
    data: rows.map((r) => ({
      date: formatDate(r["date"]),
      portfolio_value: num(r["portfolio_value"]),
      portfolio_daily_return: num(r["portfolio_daily_return"]),
      investment_return: num(r["investment_return"]),
      cash_flow_impact: num(r["cash_flow_impact"]),
      adjusted_base: num(r["adjusted_base"]),
    })),
    total,
  };
}
