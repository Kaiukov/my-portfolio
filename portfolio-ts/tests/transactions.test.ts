import { describe, expect, test, mock } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  getSql: () => ({}),
  connect: () => {},
  close: () => {},
}));

function makeRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    date: new Date(`2026-01-${String(id).padStart(2, "0")}`),
    asset: "AAPL",
    action: "BUY",
    quantity: 10,
    asset_type: "stock_usd",
    price: 150.0,
    currency: "USD",
    fees: 1.5,
    fee_currency: "USD",
    exchange: "Interactive",
    data_source: "manual",
    account: null,
    created_at: new Date("2026-01-15T10:00:00Z"),
    updated_at: null,
    ...overrides,
  };
}

describe("getTransactions", () => {
  test("returns paginated transactions", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    mockQuerySingle.mockResolvedValue({ count: 3 });

    mockQuery.mockResolvedValue([
      makeRow(1),
      makeRow(2),
      makeRow(3),
    ]);

    const { getTransactions } = await import("../src/commands/transactions.js");
    const result = await getTransactions(10, 0);

    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(3);
    expect(result.data[0].id).toBe(1);
    expect(result.data[1].id).toBe(2);
    expect(result.data[2].id).toBe(3);
  });

  test("applies date filters", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    mockQuerySingle.mockResolvedValue({ count: 1 });
    mockQuery.mockResolvedValue([makeRow(1, { date: new Date("2026-01-15") })]);

    const { getTransactions } = await import("../src/commands/transactions.js");
    const result = await getTransactions(10, 0, "2026-01-01", "2026-01-31");

    expect(result.total).toBe(1);
    expect(result.data[0].date).toBe("2026-01-15");
  });

  test("returns empty result when no transactions", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    mockQuerySingle.mockResolvedValue({ count: 0 });
    mockQuery.mockResolvedValue([]);

    const { getTransactions } = await import("../src/commands/transactions.js");
    const result = await getTransactions();

    expect(result.total).toBe(0);
    expect(result.data).toHaveLength(0);
  });

  test("formats transaction row correctly", async () => {
    mockQuerySingle.mockClear();
    mockQuery.mockClear();

    mockQuerySingle.mockResolvedValue({ count: 1 });
    mockQuery.mockResolvedValue([
      makeRow(1, {
        date: new Date("2026-01-15"),
        asset: "MSFT",
        action: "SELL",
        quantity: 5,
        asset_type: "stock_usd",
        price: 400.0,
        currency: "USD",
        fees: 2.0,
        fee_currency: "USD",
        exchange: "Robinhood",
        data_source: "csv",
        account: "broker_a",
        created_at: new Date("2026-01-15T12:00:00Z"),
        updated_at: new Date("2026-01-16T08:00:00Z"),
      }),
    ]);

    const { getTransactions } = await import("../src/commands/transactions.js");
    const result = await getTransactions();

    const tx = result.data[0];
    expect(tx.id).toBe(1);
    expect(tx.date).toBe("2026-01-15");
    expect(tx.asset).toBe("MSFT");
    expect(tx.action).toBe("SELL");
    expect(tx.quantity).toBe(5);
    expect(tx.asset_type).toBe("stock_usd");
    expect(tx.price).toBe(400.0);
    expect(tx.currency).toBe("USD");
    expect(tx.fees).toBe(2.0);
    expect(tx.fee_currency).toBe("USD");
    expect(tx.exchange).toBe("Robinhood");
    expect(tx.data_source).toBe("csv");
    expect(tx.account).toBe("broker_a");
    expect(tx.created_at).toBe("2026-01-15T12:00:00.000Z");
    expect(tx.updated_at).toBe("2026-01-16T08:00:00.000Z");
  });
});
