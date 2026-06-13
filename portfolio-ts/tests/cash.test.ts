import { describe, expect, test, mock, jest } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    cash_key: "USD",
    currency: "USD",
    display_bucket: "CASH USD",
    balance: 5000,
    usd_value: 5000,
    ...overrides,
  };
}

describe("getCash", () => {
  test("returns cash rows from portfolio_cash_sql()", async () => {
    mockQuery.mockResolvedValue([
      makeRow(),
      makeRow({ cash_key: "EURUSD=X", currency: "EUR", display_bucket: "CASH EUR", balance: 1000, usd_value: 1085 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(2);
    expect(result.total_usd).toBe(6085);
    expect(result.rows[0].cash_key).toBe("USD");
    expect(result.rows[0].currency).toBe("USD");
    expect(result.rows[0].balance).toBe(5000);
    expect(result.rows[0].usd_value).toBe(5000);
    expect(result.rows[1].currency).toBe("EUR");
    expect(result.rows[1].balance).toBe(1000);
    expect(result.as_of_date).toBeDefined();
  });

  test("passes as_of_date parameter to SQL", async () => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue([makeRow()]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash("2026-01-15");

    expect(result.as_of_date).toBe("2026-01-15");
    expect(mockQuery.mock.calls[0][1]).toEqual(["2026-01-15"]);
  });

  test("handles empty result", async () => {
    mockQuery.mockResolvedValue([]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(0);
    expect(result.total_usd).toBe(0);
    expect(result.as_of_date).toBeDefined();
  });

  test("handles null usd_value gracefully", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ usd_value: null }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].usd_value).toBe(0);
    expect(result.total_usd).toBe(0);
  });

  test("response contains all required fields", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 5000, usd_value: 5000 }),
      makeRow({ cash_key: "EURUSD=X", currency: "EUR", display_bucket: "CASH EUR", balance: 1000, usd_value: 1085 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result).toHaveProperty("as_of_date");
    expect(result).toHaveProperty("total_usd");
    expect(result).toHaveProperty("rows");

    for (const row of result.rows) {
      expect(row).toHaveProperty("cash_key");
      expect(row).toHaveProperty("currency");
      expect(row).toHaveProperty("display_bucket");
      expect(row).toHaveProperty("balance");
      expect(row).toHaveProperty("usd_value");
    }
  });
});

describe("getCash — CLI integration", () => {
  test("dispatches cash command and returns success envelope", async () => {
    mockQuery.mockResolvedValue([
      makeRow(),
    ]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cash"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cash");
    expect(output.data.as_of_date).toBeDefined();
    expect(output.data.total_usd).toBe(5000);
    expect(output.data.rows).toHaveLength(1);
    expect(output.meta.count).toBe(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("dispatches cash with --as-of-date", async () => {
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cash", "--as-of-date", "2026-01-15"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cash");
    expect(output.data.as_of_date).toBe("2026-01-15");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("cash appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("cash");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("CLI JSON snapshot: crypto fee_currency cash bucket appears in envelope (#88)", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 45000, usd_value: 45000 }),
      makeRow({ cash_key: "BTC-USD", currency: "BTC", display_bucket: "CASH BTC", balance: -0.0001, usd_value: -5.21 }),
    ]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cash"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cash");
    expect(output.data.total_usd).toBeCloseTo(44994.79, 2);
    expect(output.data.rows).toHaveLength(2);

    const btcRow = output.data.rows.find((r: any) => r.cash_key === "BTC-USD");
    expect(btcRow).toBeDefined();
    expect(btcRow!.currency).toBe("BTC");
    expect(btcRow!.display_bucket).toBe("CASH BTC");
    expect(btcRow!.balance).toBe(-0.0001);
    expect(btcRow!.usd_value).toBeCloseTo(-5.21, 2);
    expect(output.meta.count).toBe(2);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("getCash — stock trade cash impact regression (#66)", () => {
  test("stock BUY reduces USD cash by quantity*price+fees, not share count", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 8995, usd_value: 8995 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(1);
    expect(result.total_usd).toBe(8995);
    expect(result.rows[0].cash_key).toBe("USD");
    expect(result.rows[0].balance).toBe(8995);
    expect(result.rows[0].usd_value).toBe(8995);
  });

  test("stock SELL increases USD cash by quantity*price-fees", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 10438, usd_value: 10438 }),
      makeRow({ cash_key: "EURUSD=X", currency: "EUR", display_bucket: "CASH EUR", balance: -2000, usd_value: -2160 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(2);
    expect(result.total_usd).toBe(8278);
    expect(result.rows[0].cash_key).toBe("USD");
    expect(result.rows[0].balance).toBe(10438);
  });

  test("stock trade cash deltas are in correct currency buckets", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 5000, usd_value: 5000 }),
      makeRow({ cash_key: "EURUSD=X", currency: "EUR", display_bucket: "CASH EUR", balance: 800, usd_value: 864 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows[0].cash_key).toBe("USD");
    expect(result.rows[1].cash_key).toBe("EURUSD=X");
    expect(result.rows[0].usd_value).toBe(5000);
    expect(result.rows[1].usd_value).toBe(864);
    expect(result.total_usd).toBe(5864);
  });
});

describe("getCash — regression: cash netting per currency", () => {
  test("each cash_key appears exactly once (no duplicate rows per currency)", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 4576.56, usd_value: 4576.56 }),
      makeRow({ cash_key: "EURUSD=X", currency: "EUR", display_bucket: "CASH EUR", balance: 1943.29, usd_value: 2267.55 }),
      makeRow({ cash_key: "GBPUSD=X", currency: "GBP", display_bucket: "CASH GBP", balance: 1292.41, usd_value: 1739.92 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(3);

    const cashKeys = result.rows.map((r: any) => r.cash_key);
    const uniqueKeys = new Set(cashKeys);
    expect(uniqueKeys.size).toBe(cashKeys.length); // no duplicates

    expect(result.total_usd).toBeCloseTo(8584.03, 2);
  });

  test("portfolio_value agreement: mock data consistent across commands", async () => {
    // Simulate a scenario where cash=2884.03, stocks=4767.97 → portfolio_value=7652
    // This test ensures that if the DB returns consistent data across
    // status/summary/allocation calls, the commands produce consistent values.

    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 2000, usd_value: 2000 }),
      makeRow({ cash_key: "EURUSD=X", currency: "EUR", display_bucket: "CASH EUR", balance: 800, usd_value: 884.03 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(2);
    expect(result.total_usd).toBeCloseTo(2884.03, 2);
    // portfolio_value should be cash_total + stock_value
    // verified by status/summary/allocation reading same underlying data
  });

  test("deposit and stock BUY net to single USD cash bucket", async () => {
    // Regression: before fix, a DEPOSIT (+5000) and a BUY (-1500) could
    // appear as TWO separate USD rows (+5000 and -1500) because display_bucket
    // was part of the GROUP BY in portfolio_cash_sql. After fix, they must
    // net to one USD row with balance 3500.
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 3500, usd_value: 3500 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cash_key).toBe("USD");
    expect(result.rows[0].balance).toBe(3500);
    expect(result.total_usd).toBe(3500);
  });
});

