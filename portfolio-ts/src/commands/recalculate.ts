import { query, querySingle } from "../db.js";
import { parseDate } from "../validators.js";

export interface RecalculateResult {
  rows_affected: number;
  recalc_type: "full" | "partial";
  from_date: string | null;
}

export interface RecalculateDryRunResult {
  dry_run: true;
  from_date: string;
  forced: boolean;
  needs_recalc: boolean;
}

export async function recalculateDryRun(params: {
  fromDateStr?: string;
  force: boolean;
}): Promise<RecalculateDryRunResult> {
  const fromDate = params.fromDateStr
    ? parseDate(params.fromDateStr, "--from-date")
    : "beginning";

  const row = await querySingle<{ needs_recalc: boolean }>("SELECT needs_recalc() AS needs_recalc");

  return {
    dry_run: true,
    from_date: fromDate,
    forced: params.force,
    needs_recalc: row?.needs_recalc ?? false,
  };
}

export async function recalculate(params: {
  fromDateStr?: string;
  force: boolean;
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
