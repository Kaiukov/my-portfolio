import { repairPrices, repairPricesDryRun, type RepairPricesResult, type RepairPricesDryRunResult, type FetchFn } from "./repair_prices.js";
import { recalculate, type RecalculateResult } from "./recalculate.js";
import { getSummary, type SummaryData } from "./summary.js";
import { getPriceFreshness, type PriceFreshness } from "./freshness.js";
import { fetchPrices } from "../providers/yahoo.js";

export interface RefreshResult {
  refreshed: RepairPricesResult;
  recalculated: boolean;
  recalc: RecalculateResult;
  summary: SummaryData;
}

export interface RefreshDryRunResult {
  dry_run: true;
  refreshed: RepairPricesDryRunResult;
  recalculated: boolean;
  summary: SummaryData;
}

export { getPriceFreshness, type PriceFreshness };

export async function refreshPortfolio(): Promise<RefreshResult> {
  const refreshed = await repairPrices({}, fetchPrices as FetchFn);
  const force = refreshed.status === "ok";
  const recalc = await recalculate({ force });
  const summary = await getSummary();
  const recalculated = recalc.prices_stale ? false : true;
  return { refreshed, recalc, recalculated, summary };
}

export async function refreshPortfolioDryRun(): Promise<RefreshDryRunResult> {
  const refreshed = await repairPricesDryRun({});
  const summary = await getSummary();
  return { dry_run: true, refreshed, recalculated: false, summary };
}
