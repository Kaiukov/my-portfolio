import { describe, expect, test, mock } from "bun:test";
import { ValidationError, NotFoundError } from "../src/validators.js";

const mockQuerySingle = mock();
const mockWithTransaction = mock();

mock.module("../src/db.js", () => ({
  query: mock(),
  querySingle: mockQuerySingle,
  withTransaction: mockWithTransaction,
  connect: () => {},
  close: () => {},
}));

function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    date: new Date("2026-01-15"),
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
    ...overrides,
  };
}

describe("editDryRun", () => {
  test("throws when no changes provided", async () => {
    const { editDryRun } = await import("../src/commands/edit.js");
    await expect(editDryRun(42, {})).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws NOT_FOUND when transaction missing", async () => {
    mockQuerySingle.mockResolvedValue(null);
    const { editDryRun } = await import("../src/commands/edit.js");
    await expect(editDryRun(42, { price: 155 })).rejects.toBeInstanceOf(NotFoundError);
  });

  test("returns dry_run preview", async () => {
    mockQuerySingle.mockResolvedValue(makeDbRow());
    const { editDryRun } = await import("../src/commands/edit.js");
    const result = await editDryRun(42, { price: 155.5 });
    expect(result.dry_run).toBe(true);
    expect(result.transaction_id).toBe(42);
    expect(result.current.id).toBe(42);
    expect(result.proposed_changes["price"]).toBe("155.5");
  });
});

describe("editTransaction", () => {
  test("throws when no changes provided", async () => {
    const { editTransaction } = await import("../src/commands/edit.js");
    await expect(editTransaction(42, {})).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws NOT_FOUND when transaction missing", async () => {
    mockQuerySingle.mockResolvedValue(null);
    const { editTransaction } = await import("../src/commands/edit.js");
    await expect(editTransaction(42, { price: 155 })).rejects.toBeInstanceOf(NotFoundError);
  });

  test("succeeds: updates transaction and recalculates", async () => {
    const existing = makeDbRow();
    const updated = makeDbRow({ price: 155.5 });

    mockQuerySingle.mockResolvedValue(existing);
    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "stock_usd" }];
          if (sql.includes("UPDATE transactions")) return [updated];
          if (sql.includes("refresh_daily_returns_sql")) return [];
          return [];
        }),
      };
      return fn(fakeTx);
    });

    const { editTransaction } = await import("../src/commands/edit.js");
    const result = await editTransaction(42, { price: 155.5 });

    expect(result.recalculated).toBe(true);
    expect(result.before.id).toBe(42);
    expect(result.transaction.price).toBe(155.5);
    expect(result.from_date).toBe("2026-01-15");
  });
});
