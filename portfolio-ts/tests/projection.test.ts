import { describe, expect, test, mock, jest } from "bun:test";

const mockQuery = mock();
const mockQuerySingle = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle as unknown,
  connect: () => {},
  close: async () => {},
  getAssetMetadata: async () => [],
  upsertAssetMetadata: async () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

function setupSummary(portfolioValue: number) {
  mockQuerySingle.mockImplementation(() => {
    return Promise.resolve({
      holding_count: 5,
      total_cash_usd: 5000,
      portfolio_value_usd: portfolioValue,
      last_transaction_date: "2026-06-01",
      transaction_count: 42,
      as_of_date: "2026-06-04",
    });
  });
}

import type { DetailedProjection, AccumulationProjection, GoalProjection } from "../src/commands/projection.js";

function asDetailed(r: unknown): DetailedProjection {
  if ((r as DetailedProjection).mode !== "detailed") throw new Error("expected detailed");
  return r as DetailedProjection;
}

function asAccum(r: unknown): AccumulationProjection {
  if ((r as AccumulationProjection).mode !== "accumulation") throw new Error("expected accumulation");
  return r as AccumulationProjection;
}

function asGoal(r: unknown): GoalProjection {
  if ((r as GoalProjection).mode !== "goal") throw new Error("expected goal");
  return r as GoalProjection;
}

describe("Projection — annuity math", () => {
  test("zero-return m=0: FV = P₀ + C·n (hand-calculated)", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 100000,
      months: 120,
      contribution: 1000,
      annualRatePct: 0,
      mode: "accumulation",
    }));

    expect(result.projected_value).toBe(220000); // 100000 + 120*1000
    expect(result.total_contributions).toBe(120000);
    expect(result.gain_from_returns).toBe(0);

    // Verify: P₀*(1+r)ⁿ → P₀, C*[(1+r)ⁿ−1]/r → C*n
    // 100000 + 1000*120 = 220000
  });

  test("FV increases with positive rate above flat-line", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const flat = asAccum(await computeProjection({
      currentValue: 100000,
      months: 120,
      contribution: 1000,
      annualRatePct: 0,
      mode: "accumulation",
    }));

    const growing = asAccum(await computeProjection({
      currentValue: 100000,
      months: 120,
      contribution: 1000,
      annualRatePct: 7.0,
      mode: "accumulation",
    }));

    expect(growing.projected_value).toBeGreaterThan(flat.projected_value);
    expect(growing.gain_from_returns).toBeGreaterThan(0);
  });

  test("r tiny (0.1% annual): near flat-line, no overflow", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 100000,
      months: 120,
      contribution: 1000,
      annualRatePct: 0.1,
      mode: "accumulation",
    }));

    expect(result.projected_value).toBeGreaterThan(220000);
    expect(result.projected_value).toBeLessThan(220000 + 2000);
  });

  test("r very high (100%+ annual): does not overflow", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 1000,
      months: 12,
      contribution: 100,
      annualRatePct: 200,
      mode: "accumulation",
    }));

    expect(Number.isFinite(result.projected_value)).toBe(true);
    expect(result.projected_value).toBeGreaterThan(1000 + 1200);
  });

  test("n=0: returns P₀ unchanged", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 100000,
      months: 0,
      contribution: 1000,
      annualRatePct: 7.0,
      mode: "accumulation",
    }));

    expect(result.projected_value).toBe(100000);
    expect(result.total_contributions).toBe(0);
  });

  test("C=0: pure compounding only on principal", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 100000,
      months: 12,
      contribution: 0,
      annualRatePct: 0,
      mode: "accumulation",
    }));

    expect(result.projected_value).toBe(100000);
    expect(result.gain_from_returns).toBe(0);
  });

  test("P₀=0, C>0: annuity-only, flat rate (FV = C·n)", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 0,
      months: 12,
      contribution: 1000,
      annualRatePct: 0,
      mode: "accumulation",
    }));

    expect(result.projected_value).toBe(12000);
  });

  test("negative rate: FV < principal + contributions", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 100000,
      months: 10,
      contribution: 1000,
      annualRatePct: -20,
      mode: "accumulation",
    }));

    expect(result.projected_value).toBeLessThan(100000 + 10000);
    expect(result.projected_value).toBeGreaterThan(0);
  });

  test("P₀=C=0: degenerate case returns 0", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 0,
      months: 100,
      contribution: 0,
      annualRatePct: 7.0,
      mode: "accumulation",
    }));

    expect(result.projected_value).toBe(0);
  });
});

