import yahooFinance from "yahoo-finance2";

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

  const data = (await yahooFinance.historical(yahooTicker, {
    period1: extStart,
    period2: new Date(endDate),
    interval: "1d",
  })) as Array<{ date: Date; close: number | null }>;

  const rows: PriceRow[] = [];
  for (const row of data) {
    if (row.close == null) continue;
    const dateStr = isoDate(row.date);
    if (dateStr < startDate || dateStr > endDate) continue;
    rows.push({ ticker, date: dateStr, price: shouldInvert ? 1 / row.close : row.close });
  }
  return rows;
}
