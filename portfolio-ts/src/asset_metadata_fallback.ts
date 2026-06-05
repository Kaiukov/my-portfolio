import { ALLOWED_CURRENCIES, STABLECOINS } from "./validators.js";

export interface SectorWeight {
  sector: string;
  weight: number;
}

export interface AssetMetadataFallback {
  sector?: string;
  sector_weights?: SectorWeight[];
}

const KNOWN_FALLBACKS: Record<string, AssetMetadataFallback> = {
  SCHD: {
    sector_weights: [
      { sector: "Consumer Defensive", weight: 19.39 },
      { sector: "Healthcare", weight: 18.82 },
      { sector: "Energy", weight: 16.87 },
      { sector: "Industrials", weight: 11.46 },
      { sector: "Technology", weight: 11.07 },
      { sector: "Financial Services", weight: 9.01 },
      { sector: "Communication Services", weight: 6.92 },
      { sector: "Consumer Cyclical", weight: 6.42 },
      { sector: "Utilities", weight: 0.04 },
    ],
  },
  SPYM: {
    sector_weights: [
      { sector: "Technology", weight: 32.91 },
      { sector: "Financial Services", weight: 12.6 },
      { sector: "Communication Services", weight: 10.29 },
      { sector: "Consumer Cyclical", weight: 9.86 },
      { sector: "Healthcare", weight: 9.47 },
      { sector: "Industrials", weight: 9.02 },
      { sector: "Consumer Defensive", weight: 5.25 },
      { sector: "Energy", weight: 4.01 },
      { sector: "Utilities", weight: 2.54 },
      { sector: "Basic Materials", weight: 2.09 },
      { sector: "Real Estate", weight: 1.95 },
    ],
  },
  "VGEU.DE": {
    sector_weights: [
      { sector: "Financial Services", weight: 24.6 },
      { sector: "Industrials", weight: 19.0 },
      { sector: "Healthcare", weight: 13.8 },
      { sector: "Technology", weight: 8.3 },
      { sector: "Consumer Cyclical", weight: 8.2 },
      { sector: "Consumer Defensive", weight: 7.9 },
      { sector: "Energy", weight: 5.4 },
      { sector: "Utilities", weight: 4.7 },
      { sector: "Basic Materials", weight: 4.5 },
      { sector: "Communication Services", weight: 2.7 },
      { sector: "Real Estate", weight: 1.0 },
    ],
  },
  VGIT: { sector: "Bonds" },
  SGOV: { sector: "Bonds" },
  XLU: { sector: "Utilities" },
  "IGLN.L": { sector: "Gold" },
  "PAXG-USD": { sector: "Gold" },
};

function cloneSectorWeights(
  sectorWeights: SectorWeight[] | undefined,
): SectorWeight[] | undefined {
  return sectorWeights?.map((row) => ({ ...row }));
}

export function getAssetMetadataFallback(
  asset: string,
  assetKind?: string,
): AssetMetadataFallback | undefined {
  const upper = asset.toUpperCase();
  const known = KNOWN_FALLBACKS[upper];
  if (known) {
    return {
      sector: known.sector,
      sector_weights: cloneSectorWeights(known.sector_weights),
    };
  }

  if (upper === "USD" || upper.startsWith("CASH ")) {
    return { sector: "Cash" };
  }

  if (STABLECOINS.has(upper) || /-USD$/.test(upper)) {
    return { sector: "Crypto" };
  }

  if (ALLOWED_CURRENCIES.has(upper) && upper !== "USD") {
    return { sector: "FX" };
  }

  const fxMatch = /^([A-Z]{3})USD=X$/.exec(upper);
  if (fxMatch && ALLOWED_CURRENCIES.has(fxMatch[1])) {
    return { sector: "FX" };
  }

  if (assetKind === "fixed_income") {
    return { sector: "Bonds" };
  }

  return undefined;
}
