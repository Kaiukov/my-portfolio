import type { AssetType, PriceBar } from "./types.js";

const TRADING_DAYS = 252;
const CRYPTO_DAYS = 365;
const DEFAULT_RISK_FREE_RATE = 0.0425;
const EPSILON = 1e-10;

function clean(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

function mean(values: number[]): number {
  const valid = clean(values);
  if (valid.length === 0) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function variance(values: number[], useSample = true): number {
  const valid = clean(values);
  if (valid.length < 2) return 0;
  const avg = mean(valid);
  const divisor = useSample ? valid.length - 1 : valid.length;
  return valid.reduce((sum, value) => sum + (value - avg) ** 2, 0) / divisor;
}

function std(values: number[], useSample = true): number {
  return Math.sqrt(variance(values, useSample));
}

function parseBarDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function subtractCalendarYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() - years);
  return next;
}

function elapsedCalendarYears(startDate: string, endDate: string): number | null {
  const start = parseBarDate(startDate);
  const end = parseBarDate(endDate);
  if (end.getTime() <= start.getTime()) return null;

  let wholeYears = end.getUTCFullYear() - start.getUTCFullYear();
  const anniversary = new Date(start);
  anniversary.setUTCFullYear(start.getUTCFullYear() + wholeYears);
  if (anniversary.getTime() > end.getTime()) {
    wholeYears -= 1;
    anniversary.setUTCFullYear(start.getUTCFullYear() + wholeYears);
  }

  const nextAnniversary = new Date(anniversary);
  nextAnniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
  const yearSpan = nextAnniversary.getTime() - anniversary.getTime();
  if (yearSpan <= 0) return wholeYears;
  return wholeYears + (end.getTime() - anniversary.getTime()) / yearSpan;
}

export function resolveAnnualizationPeriods(assetType: AssetType): number {
  return assetType === "CRYPTO" ? CRYPTO_DAYS : TRADING_DAYS;
}

export function selectTrailingBarsWindow(
  bars: PriceBar[],
  years: number,
): PriceBar[] | null {
  if (bars.length < 2) return null;
  const endDate = parseBarDate(bars[bars.length - 1].date);
  const targetStart = subtractCalendarYears(endDate, years);
  let startIndex = -1;

  for (let index = 0; index < bars.length - 1; index++) {
    const barDate = parseBarDate(bars[index].date);
    if (barDate.getTime() <= targetStart.getTime()) {
      startIndex = index;
      continue;
    }
    break;
  }

  return startIndex >= 0 ? bars.slice(startIndex) : null;
}

function covariance(xs: number[], ys: number[]): number {
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < xs.length && index < ys.length; index++) {
    if (Number.isFinite(xs[index]) && Number.isFinite(ys[index])) {
      pairs.push([xs[index], ys[index]]);
    }
  }
  if (pairs.length < 2) return 0;
  const xMean = mean(pairs.map(([value]) => value));
  const yMean = mean(pairs.map(([, value]) => value));
  return pairs.reduce((sum, [x, y]) => sum + (x - xMean) * (y - yMean), 0) / (pairs.length - 1);
}

function ema(values: number[], span: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  const alpha = 2 / (span + 1);
  let seeded = false;
  let previous = 0;

  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    if (!seeded) {
      previous = value;
      seeded = true;
    } else {
      previous = previous + alpha * (value - previous);
    }
    result[index] = previous;
  }

  return result;
}

function sma(values: number[], window: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  if (values.length < window) return result;
  let rolling = 0;
  for (let index = 0; index < window; index++) rolling += values[index];
  result[window - 1] = rolling / window;
  for (let index = window; index < values.length; index++) {
    rolling += values[index] - values[index - window];
    result[index] = rolling / window;
  }
  return result;
}

function wildersSmoothing(values: number[], period: number): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return result;

  let seed = 0;
  for (let index = 0; index < period; index++) seed += values[index];
  let previous = seed / period;
  result[period - 1] = previous;

  for (let index = period; index < values.length; index++) {
    previous = previous + (values[index] - previous) / period;
    result[index] = previous;
  }

  return result;
}

export function priceReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < prices.length; index++) {
    const previous = prices[index - 1];
    if (!Number.isFinite(previous) || previous <= 0) {
      returns.push(NaN);
      continue;
    }
    returns.push(prices[index] / previous - 1);
  }
  return returns;
}

