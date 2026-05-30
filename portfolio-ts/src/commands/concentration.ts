import { query, querySingle } from "../db.js";

export interface ConcentrationData {
  hhi: number;
  total_holdings: number;
  top_holdings: Array<{ asset: string; asset_type: string; allocation_pct: number }>;
  as_of_date: string;
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

export async function getConcentration(
  asOfDate?: string,
  topN?: number,
): Promise<ConcentrationData> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];
  const limit = topN && topN > 0 ? topN : 5;

  const [concRow, allocRows] = await Promise.all([
    querySingle<Record<string, unknown>>(
      "SELECT hhi, total_holdings, as_of_date FROM portfolio_concentration_sql($1)",
      [actualDate],
    ),
    query<Record<string, unknown>>(
      "SELECT asset, asset_type, allocation_pct FROM portfolio_allocation_sql($1) ORDER BY allocation_pct DESC LIMIT $2",
      [actualDate, limit],
    ),
  ]);

  return {
    hhi: num(concRow?.["hhi"]),
    total_holdings: num(concRow?.["total_holdings"]),
    top_holdings: allocRows.map((r) => ({
      asset: str(r["asset"]),
      asset_type: str(r["asset_type"]),
      allocation_pct: num(r["allocation_pct"]),
    })),
    as_of_date: actualDate,
  };
}
