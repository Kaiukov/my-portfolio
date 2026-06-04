import { querySingle } from "../db.js";

export interface CashDragResult {
  total_portfolio_value: number;
  total_cash_usd: number;
  cash_pct: number;
  portfolio_cagr: number;
  benchmark_cagr: number;
  assumed_cash_return_rate: number;
  drag_vs_portfolio_cagr: number;
  drag_vs_benchmark: number;
  drag_vs_portfolio_pct: number;
  drag_vs_benchmark_pct: number;
  period_start_date: string;
  period_end_date: string;
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

export interface CashDragOptions {
  asOfDate?: string;
  fromDate?: string;
  benchmarkReturnRate?: number;
  cashReturnRate?: number;
}

export async function getCashDrag(opts: CashDragOptions = {}): Promise<CashDragResult> {
  const asOfDate = opts.asOfDate ?? new Date().toISOString().split("T")[0];

  const row = await querySingle<Record<string, unknown>>(
    "SELECT * FROM portfolio_cash_drag_sql($1::date, $2::date, $3::double precision, $4::double precision)",
    [
      asOfDate,
      opts.fromDate ?? null,
      opts.benchmarkReturnRate ?? null,
      opts.cashReturnRate ?? 0.0,
    ],
  );

  if (!row) {
    return {
      total_portfolio_value: 0,
      total_cash_usd: 0,
      cash_pct: 0,
      portfolio_cagr: 0,
      benchmark_cagr: 0,
      assumed_cash_return_rate: 0,
      drag_vs_portfolio_cagr: 0,
      drag_vs_benchmark: 0,
      drag_vs_portfolio_pct: 0,
      drag_vs_benchmark_pct: 0,
      period_start_date: "",
      period_end_date: asOfDate,
    };
  }

  return {
    total_portfolio_value: num(row["total_portfolio_value"]),
    total_cash_usd: num(row["total_cash_usd"]),
    cash_pct: num(row["cash_pct"]),
    portfolio_cagr: num(row["portfolio_cagr"]),
    benchmark_cagr: num(row["benchmark_cagr"]),
    assumed_cash_return_rate: num(row["assumed_cash_return_rate"]),
    drag_vs_portfolio_cagr: num(row["drag_vs_portfolio_cagr"]),
    drag_vs_benchmark: num(row["drag_vs_benchmark"]),
    drag_vs_portfolio_pct: num(row["drag_vs_portfolio_pct"]),
    drag_vs_benchmark_pct: num(row["drag_vs_benchmark_pct"]),
    period_start_date: str(row["period_start_date"]),
    period_end_date: str(row["period_end_date"]),
  };
}