export function priceReturnsByDate(
  bars: PriceBar[],
): Array<{ date: string; value: number }> {
  const returns: Array<{ date: string; value: number }> = [];
  for (let index = 1; index < bars.length; index++) {
    const previous = bars[index - 1].close;
    if (!Number.isFinite(previous) || previous <= 0) continue;
    returns.push({
      date: bars[index].date,
      value: bars[index].close / previous - 1,
    });
  }
  return returns;
}

export function alignReturnSeriesByDate(
  assetBars: PriceBar[],
  benchmarkBars: PriceBar[],
): { assetReturns: number[]; benchmarkReturns: number[]; dates: string[] } {
  const assetReturns = priceReturnsByDate(assetBars);
  const benchmarkReturnMap = new Map(
    priceReturnsByDate(benchmarkBars).map((entry) => [entry.date, entry.value]),
  );

  const alignedAsset: number[] = [];
  const alignedBenchmark: number[] = [];
  const dates: string[] = [];
  for (const entry of assetReturns) {
    const benchmarkValue = benchmarkReturnMap.get(entry.date);
    if (!Number.isFinite(entry.value) || !Number.isFinite(benchmarkValue)) continue;
    alignedAsset.push(entry.value);
    alignedBenchmark.push(benchmarkValue as number);
    dates.push(entry.date);
  }

  return { assetReturns: alignedAsset, benchmarkReturns: alignedBenchmark, dates };
}

export function calculateBeta(
  returns: number[],
  benchmarkReturns: number[],
): number | null {
  if (returns.length < 10 || benchmarkReturns.length < 10) return null;
  const benchmarkVariance = variance(benchmarkReturns, true);
  if (Math.abs(benchmarkVariance) < EPSILON) return null;
  return covariance(returns, benchmarkReturns) / benchmarkVariance;
}

export function calculateAnnualVolatility(
  returns: number[],
  annualizationPeriods = TRADING_DAYS,
): number | null {
  const valid = clean(returns);
  if (valid.length < 2) return null;
  return std(valid, true) * Math.sqrt(annualizationPeriods);
}

export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate = DEFAULT_RISK_FREE_RATE,
  annualizationPeriods = TRADING_DAYS,
): number | null {
  const valid = clean(returns);
  if (valid.length < 2) return null;
  const totalReturn = valid.reduce((product, value) => product * (1 + value), 1) - 1;
  const years = valid.length / annualizationPeriods;
  if (Math.abs(years) < EPSILON) return null;
  const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1;
  const annualizedVolatility = std(valid, true) * Math.sqrt(annualizationPeriods);
  if (Math.abs(annualizedVolatility) < EPSILON) return null;
  return (annualizedReturn - riskFreeRate) / annualizedVolatility;
}

export function calculateDownsideDeviation(
  returns: number[],
  riskFreeRate = DEFAULT_RISK_FREE_RATE,
  annualizationPeriods = TRADING_DAYS,
): number | null {
  const valid = clean(returns);
  if (valid.length < 2) return null;
  const dailyRiskFree = Math.pow(1 + riskFreeRate, 1 / annualizationPeriods) - 1;
  const downside = valid.map((value) => value - dailyRiskFree).filter((value) => value < 0);
  if (downside.length === 0) return 0;
  return Math.sqrt(downside.reduce((sum, value) => sum + value ** 2, 0) / downside.length) *
    Math.sqrt(annualizationPeriods);
}

export function calculateSortinoRatio(
  returns: number[],
  riskFreeRate = DEFAULT_RISK_FREE_RATE,
  annualizationPeriods = TRADING_DAYS,
): number | null {
  const valid = clean(returns);
  if (valid.length < 2) return null;
  const totalReturn = valid.reduce((product, value) => product * (1 + value), 1) - 1;
  const years = valid.length / annualizationPeriods;
  if (Math.abs(years) < EPSILON) return null;
  const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1;
  const downsideDeviation = calculateDownsideDeviation(
    valid,
    riskFreeRate,
    annualizationPeriods,
  );
  if (downsideDeviation === null || Math.abs(downsideDeviation) < EPSILON) return null;
  return (annualizedReturn - riskFreeRate) / downsideDeviation;
}

