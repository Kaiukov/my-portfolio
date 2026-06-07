import type { PriceBar, RiskMetrics, TechnicalIndicators } from "./types.js";
import {
  alignReturnSeriesByDate,
  calculate52WeekRange,
  calculateAnnualVolatility,
  calculateBeta,
  calculateCagrFromBars,
  calculateCalmarRatio,
  calculateDownsideDeviation,
  calculateKurtosis,
  calculateMacd,
  calculateMaxDrawdown,
  calculateMovingAverages,
  calculatePremiumDiscount,
  calculateRsi,
  calculateSharpeRatio,
  calculateSkewness,
  calculateSortinoRatio,
  calculateStochastic,
  calculateStochRsi,
  calculateTrackingError,
  calculateUlcerIndex,
  calculateUpDownCapture,
  calculateWilliamsR,
  interpretRsi,
  priceReturns,
  resolveAnnualizationPeriods,
  selectTrailingBarsWindow,
} from "./math.js";
import type { AssetType } from "./types.js";

type AlignedSeriesSummary = {
  assetReturnCount: number;
  alignedCount: number;
  retainedRatio: number;
};

function summarizeAlignment(
  assetBars: PriceBar[],
  aligned: { assetReturns: number[]; benchmarkReturns: number[]; dates: string[] },
): AlignedSeriesSummary {
  const assetReturnCount = Math.max(0, assetBars.length - 1);
  const alignedCount = aligned.assetReturns.length;
  return {
    assetReturnCount,
    alignedCount,
    retainedRatio: assetReturnCount > 0 ? alignedCount / assetReturnCount : 0,
  };
}

export function computeAllMetrics(
  priceBars: PriceBar[],
  historyBars: PriceBar[],
  benchmarkBars: PriceBar[],
  trackingBenchmarkBars: PriceBar[],
  trackingBenchmarkTicker: string,
  assetType: AssetType,
  riskFreeRate: number,
): {
  metrics: RiskMetrics;
  technicals: TechnicalIndicators;
  alignment: {
    benchmark: AlignedSeriesSummary;
    tracking: AlignedSeriesSummary;
  };
} {
  const closes = priceBars.map((bar) => bar.close);
  const highs = priceBars.map((bar) => bar.high);
  const lows = priceBars.map((bar) => bar.low);
  const dailyReturns = priceReturns(closes);
  const benchmarkAligned = alignReturnSeriesByDate(priceBars, benchmarkBars);
  const trackingAligned = alignReturnSeriesByDate(priceBars, trackingBenchmarkBars);
  const annualizationPeriods = resolveAnnualizationPeriods(assetType);
  const calmarWindowBars = selectTrailingBarsWindow(historyBars, 3);

  const metrics: RiskMetrics = {
    beta: null,
    annual_volatility: calculateAnnualVolatility(dailyReturns, annualizationPeriods),
    sharpe_ratio: calculateSharpeRatio(dailyReturns, riskFreeRate, annualizationPeriods),
    sortino_ratio: calculateSortinoRatio(dailyReturns, riskFreeRate, annualizationPeriods),
    downside_deviation: calculateDownsideDeviation(
      dailyReturns,
      riskFreeRate,
      annualizationPeriods,
    ),
    max_drawdown: null,
    max_drawdown_date: null,
    cagr_1y: calculateCagrFromBars(historyBars, 1),
    cagr_3y: calculateCagrFromBars(historyBars, 3),
    cagr_5y: calculateCagrFromBars(historyBars, 5),
    calmar_ratio: null,
    ulcer_index: calculateUlcerIndex(closes),
    skewness: calculateSkewness(dailyReturns),
    kurtosis: calculateKurtosis(dailyReturns),
    up_capture: null,
    down_capture: null,
    up_capture_ratio: null,
    down_capture_ratio: null,
    tracking_error: null,
    tracking_error_benchmark: trackingBenchmarkTicker,
    premium_discount: null,
    fifty_two_week_range_percent: null,
    fifty_two_week_percent_from_high: null,
  };

  if (benchmarkAligned.assetReturns.length >= 10) {
    metrics.beta = calculateBeta(
      benchmarkAligned.assetReturns,
      benchmarkAligned.benchmarkReturns,
    );
    const capture = calculateUpDownCapture(
      benchmarkAligned.assetReturns,
      benchmarkAligned.benchmarkReturns,
    );
    metrics.up_capture = capture.upCapture;
    metrics.down_capture = capture.downCapture;
    metrics.up_capture_ratio = capture.upCaptureRatio;
    metrics.down_capture_ratio = capture.downCaptureRatio;
  }

  if (trackingAligned.assetReturns.length >= 10) {
    metrics.tracking_error = calculateTrackingError(
      trackingAligned.assetReturns,
      trackingAligned.benchmarkReturns,
      annualizationPeriods,
    );
  }

  const drawdown = calculateMaxDrawdown(closes);
  metrics.max_drawdown = drawdown.maxDd;
  if (drawdown.maxDdDateIdx !== null && priceBars[drawdown.maxDdDateIdx]) {
    metrics.max_drawdown_date = priceBars[drawdown.maxDdDateIdx].date;
  }

  if (calmarWindowBars) {
    const calmarDrawdown = calculateMaxDrawdown(calmarWindowBars.map((bar) => bar.close));
    metrics.calmar_ratio = calculateCalmarRatio(metrics.cagr_3y, calmarDrawdown.maxDd);
  }

  const rsi = calculateRsi(closes);
  const movingAverages = calculateMovingAverages(closes);
  const macd = calculateMacd(closes);
  const williams = calculateWilliamsR(highs, lows, closes, [14, 2]);
  const stochastic = calculateStochastic(highs, lows, closes);
  const stochRsi = calculateStochRsi(closes);

  const technicals: TechnicalIndicators = {
    rsi,
    rsi_signal: interpretRsi(rsi),
    ma50: movingAverages.ma50,
    ma200: movingAverages.ma200,
    price_vs_ma50: movingAverages.priceVsMa50,
    price_vs_ma200: movingAverages.priceVsMa200,
    ma50_vs_ma200: movingAverages.ma50VsMa200,
    ma_trend: movingAverages.maTrend,
    macd: macd.macd,
    macd_signal: macd.macdSignal,
    macd_histogram: macd.macdHistogram,
    macd_trend: macd.macdTrend,
    williams_r_14: williams["williams_r_14"] as number | null,
    williams_r_14_signal: williams["williams_r_14_signal"] as string | null,
    williams_r_2: williams["williams_r_2"] as number | null,
    williams_r_2_signal: williams["williams_r_2_signal"] as string | null,
    stoch_k: stochastic.stochK,
    stoch_d: stochastic.stochD,
    stoch_signal: stochastic.stochSignal,
    stochrsi_k: stochRsi.stochrsiK,
    stochrsi_d: stochRsi.stochrsiD,
    stochrsi_signal: stochRsi.stochrsiSignal,
  };

  return {
    metrics,
    technicals,
    alignment: {
      benchmark: summarizeAlignment(priceBars, benchmarkAligned),
      tracking: summarizeAlignment(priceBars, trackingAligned),
    },
  };
}

export function computePremiumDiscount(
  currentPrice: number,
  navPrice: number | null,
): number | null {
  return calculatePremiumDiscount(currentPrice, navPrice);
}

export function compute52WeekRange(
  currentPrice: number,
  high52: number | null,
  low52: number | null,
): { rangePercent: number | null; fromHigh: number | null } {
  return calculate52WeekRange(currentPrice, high52, low52);
}
