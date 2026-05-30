import { describe, expect, test, mock } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

describe("getStatus", () => {
  test("returns status with transaction count and portfolio value", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    mockQuerySingle.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)")) return { count: 42 };
      if (sql.includes("MIN(date)")) return { start_date: "2024-01-15", end_date: "2026-03-20" };
      if (sql.includes("portfolio_value")) return { portfolio_value: 125000.50, as_of_date: "2026-03-20" };
      return null;
    });

    mockQuery.mockResolvedValue([
      { action: "DEPOSIT", cnt: 5, total_quantity: 100000 },
      { action: "WITHDRAW", cnt: 2, total_quantity: 15000 },
      { action: "DIVIDEND", cnt: 10, total_quantity: 2500 },
      { action: "BUY", cnt: 20, total_quantity: 0 },
      { action: "SELL", cnt: 8, total_quantity: 0 },
      { action: "FEE", cnt: 5, total_quantity: 120 },
      { action: "TAX", cnt: 1, total_quantity: 50 },
    ]);

    const { getStatus } = await import("../src/commands/status.js");
    const result = await getStatus();

    expect(result.transactions).toBe(42);
    expect(result.start_date).toBe("2024-01-15");
    expect(result.end_date).toBe("2026-03-20");
    expect(result.portfolio_value).toBe(125000.50);
    expect(result.deposits).toBe(100000);
    expect(result.withdrawals).toBe(15000);
    expect(result.total_invested).toBe(85000);
    expect(result.income).toBe(2500);
    expect(result.fees).toBe(120);
    expect(result.taxes).toBe(50);
    expect(result.as_of_date).toBe("2026-03-20");
  });

  test("handles empty database gracefully", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    mockQuerySingle.mockResolvedValue(null);
    mockQuery.mockResolvedValue([]);

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
  });
});