export function calculateMaxDrawdown(prices: number[]): {
  maxDd: number | null;
  maxDdDateIdx: number | null;
} {
  if (prices.length < 2) return { maxDd: null, maxDdDateIdx: null };
  let peak = prices[0];
  let maxDrawdown = 0;
  let maxDrawdownIndex: number | null = null;

  for (let index = 0; index < prices.length; index++) {
    const price = prices[index];
    if (price > peak) peak = price;
    const drawdown = (price - peak) / peak;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownIndex = index;
    }
  }

  return { maxDd: maxDrawdown, maxDdDateIdx: maxDrawdownIndex };
}

export function calculateCagr(
  prices: number[],
  years: number,
): number | null {
  if (prices.length < 2) return null;
  const window = Math.min(Math.floor(TRADING_DAYS * years), prices.length - 1);
  if (window < 1) return null;
  const start = prices[prices.length - 1 - window];
  const end = prices[prices.length - 1];
  if (start <= 0) return null;
  const actualYears = window / TRADING_DAYS;
  if (Math.abs(actualYears) < EPSILON) return null;
  return Math.pow(end / start, 1 / actualYears) - 1;
}

export function calculateCagrFromBars(
  bars: PriceBar[],
  years: number,
): number | null {
  const windowBars = selectTrailingBarsWindow(bars, years);
  if (!windowBars || windowBars.length < 2) return null;
  const start = windowBars[0].close;
  const end = windowBars[windowBars.length - 1].close;
  if (start <= 0 || end <= 0) return null;
  const actualYears = elapsedCalendarYears(
    windowBars[0].date,
    windowBars[windowBars.length - 1].date,
  );
  if (actualYears === null || Math.abs(actualYears) < EPSILON) return null;
  return Math.pow(end / start, 1 / actualYears) - 1;
}

export function calculateCalmarRatio(
  cagr: number | null,
  maxDrawdown: number | null,
): number | null {
  if (cagr === null || maxDrawdown === null) return null;
  if (Math.abs(maxDrawdown) < EPSILON) return null;
  return cagr / Math.abs(maxDrawdown);
}

export function calculateUlcerIndex(prices: number[]): number | null {
  if (prices.length < 2) return null;
  let peak = prices[0];
  let sumSquares = 0;
  for (const price of prices) {
    if (price > peak) peak = price;
    const drawdownPercent = ((price - peak) / peak) * 100;
    sumSquares += drawdownPercent ** 2;
  }
  return Math.sqrt(sumSquares / prices.length);
}

