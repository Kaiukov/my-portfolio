import { describe, expect, test, mock, beforeEach } from "bun:test";
import { ValidationError } from "../src/validators.js";

const mockAddTransaction = mock();
const mockAddDryRun = mock();

mock.module("../src/db.js", () => ({
  query: () => Promise.resolve([]),
  querySingle: () => Promise.resolve({ asset_type: "stock_usd", ok: true }),
  getAssetMetadata: () => Promise.resolve([]),
  upsertAssetMetadata: () => Promise.resolve(),
  connect: () => {},
  close: async () => {},
  getSql: () => ({}),
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

beforeEach(() => {
  mockAddTransaction.mockReset();
  mockAddDryRun.mockReset();
});

describe("POST /transactions dry-run", () => {
  test("POST /transactions?dry_run=true routes to addDryRun", async () => {
    mockAddDryRun.mockResolvedValue({
      dry_run: true,
      preview: {
        date: "2026-01-20",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        price: 150.25,
        currency: "USD",
        exchange: "Interactive Brokers",
        asset_type: "stock_usd",
      },
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions?dry_run=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-01-20",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        price: 150.25,
        currency: "USD",
        exchange: "Interactive Brokers",
      }),
    });
    const res = await handleRequest(req, {
      write: { addTransaction: mockAddTransaction, addDryRun: mockAddDryRun },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("add");
    expect(body.data.dry_run).toBe(true);
    expect(body.data.preview).toBeDefined();
    expect(body.data.preview.asset).toBe("AAPL");
    expect(mockAddDryRun).toHaveBeenCalledWith({
      dateStr: "2026-01-20",
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
      price: 150.25,
      currency: "USD",
      fees: undefined,
      feeCurrency: undefined,
      exchange: "Interactive Brokers",
      account: undefined,
    });
    expect(mockAddTransaction).not.toHaveBeenCalled();
  });

  test("POST /transactions?dryRun=true (camelCase) routes to addDryRun", async () => {
    mockAddDryRun.mockResolvedValue({
      dry_run: true,
      preview: {
        date: "2026-01-20",
        asset: "GOOGL",
        action: "BUY",
        quantity: 5,
        price: 2800,
        currency: "USD",
        exchange: "Fidelity",
        asset_type: "stock_usd",
      },
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions?dryRun=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-01-20",
        asset: "GOOGL",
        action: "BUY",
        quantity: 5,
        price: 2800,
        exchange: "Fidelity",
      }),
    });
    const res = await handleRequest(req, {
      write: { addTransaction: mockAddTransaction, addDryRun: mockAddDryRun },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.dry_run).toBe(true);
    expect(mockAddDryRun).toHaveBeenCalledTimes(1);
    expect(mockAddTransaction).not.toHaveBeenCalled();
  });

  test("POST /transactions with dry-run in body routes to addDryRun", async () => {
    mockAddDryRun.mockResolvedValue({
      dry_run: true,
      preview: {
        date: "2026-01-20",
        asset: "MSFT",
        action: "SELL",
        quantity: 15,
        price: 400,
        currency: "USD",
        exchange: "Schwab",
        asset_type: "stock_usd",
      },
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-01-20",
        asset: "MSFT",
        action: "SELL",
        quantity: 15,
        price: 400,
        exchange: "Schwab",
        dry_run: true,
      }),
    });
    const res = await handleRequest(req, {
      write: { addTransaction: mockAddTransaction, addDryRun: mockAddDryRun },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.dry_run).toBe(true);
    expect(mockAddDryRun).toHaveBeenCalledTimes(1);
    expect(mockAddTransaction).not.toHaveBeenCalled();
  });

  test("POST /transactions?dry-run (no value) routes to addDryRun", async () => {
    mockAddDryRun.mockResolvedValue({
      dry_run: true,
      preview: {
        date: "2026-01-20",
        asset: "TSLA",
        action: "BUY",
        quantity: 20,
        price: 250,
        currency: "USD",
        exchange: "Robinhood",
        asset_type: "stock_usd",
      },
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions?dry-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-01-20",
        asset: "TSLA",
        action: "BUY",
        quantity: 20,
        price: 250,
        exchange: "Robinhood",
      }),
    });
    const res = await handleRequest(req, {
      write: { addTransaction: mockAddTransaction, addDryRun: mockAddDryRun },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.dry_run).toBe(true);
    expect(mockAddDryRun).toHaveBeenCalledTimes(1);
    expect(mockAddTransaction).not.toHaveBeenCalled();
  });

  test("POST /transactions without dry_run routes to addTransaction", async () => {
    mockAddTransaction.mockResolvedValue({
      transaction: { id: 101, asset: "AAPL", action: "BUY" },
      recalculated: true,
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-01-20",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        price: 150.25,
        exchange: "Interactive Brokers",
      }),
    });
    const res = await handleRequest(req, {
      write: { addTransaction: mockAddTransaction, addDryRun: mockAddDryRun },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("add");
    expect(body.data.transaction).toBeDefined();
    expect(mockAddTransaction).toHaveBeenCalledWith({
      dateStr: "2026-01-20",
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
      price: 150.25,
      currency: undefined,
      fees: undefined,
      feeCurrency: undefined,
      exchange: "Interactive Brokers",
      account: undefined,
    });
    expect(mockAddTransaction).toHaveBeenCalledTimes(1);
    expect(mockAddDryRun).not.toHaveBeenCalled();
  });

  test("POST /transactions?dry_run=false routes to addTransaction", async () => {
    mockAddTransaction.mockResolvedValue({
      transaction: { id: 102, asset: "GOOGL", action: "SELL" },
      recalculated: true,
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions?dry_run=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-01-20",
        asset: "GOOGL",
        action: "SELL",
        quantity: 5,
        price: 2800,
        exchange: "Fidelity",
      }),
    });
    const res = await handleRequest(req, {
      write: { addTransaction: mockAddTransaction, addDryRun: mockAddDryRun },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockAddTransaction).toHaveBeenCalledTimes(1);
    expect(mockAddDryRun).not.toHaveBeenCalled();
  });

  test("dry-run validation errors propagate correctly", async () => {
    mockAddDryRun.mockRejectedValue(new ValidationError("Validation error"));

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions?dry_run=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-01-20",
        asset: "INVALID",
        action: "BUY",
        quantity: 10,
        price: 150.25,
        exchange: "Interactive Brokers",
      }),
    });
    const res = await handleRequest(req, {
      write: { addTransaction: mockAddTransaction, addDryRun: mockAddDryRun },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("dry-run preview includes optional fields when provided", async () => {
    mockAddDryRun.mockResolvedValue({
      dry_run: true,
      preview: {
        date: "2026-01-20",
        asset: "VTI",
        action: "BUY",
        quantity: 100,
        price: 250,
        currency: "USD",
        fees: 1.5,
        fee_currency: "USD",
        exchange: "Vanguard",
        asset_type: "stock_usd",
        account: "IRA",
      },
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions?dry_run=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-01-20",
        asset: "VTI",
        action: "BUY",
        quantity: 100,
        price: 250,
        currency: "USD",
        fees: 1.5,
        fee_currency: "USD",
        exchange: "Vanguard",
        account: "IRA",
      }),
    });
    const res = await handleRequest(req, {
      write: { addTransaction: mockAddTransaction, addDryRun: mockAddDryRun },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.dry_run).toBe(true);
    expect(body.data.preview.fees).toBe(1.5);
    expect(body.data.preview.fee_currency).toBe("USD");
    expect(body.data.preview.account).toBe("IRA");
  });
});