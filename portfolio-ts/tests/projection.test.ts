import { describe, expect, test, mock, jest, beforeEach } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
  getSql: () => ({ unsafe: async (_sql: string, _params?: unknown[]) => [] }),
  getAssetMetadata: async () => [] as unknown[],
  upsertAssetMetadata: async () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

beforeEach(() => {
  mockQuerySingle.mockReset();
  mockQuery.mockReset();
});

function makeProjRow(overrides: Record<string, unknown> = {}) {
  return {
    current_value: 100000,
    annual_return_rate: 0.07,
    monthly_contribution: 1000,
    inflation_rate: 0.0,
    target_value: null,
    years_to_goal: null,
    projected_goal_value: null,
    projection_years: 10,
    projected_value_nominal: 374_076.83,
    projected_value_real: 374_076.83,
    total_contributions: 120_000,
    return_portion: 154_076.83,
    required_return_rate: null,
    ...overrides,
  };
}

// ============================================================
// Unit tests (hand-calculated annuity formula verification)
// ============================================================
describe("getProjection - projection mode (no target)", () => {
  test("hand-calculated FV: PV=100000, r=0.07, C=1000, years=10", async () => {
    // m = 0.07/12, n=120
    // FV = 100000*(1+m)^120 + 1000*((1+m)^120-1)/m
    mockQuerySingle.mockResolvedValue(makeProjRow());

    const { getProjection } = await import("../src/commands/projection.js");
    const result = await getProjection();

    expect(result.current_value).toBe(100000);
    expect(result.annual_return_rate).toBe(0.07);
    expect(result.monthly_contribution).toBe(1000);
    expect(result.target_value).toBeNull();
    expect(result.years_to_goal).toBeNull();
    expect(result.projected_goal_value).toBeNull();
    expect(result.projection_years).toBe(10);
    expect(result.projected_value_nominal).toBeGreaterThan(0);
    expect(result.projected_value_real).toBeGreaterThan(0);
    expect(result.total_contributions).toBe(120_000);
    expect(result.return_portion).toBeGreaterThan(0);
    expect(result.required_return_rate).toBeNull();
  });

  test("m=0 fallback: FV = PV + C*n (zero return)", async () => {
    mockQuerySingle.mockResolvedValue(makeProjRow({
      annual_return_rate: 0.0,
      projected_value_nominal: 220_000,
      projected_value_real: 220_000,
      total_contributions: 120_000,
      return_portion: 0,
    }));

    const { getProjection } = await import("../src/commands/projection.js");
    const result = await getProjection();

    expect(result.annual_return_rate).toBe(0);
    expect(result.projected_value_nominal).toBe(220_000);
    expect(result.total_contributions).toBe(120_000);
    expect(result.return_portion).toBe(0);
  });

  test("return_portion = projected_value_nominal - current_value - total_contributions", async () => {
    mockQuerySingle.mockResolvedValue(makeProjRow({
      current_value: 50000,
      annual_return_rate: 0.10,
      monthly_contribution: 500,
      projection_years: 5,
      projected_value_nominal: 121_171.05,
      total_contributions: 30_000,
      return_portion: 41_171.05,
    }));

    const { getProjection } = await import("../src/commands/projection.js");
    const result = await getProjection();

    expect(result.return_portion).toBeCloseTo(41_171.05, 0);
  });
});