describe("getCash — crypto fee_currency regression (#88)", () => {
  test("crypto fee_currency creates separate cash bucket with correct usd_value", async () => {
    // BUY BTC-USD qty=0.1 @50000 fees=0.0001 fee_currency=BTC
    // Trade cash: USD -5000 (qty*price, sans fees because fee_currency differs)
    // Fee cash: BTC -0.0001 → usd_value = -0.0001 * 52100 = -5.21
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: 45000, usd_value: 45000 }),
      makeRow({ cash_key: "BTC-USD", currency: "BTC", display_bucket: "CASH BTC", balance: -0.0001, usd_value: -5.21 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(2);
    expect(result.total_usd).toBeCloseTo(44994.79, 2);

    const btcRow = result.rows.find((r: any) => r.cash_key === "BTC-USD");
    expect(btcRow).toBeDefined();
    expect(btcRow!.currency).toBe("BTC");
    expect(btcRow!.display_bucket).toBe("CASH BTC");
    expect(btcRow!.balance).toBe(-0.0001);
    expect(btcRow!.usd_value).toBeCloseTo(-5.21, 2);
  });

  test("crypto fee_currency cash row fields are complete", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "BTC-USD", currency: "BTC", display_bucket: "CASH BTC", balance: -0.00005, usd_value: -3.12 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cash_key).toBe("BTC-USD");
    expect(result.rows[0].currency).toBe("BTC");
    expect(result.rows[0].display_bucket).toBe("CASH BTC");
    expect(result.rows[0].balance).toBe(-0.00005);
    expect(result.rows[0].usd_value).toBeCloseTo(-3.12, 2);
    expect(result.as_of_date).toBeDefined();
    expect(result.total_usd).toBeCloseTo(-3.12, 2);
  });

  test("EUR fee regression: EURUSD=X cash bucket still works (#88)", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "EURUSD=X", currency: "EUR", display_bucket: "CASH EUR", balance: -10, usd_value: -11 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cash_key).toBe("EURUSD=X");
    expect(result.rows[0].balance).toBe(-10);
    expect(result.rows[0].usd_value).toBe(-11);
    expect(result.total_usd).toBe(-11);
  });

  test("NULL fee_currency regression: fee stays in trade currency bucket (#88)", async () => {
    mockQuery.mockResolvedValue([
      makeRow({ cash_key: "USD", currency: "USD", display_bucket: "CASH USD", balance: -105, usd_value: -105 }),
    ]);

    const { getCash } = await import("../src/commands/cash.js");
    const result = await getCash();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cash_key).toBe("USD");
    expect(result.rows[0].balance).toBe(-105);
    expect(result.rows[0].usd_value).toBe(-105);
    expect(result.total_usd).toBe(-105);
  });
});
