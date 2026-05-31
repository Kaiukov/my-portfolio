import { describe, expect, test, mock } from "bun:test";
import { ValidationError } from "../src/validators.js";

const mockQuerySingle = mock();
const mockQuery = mock();
const mockWithTransaction = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mockWithTransaction,
}));

describe("exchangeCurrency", () => {
  test("throws when from and to are the same", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ normalized: "USD" })
      .mockResolvedValueOnce({ normalized: "USD" });
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

  test("throws when equivalent cash buckets: USD vs CASH USD", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ normalized: "USD" })
      .mockResolvedValueOnce({ normalized: "USD" });
    const { exchangeCurrency } = await import("../src/commands/exchange.js");
    await expect(
      exchangeCurrency({
        dateStr: "01-01-2026",
        fromAsset: "USD",
        toAsset: "CASH USD",
        quantity: 1000,
        rate: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws when equivalent cash buckets: CASH USD vs USD", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ normalized: "USD" })
      .mockResolvedValueOnce({ normalized: "USD" });
    const { exchangeCurrency } = await import("../src/commands/exchange.js");
    await expect(
      exchangeCurrency({
        dateStr: "01-01-2026",
        fromAsset: "CASH USD",
        toAsset: "USD",
        quantity: 1000,
        rate: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("accepts ISO YYYY-MM-DD date format", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ normalized: "USD" })
      .mockResolvedValueOnce({ normalized: "EURUSD=X" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "cash_base" }, { asset_type: "cash_fx" }];
          if (sql.includes("INSERT INTO transactions")) return [{ id: 1 }, { id: 2 }];
          if (sql.includes("refresh_daily_returns_sql")) return [];
          return [];
        }),
      };
      return fn(fakeTx);
    });
    const { exchangeCurrency } = await import("../src/commands/exchange.js");
    const result = await exchangeCurrency({
      dateStr: "2026-01-01",
      fromAsset: "USD",
      toAsset: "EURUSD=X",
      quantity: 1000,
      rate: 0.92,
    });
    expect(result.date).toBe("2026-01-01");
    expect(result.exchange_group_id).toBeString();
    expect(result.exchange_group_id.length).toBeGreaterThan(0);
  });

  test("throws when FROM is not cash-like", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ normalized: "AAPL" })
      .mockResolvedValueOnce({ normalized: "USD" })
      .mockResolvedValueOnce({ ok: false })
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

  test("succeeds: creates two transactions with exchange_group_id and recalculates", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ normalized: "USD" })
      .mockResolvedValueOnce({ normalized: "EURUSD=X" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

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
    expect(result.exchange_group_id).toBeString();
    expect(result.exchange_group_id.length).toBeGreaterThan(0);
  });

  test("sets exchange_group_id on both legs inside transaction", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ normalized: "USD" })
      .mockResolvedValueOnce({ normalized: "EURUSD=X" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    let capturedFromGroupId: string | undefined;
    let capturedToGroupId: string | undefined;

    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string, params?: unknown[]) => {
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "cash_base" }];
          if (sql.includes("EXCHANGE_FROM")) {
            capturedFromGroupId = params?.[5] as string;
            return [{ id: 1 }];
          }
          if (sql.includes("EXCHANGE_TO")) {
            capturedToGroupId = params?.[5] as string;
            return [{ id: 2 }];
          }
          return [];
        }),
      };
      return fn(fakeTx);
    });

    const { exchangeCurrency } = await import("../src/commands/exchange.js");
    await exchangeCurrency({
      dateStr: "2026-01-01",
      fromAsset: "USD",
      toAsset: "EURUSD=X",
      quantity: 1000,
      rate: 0.92,
    });

    expect(capturedFromGroupId).toBeDefined();
    expect(capturedToGroupId).toBeDefined();
    expect(capturedFromGroupId).toBe(capturedToGroupId);
    expect(capturedFromGroupId!.length).toBeGreaterThan(0);
  });
});
