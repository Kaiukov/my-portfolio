import { describe, test, expect, mock, beforeEach } from "bun:test";
import { NotFoundError, ValidationError } from "../src/validators.js";

const mockAddTransaction = mock();
const mockEditTransaction = mock();
const mockEditDryRun = mock();
const mockDeleteTransaction = mock();
const mockDeletePreview = mock();
const mockExchangeCurrency = mock();

beforeEach(() => {
  mockAddTransaction.mockReset();
  mockEditTransaction.mockReset();
  mockEditDryRun.mockReset();
  mockDeleteTransaction.mockReset();
  mockDeletePreview.mockReset();
  mockExchangeCurrency.mockReset();
});

function writeCtx() {
  return {
    write: {
      addTransaction: mockAddTransaction,
      editTransaction: mockEditTransaction,
      editDryRun: mockEditDryRun,
      deleteTransaction: mockDeleteTransaction,
      deletePreview: mockDeletePreview,
      exchangeCurrency: mockExchangeCurrency,
    },
  };
}

describe("mcpWrite", () => {
  test("add_transaction routes to addTransaction", async () => {
    mockAddTransaction.mockResolvedValue({ transaction: { id: 1 }, recalculated: true });

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite(
      "add_transaction",
      {
        date: "2026-01-20",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        price: 155.5,
        currency: "USD",
        fees: 1,
        fee_currency: "USD",
        exchange: "IBKR",
      },
      writeCtx(),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe("add");
    expect(mockAddTransaction).toHaveBeenCalledWith({
      dateStr: "2026-01-20",
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
      price: 155.5,
      currency: "USD",
      fees: 1,
      feeCurrency: "USD",
      exchange: "IBKR",
      account: undefined,
    });
  });

  test("edit_transaction routes dry-run to editDryRun", async () => {
    mockEditDryRun.mockResolvedValue({ dry_run: true, transaction_id: 42, current: { id: 42 }, proposed_changes: {} });

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite(
      "edit_transaction",
      { id: 42, price: 155.5, dry_run: "1" },
      writeCtx(),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe("edit");
    expect(mockEditDryRun).toHaveBeenCalledTimes(1);
    expect(mockEditDryRun).toHaveBeenCalledWith(42, expect.objectContaining({ price: 155.5 }));
    expect(mockEditTransaction).not.toHaveBeenCalled();
  });

  test("delete_transaction routes confirmed delete to deleteTransaction", async () => {
    mockDeleteTransaction.mockResolvedValue({ deleted_ids: [42], recalculated: true });

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite(
      "delete_transaction",
      { id: 42, confirm: true },
      writeCtx(),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe("delete");
    expect(mockDeleteTransaction).toHaveBeenCalledWith(42, true);
  });

  test("exchange_currency routes to exchangeCurrency with aliases", async () => {
    mockExchangeCurrency.mockResolvedValue({ rate: 0.92, transaction_ids: [1, 2] });

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite(
      "exchange_currency",
      {
        date: "2026-01-20",
        from_asset: "USD",
        to: "EURUSD=X",
        quantity: "1000",
        rate: "0.92",
      },
      writeCtx(),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe("exchange");
    expect(mockExchangeCurrency).toHaveBeenCalledWith({
      dateStr: "2026-01-20",
      fromAsset: "USD",
      toAsset: "EURUSD=X",
      quantity: 1000,
      rate: 0.92,
    });
  });

  test("delete_transaction maps explicit-confirmation validation to CONFIRM_REQUIRED", async () => {
    mockDeleteTransaction.mockImplementation(async () => {
      throw new ValidationError("Deletion of transaction ID 42 requires explicit confirmation.");
    });

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite("delete_transaction", { id: 42 }, writeCtx());

    if (result.ok) throw new Error("Expected error envelope");
    expect(result.ok).toBe(false);
    expect(result.command).toBe("delete");
    expect(result.error.code).toBe("CONFIRM_REQUIRED");
  });

  test("edit_transaction maps not-found errors", async () => {
    mockEditTransaction.mockRejectedValue(new NotFoundError("Transaction ID 999 not found"));

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite("edit_transaction", { id: 999, price: 100 }, writeCtx());

    if (result.ok) throw new Error("Expected error envelope");
    expect(result.ok).toBe(false);
    expect(result.command).toBe("edit");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  test("exchange_currency maps unexpected errors to INTERNAL_ERROR", async () => {
    mockExchangeCurrency.mockRejectedValue(new Error("boom"));

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite(
      "exchange_currency",
      { date: "2026-01-20", fromAsset: "USD", toAsset: "EURUSD=X", quantity: 10, rate: 0.92 },
      writeCtx(),
    );

    if (result.ok) throw new Error("Expected error envelope");
    expect(result.ok).toBe(false);
    expect(result.command).toBe("exchange");
    expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(result.error.message).toBe("boom");
  });
});
