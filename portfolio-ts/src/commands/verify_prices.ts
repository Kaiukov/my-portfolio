import { query, querySingle } from "../db.js";

export interface VerifyPricesResult {
  total_rows: number;
  unique_tickers: number;
  date_range: { start: string | null; end: string | null };
  required_tickers: string[];
  coverage_issues: Array<{ ticker: string; issues: string[] }>;
  needs_recalc: boolean;
}

export async function verifyPrices(): Promise<VerifyPricesResult> {
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
    const missingRows = await query<{ d: string }>(
      `SELECT d::text FROM unnest($1::date[]) AS d
       WHERE d NOT IN (
         SELECT date::text FROM prices WHERE ticker = $2
       )`,
      [dates, ticker],
    );
    if (missingRows.length > 0) {
      coverageIssues.push({
        ticker,
        issues: [`missing_dates: ${missingRows.map((r) => r.d).join(", ")}`],
      });
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
    needs_recalc: needsRecalcRow?.needs_recalc ?? false,
  };
}
