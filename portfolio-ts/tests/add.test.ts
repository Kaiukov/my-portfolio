import { describe, expect, test, mock } from "bun:test";
import { ValidationError } from "../src/validators.js";

const mockQuerySingle = mock();
const mockWithTransaction = mock();

mock.module("../src/db.ts", () => ({
  query: mock(),
  querySingle: mockQuerySingle,
  withTransaction: mockWithTransaction,
  connect: () => {},
  close: () => {},
}));

describe("addTransaction validation", () => {
  test("throws on missing exchange", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        price: 150,
        exchange: "",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws on invalid date format", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "2026-01-01",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        price: 150,
        exchange: "Interactive",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws on BUY without price", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        exchange: "Interactive",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws on negative quantity", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "AAPL",
        action: "BUY",
        quantity: -5,
        price: 150,
        exchange: "Interactive",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws on unknown action", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "AAPL",
        action: "INVALID",
        quantity: 10,
        price: 150,
        exchange: "Interactive",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("SELL: throws when quantity exceeds holdings", async () => {
    mockQuerySingle.mockResolvedValue({ net: "5" });
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "AAPL",
        action: "SELL",
        quantity: 10,
        price: 150,
        exchange: "Interactive",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("succeeds: inserts, recalculates, returns transaction", async () => {
    mockQuerySingle.mockResolvedValue(null); // SELL check not called for BUY

    const fakeRow = {
      id: 99,
      date: new Date("2026-01-01"),
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
      asset_type: "stock_usd",
      price: 150.0,
      currency: "USD",
      fees: null,
      fee_currency: null,
      exchange: "Interactive",
      data_source: "",
      account: null,
      created_at: new Date("2026-01-01T10:00:00Z"),
      updated_at: null,
    };

    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "stock_usd" }];
          if (sql.includes("INSERT INTO transactions")) return [{ id: 99 }];
          if (sql.includes("refresh_daily_returns_sql")) return [];
          if (sql.includes("SELECT id, date")) return [fakeRow];
          return [];
        }),
      };
      return fn(fakeTx);
    });

    const { addTransaction } = await import("../src/commands/add.js");
    const result = await addTransaction({
      dateStr: "01-01-2026",
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
      price: 150,
      exchange: "Interactive",
    });

    expect(result.recalculated).toBe(true);
    expect(result.transaction.id).toBe(99);
    expect(result.transaction.asset).toBe("AAPL");
    expect(result.transaction.action).toBe("BUY");
  });
});
