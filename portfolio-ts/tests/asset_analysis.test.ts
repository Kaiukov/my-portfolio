import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  analyzeAsset,
  calculateMacd,
  calculateMaxDrawdown,
  calculateMovingAverages,
  calculateStochastic,
  calculateUlcerIndex,
  calculateStochRsi,
  createDefaultYahooClient,
  createYahooAssetAnalysisProvider,
  DEFAULT_YAHOO_SUPPRESS_NOTICES,
  normalizeAssetAnalysisOptions,
} from "../src/asset_analysis/index.js";
import { alignReturnSeriesByDate } from "../src/asset_analysis/math.js";
import { computeAllMetrics } from "../src/asset_analysis/metrics.js";
import type {
  AnalysisIssue,
  AssetAnalysisData,
  AssetAnalysisProvider,
  AssetInfo,
  PriceBar,
} from "../src/asset_analysis/types.js";
import { getAssetAnalysis } from "../src/commands/asset_analysis.js";
import { ValidationError } from "../src/validators.js";

const mockGetAssetAnalysis = mock(async () => makeAssetAnalysisData());

mock.module("../src/db.js", () => ({
  query: mock(async () => []),
  querySingle: mock(async () => null),
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  getSql: mock(() => ({
    begin: mock(async () => ({})),
  })),
  connect: () => {},
  close: mock(async () => {}),
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(async () => ({})),
  beginTx: mock(async () => ({})),
  commit: mock(async () => {}),
  rollback: mock(async () => {}),
}));

mock.module("../src/commands/asset_analysis.js", () => ({
  getAssetAnalysis: mockGetAssetAnalysis,
}));

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function makeBars(startDate: string, closes: number[]): PriceBar[] {
  return closes.map((close, index) => ({
    date: addDays(startDate, index),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000 + index,
  }));
}

function makeAssetInfo(overrides: Partial<AssetInfo> = {}): AssetInfo {
  return {
    ticker: "SPY",
    type: "ETF",
    quote_type: "ETF",
    type_display: "ETF",
    name: "SPDR S&P 500 ETF Trust",
    sector: null,
    industry: null,
    country: "US",
    current_price: 500,
    previous_close: 498,
    bid: 499.5,
    ask: 500.5,
    spread: 1,
    spread_pct: 0.2,
    volume: 1000000,
    open_interest: null,
    fifty_two_week_high: 550,
    fifty_two_week_low: 400,
    market_cap: null,
    nav_price: 499,
    expense_ratio: 0.0009,
    dividend_yield: 0.013,
    holdings_count: 503,
    category: "Large Blend",
    fund_family: "State Street",
    total_assets: 100000000,
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
    ...overrides,
  };
}

function makeAssetAnalysisData(): AssetAnalysisData {
  const priceBars = makeBars("2026-01-01", [100, 101, 102, 103, 104, 105]);
  const historyBars = makeBars("2021-01-01", Array.from({ length: 260 }, (_, index) => 100 + index));
  return {
    request: {
      ticker: "SPY",
      period: "6mo",
      lookback_days: 180,
      benchmark: "QQQ",
      tracking_error_benchmark: "QQQ",
      as_of_date: "2026-06-05",
      risk_free_rate: 0.03,
      annualization_periods: 252,
    },
    ticker: "SPY",
    type: "ETF",
    info: makeAssetInfo(),
    price_bars: priceBars,
    five_year_bars: historyBars,
    metrics: {
      beta: 1,
      annual_volatility: 0.2,
      sharpe_ratio: 1.1,
      sortino_ratio: 1.4,
      downside_deviation: 0.11,
      max_drawdown: -0.1,
      max_drawdown_date: "2026-01-03",
      cagr_1y: 0.12,
      cagr_3y: 0.1,
      cagr_5y: 0.09,
      calmar_ratio: 1,
      ulcer_index: 2,
      skewness: 0,
      kurtosis: 0,
      up_capture: 102,
      down_capture: 90,
      up_capture_ratio: "Outperforms",
      down_capture_ratio: "Average",
      tracking_error: 0.01,
      tracking_error_benchmark: "QQQ",
      premium_discount: 0.2,
      fifty_two_week_range_percent: 66,
      fifty_two_week_percent_from_high: 9,
    },
    technicals: {
      rsi: 55,
      rsi_signal: "Bullish",
      ma50: null,
      ma200: null,
      price_vs_ma50: null,
      price_vs_ma200: null,
      ma50_vs_ma200: null,
      ma_trend: "Insufficient data",
      macd: 1,
      macd_signal: 0.8,
      macd_histogram: 0.2,
      macd_trend: "Strong Bullish",
      williams_r_14: -25,
      williams_r_14_signal: "Neutral",
      williams_r_2: -10,
      williams_r_2_signal: "Overbought",
      stoch_k: 70,
      stoch_d: 68,
      stoch_signal: "Bullish crossover",
      stochrsi_k: 85,
      stochrsi_d: 82,
      stochrsi_signal: "Overbought",
    },
    warnings: [],
    errors: [],
  };
}

