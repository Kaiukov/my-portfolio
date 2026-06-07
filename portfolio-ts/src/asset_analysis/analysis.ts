import { ValidationError, parseDate } from "../validators.js";
import { compute52WeekRange, computeAllMetrics, computePremiumDiscount } from "./metrics.js";
import { resolveAnnualizationPeriods } from "./math.js";
import {
  createYahooAssetAnalysisProvider,
  getDefaultBenchmarkTicker,
  resolveTrackingErrorBenchmark,
} from "./provider.js";
import type {
  AnalysisIssue,
  AssetAnalysisData,
  AssetAnalysisOptions,
  AssetAnalysisPeriod,
  AssetAnalysisProvider,
  ResolvedAssetAnalysisRequest,
} from "./types.js";

const DEFAULT_RISK_FREE_RATE = 0.0425;
const MAX_LOOKBACK_DAYS = 3650;
const FIVE_YEAR_DAYS = 365 * 5 + 14;
const MIN_ALIGNMENT_RETAINED_RATIO = 0.6;

const PERIOD_LOOKBACK_DAYS: Record<Exclude<AssetAnalysisPeriod, "ytd">, number> = {
  "1mo": 31,
  "3mo": 92,
  "6mo": 183,
  "1y": 366,
  "2y": 366 * 2,
  "3y": 366 * 3,
  "5y": 366 * 5,
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function subtractDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() - days);
  return next;
}

function buildIssue(
  code: string,
  message: string,
  field?: string,
): AnalysisIssue {
  return { code, message, source: "metrics", field };
}

function calculateElapsedHistoryYears(priceBars: Array<{ date: string }>): number | null {
  if (priceBars.length < 2) return null;
  const start = new Date(`${priceBars[0].date}T00:00:00.000Z`);
  const end = new Date(`${priceBars[priceBars.length - 1].date}T00:00:00.000Z`);
  const elapsedMs = end.getTime() - start.getTime();
  return elapsedMs > 0 ? elapsedMs / 86400000 / 365.2425 : null;
}

function resolvePeriodLookback(period: AssetAnalysisPeriod, endDate: Date): number {
  if (period === "ytd") {
    const startOfYear = new Date(Date.UTC(endDate.getUTCFullYear(), 0, 1));
    return Math.max(
      1,
      Math.round((endDate.getTime() - startOfYear.getTime()) / 86400000) + 1,
    );
  }
  return PERIOD_LOOKBACK_DAYS[period];
}

export function normalizeAssetAnalysisOptions(
  options: AssetAnalysisOptions,
): ResolvedAssetAnalysisRequest {
  const ticker = (options.ticker ?? options.asset ?? "").trim().toUpperCase();
  if (!ticker) {
    throw new ValidationError("ticker or asset is required");
  }

  const now = new Date();
  const asOfDate = options.asOfDate
    ? parseDate(options.asOfDate, "--as-of-date")
    : isoDate(now);
  const endDate = startOfUtcDay(asOfDate);

  const period = options.period ?? null;
  if (period !== null && !(period in PERIOD_LOOKBACK_DAYS) && period !== "ytd") {
    throw new ValidationError(
      `--period must be one of 1mo, 3mo, 6mo, ytd, 1y, 2y, 3y, 5y`,
    );
  }

  const rawLookback = options.lookbackDays ?? (period ? resolvePeriodLookback(period, endDate) : 366);
  if (!Number.isInteger(rawLookback) || rawLookback <= 0) {
    throw new ValidationError("--lookback-days must be a positive integer");
  }
  if (rawLookback > MAX_LOOKBACK_DAYS) {
    throw new ValidationError(`--lookback-days must be <= ${MAX_LOOKBACK_DAYS}`);
  }

  const benchmark = (options.benchmark ?? getDefaultBenchmarkTicker()).trim().toUpperCase();
  if (!benchmark) {
    throw new ValidationError("--benchmark cannot be empty");
  }

  const riskFreeRate = options.riskFreeRate ?? DEFAULT_RISK_FREE_RATE;
  if (!Number.isFinite(riskFreeRate)) {
    throw new ValidationError("--risk-free-rate must be a finite number");
  }

  return {
    ticker,
    period,
    lookback_days: rawLookback,
    benchmark,
    tracking_error_benchmark: resolveTrackingErrorBenchmark(ticker, options.benchmark),
    as_of_date: asOfDate,
    risk_free_rate: riskFreeRate,
    annualization_periods: 252,
  };
}

