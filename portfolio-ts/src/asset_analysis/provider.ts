import YahooFinance from "yahoo-finance2";
import type {
  AnalysisIssue,
  AssetAnalysisProvider,
  AssetAnalysisProviderRequest,
  AssetAnalysisProviderResult,
  AssetInfo,
  AssetType,
  PriceBar,
} from "./types.js";

const DEFAULT_BENCHMARK_TICKER = "^GSPC";

const ETF_BENCHMARKS: Record<string, string> = {
  SPY: "^GSPC",
  VOO: "^GSPC",
  IVV: "^GSPC",
  VTI: "^VTI",
  IWM: "^RUT",
  IWR: "^MID",
  VO: "^VEXMX",
  VB: "^RUJ",
  XLK: "^SP500-45",
  XLF: "^SP500-40",
  XLV: "^SP500-35",
  XLE: "^SP500-10",
  XLY: "^SP500-30",
  XLP: "^SP500-25",
  XLI: "^SP500-20",
  XLB: "^SP500-15",
  XLRE: "^SP500-50",
  XLU: "^SP500-55",
  XLC: "^SP500-IT",
  EFA: "^EFA",
  EEM: "^EEM",
  VEA: "^VEA",
  VWO: "^VWO",
  VGK: "^VGK",
  VPL: "^VPL",
  TLT: "^TNX",
  IEF: "^FVX",
  SHY: "^IRX",
  AGG: "^AGG",
  BND: "^BND",
  LQD: "^LQD",
  HYG: "^HYG",
  JNK: "^JNK",
  GLD: "GLD",
  SLV: "SLV",
  GDX: "GDX",
  USO: "CL=F",
  DBC: "DBC",
  VXX: "^VIX",
  UVXY: "^VIX",
  QQQ: "^NDX",
  QQQM: "^NDX",
  VGT: "^VGT",
};

type YahooChartQuote = {
  date?: Date;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
};

type YahooChartResult = {
  quotes?: YahooChartQuote[];
};

type YahooQuoteSummaryResult = Record<string, unknown> | null;

export interface YahooClientLike {
  chart(symbol: string, options: {
    period1: Date;
    period2: Date;
    interval: "1d";
  }): Promise<YahooChartResult>;
  quoteSummary(symbol: string, options: {
    modules: string[];
  }): Promise<YahooQuoteSummaryResult>;
}

type YahooClientConstructor = new (options?: {
  suppressNotices?: string[];
}) => YahooClientLike;

export const DEFAULT_YAHOO_SUPPRESS_NOTICES = ["yahooSurvey"] as const;

