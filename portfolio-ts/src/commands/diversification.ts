import { querySingle } from "../db.js";

export interface DiversificationData {
  as_of_date: string;
  hhi: number;
  total_holdings: number;
  effective_holdings: number;
  avg_pairwise_correlation: number | null;
  max_pairwise_correlation: number | null;
  min_pairwise_correlation: number | null;
  correlation_weighted_hhi: number;
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export async function getDiversification(
  asOfDate?: string,
  lookbackDays?: number,
  minCorrelation?: number,
): Promise<DiversificationData> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];
  const actualLookback = lookbackDays && lookbackDays > 0 ? lookbackDays : 252;
  const actualMinCorr = minCorrelation !== undefined ? minCorrelation : 0.0;

  const row = await querySingle<Record<string, unknown>>(
    `SELECT
       as_of_date,
       hhi,
       total_holdings,
       effective_holdings,
       avg_pairwise_correlation,
       max_pairwise_correlation,
       min_pairwise_correlation,
       correlation_weighted_hhi
     FROM portfolio_diversification_depth_sql($1, $2, $3)`,
    [actualDate, actualLookback, actualMinCorr],
  );

  return {
    as_of_date: actualDate,
    hhi: num(row?.["hhi"]),
    total_holdings: num(row?.["total_holdings"]),
    effective_holdings: num(row?.["effective_holdings"]),
    avg_pairwise_correlation: nullableNum(row?.["avg_pairwise_correlation"]),
    max_pairwise_correlation: nullableNum(row?.["max_pairwise_correlation"]),
    min_pairwise_correlation: nullableNum(row?.["min_pairwise_correlation"]),
    correlation_weighted_hhi: num(row?.["correlation_weighted_hhi"]),
  };
}
