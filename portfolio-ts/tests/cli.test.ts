import { describe, expect, test, mock, jest } from "bun:test";

mock.module("../src/db.js", () => ({
  query: mock(),
  querySingle: mock(),
  connect: () => {},
  close: async () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

const MOCK_INCOME_RESULT = {
  as_of_date: "2026-06-03",
  from_date: "2026-01-01",
  total_income_usd: 1542.75,
  total_dividends_usd: 1420.50,
  total_interest_usd: 122.25,
  rows: [
    {
      asset: "AAPL",
      action: "DIVIDEND",
      total_quantity: 42.5,
      usd_value: 1420.50,
      currency: "USD",
      transaction_count: 4,
      first_date: "2026-02-15",
      last_date: "2026-05-15",
    },
  ],
};

mock.module("../src/commands/income.js", () => ({
  getIncome: mock(() => Promise.resolve(MOCK_INCOME_RESULT)),
}));

const MOCK_CURRENCY_EXPOSURE_RESULT = {
  as_of_date: "2026-06-03",
  portfolio_value: 150000.00,
  rows: [
    { currency: "USD", usd_value: 120000.00, pct: 80.0, holdings_usd: 115000.0, cash_usd: 5000.0 },
    { currency: "EUR", usd_value: 20000.00, pct: 13.33, holdings_usd: 18000.0, cash_usd: 2000.0 },
    { currency: "GBP", usd_value: 10000.00, pct: 6.67, holdings_usd: 9000.0, cash_usd: 1000.0 },
  ],
};

mock.module("../src/commands/currency_exposure.js", () => ({
  getCurrencyExposure: mock(() => Promise.resolve(MOCK_CURRENCY_EXPOSURE_RESULT)),
}));

const MOCK_REALIZED_GAINS_RESULT = {
  as_of_date: "2026-06-03",
  from_date: null,
  to_date: "2026-06-03",
  asset: null,
  total_realized_gain: 500.00,
  short_term_gain: 200.00,
  long_term_gain: 300.00,
  by_year: [],
  rows: [
    {
      sell_date: "2026-02-15",
      sell_id: 10,
      asset: "AAPL",
      sell_quantity: 5,
      proceeds_usd: 750,
      cost_basis_usd: 500,
      realized_gain: 250,
      holding_days: 45,
      matched_buy_id: 3,
      matched_buy_date: "2026-01-01",
    },
    {
      sell_date: "2026-03-20",
      sell_id: 11,
      asset: "AAPL",
      sell_quantity: 5,
      proceeds_usd: 750,
      cost_basis_usd: 500,
      realized_gain: 250,
      holding_days: 425,
      matched_buy_id: 2,
      matched_buy_date: "2025-01-15",
    },
  ],
};

mock.module("../src/commands/realized_gains.js", () => ({
  getRealizedGains: mock(() => Promise.resolve(MOCK_REALIZED_GAINS_RESULT)),
}));

describe("CLI parsing", () => {
  test("--help prints help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("portfolio");
    expect(output).toContain("status");
    expect(output).toContain("income");
    expect(output).toContain("realized-gains");
    expect(output).toContain("transactions");
    expect(output).toContain("currency_exposure");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("-h prints help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "-h"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("portfolio");
    expect(output).toContain("status");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("unknown command returns error envelope", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "nonexistent"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("nonexistent");
    expect(output.error.code).toBe("UNKNOWN_COMMAND");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("income command returns correct JSON envelope", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await mod.dispatch(["bun", "src/cli.ts", "income", "--as-of-date", "2026-06-03", "--from-date", "2026-01-01"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("income");
    expect(output.data).toEqual(MOCK_INCOME_RESULT);
    expect(output.meta.count).toBe(1);
    expect(output.meta.generated_at).toBeDefined();

    logSpy.mockRestore();
  });

  test("currency_exposure command returns correct JSON envelope", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await mod.dispatch(["bun", "src/cli.ts", "currency_exposure", "--as-of-date", "2026-06-03"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("currency_exposure");
    expect(output.data).toEqual(MOCK_CURRENCY_EXPOSURE_RESULT);
    expect(output.meta.count).toBe(3);
    expect(output.meta.generated_at).toBeDefined();

    logSpy.mockRestore();
  });

  test("realized-gains command returns correct JSON envelope", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await mod.dispatch(["bun", "src/cli.ts", "realized-gains", "--to-date", "2026-06-03"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("realized_gains");
    expect(output.data).toEqual(MOCK_REALIZED_GAINS_RESULT);
    expect(output.meta.count).toBe(2);
    expect(output.meta.generated_at).toBeDefined();

    logSpy.mockRestore();
  });

  test("gains alias works for realized-gains", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await mod.dispatch(["bun", "src/cli.ts", "gains", "--to-date", "2026-06-03"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("realized_gains");
    expect(output.meta.count).toBe(2);

    logSpy.mockRestore();
  });

  test("no command prints help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("portfolio");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