export function calculateSkewness(returns: number[]): number | null {
  const valid = clean(returns);
  if (valid.length < 3) return null;
  const avg = mean(valid);
  const deviation = std(valid, false);
  if (Math.abs(deviation) < EPSILON) return null;
  const n = valid.length;
  const sum = valid.reduce((acc, value) => acc + ((value - avg) / deviation) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * sum;
}

export function calculateKurtosis(returns: number[]): number | null {
  const valid = clean(returns);
  if (valid.length < 4) return null;
  const avg = mean(valid);
  const deviation = std(valid, false);
  if (Math.abs(deviation) < EPSILON) return null;
  const n = valid.length;
  const sum = valid.reduce((acc, value) => acc + ((value - avg) / deviation) ** 4, 0);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum -
    ((3 * (n - 1) ** 2) / ((n - 2) * (n - 3)));
}

export function calculateRsi(
  closes: number[],
  period = 14,
): number | null {
  if (closes.length < period + 1) return null;
  const gains = new Array<number>(closes.length - 1).fill(0);
  const losses = new Array<number>(closes.length - 1).fill(0);

  for (let index = 1; index < closes.length; index++) {
    const change = closes[index] - closes[index - 1];
    if (change > 0) gains[index - 1] = change;
    else losses[index - 1] = -change;
  }

  const avgGains = wildersSmoothing(gains, period);
  const avgLosses = wildersSmoothing(losses, period);
  const latestGain = avgGains[avgGains.length - 1];
  const latestLoss = avgLosses[avgLosses.length - 1];
  if (!Number.isFinite(latestGain) || !Number.isFinite(latestLoss)) return null;
  if (Math.abs(latestLoss) < EPSILON) return 100;
  const rs = latestGain / latestLoss;
  return 100 - 100 / (1 + rs);
}

export function interpretRsi(rsi: number | null): string | null {
  if (rsi === null) return null;
  if (rsi >= 70) return "Overbought";
  if (rsi <= 30) return "Oversold";
  if (rsi >= 55) return "Bullish";
  if (rsi <= 45) return "Bearish";
  return "Neutral";
}

export function calculateMovingAverages(closes: number[]): {
  ma50: number | null;
  ma200: number | null;
  priceVsMa50: number | null;
  priceVsMa200: number | null;
  ma50VsMa200: number | null;
  maTrend: string | null;
} {
  if (closes.length < 200) {
    return {
      ma50: null,
      ma200: null,
      priceVsMa50: null,
      priceVsMa200: null,
      ma50VsMa200: null,
      maTrend: "Insufficient data",
    };
  }

  const currentPrice = closes[closes.length - 1];
  const ma50 = mean(closes.slice(-50));
  const ma200 = mean(closes.slice(-200));
  const priceVsMa50 = ma50 !== 0 ? ((currentPrice - ma50) / ma50) * 100 : null;
  const priceVsMa200 = ma200 !== 0 ? ((currentPrice - ma200) / ma200) * 100 : null;
  const ma50VsMa200 = ma200 !== 0 ? ((ma50 - ma200) / ma200) * 100 : null;

  return {
    ma50,
    ma200,
    priceVsMa50,
    priceVsMa200,
    ma50VsMa200,
    maTrend: ma50 > ma200 ? "Golden Cross (Bullish)" : "Death Cross (Bearish)",
  };
}

export function calculateMacd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): {
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  macdTrend: string | null;
} {
  if (closes.length < slow + signalPeriod) {
    return {
      macd: null,
      macdSignal: null,
      macdHistogram: null,
      macdTrend: "Insufficient data",
    };
  }

  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = closes.map((_, index) => fastEma[index] - slowEma[index]);
  const signalLine = ema(macdLine, signalPeriod);
  const lastIndex = closes.length - 1;
  const macd = Number.isFinite(macdLine[lastIndex]) ? macdLine[lastIndex] : null;
  const macdSignal = Number.isFinite(signalLine[lastIndex]) ? signalLine[lastIndex] : null;
  const macdHistogram = macd !== null && macdSignal !== null ? macd - macdSignal : null;

  let macdTrend: string | null = "N/A";
  if (macd !== null && macdSignal !== null) {
    if (macd > macdSignal && macd > 0) macdTrend = "Strong Bullish";
    else if (macd > macdSignal && macd < 0) macdTrend = "Bullish Reversal";
    else if (macd < macdSignal && macd > 0) macdTrend = "Bearish Reversal";
    else macdTrend = "Strong Bearish";
  }

  return { macd, macdSignal, macdHistogram, macdTrend };
}

export function calculateWilliamsR(
  highs: number[],
  lows: number[],
  closes: number[],
  periods: number[] = [14, 2],
): Record<string, number | string | null> {
  const result: Record<string, number | string | null> = {};

  for (const period of periods) {
    if (closes.length < period) {
      result[`williams_r_${period}`] = null;
      result[`williams_r_${period}_signal`] = "Insufficient data";
      continue;
    }

    const values: number[] = [];
    for (let index = period - 1; index < closes.length; index++) {
      const highest = Math.max(...highs.slice(index - period + 1, index + 1));
      const lowest = Math.min(...lows.slice(index - period + 1, index + 1));
      const range = highest - lowest;
      values.push(Math.abs(range) < EPSILON ? NaN : ((highest - closes[index]) / range) * -100);
    }

    const latest = values.length > 0 && Number.isFinite(values[values.length - 1])
      ? values[values.length - 1]
      : null;
    result[`williams_r_${period}`] = latest;
    if (latest === null) result[`williams_r_${period}_signal`] = "N/A";
    else if (latest >= -20) result[`williams_r_${period}_signal`] = "Overbought";
    else if (latest <= -80) result[`williams_r_${period}_signal`] = "Oversold";
    else result[`williams_r_${period}_signal`] = "Neutral";
  }

  result["williams_r"] = result["williams_r_14"];
  result["williams_r_signal"] = result["williams_r_14_signal"];
  return result;
}

