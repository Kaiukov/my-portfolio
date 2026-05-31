import { query, querySingle } from "../db.js";

export interface CronInstallResult {
  applied: boolean;
  message: string;
  pg_cron_available: boolean;
}

export interface CronListJob {
  jobid: number;
  jobname: string;
  schedule: string;
  command: string;
  nodename: string;
  nodeport: number;
  database: string;
  username: string;
  active: boolean;
}

export interface CronListResult {
  pg_cron_available: boolean;
  jobs: CronListJob[];
  message?: string;
}

export interface CronRemoveResult {
  removed_count: number;
  message: string;
}

export async function cronInstall(): Promise<CronInstallResult> {
  const ext = await querySingle<{ extname: string }>(
    "SELECT extname FROM pg_extension WHERE extname = 'pg_cron'",
  );

  if (!ext) {
    return {
      applied: false,
      message:
        "pg_cron extension is not installed. Install it first: CREATE EXTENSION pg_cron; (requires superuser). See docs/pg-cron.md.",
      pg_cron_available: false,
    };
  }

  try {
    await query(
      `DO $do$
      BEGIN
          IF NOT EXISTS (
              SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
          ) THEN
              RAISE NOTICE 'pg_cron extension is not installed – skipping all cron job registrations.';
              RETURN;
          END IF;

          PERFORM cron.schedule(
              'portfolio_verify_prices_daily', '0 7 * * *',
              $$SELECT job_verify_prices(5)$$
          );
          PERFORM cron.schedule(
              'portfolio_health_daily', '5 7 * * *',
              $$SELECT job_health(5)$$
          );
          PERFORM cron.schedule(
              'portfolio_backup_daily', '0 2 * * *',
              $$SELECT job_backup()$$
          );
          PERFORM cron.schedule(
              'portfolio_recalc_weekday', '30 18 * * 1-5',
              $$SELECT job_recalculate()$$
          );
          PERFORM cron.schedule(
              'portfolio_recalc_saturday', '0 10 * * 6',
              $$SELECT job_recalculate()$$
          );
          PERFORM cron.schedule(
              'portfolio_detect_missing_prices_sunday', '30 2 * * 0',
              $$SELECT job_repair_missing_prices(5)$$
          );
          PERFORM cron.schedule(
              'portfolio_recalc_sunday', '0 3 * * 0',
              $$SELECT job_recalculate(true)$$
          );
          PERFORM cron.schedule(
              'portfolio_performance_monthly', '0 6 1 * *',
              $$SELECT job_monthly_performance('SPY')$$
          );
      END;
      $do$`,
    );

    return {
      applied: true,
      message: "All portfolio cron jobs registered successfully.",
      pg_cron_available: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      applied: false,
      message: `Failed to register cron jobs: ${msg}`,
      pg_cron_available: true,
    };
  }
}

export async function cronList(): Promise<CronListResult> {
  const ext = await querySingle<{ extname: string }>(
    "SELECT extname FROM pg_extension WHERE extname = 'pg_cron'",
  );

  if (!ext) {
    return {
      pg_cron_available: false,
      jobs: [],
      message:
        "pg_cron extension is not installed. Install it first: CREATE EXTENSION pg_cron; (requires superuser). See docs/pg-cron.md.",
    };
  }

  const jobs = await query<CronListJob>(
    `SELECT jobid, jobname, schedule, command, nodename, nodeport, database, username, active
     FROM cron.job
     WHERE jobname LIKE 'portfolio\_%' ESCAPE '\'
     ORDER BY jobid`,
  );

  return {
    pg_cron_available: true,
    jobs,
  };
}

export async function cronRemove(): Promise<CronRemoveResult> {
  const ext = await querySingle<{ extname: string }>(
    "SELECT extname FROM pg_extension WHERE extname = 'pg_cron'",
  );

  if (!ext) {
    return {
      removed_count: 0,
      message: "pg_cron extension is not installed. Nothing to remove.",
    };
  }

  const before = await query<{ jobid: number }>(
    "SELECT jobid FROM cron.job WHERE jobname LIKE 'portfolio_%'",
  );

  if (before.length === 0) {
    return {
      removed_count: 0,
      message: "No portfolio cron jobs found.",
    };
  }

  await query(
    "SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname LIKE 'portfolio_%'",
  );

  return {
    removed_count: before.length,
    message: `Removed ${before.length} portfolio cron job(s).`,
  };
}