// ============================================================
// Goal mode tests
// ============================================================
describe("getProjection - goal mode (with target)", () => {
  test("solves years_to_goal with r>0", async () => {
    mockQuerySingle.mockResolvedValue({
      current_value: 100_000,
      annual_return_rate: 0.07,
      monthly_contribution: 1_000,
      inflation_rate: 0.0,
      target_value: 500_000,
      years_to_goal: 16.0833,
      projected_goal_value: 500_000,
      projection_years: null,
      projected_value_nominal: null,
      projected_value_real: null,
      total_contributions: null,
      return_portion: null,
      required_return_rate: 0.12345,
    });

    const { getProjection } = await import("../src/commands/projection.js");
    const result = await getProjection({ targetValue: 500_000 });

    expect(result.target_value).toBe(500_000);
    expect(result.years_to_goal).toBeCloseTo(16.0833, 2);
    expect(result.projected_goal_value).toBe(500_000);
    expect(result.projection_years).toBeNull();
    expect(result.projected_value_nominal).toBeNull();
    expect(result.required_return_rate).toBeCloseTo(0.12345, 4);
  });

  test("unreachable target returns NULL years_to_goal", async () => {
    mockQuerySingle.mockResolvedValue({
      current_value: 100,
      annual_return_rate: -0.05,
      monthly_contribution: 0,
      inflation_rate: 0.0,
      target_value: 1_000_000,
      years_to_goal: null,
      projected_goal_value: null,
      projection_years: null,
      projected_value_nominal: null,
      projected_value_real: null,
      total_contributions: null,
      return_portion: null,
      required_return_rate: null,
    });

    const { getProjection } = await import("../src/commands/projection.js");
    const result = await getProjection({ targetValue: 1_000_000 });

    expect(result.years_to_goal).toBeNull();
    expect(result.projected_goal_value).toBeNull();
    expect(result.required_return_rate).toBeNull();
  });

  test("zero return with achievable target via contributions only", async () => {
    mockQuerySingle.mockResolvedValue({
      current_value: 50_000,
      annual_return_rate: 0.0,
      monthly_contribution: 5_000,
      inflation_rate: 0.0,
      target_value: 110_000,
      years_to_goal: 1.0,
      projected_goal_value: 110_000,
      projection_years: null,
      projected_value_nominal: null,
      projected_value_real: null,
      total_contributions: null,
      return_portion: null,
      required_return_rate: 0.0,
    });

    const { getProjection } = await import("../src/commands/projection.js");
    const result = await getProjection({ targetValue: 110_000, monthlyContribution: 5_000, annualReturnRate: 0.0 });

    expect(result.years_to_goal).toBe(1.0);
    expect(result.projected_goal_value).toBe(110_000);
  });
});

// ============================================================
// Edge cases
// ============================================================
describe("getProjection - edge cases", () => {
  test("null row from DB returns zero/null defaults", async () => {
    mockQuerySingle.mockResolvedValue(null);

    const { getProjection } = await import("../src/commands/projection.js");
    const result = await getProjection();

    expect(result.current_value).toBe(0);
    expect(result.annual_return_rate).toBe(0);
    expect(result.monthly_contribution).toBe(1000);
    expect(result.target_value).toBeNull();
    expect(result.years_to_goal).toBeNull();
    expect(result.projected_goal_value).toBeNull();
    expect(result.projection_years).toBeNull();
    expect(result.projected_value_nominal).toBeNull();
    expect(result.required_return_rate).toBeNull();
  });

  test("passes all parameters to SQL", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue(makeProjRow());

    const { getProjection } = await import("../src/commands/projection.js");
    await getProjection({
      asOfDate: "2026-01-15",
      monthlyContribution: 2500,
      annualReturnRate: 0.05,
      targetValue: 1_000_000,
      projectionYears: 20,
      inflationRate: 0.025,
    });

    const calls = mockQuerySingle.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toContain("portfolio_projection_sql");
    const params = calls[0][1] as (string | number | null)[];
    expect(params[0]).toBe("2026-01-15");
    expect(params[1]).toBe(2500);
    expect(params[2]).toBe(0.05);
    expect(params[3]).toBe(1_000_000);
    expect(params[4]).toBe(20);
    expect(params[5]).toBe(0.025);
  });

  test("defaults monthlyContribution to 1000, projectionYears to 10, inflationRate to 0", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue(makeProjRow());

    const { getProjection } = await import("../src/commands/projection.js");
    await getProjection({});

    const calls = mockQuerySingle.mock.calls;
    const params = calls[0][1] as (string | number | null)[];
    expect(params[1]).toBe(1000);
    expect(params[2]).toBeNull();
    expect(params[3]).toBeNull();
    expect(params[4]).toBe(10);
    expect(params[5]).toBe(0.0);
  });
});

