import { repairPrices, repairPricesDryRun, type RepairPricesResult, type RepairPricesDryRunResult, type FetchFn } from "./repair_prices.js";
import { recalculate } from "./recalculate.js";
import { getSummary, type SummaryData } from "./summary.js";
import { getPriceFreshness, type PriceFreshness } from "./freshness.js";
import { fetchPrices } from "../providers/yahoo.js";

export interface RefreshResult {
  refreshed: RepairPricesResult;
  recalculated: boolean;
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
  await recalculate({ force: true });
  const summary = await getSummary();
  return { refreshed, recalculated: true, summary };
}

export async function refreshPortfolioDryRun(): Promise<RefreshDryRunResult> {
  const refreshed = await repairPricesDryRun({});
  const summary = await getSummary();
  return { dry_run: true, refreshed, recalculated: false, summary };
}
