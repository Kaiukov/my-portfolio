import { querySingle } from "../db.js";
import { getAllocation } from "./allocation.js";
import type { DustFilterMeta } from "../dust.js";

export interface ConcentrationData {
  hhi: number;
  total_holdings: number;
  top_holdings: Array<{ asset: string; asset_type: string; allocation_pct: number }>;
  as_of_date: string;
  dust_filter?: DustFilterMeta;
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

export async function getConcentration(
  asOfDate?: string,
  topN?: number,
  includeDust = false,
): Promise<ConcentrationData> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];
  const limit = topN && topN > 0 ? topN : 5;

  const [concRow, allocation] = await Promise.all([
    querySingle<Record<string, unknown>>(
      "SELECT hhi, total_holdings, as_of_date FROM portfolio_concentration_sql($1)",
      [actualDate],
    ),
    getAllocation(actualDate, includeDust),
  ]);

  const topHoldings = [...allocation.rows]
    .sort((a, b) => b.allocation_pct - a.allocation_pct)
    .slice(0, limit)
    .map((row) => ({
      asset: row.asset,
      asset_type: row.asset_type,
      allocation_pct: row.allocation_pct,
    }));

  return {
    hhi: num(concRow?.["hhi"]),
    total_holdings: num(concRow?.["total_holdings"]),
    top_holdings: topHoldings,
    as_of_date: actualDate,
    dust_filter: allocation.dust_filter,
  };
}