function makeProviderResult(): Awaited<ReturnType<AssetAnalysisProvider["fetchAnalysisInput"]>> {
  const closes = Array.from({ length: 260 }, (_, index) => 100 + index * 0.5);
  const priceBars = makeBars("2025-01-01", closes);
  return {
    info: makeAssetInfo(),
    priceBars,
    historyBars: priceBars,
    benchmarkBars: priceBars,
    trackingBenchmarkBars: priceBars,
    warnings: [],
    errors: [],
  };
}

function manualEma(values: number[], span: number): number[] {
  const alpha = 2 / (span + 1);
  const result: number[] = [];
  let previous = values[0];
  result.push(previous);
  for (let index = 1; index < values.length; index++) {
    previous = previous + alpha * (values[index] - previous);
    result.push(previous);
  }
  return result;
}

beforeEach(() => {
  mockGetAssetAnalysis.mockReset();
  mockGetAssetAnalysis.mockImplementation(async () => makeAssetAnalysisData());
});

describe("asset analysis normalization", () => {
  test("normalizes asset alias and period inputs", () => {
    const request = normalizeAssetAnalysisOptions({
      asset: "spy",
      period: "6mo",
      benchmark: "qqq",
      asOfDate: "2026-06-05",
      riskFreeRate: 0.03,
    });

    expect(request.ticker).toBe("SPY");
    expect(request.period).toBe("6mo");
    expect(request.lookback_days).toBeGreaterThan(180);
    expect(request.benchmark).toBe("QQQ");
    expect(request.tracking_error_benchmark).toBe("QQQ");
    expect(request.as_of_date).toBe("2026-06-05");
    expect(request.risk_free_rate).toBe(0.03);
    expect(request.annualization_periods).toBe(252);
  });
});

describe("asset analysis provider", () => {
  test("creates the default Yahoo client with survey notices suppressed", () => {
    const constructorOptions: Array<{ suppressNotices?: string[] } | undefined> = [];

    class FakeYahooClient {
      constructor(options?: { suppressNotices?: string[] }) {
        constructorOptions.push(options);
      }

      async chart(): Promise<{ quotes: [] }> {
        return { quotes: [] };
      }

      async quoteSummary(): Promise<Record<string, unknown>> {
        return {};
      }
    }

    const client = createDefaultYahooClient(
      FakeYahooClient as unknown as new (options?: {
        suppressNotices?: string[];
      }) => {
        chart: typeof FakeYahooClient.prototype.chart;
        quoteSummary: typeof FakeYahooClient.prototype.quoteSummary;
      },
    );

    expect(client).toBeInstanceOf(FakeYahooClient);
    expect(constructorOptions).toEqual([{
      suppressNotices: [...DEFAULT_YAHOO_SUPPRESS_NOTICES],
    }]);
  });

  test("uses bounded Date chart requests and quote price.quoteType", async () => {
    const chartCalls: Array<{ symbol: string; period1: Date; period2: Date }> = [];
    const client = {
      chart: mock(async (symbol: string, options: { period1: Date; period2: Date; interval: "1d" }) => {
        chartCalls.push({ symbol, period1: options.period1, period2: options.period2 });
        return {
          quotes: [
            { date: new Date("2026-01-01T00:00:00.000Z"), open: 100, high: 101, low: 99, close: 100, volume: 1000 },
            { date: new Date("2026-01-02T00:00:00.000Z"), open: 101, high: 102, low: 100, close: 101, volume: 1000 },
          ],
        };
      }),
      quoteSummary: mock(async () => ({
        price: {
          quoteType: "ETF",
          shortName: "SPY",
          regularMarketPrice: 500,
          regularMarketPreviousClose: 499,
        },
        summaryDetail: {
          bid: 499.5,
          ask: 500.5,
          fiftyTwoWeekHigh: 550,
          fiftyTwoWeekLow: 400,
        },
      })),
    };

    const provider = createYahooAssetAnalysisProvider(client);
    const result = await provider.fetchAnalysisInput({
      ticker: "SPY",
      benchmark: "QQQ",
      trackingBenchmark: "QQQ",
      analysisStartDate: new Date("2026-01-01T00:00:00.000Z"),
      historyStartDate: new Date("2021-01-01T00:00:00.000Z"),
      asOfDate: new Date("2026-06-05T00:00:00.000Z"),
    });

    expect(chartCalls).toHaveLength(3);
    expect(chartCalls.every((call) => call.period1 instanceof Date)).toBe(true);
    expect(chartCalls.every((call) => call.period2 instanceof Date)).toBe(true);
    expect(chartCalls.every((call) => call.period2.toISOString().slice(0, 10) === "2026-06-06")).toBe(true);
    expect(result.info.type).toBe("ETF");
    expect(result.info.quote_type).toBe("ETF");
  });
});

