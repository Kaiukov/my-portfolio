import { calculateMovingAverages } from "./math.js";
import { roundTo } from "../utils.js";

export type MacroRegime = "AGGRESSIVE" | "CAUTION" | "PROTECTION";

export interface CapeIndicator {
  value: number | null;
  peak: boolean;
  source: string;
  error?: string;
}

export interface FearGreedIndicator {
  value: number | null;
  rating: string | null;
  peak: boolean;
  source: string;
  error?: string;
}

export interface UnrateIndicator {
  value: number | null;
  date: string | null;
  peak: boolean;
  ok_band: boolean;
  source: string;
  error?: string;
}

export interface SpxSma200Indicator {
  spx_price: number | null;
  sma200: number | null;
  above_sma200: boolean | null;
  peak: boolean;
  source: string;
  error?: string;
}

export interface MacroIndicatorsPayload {
  generated_at: string;
  regime: MacroRegime;
  regime_reason: string;
  peak_count: number;
  missing_count: number;
  indicators: {
    cape: CapeIndicator;
    fear_greed: FearGreedIndicator;
    unrate: UnrateIndicator;
    spx_sma200: SpxSma200Indicator;
  };
  errors: string[];
}

type IndicatorMap = Record<string, Record<string, unknown>>;
type Fetcher = () => Promise<Record<string, unknown>>;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

const SPX_SYMBOL = "^GSPC";

const FETCHERS: Array<[string, Fetcher]> = [
  ["cape", fetchCape],
  ["fear_greed", fetchFearGreed],
  ["unrate", fetchUnrate],
  ["spx_sma200", fetchSpxSma200],
];

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function fetchCape(): Promise<Record<string, unknown>> {
  const res = await fetch("https://www.multpl.com/shiller-pe", {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const match = html.match(/Current Shiller PE Ratio[^0-9]*([0-9]+\.[0-9]+)/);
  if (!match) return { value: null, error: "parse_failed", source: "multpl.com" };
  const value = parseFloat(match[1]);
  return { value, peak: value > 30, source: "multpl.com" };
}

async function fetchFearGreed(): Promise<Record<string, unknown>> {
  const res = await fetch(
    "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
    {
      headers: {
        ...HEADERS,
        Referer: "https://edition.cnn.com/markets/fear-and-greed",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  const data = (await res.json()) as Record<string, any>;
  const fg = data?.fear_and_greed;
  if (!fg || fg.score == null)
    return { value: null, error: "parse_failed", source: "CNN dataviz API" };
  const value = roundTo(parseFloat(fg.score));
  return {
    value,
    rating: fg.rating ?? null,
    peak: value > 75,
    source: "CNN dataviz API",
  };
}

async function fetchUnrate(): Promise<Record<string, unknown>> {
  const res = await fetch(
    "https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE",
    { signal: AbortSignal.timeout(15000) },
  );
  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2)
    return { value: null, error: "parse_failed", source: "FRED" };

  const headerRow = lines[0].split(",");
  const rateIdx = headerRow.indexOf("UNRATE");
  const dateIdx = headerRow.indexOf("observation_date");
  if (rateIdx < 0 || dateIdx < 0)
    return { value: null, error: "parse_failed", source: "FRED" };

  let lastValue: number | null = null;
  let lastDate: string | null = null;
  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = lines[i].split(",");
    const val = cols[rateIdx]?.trim();
    if (val) {
      lastValue = parseFloat(val);
      lastDate = cols[dateIdx]?.trim() ?? null;
      break;
    }
  }
  if (lastValue === null)
    return { value: null, error: "parse_failed", source: "FRED" };

  return {
    value: lastValue,
    date: lastDate,
    peak: lastValue <= 3.8,
    ok_band: lastValue >= 3.8 && lastValue <= 4.8,
    source: "FRED",
  };
}

async function fetchSpxSma200(): Promise<Record<string, unknown>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(SPX_SYMBOL)}?range=1y&interval=1d`;
  const res = await fetch(url, {
    headers: { ...HEADERS, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok)
    return {
      spx_price: null,
      sma200: null,
      above_sma200: null,
      peak: false,
      error: `HTTP ${res.status}`,
      source: "Yahoo Finance",
    };

  const json = (await res.json()) as Record<string, any>;
  const result = json?.chart?.result?.[0];
  if (!result)
    return {
      spx_price: null,
      sma200: null,
      above_sma200: null,
      peak: false,
      error: "empty_result",
      source: "Yahoo Finance",
    };

  const closes: (number | null)[] =
    result.indicators?.adjclose?.[0]?.adjclose ??
    result.indicators?.quote?.[0]?.close ??
    [];
  const validCloses: number[] = closes.filter(
    (v): v is number => v !== null,
  );

  if (validCloses.length < 200)
    return {
      spx_price: null,
      sma200: null,
      above_sma200: null,
      peak: false,
      error: "insufficient_data",
      source: "Yahoo Finance",
    };

  const currentPrice = validCloses[validCloses.length - 1];
  const { ma200 } = calculateMovingAverages(validCloses);

  if (ma200 === null)
    return {
      spx_price: null,
      sma200: null,
      above_sma200: null,
      peak: false,
      error: "sma200_null",
      source: "Yahoo Finance",
    };

  const above = currentPrice > ma200;
  return {
    spx_price: roundTo(currentPrice),
    sma200: roundTo(ma200),
    above_sma200: above,
    peak: !above,
    source: "Yahoo Finance",
  };
}

function isMissing(key: string, data: Record<string, unknown>): boolean {
  if (data.error) return true;
  if (key === "spx_sma200") return data.spx_price == null;
  return data.value == null;
}

export function computeRegime(
  results: IndicatorMap,
): {
  regime: MacroRegime;
  regime_reason: string;
  peak_count: number;
  missing_count: number;
  errors: string[];
} {
  const keys = ["cape", "fear_greed", "unrate", "spx_sma200"];

  const peakCount = keys.reduce((count, key) => {
    return results[key]?.peak === true ? count + 1 : count;
  }, 0);

  const missingCount = keys.reduce((count, key) => {
    return isMissing(key, results[key] ?? {}) ? count + 1 : count;
  }, 0);

  const errors: string[] = [];
  for (const key of keys) {
    const err = results[key]?.error;
    if (err) errors.push(`${key}: ${err}`);
  }

  let regime: MacroRegime;
  let regimeReason: string;

  if (missingCount > 1) {
    regime = "CAUTION";
    regimeReason = `${missingCount} indicators missing`;
  } else if (peakCount <= 1) {
    regime = "AGGRESSIVE";
    regimeReason = `${peakCount} PEAK`;
  } else if (peakCount === 2) {
    regime = "CAUTION";
    regimeReason = "2 PEAK";
  } else {
    regime = "PROTECTION";
    regimeReason = `${peakCount} PEAK`;
  }

  return {
    regime,
    regime_reason: regimeReason,
    peak_count: peakCount,
    missing_count: missingCount,
    errors,
  };
}

export async function fetchMacroIndicators(): Promise<MacroIndicatorsPayload> {
  const results: IndicatorMap = {};

  for (const [key, fn] of FETCHERS) {
    try {
      results[key] = await fn();
    } catch (err) {
      results[key] = {
        value: null,
        error: err instanceof Error ? err.message : String(err),
        source: "unknown",
      };
    }
  }

  const { regime, regime_reason, peak_count, missing_count, errors } =
    computeRegime(results);

  return {
    generated_at: isoNow(),
    regime,
    regime_reason,
    peak_count,
    missing_count,
    indicators: results as unknown as MacroIndicatorsPayload["indicators"],
    errors,
  };
}
