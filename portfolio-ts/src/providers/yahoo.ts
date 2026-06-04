import YahooFinance from "yahoo-finance2";
import { STABLECOINS, ALLOWED_CURRENCIES } from "../validators.js";

const yahooFinance = new YahooFinance();

export interface SectorWeight {
  sector: string;
  weight: number;
}

export interface AssetProfileAndSectorWeights {
  sector?: string;
  industry?: string;
  region?: string;
  sectorWeights?: SectorWeight[];
}

export function isYahooFetchable(ticker: string): boolean {
  if (ticker === "USD") return false;
  if (STABLECOINS.has(ticker.toUpperCase())) return false;
  if (/^[A-Z]{3}$/.test(ticker.toUpperCase()) && ALLOWED_CURRENCIES.has(ticker.toUpperCase())) return false;
  if (/^[A-Z]{3}USD=X$/.test(ticker)) return false;
  if (ticker.startsWith("CASH ")) return false;
  return true;
}

export function getStaticAssetProfile(ticker: string): AssetProfileAndSectorWeights | null {
  if (ticker === "USD") {
    return { sector: "Cash", region: "US" };
  }

  const upper = ticker.toUpperCase();
  if (STABLECOINS.has(upper)) {
    return { sector: "Crypto", region: "Global" };
  }

  if (ALLOWED_CURRENCIES.has(upper) && upper !== "USD") {
    return { sector: "FX", region: upper };
  }

  const fxMatch = /^([A-Z]{3})USD=X$/.exec(ticker);
  if (fxMatch && ALLOWED_CURRENCIES.has(fxMatch[1])) {
    return { sector: "FX", region: fxMatch[1] };
  }

  if (ticker.startsWith("CASH ")) {
    return { sector: "Cash", region: "US" };
  }

  if (/-USD$/.test(ticker)) {
    return { sector: "Crypto", region: "Global" };
  }

  return null;
}

export async function fetchAssetProfile(
  ticker: string,
): Promise<AssetProfileAndSectorWeights> {
  const result = await yahooFinance.quoteSummary(ticker, {
    modules: ["assetProfile", "topHoldings"],
  });

  const assetProfile = result?.assetProfile;
  const topHoldings = result?.topHoldings;

  const sector = assetProfile?.sector ?? assetProfile?.sectorDisp ?? undefined;
  const industry = assetProfile?.industry ?? assetProfile?.industryDisp ?? undefined;
  const region = assetProfile?.country ?? undefined;

  let sectorWeights: SectorWeight[] | undefined;
  if (topHoldings?.sectorWeightings?.length) {
    sectorWeights = [];
    for (const sw of topHoldings.sectorWeightings) {
      for (const [rawSector, weight] of Object.entries(sw)) {
        if (rawSector === "maxAge") continue;
        if (typeof weight === "number" && weight > 0) {
          const normalized = rawSector
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
          sectorWeights.push({ sector: normalized, weight });
        }
      }
    }
    if (sectorWeights.length === 0) sectorWeights = undefined;
  }

  return { sector, industry, region, sectorWeights };
}

export interface PriceRow {
  ticker: string;
  date: string;
  price: number;
}

// Yahoo Finance quotes these FX pairs as foreign-currency-per-USD.
// We store prices as USD-per-foreign-currency, so we invert.
const REVERSE_QUOTED_FX = new Set([
  "JPYUSD=X",
  "CHFUSD=X",
  "CADUSD=X",
  "AUDUSD=X",
  "HKDUSD=X",
  "SGDUSD=X",
]);

// Map internal ticker names to Yahoo Finance ticker symbols.
const INTERNAL_TO_YAHOO: Record<string, string> = {
  "JPYUSD=X": "JPY=X",
  "CHFUSD=X": "CHF=X",
  "CADUSD=X": "CAD=X",
  "AUDUSD=X": "AUD=X",
  "HKDUSD=X": "HKD=X",
  "SGDUSD=X": "SGD=X",
};

function toYahooTicker(internalTicker: string): string {
  return INTERNAL_TO_YAHOO[internalTicker] ?? internalTicker;
}

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export async function fetchPrices(
  ticker: string,
  startDate: string,
  endDate: string,
): Promise<PriceRow[]> {
  if (ticker.startsWith("CASH")) {
    // CASH assets always have price 1.0 — fill every day in range
    const rows: PriceRow[] = [];
    const cur = new Date(startDate);
    const end = new Date(endDate);
    while (cur <= end) {
      rows.push({ ticker, date: isoDate(cur), price: 1.0 });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return rows;
  }

  const yahooTicker = toYahooTicker(ticker);
  const shouldInvert = REVERSE_QUOTED_FX.has(ticker);

  // Extend start by 10 days to catch forward-fill on weekends/holidays
  const extStart = new Date(startDate);
  extStart.setUTCDate(extStart.getUTCDate() - 10);

  const result = await yahooFinance.chart(yahooTicker, {
    period1: extStart,
    period2: new Date(endDate),
    interval: "1d",
  });
  const data = (result?.quotes ?? []) as Array<{ date: Date; close: number | null }>;

  const rows: PriceRow[] = [];
  for (const row of data) {
    if (row.close == null) continue;
    const dateStr = isoDate(row.date);
    if (dateStr < startDate || dateStr > endDate) continue;
    rows.push({ ticker, date: dateStr, price: shouldInvert ? 1 / row.close : row.close });
  }
  return rows;
}