describe("asset analysis metrics", () => {
  test("aligns benchmark series by date rather than array position", () => {
    const assetBars = makeBars("2026-01-01", [100, 102, 104, 106]);
    const benchmarkBars = [
      { date: "2025-12-31", open: 90, high: 91, low: 89, close: 90, volume: 1000 },
      ...makeBars("2026-01-01", [100, 102, 104, 106]),
    ];

    const aligned = alignReturnSeriesByDate(assetBars, benchmarkBars);
    expect(aligned.dates).toEqual(["2026-01-02", "2026-01-03", "2026-01-04"]);
    expect(aligned.assetReturns).toHaveLength(3);
    expect(aligned.benchmarkReturns).toHaveLength(3);
  });

  test("computes date-keyed beta and tracking error with shifted benchmark history", () => {
    const closes = Array.from({ length: 30 }, (_, index) => 100 + index * 2);
    const assetBars = makeBars("2026-01-01", closes);
    const benchmarkBars = [
      { date: "2025-12-31", open: 98, high: 99, low: 97, close: 98, volume: 1000 },
      ...makeBars("2026-01-01", closes),
    ];

    const { metrics } = computeAllMetrics(
      assetBars,
      assetBars,
      benchmarkBars,
      benchmarkBars,
      "QQQ",
      "ETF",
      0.03,
    );

    expect(metrics.beta).toBeCloseTo(1, 6);
    expect(metrics.tracking_error).toBeCloseTo(0, 6);
  });

  test("keeps drawdown and ulcer calculations finite when the peak is zero", () => {
    const prices = [0, 0, 10];
    const drawdown = calculateMaxDrawdown(prices);

    expect(drawdown.maxDd).toBe(0);
    expect(drawdown.maxDdDateIdx).toBeNull();
    expect(calculateUlcerIndex(prices)).toBe(0);
  });

  test("stochrsi stays on a 0..100 scale", () => {
    const closes = Array.from({ length: 120 }, (_, index) => 100 + Math.sin(index / 3) * 12 + Math.cos(index / 5) * 4);
    const result = calculateStochRsi(closes);

    expect(result.stochrsiK).not.toBeNull();
    expect(result.stochrsiD).not.toBeNull();
    expect(result.stochrsiK!).toBeGreaterThan(1);
    expect(result.stochrsiK!).toBeLessThanOrEqual(100.000001);
    expect(result.stochrsiD!).toBeLessThanOrEqual(100.000001);
  });

  test("macd signal stays aligned to the latest macd bar", () => {
    const closes = [10, 11, 12, 13, 12, 14, 15, 16, 15, 17, 18, 19];
    const actual = calculateMacd(closes, 3, 6, 3);

    const emaFast = manualEma(closes, 3);
    const emaSlow = manualEma(closes, 6);
    const macdLine = closes.map((_, index) => emaFast[index] - emaSlow[index]);
    const signalLine = manualEma(macdLine, 3);
    const lastIndex = closes.length - 1;

    expect(actual.macd).toBeCloseTo(macdLine[lastIndex], 8);
    expect(actual.macdSignal).toBeCloseTo(signalLine[lastIndex], 8);
    expect(actual.macdHistogram).toBeCloseTo(macdLine[lastIndex] - signalLine[lastIndex], 8);
  });

  test("recovers stochastic smoothing after a single NaN bar", () => {
    const closes = Array.from({ length: 30 }, (_, index) => 100 + index);
    closes[15] = Number.NaN;
    const highs = closes.map((close) => (Number.isFinite(close) ? close + 1 : Number.NaN));
    const lows = closes.map((close) => (Number.isFinite(close) ? close - 1 : Number.NaN));

    const result = calculateStochastic(highs, lows, closes);

    expect(result.stochK).not.toBeNull();
    expect(result.stochD).not.toBeNull();
    expect(Number.isFinite(result.stochK!)).toBe(true);
    expect(Number.isFinite(result.stochD!)).toBe(true);
  });

  test("guards invalid smoothing spans", () => {
    const closes = Array.from({ length: 20 }, (_, index) => 100 + index);
    const highs = closes.map((close) => close + 1);
    const lows = closes.map((close) => close - 1);

    const macd = calculateMacd(closes, 0, 6, 3);
    const stochastic = calculateStochastic(highs, lows, closes, 14, 0, 3);

    expect(macd.macd).toBeNull();
    expect(macd.macdSignal).toBeNull();
    expect(macd.macdHistogram).toBeNull();
    expect(stochastic.stochK).toBeNull();
  });

  test("exposes 50-day averages before 200-day averages are available", () => {
    const closes = Array.from({ length: 100 }, (_, index) => index + 1);
    const result = calculateMovingAverages(closes);

    expect(result.ma50).toBeCloseTo(75.5, 10);
    expect(result.ma200).toBeNull();
    expect(result.priceVsMa50).toBeCloseTo(((100 - 75.5) / 75.5) * 100, 10);
    expect(result.priceVsMa200).toBeNull();
    expect(result.ma50VsMa200).toBeNull();
    expect(result.maTrend).toBe("Insufficient data");
  });

  test("uses elapsed calendar time for sparse-date CAGR output", () => {
    const sparseHistoryBars: PriceBar[] = [
      { date: "2023-01-01", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: "2024-01-01", open: 110, high: 111, low: 109, close: 110, volume: 1000 },
      { date: "2026-01-01", open: 121, high: 122, low: 120, close: 121, volume: 1000 },
    ];
    const analysisBars = makeBars("2025-12-20", [
      118, 119, 120, 121,
      122, 121, 120, 121,
      122, 121, 120, 121,
    ]);

    const { metrics } = computeAllMetrics(
      analysisBars,
      sparseHistoryBars,
      analysisBars,
      analysisBars,
      "QQQ",
      "ETF",
      0.03,
    );

    expect(metrics.cagr_3y).toBeCloseTo(Math.pow(121 / 100, 1 / 3) - 1, 10);
  });

  test("uses asset-kind annualization periods for stock versus crypto metrics", () => {
    const assetReturns = [
      0.02, -0.015, 0.018, -0.012, 0.017, -0.01, 0.021, -0.013, 0.016, -0.011,
      0.019, -0.014, 0.018, -0.012, 0.017, -0.01, 0.02, -0.015, 0.018, -0.012,
      0.017, -0.011, 0.019, -0.013, 0.018, -0.012, 0.017, -0.01, 0.02,
    ];
    const benchmarkReturns = assetReturns.map((value, index) => value - 0.002 + (index % 3) * 0.0005);
    const closes = [100];
    const benchmarkCloses = [100];

    for (const value of assetReturns) {
      closes.push(Number((closes[closes.length - 1] * (1 + value)).toFixed(6)));
    }
    for (const value of benchmarkReturns) {
      benchmarkCloses.push(
        Number((benchmarkCloses[benchmarkCloses.length - 1] * (1 + value)).toFixed(6)),
      );
    }

    const assetBars = makeBars("2026-01-01", closes);
    const benchmarkBars = makeBars("2026-01-01", benchmarkCloses);

    const stockMetrics = computeAllMetrics(
      assetBars,
      assetBars,
      benchmarkBars,
      benchmarkBars,
      "QQQ",
      "ETF",
      0.03,
    ).metrics;
    const cryptoMetrics = computeAllMetrics(
      assetBars,
      assetBars,
      benchmarkBars,
      benchmarkBars,
      "BTC-USD",
      "CRYPTO",
      0.03,
    ).metrics;

    expect(stockMetrics.annual_volatility).not.toBeNull();
    expect(cryptoMetrics.annual_volatility).not.toBeNull();
    expect(stockMetrics.downside_deviation).not.toBeNull();
    expect(cryptoMetrics.downside_deviation).not.toBeNull();
    expect(stockMetrics.tracking_error).not.toBeNull();
    expect(cryptoMetrics.tracking_error).not.toBeNull();

    expect(cryptoMetrics.annual_volatility!).toBeGreaterThan(stockMetrics.annual_volatility!);
    expect(cryptoMetrics.downside_deviation!).toBeGreaterThan(stockMetrics.downside_deviation!);
    expect(cryptoMetrics.tracking_error!).toBeGreaterThan(stockMetrics.tracking_error!);
    expect(cryptoMetrics.sharpe_ratio).not.toBe(stockMetrics.sharpe_ratio);
    expect(cryptoMetrics.sortino_ratio).not.toBe(stockMetrics.sortino_ratio);
  });

  test("uses the same trailing 3y window for Calmar numerator and denominator", () => {
    const priceBars = makeBars("2025-01-01", Array.from({ length: 30 }, (_, index) => 150 + index));
    const historyBars: PriceBar[] = [
      { date: "2023-01-01", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: "2024-01-01", open: 60, high: 61, low: 59, close: 60, volume: 1000 },
      { date: "2025-01-01", open: 90, high: 91, low: 89, close: 90, volume: 1000 },
      { date: "2026-01-01", open: 150, high: 151, low: 149, close: 150, volume: 1000 },
    ];

    const { metrics } = computeAllMetrics(
      priceBars,
      historyBars,
      priceBars,
      priceBars,
      "QQQ",
      "ETF",
      0.03,
    );

    const expectedCagr = Math.pow(150 / 100, 1 / 3) - 1;
    const expectedMaxDrawdown = (60 - 100) / 100;

    expect(metrics.max_drawdown).not.toBeNull();
    expect(metrics.max_drawdown!).toBeGreaterThan(expectedMaxDrawdown);
    expect(metrics.cagr_3y).toBeCloseTo(expectedCagr, 10);
    expect(metrics.calmar_ratio).toBeCloseTo(expectedCagr / Math.abs(expectedMaxDrawdown), 10);
  });
});

