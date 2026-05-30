import { describe, expect, test, mock } from "bun:test";
import { ValidationError } from "../src/validators.js";

const mockQuerySingle = mock();
const mockWithTransaction = mock();
const mockQueryInternal = mock();

mock.module("../src/db.js", () => ({
  query: mockQueryInternal,
  querySingle: mockQuerySingle,
  runTx: mockWithTransaction,
  connect: () => {},
  close: () => {},
}));

describe("exchangeCurrency", () => {
  test("throws when from and to are the same", async () => {
    const { exchangeCurrency } = await import("../src/commands/exchange.js");
    await expect(
      exchangeCurrency({
        dateStr: "01-01-2026",
        fromAsset: "USD",
        toAsset: "USD",
        quantity: 1000,
        rate: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws on invalid date format", async () => {
    const { exchangeCurrency } = await import("../src/commands/exchange.js");
    await expect(
      exchangeCurrency({
        dateStr: "2026-01-01",
        fromAsset: "USD",
        toAsset: "EURUSD=X",
        quantity: 1000,
        rate: 0.92,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws when FROM is not cash-like", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ ok: false }) // from: AAPL is not cash-like
      .mockResolvedValueOnce({ ok: true });
    const { exchangeCurrency } = await import("../src/commands/exchange.js");
    await expect(
      exchangeCurrency({
        dateStr: "01-01-2026",
        fromAsset: "AAPL",
        toAsset: "USD",
        quantity: 1000,
        rate: 0.92,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("succeeds: creates two transactions and recalculates", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ ok: true }) // from: USD is cash-like
      .mockResolvedValueOnce({ ok: true }); // to: EURUSD=X is cash-like

    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "cash_base" }];
          if (sql.includes("EXCHANGE_FROM")) return [{ id: 101 }];
          if (sql.includes("EXCHANGE_TO")) return [{ id: 102 }];
          if (sql.includes("refresh_daily_returns_sql")) return [];
          return [];
        }),
      };
      return fn(fakeTx);
    });

    const { exchangeCurrency } = await import("../src/commands/exchange.js");
    const result = await exchangeCurrency({
      dateStr: "01-01-2026",
      fromAsset: "USD",
      toAsset: "EURUSD=X",
      quantity: 1000,
      rate: 0.92,
    });

    expect(result.from.asset).toBe("USD");
    expect(result.from.quantity).toBe(1000);
    expect(result.to.asset).toBe("EURUSD=X");
    expect(result.to.quantity).toBe(920);
    expect(result.rate).toBe(0.92);
    expect(result.date).toBe("2026-01-01");
    expect(result.transaction_ids).toEqual([101, 102]);
  });
});
