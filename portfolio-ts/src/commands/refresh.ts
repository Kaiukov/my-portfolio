import { repairPrices, type RepairPricesResult, type FetchFn } from "./repair_prices.js";
import { getSummary, type SummaryData } from "./summary.js";
import { getPriceFreshness, type PriceFreshness } from "./freshness.js";
import { fetchPrices } from "../providers/yahoo.js";

export interface RefreshResult {
  refreshed: RepairPricesResult;
  summary: SummaryData;
}

export { getPriceFreshness, type PriceFreshness };

export async function refreshPortfolio(): Promise<RefreshResult> {
  const refreshed = await repairPrices({}, fetchPrices as FetchFn);
  const summary = await getSummary();
  return { refreshed, summary };
}
