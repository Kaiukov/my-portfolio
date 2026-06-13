import { describe, expect, test, mock } from "bun:test";
import { ValidationError, NotFoundError } from "../src/validators.js";

const mockQuerySingle = mock();
const mockQuery = mock();
const mockWithTransaction = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mockWithTransaction,
}));

describe("deletePreview", () => {
  test("throws NOT_FOUND when transaction missing", async () => {
    mockQuerySingle.mockResolvedValue(null);
    const { deletePreview } = await import("../src/commands/delete.js");
    await expect(deletePreview(42)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("returns dry_run result with single would_delete row for normal BUY", async () => {
    mockQuerySingle.mockResolvedValue({
      id: 42,
      date: new Date("2026-01-15"),
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
      exchange_group_id: null,
    });
    const { deletePreview } = await import("../src/commands/delete.js");
    const result = await deletePreview(42);
    expect(result.dry_run).toBe(true);
    expect(result.transaction_id).toBe(42);
    expect(result.is_exchange_group).toBe(false);
    expect(result.would_delete).toHaveLength(1);
    expect(result.would_delete[0].date).toBe("2026-01-15");
    expect(result.would_delete[0].asset).toBe("AAPL");
  });

  test("shows group-aware preview for exchange leg with group_id", async () => {
    mockQuerySingle.mockResolvedValue({
      id: 99,
      date: new Date("2026-02-01"),
      asset: "USD",
      action: "EXCHANGE_FROM",
      quantity: -1000,
      exchange_group_id: "uuid-group-123",
    });
    mockQuery.mockResolvedValue([
      {
        id: 99,
        date: new Date("2026-02-01"),
        asset: "USD",
        action: "EXCHANGE_FROM",
        quantity: -1000,
      },
      {
        id: 100,
        date: new Date("2026-02-01"),
        asset: "EURUSD=X",
        action: "EXCHANGE_TO",
        quantity: 920,
      },
    ]);

    const { deletePreview } = await import("../src/commands/delete.js");
    const result = await deletePreview(99);
    expect(result.dry_run).toBe(true);
    expect(result.is_exchange_group).toBe(true);
    expect(result.would_delete).toHaveLength(2);
    expect(result.would_delete[0].action).toBe("EXCHANGE_FROM");
    expect(result.would_delete[1].action).toBe("EXCHANGE_TO");
  });

  test("shows single-row preview for legacy exchange leg (null group_id)", async () => {
    mockQuerySingle.mockResolvedValue({
      id: 99,
      date: new Date("2026-02-01"),
      asset: "USD",
      action: "EXCHANGE_FROM",
      quantity: -1000,
      exchange_group_id: null,
    });
    const { deletePreview } = await import("../src/commands/delete.js");
    const result = await deletePreview(99);
    expect(result.dry_run).toBe(true);
    expect(result.is_exchange_group).toBe(false);
    expect(result.would_delete).toHaveLength(1);
  });
});

describe("deleteTransaction", () => {
  test("throws VALIDATION_ERROR without --confirm", async () => {
    const { deleteTransaction } = await import("../src/commands/delete.js");
    await expect(deleteTransaction(42, false)).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws NOT_FOUND when transaction missing", async () => {
    mockQuerySingle.mockResolvedValue(null);
    const { deleteTransaction } = await import("../src/commands/delete.js");
    await expect(deleteTransaction(42, true)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("succeeds: deletes single normal row and recalculates", async () => {
    mockQuerySingle.mockResolvedValue({
      id: 42,
      date: new Date("2026-01-15"),
      action: "BUY",
      exchange_group_id: null,
    });
    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async () => []),
      };
      return fn(fakeTx);
    });

    const { deleteTransaction } = await import("../src/commands/delete.js");
    const result = await deleteTransaction(42, true);

    expect(result.deleted_ids).toEqual([42]);
    expect(result.recalculated).toBe(true);
  });

  test("group delete: removes both exchange legs sharing group_id", async () => {
    mockQuerySingle.mockResolvedValue({
      id: 99,
      date: new Date("2026-02-01"),
      action: "EXCHANGE_FROM",
      exchange_group_id: "uuid-group-123",
    });
    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("DELETE FROM transactions"))
            return [{ id: 99 }, { id: 100 }];
          return [];
        }),
      };
      return fn(fakeTx);
    });

    const { deleteTransaction } = await import("../src/commands/delete.js");
    const result = await deleteTransaction(99, true);

    expect(result.deleted_ids).toEqual([99, 100]);
    expect(result.recalculated).toBe(true);
  });

  test("rejects legacy ungrouped EXCHANGE_FROM with clear error", async () => {
    mockQuerySingle.mockResolvedValue({
      id: 99,
      date: new Date("2026-02-01"),
      action: "EXCHANGE_FROM",
      exchange_group_id: null,
    });
    const { deleteTransaction } = await import("../src/commands/delete.js");

    await expect(deleteTransaction(99, true)).rejects.toBeInstanceOf(ValidationError);
    try {
      await deleteTransaction(99, true);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("before exchange grouping");
      expect(msg).toContain("blocked");
    }
  });

  test("rejects legacy ungrouped EXCHANGE_TO with clear error", async () => {
    mockQuerySingle.mockResolvedValue({
      id: 100,
      date: new Date("2026-02-01"),
      action: "EXCHANGE_TO",
      exchange_group_id: null,
    });
    const { deleteTransaction } = await import("../src/commands/delete.js");

    await expect(deleteTransaction(100, true)).rejects.toBeInstanceOf(ValidationError);
    try {
      await deleteTransaction(100, true);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("before exchange grouping");
      expect(msg).toContain("blocked");
    }
  });

  test("normal DEPOSIT delete still works (regression)", async () => {
    mockQuerySingle.mockResolvedValue({
      id: 10,
      date: new Date("2026-01-01"),
      action: "DEPOSIT",
      exchange_group_id: null,
    });
    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async () => []),
      };
      return fn(fakeTx);
    });

    const { deleteTransaction } = await import("../src/commands/delete.js");
    const result = await deleteTransaction(10, true);

    expect(result.deleted_ids).toEqual([10]);
    expect(result.recalculated).toBe(true);
  });
});