describe("Projection — detailed mode", () => {
  test("projection array has n+1 entries (months 0..n)", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asDetailed(await computeProjection({
      currentValue: 100000,
      months: 24,
      contribution: 1000,
      annualRatePct: 7.0,
      mode: "detailed",
    }));

    expect(result.projection).toHaveLength(25);
  });

  test("month 0: value = P₀, contributions and gain both zero", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asDetailed(await computeProjection({
      currentValue: 100000,
      months: 5,
      contribution: 1000,
      annualRatePct: 7.0,
      mode: "detailed",
    }));

    const m0 = result.projection[0];
    expect(m0.month).toBe(0);
    expect(m0.value).toBe(100000);
    expect(m0.contribution_sum).toBe(0);
    expect(m0.gain).toBe(0);
  });

  test("month 1: value > 101000 with positive rate (compounding + contribution)", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asDetailed(await computeProjection({
      currentValue: 100000,
      months: 1,
      contribution: 1000,
      annualRatePct: 12.0,
      mode: "detailed",
    }));

    const m1 = result.projection[1];
    expect(m1.contribution_sum).toBe(1000);
    expect(m1.gain).toBeGreaterThan(0);
    expect(m1.value).toBeGreaterThan(101000);
  });

  test("final month projected_value matches projection[n].value", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asDetailed(await computeProjection({
      currentValue: 50000,
      months: 36,
      contribution: 500,
      annualRatePct: 5.0,
      mode: "detailed",
    }));

    expect(result.projection[36].value).toBe(result.projected_value);
  });
});

describe("Projection — accumulation mode", () => {
  test("values array has n+1 entries", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 50000,
      months: 60,
      contribution: 500,
      annualRatePct: 5.0,
      mode: "accumulation",
    }));

    expect(result.values).toHaveLength(61);
    expect(result.values[0]).toBe(50000);
    expect(result.values[60]).toBe(result.projected_value);
  });

  test("values are monotonically increasing with positive rate", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 100000,
      months: 24,
      contribution: 1000,
      annualRatePct: 7.0,
      mode: "accumulation",
    }));

    for (let i = 1; i < result.values.length; i++) {
      expect(result.values[i]).toBeGreaterThan(result.values[i - 1]);
    }
  });
});

describe("Projection — goal mode", () => {
  test("hand-calculated: reach 1M with 7% annual, P₀=100k, C=1k", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asGoal(await computeProjection({
      currentValue: 100000,
      contribution: 1000,
      annualRatePct: 7.0,
      mode: "goal",
      target: 1000000,
    }));

    expect(result.feasible).toBe(true);
    expect(result.months_needed!).toBeGreaterThan(120);
    expect(result.months_needed!).toBeLessThan(360);
    expect(result.projected_value!).toBeGreaterThanOrEqual(1000000);
  });

  test("target already met: months_needed = 0", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asGoal(await computeProjection({
      currentValue: 100000,
      contribution: 0,
      annualRatePct: 7.0,
      mode: "goal",
      target: 50000,
    }));

    expect(result.feasible).toBe(true);
    expect(result.months_needed).toBe(0);
  });

  test("zero-return goal: n = (T−P₀)/C (hand-solved)", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asGoal(await computeProjection({
      currentValue: 100000,
      contribution: 2000,
      annualRatePct: 0,
      mode: "goal",
      target: 200000,
    }));

    expect(result.feasible).toBe(true);
    expect(result.months_needed).toBe(50); // (200k − 100k) / 2k = 50
  });

  test("max-months cap: infeasible when n exceeds max", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asGoal(await computeProjection({
      currentValue: 100000,
      contribution: 100,
      annualRatePct: 0,
      mode: "goal",
      target: 1000000,
      maxMonths: 50,
    }));

    expect(result.feasible).toBe(false);
    expect(result.months_needed).toBeNull();
  });

  test("negative rate: goal bounded by C/|r| asymptote", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asGoal(await computeProjection({
      currentValue: 100000,
      contribution: 1000,
      annualRatePct: -5.0,
      mode: "goal",
      target: 1000000,
    }));

    expect(result.feasible).toBe(false);
    expect(result.max_achievable).toBeLessThan(1000000);
  });

  test("goal mode without target throws", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    await expect(computeProjection({
      currentValue: 100000,
      contribution: 1000,
      annualRatePct: 7.0,
      mode: "goal",
    })).rejects.toThrow("--target");
  });

  test("goal mode exactly hit: projected_value >= target", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asGoal(await computeProjection({
      currentValue: 100000,
      contribution: 1000,
      annualRatePct: 0,
      mode: "goal",
      target: 110000,
    }));

    expect(result.feasible).toBe(true);
    expect(result.projected_value!).toBeGreaterThanOrEqual(110000);
  });
});

