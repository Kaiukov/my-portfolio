import YahooFinance from "yahoo-finance2";
import { ALLOWED_CURRENCIES } from "./validators.js";

const yahooFinance = new YahooFinance();

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

  const bareCurrency = /^[A-Z]{3}$/.test(ticker) && ALLOWED_CURRENCIES.has(ticker.toUpperCase())
    ? ticker.toUpperCase()
    : (() => {
        const m = /^([A-Z]{3})USD=X$/.exec(ticker);
        if (m && ALLOWED_CURRENCIES.has(m[1])) return m[1];
        return null;
      })();

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
    const quote = (await yahooFinance.quote(ticker)) as {
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
