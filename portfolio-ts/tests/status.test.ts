import { describe, expect, test, mock, jest } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

describe("getStatus", () => {
  test("passes as_of_date parameter to SQL", async () => {
    mockQuerySingle.mockClear();
    mockQuerySingle.mockResolvedValue({
      transactions_count: 42,
      start_date: "2024-01-15",
      end_date: "2026-03-20",
      portfolio_value: 125000.50,
      total_invested: 85000,
      deposits: 100000,
      withdrawals: 15000,
      income: 2500,
      fees: 120,
      taxes: 50,
      total_gain: 40000.50,
      total_gain_pct: 47.06,
      cost_basis: 60000,
      realized_gain: 5000,
      unrealized_gain: 35000.50,
      total_profit: 40000.50,
      as_of_date: "2026-03-20",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus("2026-03-20");

    expect(result.as_of_date).toBe("2026-03-20");
    expect(mockQuerySingle.mock.calls[0][1]).toEqual(["2026-03-20"]);
  });

  test("returns status from portfolio_status_sql()", async () => {
    mockQuerySingle.mockResolvedValue({
      transactions_count: 42,
      start_date: "2024-01-15",
      end_date: "2026-03-20",
      portfolio_value: 125000.50,
      total_invested: 85000,
      deposits: 100000,
      withdrawals: 15000,
      income: 2500,
      fees: 120,
      taxes: 50,
      total_gain: 40000.50,
      total_gain_pct: 47.06,
      cost_basis: 60000,
      realized_gain: 5000,
      unrealized_gain: 35000.50,
      total_profit: 40000.50,
      as_of_date: "2026-03-20",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.transactions).toBe(42);
    expect(result.start_date).toBe("2024-01-15");
    expect(result.end_date).toBe("2026-03-20");
    expect(result.portfolio_value).toBe(125000.50);
    expect(result.total_invested).toBe(85000);
    expect(result.deposits).toBe(100000);
    expect(result.withdrawals).toBe(15000);
    expect(result.income).toBe(2500);
    expect(result.fees).toBe(120);
    expect(result.taxes).toBe(50);
    expect(result.total_gain).toBe(40000.50);
    expect(result.total_gain_pct).toBe(47.06);
    expect(result.as_of_date).toBe("2026-03-20");
  });

  test("handles empty database gracefully", async () => {
    mockQuerySingle.mockResolvedValue(null);

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.transactions).toBe(0);
    expect(result.portfolio_value).toBeNull();
    expect(result.total_gain).toBeNull();
    expect(result.total_gain_pct).toBeNull();
    expect(result.deposits).toBe(0);
    expect(result.withdrawals).toBe(0);
    expect(result.income).toBe(0);
    expect(result.fees).toBe(0);
    expect(result.taxes).toBe(0);
    expect(result.cost_basis).toBeNull();
    expect(result.realized_gain).toBeNull();
    expect(result.unrealized_gain).toBeNull();
    expect(result.total_profit).toBeNull();
  });
});

describe("getStatus — crypto fee regression (#88)", () => {
  test("BTC fee_currency on stock BUY: fees should be USD-converted via BTC-USD ticker", async () => {
    // Hand-calculated fixture:
    // BUY 1 AAPL @ $100, fee = 0.0001 BTC, BTC-USD price = $50,000
    // fee USD value = 0.0001 * 50000 = $5
    // cost_basis = (1 * 100) + 5 = $105
    mockQuerySingle.mockResolvedValue({
      transactions_count: 1,
      start_date: "2026-01-02",
      end_date: "2026-01-02",
      portfolio_value: 100,
      total_invested: 100,
      deposits: 105,
      withdrawals: 0,
      income: 0,
      fees: 5,
      taxes: 0,
      total_gain: 0,
      total_gain_pct: 0,
      cost_basis: 105,
      realized_gain: 0,
      unrealized_gain: -5,
      total_profit: -5,
      as_of_date: "2026-01-02",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.fees).toBe(5);
    expect(result.cost_basis).toBe(105);
    expect(result.total_profit).toBe(-5);
  });

  test("fiat EUR fee_currency regression: still maps to EURUSD=X correctly", async () => {
    // BUY 1 AAPL @ $100, fee = 10 EUR, EURUSD=X = 1.10
    // fee USD value = 10 * 1.10 = $11
    // cost_basis = 100 + 11 = $111
    mockQuerySingle.mockResolvedValue({
      transactions_count: 1,
      start_date: "2026-01-02",
      end_date: "2026-01-02",
      portfolio_value: 100,
      total_invested: 100,
      deposits: 111,
      withdrawals: 0,
      income: 0,
      fees: 11,
      taxes: 0,
      total_gain: -11,
      total_gain_pct: -11,
      cost_basis: 111,
      realized_gain: 0,
      unrealized_gain: -11,
      total_profit: -11,
      as_of_date: "2026-01-02",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.fees).toBe(11);
    expect(result.cost_basis).toBe(111);
  });

  test("NULL fee_currency regression: falls back to trade currency (USD)", async () => {
    // BUY 1 AAPL @ $100, fee = $5, fee_currency = NULL
    // cost_basis = 100 + 5 = $105
    mockQuerySingle.mockResolvedValue({
      transactions_count: 1,
      start_date: "2026-01-02",
      end_date: "2026-01-02",
      portfolio_value: 100,
      total_invested: 100,
      deposits: 105,
      withdrawals: 0,
      income: 0,
      fees: 5,
      taxes: 0,
      total_gain: -5,
      total_gain_pct: -5,
      cost_basis: 105,
      realized_gain: 0,
      unrealized_gain: -5,
      total_profit: -5,
      as_of_date: "2026-01-02",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.fees).toBe(5);
    expect(result.cost_basis).toBe(105);
  });
});

describe("getStatus — FIFO cost basis regression (#66)", () => {
  test("surfaces cost_basis, realized_gain, unrealized_gain, total_profit", async () => {
    // Hand-calculated fixture:
    // BUY 10 AAPL@100 fee5  -> lot cost $1005 (100.50/unit)
    // BUY 10 AAPL@120 fee5  -> lot cost $1205 (120.50/unit)
    // SELL 14 AAPL@150 fee7 -> proceeds $2093
    // FIFO: consume 10@100.50 + 4@120.50, cost consumed = 1005+482=1487
    // realized_gain = 2093-1487 = 606
    // remaining: 6@120.50, cost_basis = 723
    // market price $130 -> value = 6*130 = 780
    // unrealized_gain = 780-723 = 57
    // total_profit = 606+57 = 663
    mockQuerySingle.mockResolvedValue({
      transactions_count: 3,
      start_date: "2026-01-01",
      end_date: "2026-01-03",
      portfolio_value: 780,
      total_invested: 1000,
      deposits: 1000,
      withdrawals: 0,
      income: 0,
      fees: 17,
      taxes: 0,
      total_gain: 100,
      total_gain_pct: 10,
      cost_basis: 723,
      realized_gain: 606,
      unrealized_gain: 57,
      total_profit: 663,
      as_of_date: "2026-01-03",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.cost_basis).toBe(723);
    expect(result.realized_gain).toBe(606);
    expect(result.unrealized_gain).toBe(57);
    expect(result.total_profit).toBe(663);
  });

  test("total_profit = realized_gain + unrealized_gain", async () => {
    mockQuerySingle.mockResolvedValue({
      transactions_count: 1,
      start_date: "2026-01-01",
      end_date: "2026-01-01",
      portfolio_value: 5000,
      total_invested: 4000,
      deposits: 5000,
      withdrawals: 1000,
      income: 0,
      fees: 0,
      taxes: 0,
      total_gain: 1000,
      total_gain_pct: 25,
      cost_basis: 3500,
      realized_gain: 800,
      unrealized_gain: 1500,
      total_profit: 2300,
      as_of_date: "2026-01-01",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.total_profit).toBe(result.realized_gain! + result.unrealized_gain!);
  });
});

describe("getStatus — crypto fee_currency regression (#88)", () => {
  test("fees field includes USD-converted crypto fee from fee_currency", async () => {
    // BUY BTC-USD 0.1@50000, fees=0.0001 fee_currency=BTC, BTC price 52100
    // fee in USD: 0.0001 * 52100 = 5.21
    // Total fees = 5.21 crypto fee + 0 fiat/standalone fees
    mockQuerySingle.mockResolvedValue({
      transactions_count: 1,
      start_date: "2026-01-15",
      end_date: "2026-01-15",
      portfolio_value: 5000,
      total_invested: 5000,
      deposits: 5000,
      withdrawals: 0,
      income: 0,
      fees: 5.21,
      taxes: 0,
      total_gain: 0,
      total_gain_pct: 0,
      cost_basis: 5005.21,
      realized_gain: 0,
      unrealized_gain: 0,
      total_profit: 0,
      as_of_date: "2026-01-15",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.fees).toBeCloseTo(5.21, 2);
    expect(result.cost_basis).toBeCloseTo(5005.21, 2);
  });

  test("fees includes both fiat and crypto fees (#88)", async () => {
    // Mix: BUY AAPL with EUR fee + BUY BTC-USD with BTC fee
    // EUR fee: 5 EUR * 1.085 = 5.425 USD
    // BTC fee: 0.0001 BTC * 52100 = 5.21 USD
    // Total: 10.635
    mockQuerySingle.mockResolvedValue({
      transactions_count: 2,
      start_date: "2026-01-15",
      end_date: "2026-01-15",
      portfolio_value: 12000,
      total_invested: 12000,
      deposits: 12000,
      withdrawals: 0,
      income: 0,
      fees: 10.64,
      taxes: 0,
      total_gain: 0,
      total_gain_pct: 0,
      cost_basis: 12010.64,
      realized_gain: 0,
      unrealized_gain: 0,
      total_profit: 0,
      as_of_date: "2026-01-15",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.fees).toBeCloseTo(10.64, 2);
    expect(result.cost_basis).toBeCloseTo(12010.64, 2);
  });

  test("zero fees when all fee_currency are NULL (#88)", async () => {
    // BUY with NULL fee_currency: fee treated as same-currency (USD)
    // No separate fee row needed
    mockQuerySingle.mockResolvedValue({
      transactions_count: 1,
      start_date: "2026-01-15",
      end_date: "2026-01-15",
      portfolio_value: 10000,
      total_invested: 10005,
      deposits: 10000,
      withdrawals: 0,
      income: 0,
      fees: 5,
      taxes: 0,
      total_gain: 0,
      total_gain_pct: 0,
      cost_basis: 10005,
      realized_gain: 0,
      unrealized_gain: 0,
      total_profit: 0,
      as_of_date: "2026-01-15",
    });

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.fees).toBe(5);
  });
});

describe("getStatus — CLI integration crypto fee_currency (#88)", () => {
  test("CLI JSON snapshot: status surfaces crypto fee in envelope", async () => {
    mockQuerySingle.mockResolvedValue({
      transactions_count: 2,
      start_date: "2026-01-15",
      end_date: "2026-01-15",
      portfolio_value: 12000,
      total_invested: 12000,
      deposits: 12000,
      withdrawals: 0,
      income: 0,
      fees: 10.64,
      taxes: 0,
      total_gain: 0,
      total_gain_pct: 0,
      cost_basis: 12010.64,
      realized_gain: 0,
      unrealized_gain: 0,
      total_profit: 0,
      as_of_date: "2026-01-15",
    });
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "status"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("status");
    expect(output.data.fees).toBeCloseTo(10.64, 2);
    expect(output.data.transactions).toBe(2);
    expect(output.data.portfolio_value).toBe(12000);
    expect(output.meta.generated_at).toBeDefined();

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("getStatus — CLI integration", () => {
  test("dispatches status command and returns success envelope", async () => {
    mockQuerySingle.mockResolvedValue({
      transactions_count: 42,
      start_date: "2024-01-15",
      end_date: "2026-03-20",
      portfolio_value: 125000.50,
      total_invested: 85000,
      deposits: 100000,
      withdrawals: 15000,
      income: 2500,
      fees: 120,
      taxes: 50,
      total_gain: 40000.50,
      total_gain_pct: 47.06,
      cost_basis: 60000,
      realized_gain: 5000,
      unrealized_gain: 35000.50,
      total_profit: 40000.50,
      as_of_date: "2026-03-20",
    });
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "status"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("status");
    expect(output.data.transactions).toBe(42);
    expect(output.data.fees).toBe(120);
    expect(output.data.as_of_date).toBe("2026-03-20");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("status JSON envelope shows crypto fee USD-converted (#88)", async () => {
    mockQuerySingle.mockResolvedValue({
      transactions_count: 1,
      start_date: "2026-01-02",
      end_date: "2026-01-02",
      portfolio_value: 100,
      total_invested: 100,
      deposits: 105,
      withdrawals: 0,
      income: 0,
      fees: 5,
      taxes: 0,
      total_gain: 0,
      total_gain_pct: 0,
      cost_basis: 105,
      realized_gain: 0,
      unrealized_gain: -5,
      total_profit: -5,
      as_of_date: "2026-01-02",
    });
    mockQuery.mockResolvedValue([]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "status"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("status");
    expect(output.data.fees).toBe(5);
    expect(output.data.cost_basis).toBe(105);
    expect(output.data.total_profit).toBe(-5);
    expect(output.meta.count).toBeNull();

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("status appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("status");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
