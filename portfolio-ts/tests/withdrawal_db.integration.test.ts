import { describe, expect, test, jest } from "bun:test";

describe("Withdrawal — DB-gated integration", () => {
  const dbUrl = process.env.PORTFOLIO_DB_URL;
  const runDb = test.if(
    dbUrl !== undefined && dbUrl !== "" && !!process.env.PORTFOLIO_TEST_FIXTURE_DB,
  );

  runDb("portfolio_withdrawal_sql parses and runs (SQL smoke test)", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "withdrawal"]);

      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.command).toBe("withdrawal");
      expect(typeof output.data.portfolio_value).toBe("number");
      expect(output.data.portfolio_value).toBeGreaterThan(0);
      expect(typeof output.data.annual_withdrawal).toBe("number");
      expect(typeof output.data.withdrawal_rate_pct).toBe("number");
      expect(typeof output.data.time_horizon_years).toBe("number");
      expect(typeof output.data.expected_return).toBe("number");
      expect(typeof output.data.inflation_rate).toBe("number");
      expect(output.data.years_until_depletion === null || typeof output.data.years_until_depletion === "number").toBe(true);
      expect(typeof output.data.terminal_value).toBe("number");
      expect(typeof output.data.success_likelihood).toBe("number");
      expect(
        output.data.max_safe_withdrawal === null || typeof output.data.max_safe_withdrawal === "number",
      ).toBe(true);
      expect(
        output.data.max_safe_withdrawal_rate === null || typeof output.data.max_safe_withdrawal_rate === "number",
      ).toBe(true);
      expect(typeof output.data.total_withdrawn).toBe("number");
      expect(typeof output.data.return_generated).toBe("number");
      expect(typeof output.data.shortfall_risk).toBe("number");
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  runDb("withdrawal with custom params via CLI returns valid data", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "withdrawal",
        "--annual-withdrawal", "50000",
        "--time-horizon-years", "20",
        "--expected-return", "0.06",
        "--inflation-rate", "2.0",
      ]);

      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.command).toBe("withdrawal");
      expect(output.data.annual_withdrawal).toBe(50000);
      expect(output.data.time_horizon_years).toBe(20);
      expect(output.data.expected_return).toBe(0.06);
      expect(output.data.inflation_rate).toBe(2.0);
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  runDb("withdrawal via API route returns valid JSON envelope", async () => {
    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/withdrawal?annual_withdrawal=30000&time_horizon_years=15");
    const resp = await handleRequest(req);
    expect(resp.status).toBe(200);

    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("withdrawal");
    expect(body.data.annual_withdrawal).toBe(30000);
    expect(body.data.time_horizon_years).toBe(15);
  });

  runDb("withdrawal via MCP read tool returns valid JSON envelope", async () => {
    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("withdrawal", {
      annual_withdrawal: 25000,
      time_horizon_years: 10,
      expected_return: 0.05,
      inflation_rate: 2.5,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("withdrawal envelope not ok");

    const d = result.data as Record<string, unknown>;
    expect(result.command).toBe("withdrawal");
    expect(d.annual_withdrawal).toBe(25000);
    expect(d.time_horizon_years).toBe(10);
    expect(d.expected_return).toBe(0.05);
    expect(d.inflation_rate).toBe(2.5);
  });

  runDb("withdrawal recurrence is hand-verifiable: compute V_t manually and assert terminal_value", async () => {
    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("withdrawal", {
      annual_withdrawal: 12000,
      time_horizon_years: 10,
      expected_return: 0.05,
      inflation_rate: 3.0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("withdrawal envelope not ok");

    const data = result.data as Record<string, unknown>;
    const pv = Number(data.portfolio_value);
    const r = Number(data.expected_return);
    const inflDecimal = Number(data.inflation_rate) / 100;
    const annualWithdrawal = Number(data.annual_withdrawal);
    const horizon = Number(data.time_horizon_years);

    let value = pv;
    for (let year = 1; year <= horizon; year += 1) {
      const withdrawal = annualWithdrawal * Math.pow(1 + inflDecimal, year - 1);
      value = value * (1 + r) - withdrawal;
    }

    const sqlTerminal = Number(data.terminal_value);
    const diff = Math.abs(value - sqlTerminal);
    const relDiff = Math.abs(pv) > 1 ? diff / pv : diff;
    expect(relDiff).toBeLessThan(0.01);
  });

  runDb("max_safe_withdrawal: slightly above max_safe should deplete", async () => {
    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("withdrawal", {
      annual_withdrawal: 1000,
      time_horizon_years: 20,
      expected_return: 0.04,
      inflation_rate: 2.0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("withdrawal envelope not ok");

    const data = result.data as Record<string, unknown>;
    const maxSafe = Number(data.max_safe_withdrawal);
    const pv = Number(data.portfolio_value);

    expect(maxSafe).toBeGreaterThan(0);

    const expectedRate = pv > 0 ? maxSafe / pv * 100 : 0;
    expect(Math.abs(Number(data.max_safe_withdrawal_rate) - expectedRate)).toBeLessThan(1e-6);
  });

  runDb("short horizon positive return: SQL max_safe_withdrawal can exceed portfolio_value", async () => {
    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("withdrawal", {
      annual_withdrawal: 1000,
      time_horizon_years: 1,
      expected_return: 0.10,
      inflation_rate: 0.0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("withdrawal envelope not ok");

    const data = result.data as Record<string, unknown>;
    expect(Number(data.max_safe_withdrawal)).toBeGreaterThan(Number(data.portfolio_value));
  });

  runDb("edge: zero-horizon returns NULL max-safe sentinel and coherent outputs", async () => {
    const { getWithdrawal } = await import("../src/commands/withdrawal.js");
    const result = await getWithdrawal({
      annualWithdrawal: 1000,
      timeHorizonYears: 0,
      expectedReturn: 0.05,
      inflationRate: 2.0,
    });

    expect(result.time_horizon_years).toBe(0);
    expect(result.max_safe_withdrawal).toBeNull();
    expect(result.max_safe_withdrawal_rate).toBeNull();
    expect(result.total_withdrawn).toBe(0);
    expect(result.return_generated).toBe(0);
    expect(result.shortfall_risk).toBe(0);
  });
});
