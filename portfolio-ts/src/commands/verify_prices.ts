import { query, querySingle } from "../db.js";

export interface VerifyPricesResult {
  total_rows: number;
  unique_tickers: number;
  date_range: { start: string | null; end: string | null };
  required_tickers: string[];
  coverage_issues: Array<{ ticker: string; issues: string[] }>;
  stale_tickers: Array<{ ticker: string; last_price_date: string; age_days: number }>;
  needs_recalc: boolean;
}

export async function verifyPrices(maxAgeDays?: number): Promise<VerifyPricesResult> {
  const statsRow = await querySingle<{
    total_rows: number;
    min_date: string | null;
    max_date: string | null;
  }>(
    `SELECT COUNT(*)::int AS total_rows,
            MIN(date)::text AS min_date,
            MAX(date)::text AS max_date
     FROM prices`,
  );

  const tickers = await query<{ ticker: string }>(
    "SELECT DISTINCT ticker FROM prices ORDER BY ticker",
  );

  const requiredRows = await query<{ ticker: string; ticker_category: string }>(
    "SELECT ticker, ticker_category FROM discover_required_tickers_sql() ORDER BY ticker",
  );
  const requiredTickers = requiredRows.map((r) => r.ticker);

  // Determine end date for checkpoint validation
  const today = new Date().toISOString().split("T")[0];
  const checkpointRows = await query<{ ticker: string; checkpoint_date: string }>(
    "SELECT ticker, checkpoint_date::text AS checkpoint_date FROM get_required_price_checkpoints_sql($1) ORDER BY ticker, checkpoint_date",
    [today],
  );

  // Group checkpoints by ticker and check coverage
  const checkpointMap = new Map<string, string[]>();
  for (const row of checkpointRows) {
    const dates = checkpointMap.get(row.ticker) ?? [];
    dates.push(row.checkpoint_date);
    checkpointMap.set(row.ticker, dates);
  }

  // Check which required checkpoint dates are missing from prices
  const coverageIssues: Array<{ ticker: string; issues: string[] }> = [];
  for (const [ticker, dates] of checkpointMap) {
    if (dates.length === 0) continue;
    const dateList = dates.map((d) => `('${d}'::date)`).join(", ");
    const missingRows = await query<{ d: string }>(
      `SELECT d::text FROM (VALUES ${dateList}) AS cp(d)
       WHERE d NOT IN (
         SELECT date FROM prices WHERE ticker = $1
       )`,
      [ticker],
    );
    if (missingRows.length > 0) {
      coverageIssues.push({
        ticker,
        issues: [`missing_dates: ${missingRows.map((r) => r.d).join(", ")}`],
      });
    }
  }

  // Staleness pass: for each ticker with prices, check if the latest price is too old
  const staleTickers: Array<{ ticker: string; last_price_date: string; age_days: number }> = [];
  if (maxAgeDays !== undefined && maxAgeDays > 0) {
    const allTickers = new Set([...requiredTickers, ...tickers.map((r) => r.ticker)]);
    for (const ticker of allTickers) {
      const latestRow = await querySingle<{ last_date: string | null }>(
        `SELECT MAX(date)::text AS last_date FROM prices WHERE ticker = $1`,
        [ticker],
      );
      if (latestRow?.last_date) {
        const ageDays = Math.floor(
          (new Date(today).getTime() - new Date(latestRow.last_date).getTime()) / 86400000,
        );
        if (ageDays > maxAgeDays) {
          staleTickers.push({ ticker, last_price_date: latestRow.last_date, age_days: ageDays });
        }
      }
    }
  }

  const needsRecalcRow = await querySingle<{ needs_recalc: boolean }>(
    "SELECT needs_recalc() AS needs_recalc",
  );

  return {
    total_rows: statsRow?.total_rows ?? 0,
    unique_tickers: tickers.length,
    date_range: {
      start: statsRow?.min_date ?? null,
      end: statsRow?.max_date ?? null,
    },
    required_tickers: requiredTickers,
    coverage_issues: coverageIssues,
    stale_tickers: staleTickers,
    needs_recalc: needsRecalcRow?.needs_recalc ?? false,
  };
}
