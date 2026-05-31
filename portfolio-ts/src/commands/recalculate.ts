import { query, querySingle } from "../db.js";
import { parseDate, STALE_MAX_AGE_DAYS } from "../validators.js";

export interface RecalculateResult {
  rows_affected: number;
  recalc_type: "full" | "partial";
  from_date: string | null;
  prices_stale?: boolean;
  stale_tickers?: string[];
}

export interface RecalculateDryRunResult {
  dry_run: true;
  from_date: string;
  forced: boolean;
  needs_recalc: boolean;
  prices_stale: boolean;
  stale_tickers: string[];
}

export async function checkPricesStale(maxAgeDays: number = STALE_MAX_AGE_DAYS): Promise<{
  stale: boolean;
  tickers: string[];
}> {
  const rows = await query<{ ticker: string }>(
    `SELECT DISTINCT dt.ticker
     FROM discover_required_tickers_sql() dt
     WHERE NOT is_cash_like_sql(dt.ticker)
       AND price_asof_stale_sql(dt.ticker, CURRENT_DATE, $1) IS NULL
     ORDER BY dt.ticker`,
    [maxAgeDays],
  );
  return { stale: rows.length > 0, tickers: rows.map((r) => r.ticker) };
}

export async function recalculateDryRun(params: {
  fromDateStr?: string;
  force: boolean;
  maxAgeDays?: number;
}): Promise<RecalculateDryRunResult> {
  const fromDate = params.fromDateStr
    ? parseDate(params.fromDateStr, "--from-date")
    : "beginning";

  const row = await querySingle<{ needs_recalc: boolean }>("SELECT needs_recalc() AS needs_recalc");

  const maxAge = params.maxAgeDays ?? STALE_MAX_AGE_DAYS;
  const staleCheck = await checkPricesStale(maxAge);

  return {
    dry_run: true,
    from_date: fromDate,
    forced: params.force,
    needs_recalc: row?.needs_recalc ?? false,
    prices_stale: staleCheck.stale,
    stale_tickers: staleCheck.tickers,
  };
}

export async function recalculate(params: {
  fromDateStr?: string;
  force: boolean;
  maxAgeDays?: number;
}): Promise<RecalculateResult> {
  const fromDate = params.fromDateStr
    ? parseDate(params.fromDateStr, "--from-date")
    : null;

  if (!params.force) {
    const row = await querySingle<{ needs_recalc: boolean }>("SELECT needs_recalc() AS needs_recalc");
    if (row && !row.needs_recalc) {
      return { rows_affected: 0, recalc_type: fromDate ? "partial" : "full", from_date: fromDate };
    }
  }

  const maxAge = params.maxAgeDays ?? STALE_MAX_AGE_DAYS;
  if (!params.force) {
    const staleCheck = await checkPricesStale(maxAge);
    if (staleCheck.stale) {
      return {
        rows_affected: 0,
        recalc_type: fromDate ? "partial" : "full",
        from_date: fromDate,
        prices_stale: true,
        stale_tickers: staleCheck.tickers,
      };
    }
  }

  const rows = await query<{ refresh_daily_returns_sql: number }>(
    "SELECT refresh_daily_returns_sql($1) AS refresh_daily_returns_sql",
    [fromDate],
  );
  const rowsAffected = Number(rows[0]?.refresh_daily_returns_sql ?? 0);

  if (rowsAffected > 0) {
    await query(
      `INSERT INTO refresh_log (refresh_date, refresh_type, rows_affected)
       VALUES (CURRENT_DATE, 'daily_returns', $1)`,
      [rowsAffected],
    );
    const now = new Date().toISOString();
    await query(
      `INSERT INTO service_state (state_key, state_value, updated_at)
       VALUES ('last_successful_recalc', $1, $2)
       ON CONFLICT (state_key)
       DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = EXCLUDED.updated_at`,
      [now, now],
    );
    await query(
      `UPDATE service_state SET state_value = 'false', updated_at = NOW()
       WHERE state_key = 'needs_recalc'`,
    );
  }

  return {
    rows_affected: rowsAffected,
    recalc_type: fromDate ? "partial" : "full",
    from_date: fromDate,
  };
}