// ============================================================
// CLI JSON snapshot tests
// ============================================================
describe("getProjection - CLI integration", () => {
  test("dispatches projection command and returns success envelope", async () => {
    mockQuerySingle.mockResolvedValue(makeProjRow());

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "projection"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("projection");
    expect(output.data.current_value).toBe(100_000);
    expect(output.data.annual_return_rate).toBe(0.07);
    expect(output.data.monthly_contribution).toBe(1000);
    expect(output.data.projection_years).toBe(10);
    expect(output.data.projected_value_nominal).toBeGreaterThan(0);
    expect(output.data.total_contributions).toBe(120_000);
    expect(output.data.return_portion).toBeGreaterThan(0);
    expect(output.meta).toBeDefined();
    expect(output.meta.generated_at).toBeDefined();

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches projection with all flags", async () => {
    mockQuerySingle.mockResolvedValue(makeProjRow({
      monthly_contribution: 2_000,
      annual_return_rate: 0.08,
      target_value: 1_000_000,
      inflation_rate: 0.025,
      projection_years: 15,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch([
      "bun", "src/cli.ts", "projection",
      "--monthly-contribution", "2000",
      "--annual-return-rate", "0.08",
      "--target-value", "1000000",
      "--inflation-rate", "0.025",
      "--projection-years", "15",
      "--as-of-date", "2026-01-15",
    ]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("projection");
    expect(output.data.monthly_contribution).toBe(2000);
    expect(output.data.annual_return_rate).toBe(0.08);
    expect(output.data.target_value).toBe(1_000_000);
    expect(output.data.inflation_rate).toBe(0.025);
    expect(output.data.projection_years).toBe(15);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches projection with snake_case flags", async () => {
    mockQuerySingle.mockResolvedValue(makeProjRow());

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch([
      "bun", "src/cli.ts", "projection",
      "--monthly_contribution", "3000",
      "--annual_return_rate", "0.06",
      "--target_value", "500000",
      "--inflation_rate", "0.02",
      "--projection_years", "20",
      "--as_of_date", "2026-06-01",
    ]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("projection");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("projection appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("projection");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ============================================================
// DB-gated integration tests (skip without PORTFOLIO_DB_URL)
// ============================================================
const DB_URL = process.env.PORTFOLIO_DB_URL;
const MAYBE_SKIP = DB_URL ? describe : describe.skip;

MAYBE_SKIP("projection integration (DB-gated)", () => {
  test("SQL function parses and runs (projection mode)", async () => {
    const { connect, querySingle } = await import("../src/db.js");
    connect();

    const row = await querySingle<Record<string, unknown>>(
      `SELECT * FROM portfolio_projection_sql(
        CURRENT_DATE, 1000::double precision, 0.07::double precision,
        NULL::double precision, 10, 0.0::double precision
      )`,
    );

    expect(row).not.toBeNull();
    if (row) {
      expect(Number(row["current_value"])).toBeGreaterThan(0);
      expect(Number(row["projected_value_nominal"])).toBeGreaterThan(0);
      expect(Number(row["projection_years"])).toBe(10);
      expect(row["target_value"]).toBeNull();
      expect(row["years_to_goal"]).toBeNull();
    }
  });

  test("SQL function runs (goal mode)", async () => {
    const { connect, querySingle } = await import("../src/db.js");
    connect();

    const row = await querySingle<Record<string, unknown>>(
      `SELECT * FROM portfolio_projection_sql(
        CURRENT_DATE, 1000::double precision, 0.07::double precision,
        500000::double precision, 10::integer, 0.0::double precision
      )`,
    );

    expect(row).not.toBeNull();
    if (row) {
      expect(Number(row["current_value"])).toBeGreaterThan(0);
      expect(row["target_value"]).not.toBeNull();
      expect(row["projected_value_nominal"]).toBeNull();
    }
  });

  test("service layer integration test", async () => {
    const { getProjection } = await import("../src/commands/projection.js");
    const result = await getProjection({
      monthlyContribution: 1000,
      annualReturnRate: 0.07,
      projectionYears: 5,
    });

    expect(result.current_value).toBeGreaterThan(0);
    expect(result.projected_value_nominal).toBeGreaterThan(result.current_value);
    expect(result.projection_years).toBe(5);
    expect(result.target_value).toBeNull();
  });

  test("m=0 yields FV = PV + C*n", async () => {
    const { getProjection } = await import("../src/commands/projection.js");
    const result = await getProjection({
      monthlyContribution: 1000,
      annualReturnRate: 0.0,
      projectionYears: 3,
    });

    expect(result.annual_return_rate).toBe(0);
    expect(result.return_portion).toBe(0);
    expect(result.total_contributions).toBe(36_000);
    expect(result.projected_value_nominal).toBeCloseTo(result.current_value + 36_000, 0);
  });
});
