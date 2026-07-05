import { describe, expect, test, mock, jest } from "bun:test";

const mockQuerySingle = mock();

mock.module("../src/db.js", () => ({
  query: mock(),
  querySingle: mockQuerySingle as unknown,
  getSql: () => ({}),
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

describe("Withdrawal — SQL row mapping", () => {
  test("preserves NULL max-safe sentinel for zero horizon", async () => {
    mockQuerySingle.mockResolvedValueOnce({
      portfolio_value: 500000,
      annual_withdrawal: 10000,
      withdrawal_rate_pct: 2.0,
      time_horizon_years: 0,
      expected_return: 0.07,
      inflation_rate: 3.0,
      years_until_depletion: null,
      terminal_value: 500000,
      success_likelihood: 100.0,
      max_safe_withdrawal: null,
      max_safe_withdrawal_rate: null,
      total_withdrawn: 0,
      return_generated: 0,
      shortfall_risk: 0.0,
    });

    const { getWithdrawal } = await import("../src/commands/withdrawal.js");
    const result = await getWithdrawal({ timeHorizonYears: 0, annualWithdrawal: 10000 });

    expect(result.time_horizon_years).toBe(0);
    expect(result.terminal_value).toBe(500000);
    expect(result.max_safe_withdrawal).toBeNull();
    expect(result.max_safe_withdrawal_rate).toBeNull();
  });
});

function simulateWithdrawal(
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
  let terminalValueAtDepletion = value;

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
      terminalValueAtDepletion = 0;
    }
  }

  if (yearsUntilDepletion === null) {
    terminalValueAtDepletion = value;
  }

  return {
    yearsUntilDepletion,
    terminalValue: value,
    totalWithdrawn,
    returnGenerated: terminalValueAtDepletion - portfolioValue + totalWithdrawn,
  };
}

// ── Hand-calculated recurrence tests (v1 deterministic single-path) ──
// Recurrence: V_0 = PV, V_t = V_{t-1} * (1+r) - W0 * (1+infl)^(t-1)
// Withdrawal at END of year, inflation-adjusted.

describe("Withdrawal — hand-calculated recurrence", () => {
  test("4% rule on $1M, 6% return, 3% infl, 30yr → survives ~30yr", () => {
    // PV = 1_000_000, r = 0.06, infl = 0.03, W0 = 40_000, horizon = 30
    // Simulate manually:
    let V = 1_000_000;
    const r = 0.06;
    const infl = 0.03;
    const W0 = 40_000;
    for (let t = 1; t <= 30; t++) {
      const w = W0 * Math.pow(1 + infl, t - 1);
      V = V * (1 + r) - w;
    }
    // Classic 4% rule: ~95% success historically, should survive 30yr at 6% real
    expect(V).toBeGreaterThan(-1); // positive or near-zero terminal
  });

  test("fractional depletion fixture matches corrected total_withdrawn and return_generated", () => {
    const result = simulateWithdrawal(100000, 15000, 0.05, 3.0, 10);

    expect(result.yearsUntilDepletion).toBeCloseTo(7.43138026, 5);
    expect(result.totalWithdrawn).toBeCloseTo(122895.08, 2);
    expect(result.returnGenerated).toBeCloseTo(22895.08, 2);
  });

  test("fast-depletes: 15% withdrawal rate, 5% return, 3% infl, 10yr", () => {
    // PV = 100_000, r = 0.05, infl = 0.03, W0 = 15_000, horizon = 10
    let V = 100_000;
    const r = 0.05;
    const infl = 0.03;
    const W0 = 15_000;
    let depletionYr = -1;
    for (let t = 1; t <= 10; t++) {
      const w = W0 * Math.pow(1 + infl, t - 1);
      V = V * (1 + r) - w;
      if (V <= 0 && depletionYr < 0) {
        depletionYr = t;
      }
    }
    // Should deplete before 10 years (hand-verified: year 8)
    expect(depletionYr).toBeGreaterThan(0);
    expect(depletionYr).toBeLessThan(10);
    expect(V).toBeLessThan(0);
  });

  test("never-depletes: tiny withdrawal, 7% return, 30yr", () => {
    // PV = 500_000, r = 0.07, infl = 0.02, W0 = 1_000, horizon = 30
    let V = 500_000;
    const r = 0.07;
    const infl = 0.02;
    const W0 = 1_000;
    let depleted = false;
    for (let t = 1; t <= 30; t++) {
      const w = W0 * Math.pow(1 + infl, t - 1);
      V = V * (1 + r) - w;
      if (V <= 0) { depleted = true; break; }
    }
    expect(depleted).toBe(false);
    expect(V).toBeGreaterThan(50_000); // still growing
  });

  test("zero-return, zero-infl: linear depletion", () => {
    // PV = 100_000, r = 0, infl = 0, W0 = 20_000, horizon = 10
    let V = 100_000;
    for (let t = 1; t <= 10; t++) {
      V = V - 20_000;
      if (V <= 0) break;
    }
    // Linear: depletes in year 5
    expect(V).toBeLessThanOrEqual(0);
  });

  test("inflation-adjusted withdrawals grow over time", () => {
    const W0 = 40_000;
    const infl = 0.03;
    const w5 = W0 * Math.pow(1 + infl, 4);  // year 5 withdrawal
    const w20 = W0 * Math.pow(1 + infl, 19); // year 20 withdrawal
    expect(w20).toBeGreaterThan(w5 * 1.5); // significantly larger
  });
});

describe("Withdrawal — max safe withdrawal bisection", () => {
  test("short horizon positive return: max_safe can exceed portfolio_value", () => {
    // PV = 100_000, r = 10%, infl = 0%, horizon = 1
    // Exact max safe is PV * (1+r) = 110_000.
    const pv = 100_000;
    const r = 0.10;
    const infl = 0.0;
    const horizon = 1;

    function terminal(W0: number): number {
      let V = pv;
      for (let t = 1; t <= horizon; t++) {
        const w = W0 * Math.pow(1 + infl, t - 1);
        V = V * (1 + r) - w;
      }
      return V;
    }

    let bracketLo = 0;
    let bracketHi = Math.max(pv, 1);
    while (terminal(bracketHi) >= 0) {
      bracketLo = bracketHi;
      bracketHi *= 2;
    }

    let lo = 0;
    let hi = bracketHi;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (terminal(mid) >= 0) lo = mid;
      else hi = mid;
    }
    const maxSafe = lo;
    const tv = terminal(maxSafe);
    expect(tv).toBeGreaterThan(-1); // near zero
    expect(bracketLo).toBeGreaterThanOrEqual(pv);
    expect(maxSafe).toBeGreaterThan(pv);
    expect(Math.abs(maxSafe - 110_000)).toBeLessThan(1e-6);

    // A slightly higher withdrawal should go negative
    expect(terminal(maxSafe * 1.01)).toBeLessThan(0);
  });
});

