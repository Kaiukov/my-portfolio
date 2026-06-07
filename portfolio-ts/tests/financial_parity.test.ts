import { describe, expect, test } from "bun:test";
import { getSql } from "../src/db.js";
import { runTx } from "../src/tx.js";
import { annualToMonthly, computeProjection } from "../src/commands/projection.js";
import type { AccumulationProjection, GoalProjection, ProjectionResult } from "../src/commands/projection.js";

const EPSILON = 1e-6;

type TxContext = {
  unsafe: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

type PortfolioStatusStub = {
  portfolioValue: number;
  deposits?: number;
  withdrawals?: number;
  income?: number;
  fees?: number;
  taxes?: number;
  totalGain?: number;
  realizedGain?: number;
  unrealizedGain?: number;
};

function n(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`expected finite number, got ${String(value)}`);
  }
  return parsed;
}

function asAccumulationProjection(result: ProjectionResult): AccumulationProjection {
  if (result.mode !== "accumulation") {
    throw new Error(`expected accumulation projection, got ${result.mode}`);
  }
  return result;
}

function asGoalProjection(result: ProjectionResult): GoalProjection {
  if (result.mode !== "goal") {
    throw new Error(`expected goal projection, got ${result.mode}`);
  }
  return result;
}

async function stubPortfolioStatus(unsafe: TxContext["unsafe"], stub: PortfolioStatusStub): Promise<void> {
  await unsafe(`
    CREATE OR REPLACE FUNCTION public.portfolio_status_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)
    RETURNS TABLE (
      transactions_count INTEGER,
      start_date TEXT,
      end_date TEXT,
      portfolio_value DOUBLE PRECISION,
      total_invested DOUBLE PRECISION,
      deposits DOUBLE PRECISION,
      withdrawals DOUBLE PRECISION,
      income DOUBLE PRECISION,
      fees DOUBLE PRECISION,
      taxes DOUBLE PRECISION,
      total_gain DOUBLE PRECISION,
      total_gain_pct DOUBLE PRECISION,
      cost_basis DOUBLE PRECISION,
      realized_gain DOUBLE PRECISION,
      unrealized_gain DOUBLE PRECISION,
      total_profit DOUBLE PRECISION,
      as_of_date TEXT
    )
    LANGUAGE sql
    STABLE
    AS $$
      SELECT
        0::INTEGER,
        NULL::TEXT,
        NULL::TEXT,
        ${stub.portfolioValue}::DOUBLE PRECISION,
        (${stub.deposits ?? 0} - ${stub.withdrawals ?? 0})::DOUBLE PRECISION,
        ${stub.deposits ?? 0}::DOUBLE PRECISION,
        ${stub.withdrawals ?? 0}::DOUBLE PRECISION,
        ${stub.income ?? 0}::DOUBLE PRECISION,
        ${stub.fees ?? 0}::DOUBLE PRECISION,
        ${stub.taxes ?? 0}::DOUBLE PRECISION,
        ${stub.totalGain ?? 0}::DOUBLE PRECISION,
        NULL::DOUBLE PRECISION,
        NULL::DOUBLE PRECISION,
        ${stub.realizedGain ?? 0}::DOUBLE PRECISION,
        ${stub.unrealizedGain ?? 0}::DOUBLE PRECISION,
        ${stub.totalGain ?? 0}::DOUBLE PRECISION,
        p_as_of_date::TEXT
    $$;
  `);
}

