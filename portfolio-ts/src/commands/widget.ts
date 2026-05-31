import { query, querySingle } from "../db.js";

export interface TodayData {
  amount: number;
  pct: number;
}

export interface TotalData {
  amount: number | null;
  pct: number | null;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface WidgetData {
  title: string;
  currency: string;
  as_of_date: string;
  last_refresh: string | null;
  value: number | null;
  today: TodayData;
  total: TotalData;
  series: SeriesPoint[];
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

function strOrNull(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
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

export async function getWidget(
  days: number,
  asOfDate?: string,
): Promise<WidgetData> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];

  const statusRow = await querySingle<Record<string, unknown>>(
    "SELECT * FROM portfolio_status_sql($1)",
    [actualDate],
  );

  const seriesRows = await query<Record<string, unknown>>(
    `SELECT date, portfolio_value, investment_return
     FROM daily_returns
     WHERE date <= $1
     ORDER BY date DESC
     LIMIT $2`,
    [actualDate, days + 1],
  );

  const portfolioValue = statusRow ? numOrNull(statusRow["portfolio_value"]) : null;
  const totalGain = statusRow ? numOrNull(statusRow["total_gain"]) : null;
  const totalGainPct = statusRow ? numOrNull(statusRow["total_gain_pct"]) : null;
  const asOfDateStr = statusRow && statusRow["as_of_date"] != null
    ? String(statusRow["as_of_date"])
    : actualDate;

  let todayAmount = 0;
  let todayPct = 0;
  let lastRefresh: string | null = null;

  if (seriesRows.length > 0) {
    lastRefresh = formatDate(seriesRows[0]["date"]);

    if (seriesRows.length >= 2) {
      todayAmount = num(seriesRows[0]["portfolio_value"]) - num(seriesRows[1]["portfolio_value"]);
    }

    const investmentReturn = seriesRows[0]["investment_return"];
    if (investmentReturn !== null && investmentReturn !== undefined) {
      todayPct = num(investmentReturn);
    }
  }

  const seriesPoints: SeriesPoint[] = seriesRows
    .slice(0, days)
    .reverse()
    .map((r) => ({
      date: formatDate(r["date"]),
      value: num(r["portfolio_value"]),
    }));

  return {
    title: "Portfolio",
    currency: "USD",
    as_of_date: asOfDateStr,
    last_refresh: lastRefresh,
    value: portfolioValue,
    today: { amount: todayAmount, pct: todayPct },
    total: { amount: totalGain, pct: totalGainPct },
    series: seriesPoints,
  };
}
