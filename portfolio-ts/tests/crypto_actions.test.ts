import { describe, expect, test, mock, beforeEach } from "bun:test";
import { ValidationError } from "../src/validators.js";

const mockQuerySingle = mock();
const mockWithTransaction = mock();

mock.module("../src/db.js", () => ({
  query: mock(),
  querySingle: mockQuerySingle,
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  getSql: () => ({}),
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mockWithTransaction,
}));

beforeEach(() => {
  mockQuerySingle.mockReset();
  mockWithTransaction.mockReset();
});

describe("staking rewards", () => {
  test("rejects cash-like assets", async () => {
    mockQuerySingle.mockResolvedValueOnce({ asset_type: "cash_base", cash_like: true });
    const { applyStakingReward } = await import("../src/commands/reward.js");

    await expect(
      applyStakingReward({
        dateStr: "2026-01-02",
        asset: "USD",
        quantity: 1,
        exchange: "Binance",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("accepts crypto reward and inserts a zero-basis lot", async () => {
    mockQuerySingle.mockResolvedValueOnce({ asset_type: "crypto", cash_like: false });
    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("INSERT INTO transactions")) return [{ id: 42 }];
          if (sql.includes("SELECT id, date")) {
            return [{
              id: 42,
              date: new Date("2026-01-02"),
              asset: "BTC-USD",
              action: "STAKING_REWARD",
              quantity: 0.00017429,
              asset_type: "crypto",
              price: null,
              currency: "USD",
              fees: null,
              fee_currency: null,
              exchange: "Binance",
              data_source: "",
              account: null,
              created_at: new Date(),
              updated_at: null,
            }];
          }
          return [];
        }),
      };
      return fn(fakeTx);
    });

    const { applyStakingReward } = await import("../src/commands/reward.js");
    const result = await applyStakingReward({
      dateStr: "2026-01-02",
      asset: "BTC-USD",
      quantity: 0.00017429,
      exchange: "Binance",
    });

    expect(result.recalculated).toBe(true);
    expect(result.transaction.action).toBe("STAKING_REWARD");
    expect(result.transaction.price).toBeNull();
    expect(result.transaction.quantity).toBeCloseTo(0.00017429, 8);
  });
});

describe("crypto wrap conversions", () => {
  test("rejects same asset on both sides", async () => {
    const { applyWrap } = await import("../src/commands/wrap.js");

    await expect(
      applyWrap({
        dateStr: "2026-02-01",
        fromAsset: "ETH-USD",
        toAsset: "eth-usd",
        fromQuantity: 1,
        toQuantity: 1.05,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("accepts crypto conversion and returns exchange_group_id", async () => {
    mockQuerySingle
      .mockResolvedValueOnce({ asset_type: "crypto", cash_like: false })
      .mockResolvedValueOnce({ asset_type: "crypto", cash_like: false });

    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("get_asset_type_sql")) {
            return [{ asset_type: "crypto" }, { asset_type: "crypto" }];
          }
          if (sql.includes("INSERT INTO transactions") && sql.includes("'WRAP'")) return [{ id: 101 }];
          if (sql.includes("INSERT INTO transactions") && sql.includes("'UNWRAP'")) return [{ id: 102 }];
          if (sql.includes("refresh_daily_returns_sql")) return [];
          return [];
        }),
      };
      return fn(fakeTx);
    });

    const { applyUnwrap } = await import("../src/commands/wrap.js");
    const result = await applyUnwrap({
      dateStr: "2026-02-01",
      fromAsset: "WBETH-USD",
      toAsset: "ETH-USD",
      fromQuantity: 1.05,
      toQuantity: 1,
    });

    expect(result.from.asset).toBe("WBETH-USD");
    expect(result.to.asset).toBe("ETH-USD");
    expect(result.exchange_group_id).toBeString();
    expect(result.transaction_ids).toEqual([101, 102]);
  });
});
