import { describe, expect, test, mock } from "bun:test";
import { ValidationError, NotFoundError } from "../src/validators.js";

const mockQuerySingle = mock();
const mockWithTransaction = mock();

mock.module("../src/db.ts", () => ({
  query: mock(),
  querySingle: mockQuerySingle,
  runTx: mockWithTransaction,
  connect: () => {},
  close: () => {},
}));

describe("deletePreview", () => {
  test("throws NOT_FOUND when transaction missing", async () => {
    mockQuerySingle.mockResolvedValue(null);
    const { deletePreview } = await import("../src/commands/delete.js");
    await expect(deletePreview(42)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("returns dry_run result with would_delete", async () => {
    mockQuerySingle.mockResolvedValue({
      date: new Date("2026-01-15"),
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
    });
    const { deletePreview } = await import("../src/commands/delete.js");
    const result = await deletePreview(42);
    expect(result.dry_run).toBe(true);
    expect(result.transaction_id).toBe(42);
    expect(result.would_delete.date).toBe("2026-01-15");
    expect(result.would_delete.asset).toBe("AAPL");
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

  test("succeeds: deletes and recalculates", async () => {
    mockQuerySingle.mockResolvedValue({ id: 42, date: new Date("2026-01-15") });
    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async () => []),
      };
      return fn(fakeTx);
    });

    const { deleteTransaction } = await import("../src/commands/delete.js");
    const result = await deleteTransaction(42, true);

    expect(result.deleted_id).toBe(42);
    expect(result.recalculated).toBe(true);
  });
});
