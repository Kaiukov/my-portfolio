import { querySingle, query } from "../db.js";

export interface HealthResult {
  status: "ok" | "degraded";
  db_reachable: boolean;
  needs_recalc: boolean;
  last_successful_price_refresh: string | null;
  last_successful_recalc: string | null;
  price_coverage_issues: number;
  coverage_issue_tickers: string[];
  stale_price_tickers: Array<{ ticker: string; last_price_date: string; age_days: number }>;
  stale_tickers: string[];
}

export async function getHealth(maxAgeDays?: number): Promise<HealthResult> {
  // DB reachability is proven by reaching this point
  const needsRecalcRow = await querySingle<{ needs_recalc: boolean }>(
    "SELECT needs_recalc() AS needs_recalc",
  );
  const needsRecalc = needsRecalcRow?.needs_recalc ?? false;

  const stateRows = await query<{ state_key: string; state_value: string }>(
    "SELECT state_key, state_value FROM service_state WHERE state_key IN ($1, $2)",
    ["last_successful_price_refresh", "last_successful_recalc"],
  );
  const state: Record<string, string> = {};
  for (const r of stateRows) state[r.state_key] = r.state_value;

  // Coverage issues: tickers with missing required price checkpoints
  const today = new Date().toISOString().split("T")[0];
  const checkpointRows = await query<{ ticker: string }>(
    `SELECT DISTINCT c.ticker
     FROM get_required_price_checkpoints_sql($1::date) c
     WHERE NOT EXISTS (
       SELECT 1 FROM prices p
       WHERE p.ticker = c.ticker AND p.date = c.checkpoint_date::date
     )`,
    [today],
  );
  const coverageIssueTickers = [...new Set(checkpointRows.map((r) => r.ticker))].sort();

  // Stale-price detection via SQL (per-ticker staleness, no masking)
  let stalePriceTickers: Array<{ ticker: string; last_price_date: string; age_days: number }> = [];
  if (maxAgeDays !== undefined && maxAgeDays > 0) {
    const staleRows = await query<{ ticker: string; last_price_date: string; age_days: number }>(
      "SELECT ticker, last_price_date::text, age_days::int FROM stale_tickers_sql($1)",
      [maxAgeDays],
    );
    stalePriceTickers = staleRows.map((r) => ({
      ticker: r.ticker,
      last_price_date: r.last_price_date,
      age_days: r.age_days,
    }));
  }

  // stale_tickers is the union of both sets (maintained for backward compat)
  const allStaleTickers = new Set([
    ...coverageIssueTickers,
    ...stalePriceTickers.map((s) => s.ticker),
  ]);
  const staleTickers = [...allStaleTickers].sort();

  const ok = !needsRecalc && staleTickers.length === 0;

  return {
    status: ok ? "ok" : "degraded",
    db_reachable: true,
    needs_recalc: needsRecalc,
    last_successful_price_refresh: state["last_successful_price_refresh"] ?? null,
    last_successful_recalc: state["last_successful_recalc"] ?? null,
    price_coverage_issues: coverageIssueTickers.length,
    coverage_issue_tickers: coverageIssueTickers,
    stale_price_tickers: stalePriceTickers,
    stale_tickers: staleTickers,
  };
}