describe("Projection — precision", () => {
  test("round-trip: FV consistent with lump-sum implied rate", async () => {
    const { computeProjection, annualToMonthly } = await import("../src/commands/projection.js");

    const P0 = 100000;
    const C = 1000;
    const n = 120;

    const result = asAccum(await computeProjection({
      currentValue: P0,
      months: n,
      contribution: C,
      annualRatePct: 7.0,
      mode: "accumulation",
    }));

    const fv = result.projected_value;

    // Implied lump-sum rate: FV = P₀*(1+r_implied)ⁿ
    const rImplied = Math.pow(fv / P0, 1 / n) - 1;
    expect(rImplied).toBeGreaterThan(0);

    // With contributions, FV >>> P₀*(1+r)ⁿ, so implied lump-sum rate >> annuity rate
    const rExpected = annualToMonthly(7.0);
    expect(rImplied).toBeGreaterThan(rExpected);
  });

  test("zero-rate: gain_from_returns is exactly zero (no rounding error)", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 100000,
      months: 120,
      contribution: 1000,
      annualRatePct: 0,
      mode: "accumulation",
    }));

    expect(result.gain_from_returns).toBe(0);
  });
});

describe("Projection — realistic scale (10^7)", () => {
  test("10M portfolio, 100k/month, 6% annual, 360 months", async () => {
    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      currentValue: 10_000_000,
      months: 360,
      contribution: 100_000,
      annualRatePct: 6.0,
      mode: "accumulation",
    }));

    // Must exceed sum of contributions alone
    expect(result.projected_value).toBeGreaterThan(10_000_000 + 360 * 100_000);
    expect(Number.isFinite(result.projected_value)).toBe(true);
  });
});

describe("Projection — auto-fetch from summary", () => {
  test("fetches portfolio value from getSummary when currentValue not set", async () => {
    setupSummary(250000);

    const { computeProjection } = await import("../src/commands/projection.js");

    const result = asAccum(await computeProjection({
      months: 12,
      contribution: 1000,
      annualRatePct: 7.0,
      mode: "accumulation",
    }));

    expect(result.current_value).toBe(250000);
  });
});

describe("Projection — CLI integration", () => {
  test("dispatches projection with detailed mode (CLI flags)", async () => {
    setupSummary(100000);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "projection", "--current-value", "100000", "--n", "24", "--contribution", "1000", "--rate", "7"]);
      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.command).toBe("projection");
      expect(output.data.mode).toBe("detailed");
      expect(output.data.current_value).toBe(100000);
      expect(output.data.months).toBe(24);
      expect(output.data.projection).toHaveLength(25);
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test("dispatches projection — accumulation mode", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "projection", "--current-value", "50000", "--n", "12", "--contribution", "500", "--rate", "5", "--mode", "accumulation"]);
      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.data.mode).toBe("accumulation");
      expect(output.data.values).toHaveLength(13);
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test("dispatches projection — goal mode", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "projection", "--current-value", "100000", "--contribution", "1000", "--rate", "7", "--mode", "goal", "--target", "1000000"]);
      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.data.mode).toBe("goal");
      expect(output.data.feasible).toBe(true);
      expect(output.data.months_needed).toBeGreaterThan(0);
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test("projection — goal mode without target returns error", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "projection", "--mode", "goal"]);
      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(false);
      expect(output.error.code).toBe("VALIDATION_ERROR");
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test("projection help text mentions projection", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "--help"]);
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("projection");
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe("Projection — DB-gated integration", () => {
  const dbUrl = process.env.PORTFOLIO_DB_URL;
  const runDb = test.if(dbUrl !== undefined && dbUrl !== "");

  runDb("projection fetches current portfolio value from live DB (detailed)", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "projection", "--n", "12", "--contribution", "1000", "--rate", "7"]);

      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.command).toBe("projection");
      expect(output.data.mode).toBe("detailed");
      expect(output.data.projection).toBeDefined();
      expect(output.data.projection).toHaveLength(13);
      expect(typeof output.data.current_value).toBe("number");
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  runDb("projection goal mode with live DB", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "projection", "--contribution", "1000", "--rate", "7", "--mode", "goal", "--target", "1000000"]);

      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.command).toBe("projection");
      expect(output.data.mode).toBe("goal");
      expect(typeof output.data.current_value).toBe("number");
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
