/*
 * Projection Engine — Annuity Formula Derivation
 *
 * Standard future-value-of-annuity formula (lump sum + end-of-period contributions):
 *
 *   FV(n) = P₀·(1+r)ⁿ + C·[(1+r)ⁿ − 1] / r
 *
 * where:
 *   P₀ = current portfolio value (principal, lump sum)
 *   C  = monthly contribution (added at END of each month)
 *   r  = monthly effective rate = (1 + R_annual)^(1/12) − 1
 *   n  = number of months
 *
 * Derivation — geometric series:
 *   Each contribution C at month k compounds for n−k months.
 *   FV = P₀·(1+r)ⁿ + Σ_{k=1}^{n} C·(1+r)^{n−k}
 *      = P₀·(1+r)ⁿ + C·[(1+r)ⁿ − 1] / r
 *
 * Special case r → 0 (zero-return / flat-line / m=0):
 *   By L'Hôpital or series expansion:
 *     lim_{r→0} C·[(1+r)ⁿ − 1] / r = C·n
 *   ∴  FV(n) = P₀ + C·n
 *
 *   Numerically: when |r| < 1e-14 the zero-return branch avoids
 *   catastrophic cancellation in (1+r)ⁿ − 1.
 *
 * Inverse (goal mode) — search for the first month where nominal FV meets the
 * target inflated to that month. The SQL path uses the same month-by-month
 * recurrence so the TS reference stays aligned with the production function.
 *
 * Asymptotic bound for negative r:
 *   lim_{n→∞} FV(n) = C / |r|
 *   Maximum achievable = max(P₀, C/|r|)  when r < 0.
 *   If target > max_achievable → infeasible.
 *
 * Two engines:
 *   getProjection()  — SQL-backed (portfolio_projection_sql), for API/MCP compatibility
 *   computeProjection() — pure TypeScript, month-by-month with multiple modes
 *
 * Goal mode treats `target` as today's dollars and inflates it to the goal
 * month using `inflationRate` before comparing against nominal FV.
 */

import { querySingle } from "../db.js";
import { getSummary } from "./summary.js";
import type { SummaryData } from "./summary.js";
import { roundTo } from "../utils.js";

// ── SQL-backed projection (API/MCP compatibility) ──

