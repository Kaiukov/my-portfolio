import { query, querySingle } from "../db.js";
import { parseWriteDate } from "../validators.js";

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
    ? parseWriteDate(params.fromDateStr, "--from-date")
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
    ? parseWriteDate(params.fromDateStr, "--from-date")
    : null;

  const rows = await query<{ refresh_daily_returns_sql: number }>(
    "SELECT refresh_daily_returns_sql($1) AS refresh_daily_returns_sql",
    [fromDate],
  );
  const rowsAffected = Number(rows[0]?.refresh_daily_returns_sql ?? 0);

  return {
    rows_affected: rowsAffected,
    recalc_type: fromDate ? "partial" : "full",
    from_date: fromDate,
  };
}
