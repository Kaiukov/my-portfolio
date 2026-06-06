export type AssetType =
  | "STOCK"
  | "ETF"
  | "CRYPTO"
  | "FX"
  | "FUND"
  | "INDEX"
  | "FUTURE"
  | "UNKNOWN";

export type AssetAnalysisPeriod =
  | "1mo"
  | "3mo"
  | "6mo"
  | "ytd"
  | "1y"
  | "2y"
  | "3y"
  | "5y";

export interface AnalysisIssue {
  code: string;
  message: string;
  source: "validation" | "provider" | "metrics";
  field?: string;
  ticker?: string;
}

export interface AssetInfo {
  ticker: string;
  type: AssetType;
  quote_type: string | null;
  type_display: string | null;
  name: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;

  current_price: number | null;
  previous_close: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  spread_pct: number | null;

  volume: number | null;
  open_interest: number | null;

  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;

  market_cap: number | null;

  nav_price: number | null;
  expense_ratio: number | null;
  dividend_yield: number | null;
  holdings_count: number | null;
  category: string | null;
  fund_family: string | null;
  total_assets: number | null;

  pe_ratio: number | null;
  pb_ratio: number | null;
  peg_ratio: number | null;
  roe: number | null;
  roa: number | null;
  profit_margins: number | null;
  trailing_eps: number | null;
  forward_eps: number | null;
  revenue_growth: number | null;
  earnings_growth: number | null;
  payout_ratio: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;

  volume_24h: number | null;
  circulating_supply: number | null;
}

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface RiskMetrics {
  beta: number | null;
  annual_volatility: number | null;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  downside_deviation: number | null;

  max_drawdown: number | null;
  max_drawdown_date: string | null;

  cagr_1y: number | null;
  cagr_3y: number | null;
  cagr_5y: number | null;

  calmar_ratio: number | null;
  ulcer_index: number | null;

  skewness: number | null;
  kurtosis: number | null;

  up_capture: number | null;
  down_capture: number | null;
  up_capture_ratio: string | null;
  down_capture_ratio: string | null;

  tracking_error: number | null;
  tracking_error_benchmark: string | null;
  premium_discount: number | null;

  fifty_two_week_range_percent: number | null;
  fifty_two_week_percent_from_high: number | null;
}

export interface TechnicalIndicators {
  rsi: number | null;
  rsi_signal: string | null;

  ma50: number | null;
  ma200: number | null;
  price_vs_ma50: number | null;
  price_vs_ma200: number | null;
  ma50_vs_ma200: number | null;
  ma_trend: string | null;

  macd: number | null;
  macd_signal: number | null;
  macd_histogram: number | null;
  macd_trend: string | null;

  williams_r_14: number | null;
  williams_r_14_signal: string | null;
  williams_r_2: number | null;
  williams_r_2_signal: string | null;

  stoch_k: number | null;
  stoch_d: number | null;
  stoch_signal: string | null;

  stochrsi_k: number | null;
  stochrsi_d: number | null;
  stochrsi_signal: string | null;
}

export interface AssetAnalysisOptions {
  ticker?: string;
  asset?: string;
  period?: AssetAnalysisPeriod;
  lookbackDays?: number;
  benchmark?: string;
  asOfDate?: string;
  riskFreeRate?: number;
}

export interface ResolvedAssetAnalysisRequest {
  ticker: string;
  period: AssetAnalysisPeriod | null;
  lookback_days: number;
  benchmark: string;
  tracking_error_benchmark: string;
  as_of_date: string;
  risk_free_rate: number;
  annualization_periods: number;
}

export interface AssetAnalysisProviderRequest {
  ticker: string;
  benchmark: string;
  trackingBenchmark: string;
  analysisStartDate: Date;
  historyStartDate: Date;
  asOfDate: Date;
}

export interface AssetAnalysisProviderResult {
  info: AssetInfo;
  priceBars: PriceBar[];
  historyBars: PriceBar[];
  benchmarkBars: PriceBar[];
  trackingBenchmarkBars: PriceBar[];
  warnings: AnalysisIssue[];
  errors: AnalysisIssue[];
}

export interface AssetAnalysisProvider {
  fetchAnalysisInput(
    request: AssetAnalysisProviderRequest,
  ): Promise<AssetAnalysisProviderResult>;
}

export interface AssetAnalysisData {
  request: ResolvedAssetAnalysisRequest;
  ticker: string;
  type: AssetType;
  info: AssetInfo;
  price_bars: PriceBar[];
  five_year_bars: PriceBar[];
  metrics: RiskMetrics;
  technicals: TechnicalIndicators;
  warnings: AnalysisIssue[];
  errors: AnalysisIssue[];
}