export function calculateStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  kSmooth = 3,
  dPeriod = 3,
): {
  stochK: number | null;
  stochD: number | null;
  stochSignal: string | null;
} {
  if (closes.length < kPeriod + kSmooth) {
    return { stochK: null, stochD: null, stochSignal: "Insufficient data" };
  }

  const fastK: number[] = [];
  for (let index = kPeriod - 1; index < closes.length; index++) {
    const highest = Math.max(...highs.slice(index - kPeriod + 1, index + 1));
    const lowest = Math.min(...lows.slice(index - kPeriod + 1, index + 1));
    const range = highest - lowest;
    fastK.push(Math.abs(range) < EPSILON ? 50 : 100 * (closes[index] - lowest) / range);
  }

  const slowK = sma(fastK, kSmooth);
  const dLine = sma(slowK.map((value) => Number.isFinite(value) ? value : 50), dPeriod);
  const latestK = Number.isFinite(slowK[slowK.length - 1]) ? slowK[slowK.length - 1] : null;
  const latestD = Number.isFinite(dLine[dLine.length - 1]) ? dLine[dLine.length - 1] : null;

  let stochSignal: string | null = "N/A";
  if (latestK !== null && latestD !== null) {
    if (latestK >= 80) stochSignal = "Overbought";
    else if (latestK <= 20) stochSignal = "Oversold";
    else if (latestK > latestD) stochSignal = "Bullish crossover";
    else if (latestK < latestD) stochSignal = "Bearish crossover";
    else stochSignal = "Neutral";
  }

  return {
    stochK: latestK,
    stochD: latestD,
    stochSignal: latestK !== null ? stochSignal : "Insufficient data",
  };
}

