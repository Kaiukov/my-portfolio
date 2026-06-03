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
    expect(output).toContain("transactions");

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
