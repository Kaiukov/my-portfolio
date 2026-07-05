import { describe, expect, test, jest } from "bun:test";

describe("Projection — DB-gated integration", () => {
  const dbUrl = process.env.PORTFOLIO_DB_URL;
  const runDb = test.if(
    dbUrl !== undefined && dbUrl !== "" && !!process.env.PORTFOLIO_TEST_FIXTURE_DB,
  );

  runDb("projection fetches current portfolio value from live DB and returns SQL-backed result", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "projection", "--monthly-contribution", "1000", "--annual-return-rate", "0.12"]);

      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.command).toBe("projection");
      expect(typeof output.data.current_value).toBe("number");
      expect(typeof output.data.annual_return_rate).toBe("number");
      expect(typeof output.data.monthly_contribution).toBe("number");
      expect(typeof output.data.projected_value_nominal).toBe("number");
      expect(typeof output.data.projected_value_real).toBe("number");
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  runDb("projection goal mode with live DB returns years_to_goal", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "projection",
        "--monthly-contribution", "1000",
        "--annual-return-rate", "0.12",
        "--target-value", "30000",
        "--projection-years", "5",
      ]);

      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.command).toBe("projection");
      expect(typeof output.data.current_value).toBe("number");
      expect(output.data.target_value).toBe(30000);
      expect(output.data.years_to_goal).toBeGreaterThan(0);
      expect(output.data.years_to_goal).toBeLessThanOrEqual(5);
      expect(typeof output.data.required_return_rate).toBe("number");
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  runDb("projection zero horizon keeps current_value unchanged and echoes projection_years=0", async () => {
    const { getProjection } = await import("../src/commands/projection.js");

    const result = await getProjection({
      monthlyContribution: 1000,
      annualReturnRate: 0.12,
      projectionYears: 0,
      inflationRate: 0.025,
    });

    expect(result.current_value).toBeGreaterThan(0);
    expect(result.projection_years).toBe(0);
    expect(result.projected_value_nominal).toBe(result.current_value);
    expect(result.projected_value_real).toBe(result.current_value);
    expect(result.total_contributions).toBe(0);
    expect(result.return_portion).toBe(0);
  });

  runDb("projection goal mode already-met target returns years_to_goal=0", async () => {
    const { getProjection } = await import("../src/commands/projection.js");

    const baseline = await getProjection({
      monthlyContribution: 1000,
      annualReturnRate: 0.07,
      projectionYears: 5,
    });

    expect(baseline.current_value).toBeGreaterThan(0);

    const result = await getProjection({
      monthlyContribution: 1000,
      annualReturnRate: 0.07,
      projectionYears: 5,
      targetValue: baseline.current_value,
    });

    expect(result.years_to_goal).toBe(0);
    expect(result.projected_goal_value).toBe(baseline.current_value);
    expect(result.required_return_rate).toBeNull();
  });

  runDb("projection goal mode negative rate does not use linear carry-forward", async () => {
    const { getProjection } = await import("../src/commands/projection.js");

    const baseline = await getProjection({
      monthlyContribution: 1000,
      annualReturnRate: -0.2,
      projectionYears: 1,
    });

    expect(baseline.current_value).toBeGreaterThan(0);

    const contribution = 1000;
    const monthlyLoss = Math.abs(-0.2 / 12.0) * baseline.current_value;
    const targetValue = baseline.current_value + contribution - monthlyLoss * 0.25;

    const result = await getProjection({
      monthlyContribution: contribution,
      annualReturnRate: -0.2,
      projectionYears: 1,
      targetValue,
    });

    expect(result.years_to_goal === null || result.years_to_goal > (1 / 12)).toBe(true);
  });
});