export function calculateStochRsi(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): {
  stochrsiK: number | null;
  stochrsiD: number | null;
  stochrsiSignal: string | null;
} {
  if (closes.length < rsiPeriod + stochPeriod) {
    return { stochrsiK: null, stochrsiD: null, stochrsiSignal: "Insufficient data" };
  }

  const gains: number[] = [];
  const losses: number[] = [];
  for (let index = 1; index < closes.length; index++) {
    const change = closes[index] - closes[index - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  const avgGains = sma(gains, rsiPeriod);
  const avgLosses = sma(losses, rsiPeriod);
  const rsiValues: number[] = [];

  for (let index = rsiPeriod - 1; index < avgGains.length; index++) {
    const avgGain = avgGains[index];
    const avgLoss = avgLosses[index];
    if (!Number.isFinite(avgGain) || !Number.isFinite(avgLoss)) {
      rsiValues.push(NaN);
      continue;
    }
    if (Math.abs(avgLoss) < EPSILON) {
      rsiValues.push(100);
      continue;
    }
    rsiValues.push(100 - 100 / (1 + avgGain / avgLoss));
  }

  const stochRsiValues: number[] = [];
  for (let index = stochPeriod - 1; index < rsiValues.length; index++) {
    const window = rsiValues.slice(index - stochPeriod + 1, index + 1).filter((value) => Number.isFinite(value));
    if (window.length < 2 || !Number.isFinite(rsiValues[index])) {
      stochRsiValues.push(NaN);
      continue;
    }
    const highest = Math.max(...window);
    const lowest = Math.min(...window);
    const range = highest - lowest;
    stochRsiValues.push(Math.abs(range) < EPSILON ? 50 : ((rsiValues[index] - lowest) / range) * 100);
  }

  const kLine = sma(stochRsiValues.map((value) => Number.isFinite(value) ? value : 50), kSmooth);
  const dLine = sma(kLine.map((value) => Number.isFinite(value) ? value : 50), dSmooth);
  const latestK = Number.isFinite(kLine[kLine.length - 1]) ? kLine[kLine.length - 1] : null;
  const latestD = Number.isFinite(dLine[dLine.length - 1]) ? dLine[dLine.length - 1] : null;

  let stochrsiSignal: string | null = "N/A";
  if (latestK !== null && latestD !== null) {
    if (latestK >= 80) stochrsiSignal = "Overbought";
    else if (latestK <= 20) stochrsiSignal = "Oversold";
    else if (latestK > latestD) stochrsiSignal = "Bullish crossover";
    else if (latestK < latestD) stochrsiSignal = "Bearish crossover";
    else stochrsiSignal = "Neutral";
  }

  return {
    stochrsiK: latestK,
    stochrsiD: latestD,
    stochrsiSignal: latestK !== null ? stochrsiSignal : "Insufficient data",
  };
}

function interpretCaptureRatio(value: number | null, direction: "up" | "down"): string | null {
  if (value === null) return null;
  if (direction === "up") {
    if (value >= 100) return "Outperforms";
    if (value >= 80) return "Good";
    if (value >= 50) return "Weak";
    return "Poor";
  }
  if (value <= 80) return "Protects";
  if (value <= 100) return "Average";
  if (value <= 120) return "Weak";
  return "Poor";
}

export function calculateUpDownCapture(
  returns: number[],
  benchmarkReturns: number[],
): {
  upCapture: number | null;
  downCapture: number | null;
  upCaptureRatio: string | null;
  downCaptureRatio: string | null;
} {
  if (returns.length < 10 || benchmarkReturns.length < 10) {
    return {
      upCapture: null,
      downCapture: null,
      upCaptureRatio: null,
      downCaptureRatio: null,
    };
  }

  const upAsset: number[] = [];
  const upBenchmark: number[] = [];
  const downAsset: number[] = [];
  const downBenchmark: number[] = [];

  for (let index = 0; index < returns.length && index < benchmarkReturns.length; index++) {
    const assetReturn = returns[index];
    const benchmarkReturn = benchmarkReturns[index];
    if (!Number.isFinite(assetReturn) || !Number.isFinite(benchmarkReturn)) continue;
    if (benchmarkReturn > 0) {
      upAsset.push(assetReturn);
      upBenchmark.push(benchmarkReturn);
    } else if (benchmarkReturn < 0) {
      downAsset.push(assetReturn);
      downBenchmark.push(benchmarkReturn);
    }
  }

  let upCapture: number | null = null;
  if (upAsset.length > 0) {
    const assetReturn = upAsset.reduce((product, value) => product * (1 + value), 1) - 1;
    const benchmarkReturn = upBenchmark.reduce((product, value) => product * (1 + value), 1) - 1;
    if (Math.abs(benchmarkReturn) > EPSILON) {
      upCapture = (assetReturn / benchmarkReturn) * 100;
    }
  }

  let downCapture: number | null = null;
  if (downAsset.length > 0) {
    const assetReturn = downAsset.reduce((product, value) => product * (1 + value), 1) - 1;
    const benchmarkReturn = downBenchmark.reduce((product, value) => product * (1 + value), 1) - 1;
    if (Math.abs(benchmarkReturn) > EPSILON) {
      downCapture = (assetReturn / benchmarkReturn) * 100;
    }
  }

  return {
    upCapture,
    downCapture,
    upCaptureRatio: interpretCaptureRatio(upCapture, "up"),
    downCaptureRatio: interpretCaptureRatio(downCapture, "down"),
  };
}

export function calculateTrackingError(
  returns: number[],
  benchmarkReturns: number[],
  annualizationPeriods = TRADING_DAYS,
): number | null {
  if (returns.length < 10 || benchmarkReturns.length < 10) return null;
  const excess = returns
    .map((value, index) => value - benchmarkReturns[index])
    .filter((value) => Number.isFinite(value));
  if (excess.length < 10) return null;
  return std(excess, true) * Math.sqrt(annualizationPeriods);
}

export function calculatePremiumDiscount(
  currentPrice: number,
  navPrice: number | null,
): number | null {
  if (navPrice === null || Math.abs(navPrice) < EPSILON) return null;
  return ((currentPrice - navPrice) / navPrice) * 100;
}

export function calculate52WeekRange(
  currentPrice: number,
  high52: number | null,
  low52: number | null,
): { rangePercent: number | null; fromHigh: number | null } {
  if (high52 === null || low52 === null) return { rangePercent: null, fromHigh: null };
  const range = high52 - low52;
  if (Math.abs(range) < EPSILON || Math.abs(high52) < EPSILON) {
    return { rangePercent: null, fromHigh: null };
  }
  return {
    rangePercent: ((currentPrice - low52) / range) * 100,
    fromHigh: ((high52 - currentPrice) / high52) * 100,
  };
}
