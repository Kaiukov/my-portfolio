import { describe, expect, test, mock, beforeEach, afterAll } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();
const mockRunTx = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  getSql: () => ({}),
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mockRunTx,
}));

const ROW = {
  id: 7,
  date: "2026-11-19",
  asset: "ANT",
  action: "BUY",
  quantity: 1,
  asset_type: "stock_usd",
  price: 107.98,
  currency: "USD",
  fees: 1.84,
  fee_currency: "EUR",
  exchange: "Freedom24",
  data_source: "",
  account: null,
  created_at: "2026-11-19T00:00:00Z",
  updated_at: null,
};

/** Dispatch the SQL calls prepareAdd + the price preflight make. */
function stubDb(options: { assetType?: string; prices?: Array<number | null> }) {
  const prices = [...(options.prices ?? [null])];
  const initial = prices.shift() ?? null;
  mockQuerySingle.mockImplementation(async (sql: string) => {
    if (sql.includes("get_asset_type_sql")) {
      return { asset_type: options.assetType ?? "stock_usd", price: initial };
    }
    if (sql.includes("price_asof_sql")) {
      return { price: prices.length > 0 ? prices.shift() : initial };
    }
    return null;
  });
}

function stubTx() {
  mockRunTx.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      unsafe: async (sql: string) =>
        sql.trim().toUpperCase().startsWith("INSERT") ? [{ id: ROW.id }] : [ROW],
    }),
  );
}

const baseParams = {
  dateStr: "2026-11-19",
  asset: "ANT",
  action: "BUY",
  quantity: 1,
  price: 107.98,
  currency: "USD",
  fees: 1.84,
  feeCurrency: "EUR",
  exchange: "Freedom24",
};

afterAll(() => {
  // This file replaces src/db.js and src/tx.js globally; restore them so other
  // test files keep their own modules.
  mock.restore();
});

describe("normalizeSymbol", () => {
  test("strips only a terminal venue suffix", async () => {
    const { normalizeSymbol } = await import("../src/validators.js");
    expect(normalizeSymbol("ANT.US")).toBe("ANT");
    expect(normalizeSymbol("ant.us")).toBe("ant");
    expect(normalizeSymbol(" ANT.US ")).toBe("ANT");
    expect(normalizeSymbol("BRK.B")).toBe("BRK.B");
    expect(normalizeSymbol("ANT")).toBe("ANT");
    expect(normalizeSymbol("US")).toBe("US");
  });
});

describe("addTransaction price bootstrap", () => {
  beforeEach(() => {
    mockQuerySingle.mockReset();
    mockQuery.mockReset();
    mockRunTx.mockReset();
    stubTx();
  });

  test("fetches the missing price for a new instrument before inserting", async () => {
    stubDb({ prices: [null, 97.17] });
    const fetchFn = mock(async () => [{ ticker: "ANT", date: "2026-11-19", price: 97.17 }]);
    const { addTransaction } = await import("../src/commands/add.js");

    const result = await addTransaction({ ...baseParams, fetchFn });

    expect(result.transaction.id).toBe(7);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [ticker, start, end] = fetchFn.mock.calls[0] as unknown as [string, string, string];
    expect(ticker).toBe("ANT");
    expect(start < "2026-11-19").toBe(true);
    expect(end >= "2026-11-19").toBe(true);
    // The fetched row is persisted into `prices`, not into `transactions`.
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO prices"))).toBe(true);
    expect(mockRunTx).toHaveBeenCalledTimes(1);
  });

  test("does not fetch when a price already exists", async () => {
    stubDb({ prices: [97.17] });
    const fetchFn = mock(async () => []);
    const { addTransaction } = await import("../src/commands/add.js");

    await addTransaction({ ...baseParams, fetchFn });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(mockRunTx).toHaveBeenCalledTimes(1);
  });

  test("fails with PRICE_UNAVAILABLE and an actionable hint when the provider has no data", async () => {
    stubDb({ prices: [null] });
    const fetchFn = mock(async () => []);
    const { addTransaction } = await import("../src/commands/add.js");
    const { PriceUnavailableError } = await import("../src/validators.js");

    const error = await addTransaction({ ...baseParams, fetchFn }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PriceUnavailableError);
    expect((error as InstanceType<typeof PriceUnavailableError>).code).toBe("PRICE_UNAVAILABLE");
    expect((error as Error).message).toContain("repair_prices --ticker ANT");
    // No transaction is attempted: the insert can never be half-applied.
    expect(mockRunTx).not.toHaveBeenCalled();
  });

  test("stores the canonical symbol when the broker sends a venue suffix", async () => {
    stubDb({ prices: [97.17] });
    const fetchFn = mock(async () => []);
    const { addTransaction } = await import("../src/commands/add.js");

    const result = await addTransaction({ ...baseParams, asset: "ANT.US", fetchFn });

    expect(result.transaction.asset).toBe("ANT");
    const assetTypeCall = mockQuerySingle.mock.calls.find(([sql]) =>
      String(sql).includes("get_asset_type_sql"),
    ) as [string, unknown[]];
    expect(assetTypeCall[1][0]).toBe("ANT");
  });

  test("skips the preflight for cash-like assets", async () => {
    stubDb({ assetType: "cash_fx", prices: [null] });
    const fetchFn = mock(async () => []);
    const { addTransaction } = await import("../src/commands/add.js");

    await addTransaction({
      dateStr: "2026-11-19",
      asset: "EURUSD=X",
      action: "BUY",
      quantity: 1000,
      price: 1.05,
      currency: "USD",
      exchange: "Freedom24",
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(mockRunTx).toHaveBeenCalledTimes(1);
  });
});