function solveRequiredReturnRate(
  currentValue: number,
  monthlyContribution: number,
  projectionYears: number,
  inflationRate: number,
  targetValue: number,
): number | null {
  const months = Math.max(projectionYears, 0) * 12;
  const goalTarget = targetValue * Math.pow(1 + inflationRate, Math.max(projectionYears, 0));
  const fv = (annualRateDecimal: number): number => {
    const monthlyRate = annualToMonthly(annualRateDecimal * 100);
    if (Math.abs(monthlyRate) < EPSILON) {
      return currentValue + monthlyContribution * months;
    }
    const growth = Math.pow(1 + monthlyRate, months);
    return currentValue * growth + monthlyContribution * (growth - 1) / monthlyRate;
  };

  if (fv(2.0) < goalTarget) return null;

  let lo = -0.20;
  let hi = 2.0;
  let mid = 0.0;

  for (let i = 0; i < 200; i += 1) {
    mid = (lo + hi) / 2;
    const value = fv(mid);
    if (Math.abs(value - goalTarget) < 1e-8 || (hi - lo) < 1e-8) {
      return mid;
    }
    if (value < goalTarget) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return mid;
}

function simulateWithdrawalFixture(
  portfolioValue: number,
  annualWithdrawal: number,
  expectedReturn: number,
  inflationRatePct: number,
  horizonYears: number,
) {
  const inflation = inflationRatePct / 100;
  let value = portfolioValue;
  let yearsUntilDepletion: number | null = null;
  let totalWithdrawn = 0;
  let terminalValueAtReturn = portfolioValue;

  for (let year = 1; year <= horizonYears; year += 1) {
    const withdrawal = annualWithdrawal * Math.pow(1 + inflation, year - 1);
    const previousValue = value;
    value = value * (1 + expectedReturn) - withdrawal;

    if (yearsUntilDepletion === null) {
      totalWithdrawn += withdrawal;
    }

    if (yearsUntilDepletion === null && value <= 0) {
      if (value === 0) {
        yearsUntilDepletion = year;
      } else if (previousValue > 0) {
        yearsUntilDepletion = (year - 1) + previousValue / (previousValue - value);
      } else {
        yearsUntilDepletion = year;
      }

      const fraction = Math.max(0, Math.min(1, yearsUntilDepletion - (year - 1)));
      totalWithdrawn = totalWithdrawn - withdrawal + withdrawal * fraction;
      terminalValueAtReturn = 0;
    }
  }

  return {
    yearsUntilDepletion,
    terminalValue: value,
    totalWithdrawn,
    returnGenerated: terminalValueAtReturn - portfolioValue + totalWithdrawn,
  };
}

describe("financial parity", () => {
  const dbUrl = process.env.PORTFOLIO_DB_URL;
  const runDb = test.if(dbUrl !== undefined && dbUrl !== "");

  runDb("projection SQL and TS match on the corrected accumulation fixture", async () => {
    await runTx(async ({ unsafe }: TxContext) => {
      await unsafe("SAVEPOINT financial_parity_projection_accumulation");
      try {
        await stubPortfolioStatus(unsafe, { portfolioValue: 100000 });

        const rows = await unsafe(
          `SELECT * FROM portfolio_projection_sql(
            $1::date, $2::double precision, $3::double precision,
            $4::double precision, $5::integer, $6::double precision
          )`,
          ["2026-01-15", 1000, 0.12, null, 10, 0],
        );

        const row = rows[0] as Record<string, unknown>;
        const ts = asAccumulationProjection(await computeProjection({
          currentValue: 100000,
          months: 120,
          contribution: 1000,
          annualRatePct: 12.0,
          mode: "accumulation",
        }));

        expect(n(row.projected_value_nominal)).toBeCloseTo(ts.projected_value, 2);
        expect(n(row.total_contributions)).toBeCloseTo(ts.total_contributions, 2);
        expect(n(row.return_portion)).toBeCloseTo(ts.gain_from_returns, 2);
        expect(n(row.projected_value_nominal)).toBeCloseTo(532514.86, 2);
      } finally {
        await unsafe("ROLLBACK TO SAVEPOINT financial_parity_projection_accumulation");
      }
    }, getSql());
  });

  runDb("projection goal mode inflates the target before month search and solver", async () => {
    await runTx(async ({ unsafe }: TxContext) => {
      await unsafe("SAVEPOINT financial_parity_projection_goal");
      try {
        await stubPortfolioStatus(unsafe, { portfolioValue: 100000 });

        const rows = await unsafe(
          `SELECT * FROM portfolio_projection_sql(
            $1::date, $2::double precision, $3::double precision,
            $4::double precision, $5::integer, $6::double precision
          )`,
          ["2026-01-15", 1000, 0.07, 250000, 10, 0.03],
        );

        const row = rows[0] as Record<string, unknown>;
        const ts = asGoalProjection(await computeProjection({
          currentValue: 100000,
          months: 120,
          contribution: 1000,
          annualRatePct: 7.0,
          mode: "goal",
          target: 250000,
          maxMonths: 1200,
          inflationRate: 0.03,
        }));

        expect(n(row.years_to_goal)).toBeCloseTo((ts.months_needed ?? 0) / 12, 10);
        expect(n(row.projected_goal_value)).toBeCloseTo(ts.projected_value ?? 0, 2);
        const expectedRequiredReturnRate = solveRequiredReturnRate(100000, 1000, 10, 0.03, 250000);
        expect(expectedRequiredReturnRate).not.toBeNull();
        expect(n(row.required_return_rate)).toBeCloseTo(expectedRequiredReturnRate!, 6);
        expect(n(row.projected_goal_value)).toBeGreaterThanOrEqual(250000);
      } finally {
        await unsafe("ROLLBACK TO SAVEPOINT financial_parity_projection_goal");
      }
    }, getSql());
  });

  runDb("withdrawal SQL and TS match on the fractional depletion fixture", async () => {
    await runTx(async ({ unsafe }: TxContext) => {
      await unsafe("SAVEPOINT financial_parity_withdrawal");
      try {
        await stubPortfolioStatus(unsafe, { portfolioValue: 100000 });

        const rows = await unsafe(
          `SELECT * FROM portfolio_withdrawal_sql(
            $1::date, $2::double precision, $3::double precision,
            $4::integer, $5::double precision, $6::double precision
          )`,
          ["2026-01-15", 15000, null, 10, 0.05, 3.0],
        );

        const row = rows[0] as Record<string, unknown>;
        const ts = simulateWithdrawalFixture(100000, 15000, 0.05, 3.0, 10);

        expect(n(row.years_until_depletion)).toBeCloseTo(ts.yearsUntilDepletion ?? 0, 6);
        expect(n(row.terminal_value)).toBeCloseTo(ts.terminalValue, 6);
        expect(n(row.total_withdrawn)).toBeCloseTo(ts.totalWithdrawn, 2);
        expect(n(row.return_generated)).toBeCloseTo(ts.returnGenerated, 2);
        expect(n(row.total_withdrawn)).toBeCloseTo(122895.08, 2);
      } finally {
        await unsafe("ROLLBACK TO SAVEPOINT financial_parity_withdrawal");
      }
    }, getSql());
  });

  runDb("decomposition SQL and TS match on the signed split fixture", async () => {
    await runTx(async ({ unsafe }: TxContext) => {
      await unsafe("SAVEPOINT financial_parity_decomposition");
      try {
        await unsafe(`
          CREATE TEMP TABLE daily_returns (
            date DATE NOT NULL,
            portfolio_value DOUBLE PRECISION NOT NULL
          ) ON COMMIT DROP;
        `);
        await unsafe(
          `INSERT INTO daily_returns (date, portfolio_value) VALUES
            ('2026-01-01', 100::double precision);`,
        );
        await unsafe(`
          CREATE OR REPLACE FUNCTION public.portfolio_status_sql(p_as_of_date DATE DEFAULT CURRENT_DATE)
          RETURNS TABLE (
            transactions_count INTEGER,
            start_date TEXT,
            end_date TEXT,
            portfolio_value DOUBLE PRECISION,
            total_invested DOUBLE PRECISION,
            deposits DOUBLE PRECISION,
            withdrawals DOUBLE PRECISION,
            income DOUBLE PRECISION,
            fees DOUBLE PRECISION,
            taxes DOUBLE PRECISION,
            total_gain DOUBLE PRECISION,
            total_gain_pct DOUBLE PRECISION,
            cost_basis DOUBLE PRECISION,
            realized_gain DOUBLE PRECISION,
            unrealized_gain DOUBLE PRECISION,
            total_profit DOUBLE PRECISION,
            as_of_date TEXT
          )
          LANGUAGE sql
          STABLE
          AS $$
            SELECT
              0::INTEGER,
              NULL::TEXT,
              NULL::TEXT,
              100::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              NULL::DOUBLE PRECISION,
              NULL::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              p_as_of_date::TEXT
            WHERE p_as_of_date = DATE '2026-01-01'
            UNION ALL
            SELECT
              0::INTEGER,
              NULL::TEXT,
              NULL::TEXT,
              140::DOUBLE PRECISION,
              50::DOUBLE PRECISION,
              50::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              -10::DOUBLE PRECISION,
              NULL::DOUBLE PRECISION,
              NULL::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              0::DOUBLE PRECISION,
              -10::DOUBLE PRECISION,
              p_as_of_date::TEXT
            WHERE p_as_of_date = DATE '2026-06-01';
          $$;
        `);

        const rows = await unsafe(
          `SELECT * FROM portfolio_decomposition_sql($1::date)`,
          ["2026-06-01"],
        );

        const row = rows[0] as Record<string, unknown>;
        const growth = 140 - 100;
        const referenceContributionsPct = 50 / growth * 100;
        const referenceReturnsPct = -10 / growth * 100;

        expect(n(row.total_growth_usd)).toBe(40);
        expect(n(row.from_contributions_usd)).toBe(50);
        expect(n(row.from_returns_usd)).toBe(-10);
        expect(n(row.from_contributions_pct)).toBeCloseTo(referenceContributionsPct, 6);
        expect(n(row.from_returns_pct)).toBeCloseTo(referenceReturnsPct, 6);
        expect(n(row.from_contributions_pct)).toBe(125);
        expect(n(row.from_returns_pct)).toBe(-25);
      } finally {
        await unsafe("ROLLBACK TO SAVEPOINT financial_parity_decomposition");
      }
    }, getSql());
  });
});
