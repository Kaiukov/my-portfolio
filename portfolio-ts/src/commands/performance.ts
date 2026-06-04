import { query } from "../db.js";

export interface PeriodReturns {
  "1M": number;
  "3M": number;
  "6M": number;
  YTD: number;
  "1Y": number;
  SII: number;
}

export interface RollingReturnsEntry {
  date: string;
  return: number;
}

export interface PerformanceResult {
  total_days: number;
  start_date: string | null;
  end_date: string | null;
  start_value: number;
  end_value: number;
  total_gain: number;
  avg_daily_return: number;
  avg_investment_return: number;
  std_dev: number;
  hist_volatility: number;
  var_95: number;
  var_99: number;
  cvar_95: number;
  cvar_99: number;
  max_drawdown: number;
  avg_drawdown: number;
  avg_drawdown_duration: number;
  time_weighted_return_pct: number;
  total_return_pct: number;
  median_monthly_return: number;
  cagr: number;
  beta: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  treynor_ratio: number;
  information_ratio: number;
  jensens_alpha: number;
  relative_return: number;
  tracking_error: number;
  spy_twr_pct: number;
  spy_cagr_pct: number;
  up_capture_ratio: number;
  down_capture_ratio: number;
  calmar_ratio: number;
  real_cagr: number;
  real_total_return_pct: number;
  period_returns: PeriodReturns;
  rolling_12m_returns: RollingReturnsEntry[];
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function str(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

function intVal(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export interface PerformanceOptions {
  asOfDate?: string;
  benchmark?: string;
  fromDate?: string;
  period?: string;
  inflationRate?: string;
}

export async function getPerformance(opts: PerformanceOptions = {}): Promise<{ data: PerformanceResult; benchmark: string }> {
  const asOfDate = opts.asOfDate ?? new Date().toISOString().split("T")[0];
  const benchmark = opts.benchmark ?? process.env["PORTFOLIO_BENCHMARK_TICKERS"]?.split(",")[0]?.trim() ?? "SPY";
  const inflationRate = opts.inflationRate !== undefined ? String(opts.inflationRate) : "0.025";

  let fromDate: string | null = null;

  if (opts.period) {
    const today = new Date();
    const t = new Date(today);
    switch (opts.period) {
      case "ytd":
        t.setMonth(0, 1);
        break;
      case "1y":
        t.setFullYear(t.getFullYear() - 1);
        break;
      case "6m":
        t.setMonth(t.getMonth() - 6);
        break;
      case "3m":
        t.setMonth(t.getMonth() - 3);
        break;
    }
    fromDate = t.toISOString().split("T")[0];
  } else if (opts.fromDate) {
    fromDate = opts.fromDate;
  }

  const row = await query<Record<string, unknown>>(
    "SELECT * FROM portfolio_performance_sql($1, $2, $3::date, 0.02, $4::double precision)",
    [asOfDate, benchmark, fromDate, inflationRate],
  );

  if (row.length === 0) {
    return {
      data: {
        total_days: 0,
        start_date: null,
        end_date: null,
        start_value: 0,
        end_value: 0,
        total_gain: 0,
        avg_daily_return: 0,
        avg_investment_return: 0,
        std_dev: 0,
        hist_volatility: 0,
        var_95: 0,
        var_99: 0,
        cvar_95: 0,
        cvar_99: 0,
        max_drawdown: 0,
        avg_drawdown: 0,
        avg_drawdown_duration: 0,
        time_weighted_return_pct: 0,
        total_return_pct: 0,
        median_monthly_return: 0,
        cagr: 0,
        beta: 0,
        sharpe_ratio: 0,
        sortino_ratio: 0,
        treynor_ratio: 0,
        information_ratio: 0,
        jensens_alpha: 0,
        relative_return: 0,
        tracking_error: 0,
        spy_twr_pct: 0,
        spy_cagr_pct: 0,
        up_capture_ratio: 0,
        down_capture_ratio: 0,
        calmar_ratio: 0,
        real_cagr: 0,
        real_total_return_pct: 0,
        period_returns: { "1M": 0, "3M": 0, "6M": 0, YTD: 0, "1Y": 0, SII: 0 },
        rolling_12m_returns: [],
      },
      benchmark,
    };
  }

  const r = row[0];

  const periodRows = await query<{ period: string; return_pct: number }>(
    "SELECT * FROM portfolio_period_returns_sql($1::date)",
    [asOfDate],
  );
  const periodReturns: Record<string, number> = { "1M": 0, "3M": 0, "6M": 0, YTD: 0, "1Y": 0, SII: 0 };
  for (const pr of periodRows) {
    periodReturns[pr.period] = Number.isFinite(Number(pr.return_pct)) ? Number(pr.return_pct) : 0;
  }

  const rollingRows = await query<{ date: string; return_pct: number }>(
    "SELECT * FROM portfolio_rolling_returns_sql($1::date, 12)",
    [asOfDate],
  );
  const rolling12m: RollingReturnsEntry[] = rollingRows.map((rr) => ({
    date: String(rr.date),
    return: Number.isFinite(Number(rr.return_pct)) ? Number(rr.return_pct) : 0,
  }));

  return {
    data: {
      total_days: intVal(r["total_days"]),
      start_date: str(r["start_date"]),
      end_date: str(r["end_date"]),
      start_value: num(r["start_value"]),
      end_value: num(r["end_value"]),
      total_gain: num(r["total_gain"]),
      avg_daily_return: num(r["avg_daily_return"]),
      avg_investment_return: num(r["avg_investment_return"]),
      std_dev: num(r["std_dev"]),
      hist_volatility: num(r["hist_volatility"]),
      var_95: num(r["var_95"]),
      var_99: num(r["var_99"]),
      cvar_95: num(r["cvar_95"]),
      cvar_99: num(r["cvar_99"]),
      max_drawdown: num(r["max_drawdown"]),
      avg_drawdown: num(r["avg_drawdown"]),
      avg_drawdown_duration: num(r["avg_drawdown_duration"]),
      time_weighted_return_pct: num(r["time_weighted_return_pct"]),
      total_return_pct: num(r["total_return_pct"]),
      median_monthly_return: num(r["median_monthly_return"]),
      cagr: num(r["cagr"]),
      beta: num(r["beta"]),
      sharpe_ratio: num(r["sharpe_ratio"]),
      sortino_ratio: num(r["sortino_ratio"]),
      treynor_ratio: num(r["treynor_ratio"]),
      information_ratio: num(r["information_ratio"]),
      jensens_alpha: num(r["jensens_alpha"]),
      relative_return: num(r["relative_return"]),
      tracking_error: num(r["tracking_error"]),
      spy_twr_pct: num(r["spy_twr_pct"]),
      spy_cagr_pct: num(r["spy_cagr_pct"]),
      up_capture_ratio: num(r["up_capture_ratio"]),
      down_capture_ratio: num(r["down_capture_ratio"]),
      calmar_ratio: num(r["calmar_ratio"]),
      real_cagr: num(r["real_cagr"]),
      real_total_return_pct: num(r["real_total_return_pct"]),
      period_returns: periodReturns as unknown as PeriodReturns,
      rolling_12m_returns: rolling12m,
    },
    benchmark,
  };
}
