import yahooFinance from "yahoo-finance2";

export interface AssetMetadata {
  yahoo_quote_type: string;
  yahoo_type_disp: string;
  yahoo_short_name: string;
  yahoo_long_name: string;
  currency: string;
  exchange: string;
}

const ASSET_KIND_MAP: Record<string, string> = {
  EQUITY: "stock",
  ETF: "etf",
  CRYPTOCURRENCY: "crypto",
  MUTUALFUND: "fund",
  CURRENCY: "fx",
};

export function normalizeAssetKind(yahooQuoteType: string | null): string {
  if (yahooQuoteType == null || yahooQuoteType === "") return "unknown";
  const upper = yahooQuoteType.toUpperCase();
  return ASSET_KIND_MAP[upper] ?? "unknown";
}

export const ASSET_KIND_NORMALIZED = new Set([
  "stock",
  "etf",
  "crypto",
  "fund",
  "fx",
  "cash",
  "unknown",
]);

export async function fetchAssetMetadata(
  ticker: string,
): Promise<AssetMetadata | null> {
  if (ticker === "USD") {
    return {
      yahoo_quote_type: "CURRENCY",
      yahoo_type_disp: "Currency",
      yahoo_short_name: "USD",
      yahoo_long_name: "United States Dollar",
      currency: "USD",
      exchange: "N/A",
    };
  }

  const bareCurrency = /^[A-Z]{3}$/.test(ticker)
    ? ticker
    : /^([A-Z]{3})USD=X$/.exec(ticker)?.[1] ?? null;

  if (bareCurrency && bareCurrency !== "USD") {
    return {
      yahoo_quote_type: "CURRENCY",
      yahoo_type_disp: "Currency",
      yahoo_short_name: bareCurrency,
      yahoo_long_name: `${bareCurrency} Currency`,
      currency: bareCurrency,
      exchange: "N/A",
    };
  }

  try {
    const quote = (await yahooFinance.quote(
      ticker,
      { fields: ["quoteType", "typeDisp", "shortName", "longName", "currency", "exchange"] },
    )) as {
      quoteType?: string;
      typeDisp?: string;
      shortName?: string;
      longName?: string;
      currency?: string;
      exchange?: string;
    };

    if (!quote || !quote.quoteType) return null;

    return {
      yahoo_quote_type: quote.quoteType,
      yahoo_type_disp: quote.typeDisp ?? "",
      yahoo_short_name: quote.shortName ?? "",
      yahoo_long_name: quote.longName ?? "",
      currency: quote.currency ?? "",
      exchange: quote.exchange ?? "",
    };
  } catch {
    return null;
  }
}