export function createDefaultYahooClient(
  Client: YahooClientConstructor = YahooFinance as unknown as YahooClientConstructor,
): YahooClientLike {
  return new Client({
    suppressNotices: [...DEFAULT_YAHOO_SUPPRESS_NOTICES],
  });
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getDefaultBenchmarkTicker(): string {
  return DEFAULT_BENCHMARK_TICKER;
}

export function resolveTrackingErrorBenchmark(
  ticker: string,
  explicitBenchmark?: string,
): string {
  if (explicitBenchmark && explicitBenchmark.trim() !== "") {
    return explicitBenchmark.trim().toUpperCase();
  }
  return ETF_BENCHMARKS[ticker.toUpperCase()] ?? DEFAULT_BENCHMARK_TICKER;
}

export function normalizeQuoteType(quoteType: string | null): AssetType {
  switch ((quoteType ?? "").toUpperCase()) {
    case "ETF":
      return "ETF";
    case "CRYPTOCURRENCY":
      return "CRYPTO";
    case "CURRENCY":
      return "FX";
    case "MUTUALFUND":
      return "FUND";
    case "INDEX":
      return "INDEX";
    case "FUTURE":
      return "FUTURE";
    case "EQUITY":
    case "ECNQUOTE":
      return "STOCK";
    default:
      return "UNKNOWN";
  }
}

export function buildEmptyAssetInfo(ticker: string): AssetInfo {
  return {
    ticker,
    type: "UNKNOWN",
    quote_type: null,
    type_display: null,
    name: null,
    sector: null,
    industry: null,
    country: null,
    current_price: null,
    previous_close: null,
    bid: null,
    ask: null,
    spread: null,
    spread_pct: null,
    volume: null,
    open_interest: null,
    fifty_two_week_high: null,
    fifty_two_week_low: null,
    market_cap: null,
    nav_price: null,
    expense_ratio: null,
    dividend_yield: null,
    holdings_count: null,
    category: null,
    fund_family: null,
    total_assets: null,
    pe_ratio: null,
    pb_ratio: null,
    peg_ratio: null,
    roe: null,
    roa: null,
    profit_margins: null,
    trailing_eps: null,
    forward_eps: null,
    revenue_growth: null,
    earnings_growth: null,
    payout_ratio: null,
    debt_to_equity: null,
    current_ratio: null,
    volume_24h: null,
    circulating_supply: null,
  };
}

function issue(
  code: string,
  message: string,
  ticker: string,
  field?: string,
): AnalysisIssue {
  return { code, message, source: "provider", ticker, field };
}

function mapChartQuotesToBars(
  quotes: YahooChartQuote[] | undefined,
  endDateInclusive: string,
): PriceBar[] {
  const bars: PriceBar[] = [];
  for (const quote of quotes ?? []) {
    if (!(quote.date instanceof Date) || quote.close == null) continue;
    const date = isoDate(quote.date);
    if (date > endDateInclusive) continue;
    bars.push({
      date,
      open: quote.open ?? quote.close,
      high: quote.high ?? quote.close,
      low: quote.low ?? quote.close,
      close: quote.close,
      volume: quote.volume ?? null,
    });
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return bars;
}

async function fetchChartBars(
  client: YahooClientLike,
  symbol: string,
  period1: Date,
  period2Exclusive: Date,
  endDateInclusive: string,
): Promise<PriceBar[]> {
  const result = await client.chart(symbol, {
    period1,
    period2: period2Exclusive,
    interval: "1d",
  });
  return mapChartQuotesToBars(result?.quotes, endDateInclusive);
}

function mapQuoteSummaryToAssetInfo(
  ticker: string,
  summary: YahooQuoteSummaryResult,
): AssetInfo {
  const info = buildEmptyAssetInfo(ticker);
  const root = asObject(summary);
  const price = asObject(root["price"]);
  const detail = asObject(root["summaryDetail"]);
  const stats = asObject(root["defaultKeyStatistics"]);
  const profile = asObject(root["assetProfile"]);
  const summaryProfile = asObject(root["summaryProfile"]);
  const financialData = asObject(root["financialData"]);
  const fundProfile = asObject(root["fundProfile"]);
  const quoteTypeModule = asObject(root["quoteType"]);

  const quoteType =
    asString(price["quoteType"]) ??
    asString(quoteTypeModule["quoteType"]) ??
    asString(root["quoteType"]);
  const type = normalizeQuoteType(quoteType);
  const currentPrice = asNumber(price["regularMarketPrice"]);
  const bid = asNumber(detail["bid"]);
  const ask = asNumber(detail["ask"]);
  const spread = bid !== null && ask !== null ? ask - bid : null;
  const spreadPct = bid !== null && ask !== null && bid !== 0 ? (spread! / bid) * 100 : null;
  const identityProfile = Object.keys(profile).length > 0 ? profile : summaryProfile;

  return {
    ...info,
    type,
    quote_type: quoteType,
    type_display: asString(price["quoteType"]) ?? asString(price["quoteSourceName"]),
    name: asString(price["shortName"]) ?? asString(price["longName"]),
    sector: asString(identityProfile["sector"]),
    industry: asString(identityProfile["industry"]),
    country: asString(identityProfile["country"]),
    current_price: currentPrice,
    previous_close: asNumber(price["regularMarketPreviousClose"]) ?? asNumber(detail["previousClose"]),
    bid,
    ask,
    spread,
    spread_pct: spreadPct,
    volume: asNumber(detail["volume"]) ?? asNumber(price["regularMarketVolume"]),
    open_interest: asNumber(detail["openInterest"]),
    fifty_two_week_high: asNumber(detail["fiftyTwoWeekHigh"]),
    fifty_two_week_low: asNumber(detail["fiftyTwoWeekLow"]),
    market_cap: asNumber(price["marketCap"]),
    nav_price: asNumber(stats["navPrice"]),
    expense_ratio: asNumber(fundProfile["annualReportExpenseRatio"]),
    dividend_yield: asNumber(financialData["dividendYield"]) ?? asNumber(stats["yield"]),
    holdings_count: asNumber(fundProfile["totalHoldings"]),
    category: asString(fundProfile["categoryName"]) ?? asString(fundProfile["legalType"]),
    fund_family: asString(identityProfile["fundFamily"]),
    total_assets: asNumber(fundProfile["totalNetAssets"]),
    pe_ratio: asNumber(detail["trailingPE"]) ?? asNumber(stats["forwardPE"]),
    pb_ratio: asNumber(stats["priceToBook"]),
    peg_ratio: asNumber(stats["pegRatio"]),
    roe: asNumber(stats["returnOnEquity"]),
    roa: asNumber(stats["returnOnAssets"]),
    profit_margins: asNumber(stats["profitMargins"]),
    trailing_eps: asNumber(stats["trailingEps"]),
    forward_eps: asNumber(stats["forwardEps"]),
    revenue_growth: asNumber(stats["revenueGrowth"]),
    earnings_growth: asNumber(stats["earningsQuarterlyGrowth"]),
    payout_ratio: asNumber(stats["payoutRatio"]),
    debt_to_equity: asNumber(stats["debtToEquity"]),
    current_ratio: asNumber(stats["currentRatio"]),
    volume_24h: asNumber(stats["volume24Hr"]),
    circulating_supply: asNumber(stats["circulatingSupply"]),
  };
}

export function createYahooAssetAnalysisProvider(
  client: YahooClientLike = createDefaultYahooClient(),
): AssetAnalysisProvider {
  return {
    async fetchAnalysisInput(
      request: AssetAnalysisProviderRequest,
    ): Promise<AssetAnalysisProviderResult> {
      const warnings: AnalysisIssue[] = [];
      const errors: AnalysisIssue[] = [];
      const endDateInclusive = isoDate(request.asOfDate);
      const period2Exclusive = addDays(request.asOfDate, 1);

      const primaryBars = await fetchChartBars(
        client,
        request.ticker,
        request.analysisStartDate,
        period2Exclusive,
        endDateInclusive,
      );
      if (primaryBars.length < 2) {
        throw new Error(`No usable historical data returned for ${request.ticker}`);
      }

      const historyPromise = fetchChartBars(
        client,
        request.ticker,
        request.historyStartDate,
        period2Exclusive,
        endDateInclusive,
      );
      const infoPromise = client.quoteSummary(request.ticker, {
        modules: [
          "price",
          "quoteType",
          "summaryDetail",
          "assetProfile",
          "summaryProfile",
          "defaultKeyStatistics",
          "financialData",
          "fundProfile",
        ],
      });
      const benchmarkPromise = fetchChartBars(
        client,
        request.benchmark,
        request.analysisStartDate,
        period2Exclusive,
        endDateInclusive,
      );
      const trackingPromise =
        request.trackingBenchmark === request.benchmark
          ? Promise.resolve<PriceBar[] | null>(null)
          : fetchChartBars(
              client,
              request.trackingBenchmark,
              request.analysisStartDate,
              period2Exclusive,
              endDateInclusive,
            );

      const [historyResult, infoResult, benchmarkResult, trackingResult] = await Promise.allSettled([
        historyPromise,
        infoPromise,
        benchmarkPromise,
        trackingPromise,
      ]);

      const historyBars =
        historyResult.status === "fulfilled" && historyResult.value.length >= 2
          ? historyResult.value
          : primaryBars;
      if (historyResult.status === "rejected") {
        errors.push(
          issue(
            "LONG_HISTORY_FETCH_FAILED",
            `Failed to load extended history for ${request.ticker}: ${historyResult.reason instanceof Error ? historyResult.reason.message : String(historyResult.reason)}`,
            request.ticker,
            "five_year_bars",
          ),
        );
      } else if (historyBars.length < 2) {
        warnings.push(
          issue(
            "LONG_HISTORY_UNAVAILABLE",
            `Extended history for ${request.ticker} is unavailable; CAGR metrics may be null.`,
            request.ticker,
            "five_year_bars",
          ),
        );
      }

      const info =
        infoResult.status === "fulfilled"
          ? mapQuoteSummaryToAssetInfo(request.ticker, infoResult.value)
          : buildEmptyAssetInfo(request.ticker);
      if (infoResult.status === "rejected") {
        errors.push(
          issue(
            "ASSET_INFO_FETCH_FAILED",
            `Failed to load quote summary for ${request.ticker}: ${infoResult.reason instanceof Error ? infoResult.reason.message : String(infoResult.reason)}`,
            request.ticker,
            "info",
          ),
        );
      }

      const benchmarkBars =
        benchmarkResult.status === "fulfilled"
          ? benchmarkResult.value
          : [];
      if (benchmarkResult.status === "rejected") {
        errors.push(
          issue(
            "BENCHMARK_FETCH_FAILED",
            `Failed to load benchmark history for ${request.benchmark}: ${benchmarkResult.reason instanceof Error ? benchmarkResult.reason.message : String(benchmarkResult.reason)}`,
            request.benchmark,
            "benchmark",
          ),
        );
      } else if (benchmarkBars.length < 2) {
        warnings.push(
          issue(
            "BENCHMARK_HISTORY_UNAVAILABLE",
            `Benchmark history for ${request.benchmark} is unavailable; benchmark-relative metrics may be null.`,
            request.benchmark,
            "benchmark",
          ),
        );
      }

      const trackingBenchmarkBars =
        request.trackingBenchmark === request.benchmark
          ? benchmarkBars
          : trackingResult.status === "fulfilled" && trackingResult.value
            ? trackingResult.value
            : [];
      if (request.trackingBenchmark !== request.benchmark) {
        if (trackingResult.status === "rejected") {
          errors.push(
            issue(
              "TRACKING_BENCHMARK_FETCH_FAILED",
              `Failed to load tracking benchmark history for ${request.trackingBenchmark}: ${trackingResult.reason instanceof Error ? trackingResult.reason.message : String(trackingResult.reason)}`,
              request.trackingBenchmark,
              "tracking_error_benchmark",
            ),
          );
        } else if (trackingBenchmarkBars.length < 2) {
          warnings.push(
            issue(
              "TRACKING_BENCHMARK_HISTORY_UNAVAILABLE",
              `Tracking benchmark history for ${request.trackingBenchmark} is unavailable; tracking error may be null.`,
              request.trackingBenchmark,
              "tracking_error_benchmark",
            ),
          );
        }
      }

      return {
        info,
        priceBars: primaryBars,
        historyBars,
        benchmarkBars,
        trackingBenchmarkBars,
        warnings,
        errors,
      };
    },
  };
}
