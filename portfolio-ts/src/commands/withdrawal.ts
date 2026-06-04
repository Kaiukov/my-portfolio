/*
 * Safe withdrawal rate / decumulation analysis (#230)
 *
 * Calls portfolio_withdrawal_sql() in PostgreSQL. Determines how long a
 * portfolio lasts given an annual withdrawal amount/rate, accounts for
 * inflation-adjusted spending, expected returns, and computes max safe
 * withdrawal via bisection.
 *
 * Recurrence (withdrawal at END of year, inflation-adjusted):
 *   V_0 = portfolio_value
 *   V_t = V_{t-1} * (1 + r) - W0 * (1 + infl)^(t-1)   for t = 1..horizon
 *
 * success_likelihood: v1 deterministic single-path proxy (NOT Monte-Carlo).
 */

import { querySingle } from "../db.js";

export interface WithdrawalResult {
  portfolio_value: number;
  annual_withdrawal: number;
  withdrawal_rate_pct: number;
  time_horizon_years: number;
  expected_return: number;
  inflation_rate: number;
  years_until_depletion: number | null;
  terminal_value: number;
  success_likelihood: number;
  max_safe_withdrawal: number;
  max_safe_withdrawal_rate: number;
  total_withdrawn: number;
  return_generated: number;
  shortfall_risk: number;
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export interface WithdrawalOptions {
  asOfDate?: string;
  annualWithdrawal?: number;
  withdrawalRate?: number;
  timeHorizonYears?: number;
  expectedReturn?: number;
  inflationRate?: number;
}

export async function getWithdrawal(opts: WithdrawalOptions = {}): Promise<WithdrawalResult> {
  const asOfDate = opts.asOfDate ?? new Date().toISOString().split("T")[0];
  const annualWithdrawal = opts.annualWithdrawal ?? null;
  const withdrawalRate = opts.withdrawalRate ?? null;
  const timeHorizonYears = opts.timeHorizonYears ?? null;
  const expectedReturn = opts.expectedReturn ?? null;
  const inflationRate = opts.inflationRate ?? null;

  const row = await querySingle<Record<string, unknown>>(
    `SELECT * FROM portfolio_withdrawal_sql(
      $1::date, $2::double precision, $3::double precision,
      $4::integer, $5::double precision, $6::double precision
    )`,
    [asOfDate, annualWithdrawal, withdrawalRate, timeHorizonYears, expectedReturn, inflationRate],
  );

  if (!row) {
    return {
      portfolio_value: 0,
      annual_withdrawal: 0,
      withdrawal_rate_pct: 0,
      time_horizon_years: 0,
      expected_return: 0,
      inflation_rate: 0,
      years_until_depletion: null,
      terminal_value: 0,
      success_likelihood: 0,
      max_safe_withdrawal: 0,
      max_safe_withdrawal_rate: 0,
      total_withdrawn: 0,
      return_generated: 0,
      shortfall_risk: 100,
    };
  }

  return {
    portfolio_value: num(row["portfolio_value"]),
    annual_withdrawal: num(row["annual_withdrawal"]),
    withdrawal_rate_pct: num(row["withdrawal_rate_pct"]),
    time_horizon_years: row["time_horizon_years"] !== null ? Number(row["time_horizon_years"]) : 0,
    expected_return: num(row["expected_return"]),
    inflation_rate: num(row["inflation_rate"]),
    years_until_depletion: nullableNum(row["years_until_depletion"]),
    terminal_value: num(row["terminal_value"]),
    success_likelihood: num(row["success_likelihood"]),
    max_safe_withdrawal: num(row["max_safe_withdrawal"]),
    max_safe_withdrawal_rate: num(row["max_safe_withdrawal_rate"]),
    total_withdrawn: num(row["total_withdrawn"]),
    return_generated: num(row["return_generated"]),
    shortfall_risk: num(row["shortfall_risk"]),
  };
}