describe("asset analysis command", () => {
  test("supports injectable providers and surfaces partial provider failures", async () => {
    const provider: AssetAnalysisProvider = {
      fetchAnalysisInput: mock(async () => {
        const result = makeProviderResult();
        return {
          ...result,
          benchmarkBars: [],
          trackingBenchmarkBars: [],
          warnings: [
            { code: "BENCHMARK_HISTORY_UNAVAILABLE", message: "benchmark missing", source: "provider", ticker: "QQQ", field: "benchmark" } as AnalysisIssue,
          ],
          errors: [
            { code: "TRACKING_BENCHMARK_FETCH_FAILED", message: "tracking failed", source: "provider", ticker: "QQQ", field: "tracking_error_benchmark" } as AnalysisIssue,
          ],
        };
      }),
    };

    const result = await analyzeAsset(
      { ticker: "SPY", benchmark: "QQQ", asOfDate: "2026-06-05", riskFreeRate: 0.03 },
      provider,
    );

    expect(result.request.benchmark).toBe("QQQ");
    expect(result.request.risk_free_rate).toBe(0.03);
    expect(result.request.annualization_periods).toBe(252);
    expect(result.metrics.beta).toBeNull();
    expect(result.metrics.tracking_error).toBeNull();
    expect(result.warnings.some((item: AnalysisIssue) => item.code === "BENCHMARK_HISTORY_UNAVAILABLE")).toBe(true);
    expect(result.errors.some((item: AnalysisIssue) => item.code === "TRACKING_BENCHMARK_FETCH_FAILED")).toBe(true);
  });

  test("analyzeAsset keeps adapter-independent ticker support", async () => {
    const provider: AssetAnalysisProvider = {
      fetchAnalysisInput: mock(async () => makeProviderResult()),
    };
    const result = await analyzeAsset({ ticker: "btc-usd" }, provider);
    expect(result.ticker).toBe("BTC-USD");
    expect(result.request.annualization_periods).toBe(252);
  });

  test("analyzeAsset surfaces reduced alignment counts as warnings", async () => {
    const assetBars = makeBars("2026-01-01", Array.from({ length: 20 }, (_, index) => 100 + index));
    const shiftedBenchmarkBars = makeBars("2026-01-11", Array.from({ length: 20 }, (_, index) => 100 + index));
    const provider: AssetAnalysisProvider = {
      fetchAnalysisInput: mock(async () => ({
        ...makeProviderResult(),
        priceBars: assetBars,
        historyBars: assetBars,
        benchmarkBars: shiftedBenchmarkBars,
        trackingBenchmarkBars: shiftedBenchmarkBars,
      })),
    };

    const result = await analyzeAsset({ ticker: "SPY", benchmark: "QQQ", asOfDate: "2026-06-05", riskFreeRate: 0.03 }, provider);

    const benchmarkWarning = result.warnings.find((item: AnalysisIssue) => item.code === "BENCHMARK_ALIGNMENT_REDUCED");
    const trackingWarning = result.warnings.find((item: AnalysisIssue) => item.code === "TRACKING_ALIGNMENT_REDUCED");

    expect(benchmarkWarning).not.toBeUndefined();
    expect(benchmarkWarning?.message).toContain("of 19 return observations");
    expect(trackingWarning).not.toBeUndefined();
    expect(trackingWarning?.message).toContain("of 19 return observations");
  });

  test("analyzeAsset resolves crypto annualization periods from asset kind", async () => {
    const provider: AssetAnalysisProvider = {
      fetchAnalysisInput: mock(async () => ({
        ...makeProviderResult(),
        info: makeAssetInfo({
          ticker: "BTC-USD",
          type: "CRYPTO",
          quote_type: "CRYPTOCURRENCY",
          type_display: "CRYPTOCURRENCY",
        }),
      })),
    };
    const result = await analyzeAsset({ ticker: "btc-usd" }, provider);
    expect(result.request.annualization_periods).toBe(365);
  });
});

