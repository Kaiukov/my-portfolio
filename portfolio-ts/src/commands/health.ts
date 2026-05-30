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

  // Stale-price detection: tickers whose latest price exceeds max_age_days
  const stalePriceTickers: Array<{ ticker: string; last_price_date: string; age_days: number }> = [];
  if (maxAgeDays !== undefined && maxAgeDays > 0) {
    const allRows = await query<{ ticker: string }>(
      "SELECT DISTINCT ticker FROM prices ORDER BY ticker",
    );
    for (const row of allRows) {
      const latestRow = await querySingle<{ last_date: string | null }>(
        `SELECT MAX(date)::text AS last_date FROM prices WHERE ticker = $1`,
        [row.ticker],
      );
      if (latestRow?.last_date) {
        const ageDays = Math.floor(
          (new Date(today).getTime() - new Date(latestRow.last_date).getTime()) / 86400000,
        );
        if (ageDays > maxAgeDays) {
          stalePriceTickers.push({
            ticker: row.ticker,
            last_price_date: latestRow.last_date,
            age_days: ageDays,
          });
        }
      }
    }
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