export interface SqlProjectionResult {
  current_value: number;
  annual_return_rate: number;
  monthly_contribution: number;
  inflation_rate: number;
  target_value: number | null;
  years_to_goal: number | null;
  projected_goal_value: number | null;
  projection_years: number | null;
  projected_value_nominal: number | null;
  projected_value_real: number | null;
  total_contributions: number | null;
  return_portion: number | null;
  required_return_rate: number | null;
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

export interface ProjectionOptions {
  asOfDate?: string;
  monthlyContribution?: number;
  annualReturnRate?: number;
  targetValue?: number;
  projectionYears?: number;
  inflationRate?: number;
}

export async function getProjection(opts: ProjectionOptions = {}): Promise<SqlProjectionResult> {
  const asOfDate = opts.asOfDate ?? new Date().toISOString().split("T")[0];
  const monthlyContribution = opts.monthlyContribution ?? 1000;
  const annualReturnRate = opts.annualReturnRate ?? null;
  const targetValue = opts.targetValue ?? null;
  const projectionYears = opts.projectionYears ?? 10;
  const inflationRate = opts.inflationRate ?? 0.0;

  const row = await querySingle<Record<string, unknown>>(
    `SELECT * FROM portfolio_projection_sql(
      $1::date, $2::double precision, $3::double precision,
      $4::double precision, $5::integer, $6::double precision
    )`,
    [asOfDate, monthlyContribution, annualReturnRate, targetValue, projectionYears, inflationRate],
  );

  if (!row) {
    return {
      current_value: 0,
      annual_return_rate: 0,
      monthly_contribution: monthlyContribution,
      inflation_rate: inflationRate,
      target_value: targetValue,
      years_to_goal: null,
      projected_goal_value: null,
      projection_years: null,
      projected_value_nominal: null,
      projected_value_real: null,
      total_contributions: null,
      return_portion: null,
      required_return_rate: null,
    };
  }

  return {
    current_value: num(row["current_value"]),
    annual_return_rate: num(row["annual_return_rate"]),
    monthly_contribution: num(row["monthly_contribution"]),
    inflation_rate: num(row["inflation_rate"]),
    target_value: nullableNum(row["target_value"]),
    years_to_goal: nullableNum(row["years_to_goal"]),
    projected_goal_value: nullableNum(row["projected_goal_value"]),
    projection_years: row["projection_years"] !== null && row["projection_years"] !== undefined
      ? Number(row["projection_years"]) : null,
    projected_value_nominal: nullableNum(row["projected_value_nominal"]),
    projected_value_real: nullableNum(row["projected_value_real"]),
    total_contributions: nullableNum(row["total_contributions"]),
    return_portion: nullableNum(row["return_portion"]),
    required_return_rate: nullableNum(row["required_return_rate"]),
  };
}

// ── Pure TypeScript projection engine ──

export type ProjectionMode = "detailed" | "accumulation" | "goal";

export interface ProjectionPoint {
  month: number;
  value: number;
}

export interface DetailedProjectionPoint extends ProjectionPoint {
  contribution_sum: number;
  gain: number;
}

export interface ProjectionBase {
  mode: ProjectionMode;
  as_of_date: string;
  current_value: number;
  monthly_contribution: number;
  annual_rate_pct: number;
  monthly_rate: number;
}

export interface DetailedProjection extends ProjectionBase {
  mode: "detailed";
  months: number;
  projected_value: number;
  total_contributions: number;
  gain_from_returns: number;
  projection: DetailedProjectionPoint[];
}

export interface AccumulationProjection extends ProjectionBase {
  mode: "accumulation";
  months: number;
  projected_value: number;
  total_contributions: number;
  gain_from_returns: number;
  values: number[];
}

export interface GoalProjection extends ProjectionBase {
  mode: "goal";
  target: number;
  feasible: boolean;
  months_needed: number | null;
  projected_value: number | null;
  max_achievable: number;
}

export type ProjectionResult = DetailedProjection | AccumulationProjection | GoalProjection;

export function annualToMonthly(annualRatePct: number): number {
  const R = annualRatePct / 100;
  return Math.pow(1 + R, 1 / 12) - 1;
}

const EPSILON = 1e-14;

function futureValue(P0: number, monthlyRate: number, contribution: number, months: number): number {
  if (months <= 0) return P0;

  if (Math.abs(monthlyRate) < EPSILON) {
    return P0 + contribution * months;
  }

  const growth = Math.pow(1 + monthlyRate, months);
  return P0 * growth + contribution * (growth - 1) / monthlyRate;
}

function maxAchievable(P0: number, monthlyRate: number, contribution: number): number {
  if (monthlyRate >= 0) return Infinity;

  const bound = contribution / Math.abs(monthlyRate);
  return Math.max(P0, bound);
}

function inflatedGoalTarget(target: number, inflationRate: number, months: number): number {
  return target * Math.pow(1 + inflationRate, months / 12);
}

export interface ComputeProjectionInput {
  asOfDate?: string;
  currentValue?: number;
  months?: number;
  contribution?: number;
  annualRatePct?: number;
  mode?: ProjectionMode;
  target?: number;
  maxMonths?: number;
  inflationRate?: number;
}

export async function computeProjection(input: ComputeProjectionInput): Promise<ProjectionResult> {
  const mode: ProjectionMode = input.mode ?? "detailed";
  const asOfDate = input.asOfDate ?? new Date().toISOString().split("T")[0];

  let P0 = input.currentValue;
  if (P0 === undefined) {
    const summary: SummaryData = await getSummary(asOfDate);
    P0 = summary.portfolio_value_usd;
  }

  const annualRatePct = input.annualRatePct ?? 7.0;
  const monthlyRate = annualToMonthly(annualRatePct);
  const C = input.contribution ?? 0;
  const inflationRate = input.inflationRate ?? 0;

  const base: ProjectionBase = {
    mode,
    as_of_date: asOfDate,
    current_value: roundTo(P0),
    monthly_contribution: C,
    annual_rate_pct: annualRatePct,
    monthly_rate: monthlyRate,
  };

  if (mode === "goal") {
    const target = input.target;
    if (target === undefined || target <= 0) {
      throw new Error("--target is required for goal mode and must be positive");
    }

    const maxMonths = input.maxMonths ?? 600;
    const achievable = maxAchievable(P0, monthlyRate, C);

    if (target <= P0) {
      return {
        ...base,
        mode: "goal",
        target,
        feasible: true,
        months_needed: 0,
        projected_value: roundTo(P0),
        max_achievable: Number.isFinite(achievable) ? roundTo(achievable) : Infinity,
      };
    }

    if (Number.isFinite(achievable) && target > achievable) {
      const fvAt = futureValue(P0, monthlyRate, C, maxMonths);
      return {
        ...base,
        mode: "goal",
        target,
        feasible: false,
        months_needed: null,
        projected_value: roundTo(fvAt),
        max_achievable: roundTo(achievable),
      };
    }

    for (let n = 1; n <= maxMonths; n += 1) {
      const fvAt = futureValue(P0, monthlyRate, C, n);
      const goalAtN = inflatedGoalTarget(target, inflationRate, n);
      if (fvAt >= goalAtN) {
        return {
          ...base,
          mode: "goal",
          target,
          feasible: true,
          months_needed: n,
          projected_value: roundTo(fvAt),
          max_achievable: Number.isFinite(achievable) ? roundTo(achievable) : Infinity,
        };
      }
    }

    const fvAt = futureValue(P0, monthlyRate, C, maxMonths);
    return {
      ...base,
      mode: "goal",
      target,
      feasible: false,
      months_needed: null,
      projected_value: roundTo(fvAt),
      max_achievable: Number.isFinite(achievable) ? roundTo(achievable) : Infinity,
    };
  }

  const n = input.months ?? 120;
  if (n < 0) throw new Error("--n must be non-negative");

  const fvFinal = futureValue(P0, monthlyRate, C, n);
  const totalContributions = C * n;
  const gainFromReturns = fvFinal - P0 - totalContributions;

  if (mode === "accumulation") {
    const values: number[] = [];
    for (let i = 0; i <= n; i++) {
      values.push(roundTo(futureValue(P0, monthlyRate, C, i)));
    }

    return {
      ...base,
      mode: "accumulation",
      months: n,
      projected_value: roundTo(fvFinal),
      total_contributions: roundTo(totalContributions),
      gain_from_returns: roundTo(gainFromReturns),
      values,
    };
  }

  const projection: DetailedProjectionPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const fv = futureValue(P0, monthlyRate, C, i);
    const contribSum = C * i;
    const gain = fv - P0 - contribSum;

    projection.push({
      month: i,
      value: roundTo(fv),
      contribution_sum: roundTo(contribSum),
      gain: roundTo(gain),
    });
  }

  return {
    ...base,
    mode: "detailed",
    months: n,
    projected_value: roundTo(fvFinal),
    total_contributions: roundTo(totalContributions),
    gain_from_returns: roundTo(gainFromReturns),
    projection,
  };
}