describe("asset analysis adapter parity", () => {
  test("cli success passes issue options and keeps warnings out of meta", async () => {
    const { dispatch, normalizeCommandName } = await import("../src/cli.js");
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((value: string) => {
      logs.push(value);
    }) as typeof console.log;

    await dispatch([
      "bun",
      "src/cli.ts",
      "asset-analysis",
      "--asset",
      "SPY",
      "--lookback-days",
      "90",
      "--benchmark",
      "QQQ",
      "--as-of-date",
      "2026-06-05",
      "--risk-free-rate",
      "0.03",
    ]);

    console.log = originalLog;

    expect(normalizeCommandName("asset-analysis")).toBe("asset_analysis");
    expect(mockGetAssetAnalysis).toHaveBeenCalledWith({
      ticker: undefined,
      asset: "SPY",
      period: undefined,
      lookbackDays: 90,
      benchmark: "QQQ",
      asOfDate: "2026-06-05",
      riskFreeRate: 0.03,
    });
    const output = JSON.parse(logs[0]);
    expect(output.command).toBe("asset_analysis");
    expect("warnings" in output.meta).toBe(false);
  });

  test("asset-analysis and asset_analysis dispatch through the same normalized CLI path", async () => {
    const { dispatch } = await import("../src/cli.js");
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((value: string) => {
      logs.push(value);
    }) as typeof console.log;

    await dispatch([
      "bun",
      "src/cli.ts",
      "asset-analysis",
      "--ticker",
      "SPY",
      "--benchmark",
      "QQQ",
      "--as-of-date",
      "2026-06-05",
      "--risk-free-rate",
      "0.03",
    ]);
    await dispatch([
      "bun",
      "src/cli.ts",
      "asset_analysis",
      "--ticker",
      "SPY",
      "--benchmark",
      "QQQ",
      "--as-of-date",
      "2026-06-05",
      "--risk-free-rate",
      "0.03",
    ]);

    console.log = originalLog;

    expect(mockGetAssetAnalysis).toHaveBeenCalledTimes(2);
    expect(mockGetAssetAnalysis).toHaveBeenNthCalledWith(1, {
      ticker: "SPY",
      asset: undefined,
      period: undefined,
      lookbackDays: undefined,
      benchmark: "QQQ",
      asOfDate: "2026-06-05",
      riskFreeRate: 0.03,
    });
    expect(mockGetAssetAnalysis).toHaveBeenNthCalledWith(2, {
      ticker: "SPY",
      asset: undefined,
      period: undefined,
      lookbackDays: undefined,
      benchmark: "QQQ",
      asOfDate: "2026-06-05",
      riskFreeRate: 0.03,
    });
    expect(JSON.parse(logs[0]).command).toBe("asset_analysis");
    expect(JSON.parse(logs[1]).command).toBe("asset_analysis");
  });

  test("api success passes issue options and keeps warnings out of meta", async () => {
    const { handleRequest } = await import("../src/api/server.js");
    const response = await handleRequest(
      new Request("http://localhost/asset_analysis?asset=SPY&period=6mo&benchmark=QQQ&as_of=2026-06-05&risk_free_rate=0.03"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetAssetAnalysis).toHaveBeenCalledWith({
      ticker: undefined,
      asset: "SPY",
      period: "6mo",
      lookbackDays: undefined,
      benchmark: "QQQ",
      asOfDate: "2026-06-05",
      riskFreeRate: 0.03,
    });
    expect(body.command).toBe("asset_analysis");
    expect("warnings" in body.meta).toBe(false);
  });

  test("mcp success passes issue options and keeps warnings out of meta", async () => {
    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("asset_analysis", {
      asset: "SPY",
      lookbackDays: 90,
      benchmark: "QQQ",
      asOf: "2026-06-05",
      riskFreeRate: 0.03,
    });

    expect(mockGetAssetAnalysis).toHaveBeenCalledWith({
      ticker: undefined,
      asset: "SPY",
      period: undefined,
      lookbackDays: 90,
      benchmark: "QQQ",
      asOfDate: "2026-06-05",
      riskFreeRate: 0.03,
    });
    expect(result.ok).toBe(true);
    expect(result.command).toBe("asset_analysis");
    expect("warnings" in result.meta).toBe(false);
  });

  test("missing ticker or asset returns asset_analysis validation errors across adapters", async () => {
    const { dispatch } = await import("../src/cli.js");
    const { handleRequest } = await import("../src/api/server.js");
    const { mcpRead } = await import("../src/mcp/read.js");

    const logs: string[] = [];
    const originalLog = console.log;
    const originalExit = process.exit;
    console.log = ((value: string) => {
      logs.push(value);
    }) as typeof console.log;
    process.exit = (() => undefined as never) as typeof process.exit;

    await dispatch(["bun", "src/cli.ts", "asset-analysis"]);
    const cliBody = JSON.parse(logs[0]);
    expect(cliBody.command).toBe("asset_analysis");
    expect(cliBody.error.code).toBe("VALIDATION_ERROR");

    const apiResponse = await handleRequest(new Request("http://localhost/asset_analysis"));
    const apiBody = await apiResponse.json();
    expect(apiResponse.status).toBe(400);
    expect(apiBody.command).toBe("asset_analysis");

    const mcpBody = await mcpRead("asset_analysis", {});
    expect(mcpBody.ok).toBe(false);
    if (!mcpBody.ok) {
      expect(mcpBody.command).toBe("asset_analysis");
      expect(mcpBody.error.code).toBe("VALIDATION_ERROR");
    }

    console.log = originalLog;
    process.exit = originalExit;
  });

  test("api retains asset_analysis command on thrown validation errors", async () => {
    const { handleRequest } = await import("../src/api/server.js");
    mockGetAssetAnalysis.mockImplementationOnce(async () => {
      throw new ValidationError("bad benchmark");
    });

    const response = await handleRequest(
      new Request("http://localhost/asset_analysis?ticker=SPY&benchmark=%5EINVALID"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.command).toBe("asset_analysis");
    expect(body.error.message).toContain("bad benchmark");
  });
});