function dedupeIssues(issues: AnalysisIssue[]): AnalysisIssue[] {
  const seen = new Set<string>();
  return issues.filter((item) => {
    const key = [item.code, item.message, item.field, item.ticker, item.source].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function analyzeAsset(
  options: AssetAnalysisOptions,
  provider: AssetAnalysisProvider = createYahooAssetAnalysisProvider(),
): Promise<AssetAnalysisData> {
  const normalizedRequest = normalizeAssetAnalysisOptions(options);
  const asOfDate = startOfUtcDay(normalizedRequest.as_of_date);
  const analysisStartDate = subtractDays(asOfDate, normalizedRequest.lookback_days);
  const historyStartDate = subtractDays(
    asOfDate,
    Math.max(normalizedRequest.lookback_days, FIVE_YEAR_DAYS),
  );

  const fetched = await provider.fetchAnalysisInput({
    ticker: normalizedRequest.ticker,
    benchmark: normalizedRequest.benchmark,
    trackingBenchmark: normalizedRequest.tracking_error_benchmark,
    analysisStartDate,
    historyStartDate,
    asOfDate,
  });
  const request = {
    ...normalizedRequest,
    annualization_periods: resolveAnnualizationPeriods(fetched.info.type),
  };

  const warnings: AnalysisIssue[] = [...fetched.warnings];
  const errors: AnalysisIssue[] = [...fetched.errors];

  if (fetched.priceBars.length < 2) {
    throw new Error(`Insufficient price history returned for ${request.ticker}`);
  }
  if (fetched.priceBars.length < 50) {
    warnings.push(
      buildIssue(
        "INSUFFICIENT_LOOKBACK_HISTORY",
        `Only ${fetched.priceBars.length} bars are available for ${request.ticker}; beta, capture ratios, and tracking error may be null.`,
        "price_bars",
      ),
    );
  }
  const historyElapsedYears = calculateElapsedHistoryYears(fetched.historyBars);
  if (historyElapsedYears === null || historyElapsedYears < 1) {
    warnings.push(
      buildIssue(
        "INSUFFICIENT_LONG_HISTORY",
        `Extended history for ${request.ticker} is shorter than one calendar year; CAGR metrics may be null.`,
        "five_year_bars",
      ),
    );
  }

  const { metrics, technicals, alignment } = computeAllMetrics(
    fetched.priceBars,
    fetched.historyBars,
    fetched.benchmarkBars,
    fetched.trackingBenchmarkBars,
    request.tracking_error_benchmark,
    fetched.info.type,
    request.risk_free_rate,
  );

  if (fetched.benchmarkBars.length < 2) {
    warnings.push(
      buildIssue(
        "BENCHMARK_METRICS_UNAVAILABLE",
        `Benchmark-relative metrics are unavailable because ${request.benchmark} did not return enough data.`,
        "benchmark",
      ),
    );
  } else if (alignment.benchmark.retainedRatio < MIN_ALIGNMENT_RETAINED_RATIO) {
    warnings.push(
      buildIssue(
        "BENCHMARK_ALIGNMENT_REDUCED",
        `${request.benchmark} alignment retained ${alignment.benchmark.alignedCount} of ${alignment.benchmark.assetReturnCount} return observations (${(alignment.benchmark.retainedRatio * 100).toFixed(1)}%); benchmark-relative metrics may be less representative.`,
        "benchmark",
      ),
    );
  }
  if (fetched.trackingBenchmarkBars.length < 2) {
    warnings.push(
      buildIssue(
        "TRACKING_ERROR_UNAVAILABLE",
        `Tracking error is unavailable because ${request.tracking_error_benchmark} did not return enough data.`,
        "tracking_error_benchmark",
      ),
    );
  } else if (alignment.tracking.retainedRatio < MIN_ALIGNMENT_RETAINED_RATIO) {
    warnings.push(
      buildIssue(
        "TRACKING_ALIGNMENT_REDUCED",
        `${request.tracking_error_benchmark} alignment retained ${alignment.tracking.alignedCount} of ${alignment.tracking.assetReturnCount} return observations (${(alignment.tracking.retainedRatio * 100).toFixed(1)}%); tracking error may be less representative.`,
        "tracking_error_benchmark",
      ),
    );
  }

  const currentPrice = fetched.info.current_price ?? fetched.priceBars[fetched.priceBars.length - 1]?.close ?? null;
  if (currentPrice !== null) {
    metrics.premium_discount = computePremiumDiscount(currentPrice, fetched.info.nav_price);
    const range = compute52WeekRange(
      currentPrice,
      fetched.info.fifty_two_week_high,
      fetched.info.fifty_two_week_low,
    );
    metrics.fifty_two_week_range_percent = range.rangePercent;
    metrics.fifty_two_week_percent_from_high = range.fromHigh;
  }

  return {
    request,
    ticker: request.ticker,
    type: fetched.info.type,
    info: fetched.info,
    price_bars: fetched.priceBars,
    five_year_bars: fetched.historyBars,
    metrics,
    technicals,
    warnings: dedupeIssues(warnings),
    errors: dedupeIssues(errors),
  };
}