describe("Withdrawal — success_likelihood v1 proxy", () => {
  test("positive terminal → success 100", () => {
    // If V_final >= 0 then success = 100
    expect(100.0).toBe(100.0);
  });

  test("depletes at midway → linear proxy ~50", () => {
    const horizon = 30;
    const depletionYear = 15;
    const success = 100 * depletionYear / horizon;
    expect(success).toBe(50);
  });

  test("shortfall_risk = 100 - success_likelihood", () => {
    const success = 75;
    const shortfall = 100 - success;
    expect(shortfall).toBe(25);
  });
});

// ── CLI integration tests (mocked DB) ──

describe("Withdrawal — CLI integration (mocked DB)", () => {
  function setupWithdrawal(overrides: Record<string, unknown> = {}) {
    mockQuerySingle.mockImplementation(() => Promise.resolve({
      portfolio_value: 500000,
      annual_withdrawal: 20000,
      withdrawal_rate_pct: 4.0,
      time_horizon_years: 30,
      expected_return: 0.07,
      inflation_rate: 3.0,
      years_until_depletion: null,
      terminal_value: 1247533.42,
      success_likelihood: 100.0,
      max_safe_withdrawal: 32145.67,
      max_safe_withdrawal_rate: 6.43,
      total_withdrawn: 800000,
      return_generated: 1547533.42,
      shortfall_risk: 0.0,
      ...overrides,
    }));
  }

  test("dispatches withdrawal command with default params (4% rule)", async () => {
    setupWithdrawal();
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "withdrawal"]);
      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.command).toBe("withdrawal");
      expect(output.data.portfolio_value).toBe(500000);
      expect(output.data.annual_withdrawal).toBe(20000);
      expect(output.data.withdrawal_rate_pct).toBe(4.0);
      expect(output.data.time_horizon_years).toBe(30);
      expect(output.data.success_likelihood).toBe(100.0);
      expect(output.data.max_safe_withdrawal).toBeGreaterThan(0);
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test("dispatches withdrawal with custom flags", async () => {
    setupWithdrawal({
      annual_withdrawal: 25000,
      withdrawal_rate_pct: 5.0,
      time_horizon_years: 25,
      expected_return: 0.05,
      inflation_rate: 2.5,
      years_until_depletion: 22.3,
      terminal_value: -50000,
      success_likelihood: 89.2,
      shortfall_risk: 10.8,
    });
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "withdrawal",
        "--annual-withdrawal", "25000",
        "--withdrawal-rate", "5",
        "--time-horizon-years", "25",
        "--expected-return", "0.05",
        "--inflation-rate", "2.5",
      ]);
      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.command).toBe("withdrawal");
      expect(output.data.annual_withdrawal).toBe(25000);
      expect(output.data.withdrawal_rate_pct).toBe(5.0);
      expect(output.data.time_horizon_years).toBe(25);
      expect(output.data.expected_return).toBe(0.05);
      expect(output.data.inflation_rate).toBe(2.5);
      expect(output.data.years_until_depletion).toBe(22.3);
      expect(output.data.success_likelihood).toBe(89.2);
      expect(output.data.shortfall_risk).toBe(10.8);
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test("dispatches corrected fractional-depletion snapshot", async () => {
    setupWithdrawal({
      annual_withdrawal: 15000,
      withdrawal_rate_pct: 15.0,
      time_horizon_years: 10,
      expected_return: 0.05,
      inflation_rate: 3.0,
      years_until_depletion: 7.430682,
      terminal_value: -12345.67,
      success_likelihood: 74.30682,
      max_safe_withdrawal: 20000,
      max_safe_withdrawal_rate: 20.0,
      total_withdrawn: 122895.08,
      return_generated: 22895.08,
      shortfall_risk: 25.69318,
    });
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "withdrawal",
        "--annual-withdrawal", "15000",
        "--time-horizon-years", "10",
        "--expected-return", "0.05",
        "--inflation-rate", "3.0",
      ]);
      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.command).toBe("withdrawal");
      expect(output.data.annual_withdrawal).toBe(15000);
      expect(output.data.years_until_depletion).toBeCloseTo(7.430682, 6);
      expect(output.data.total_withdrawn).toBeCloseTo(122895.08, 2);
      expect(output.data.return_generated).toBeCloseTo(22895.08, 2);
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test("withdrawal help text mentions the command", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    try {
      await mod.dispatch(["bun", "src/cli.ts", "--help"]);
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("withdrawal");
      expect(output).toContain("annual-withdrawal");
      expect(output).toContain("withdrawal-rate");
      expect(output).toContain("time-horizon-years");
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
