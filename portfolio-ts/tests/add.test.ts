import { describe, expect, test, mock, jest } from "bun:test";
import { ValidationError } from "../src/validators.js";

const mockQuerySingle = mock();
const mockWithTransaction = mock();

mock.module("../src/db.js", () => ({
  query: mock(),
  querySingle: mockQuerySingle,
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mockWithTransaction,
}));

describe("addTransaction validation", () => {
  test("throws on missing exchange", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        price: 150,
        exchange: "",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("accepts ISO YYYY-MM-DD date format", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    // Will fail at SELL check (no holdings) rather than date validation
    mockQuerySingle.mockResolvedValueOnce({ net: "5" });
    await expect(
      addTransaction({
        dateStr: "2026-01-01",
        asset: "AAPL",
        action: "SELL",
        quantity: 10,
        price: 150,
        exchange: "Interactive",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Error should be about SELL quantity, not date format
    try {
      await addTransaction({
        dateStr: "2026-01-01",
        asset: "AAPL",
        action: "SELL",
        quantity: 10,
        price: 150,
        exchange: "Interactive",
      });
    } catch (e) {
      expect((e as ValidationError).message).toContain("SELL");
    }
  });

  test("throws on BUY without price", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        exchange: "Interactive",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws on negative quantity", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "AAPL",
        action: "BUY",
        quantity: -5,
        price: 150,
        exchange: "Interactive",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws on unknown action", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "AAPL",
        action: "INVALID",
        quantity: 10,
        price: 150,
        exchange: "Interactive",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("SELL: throws when quantity exceeds holdings", async () => {
    mockQuerySingle.mockResolvedValue({ net: "5" });
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "AAPL",
        action: "SELL",
        quantity: 10,
        price: 150,
        exchange: "Interactive",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects asset='EUR' (bare currency) for BUY before any DB write", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "EUR",
        action: "BUY",
        quantity: 10,
        price: 150,
        exchange: "Interactive",
      }),
    ).rejects.toThrow(ValidationError);
  });

  test("accepts asset='EURUSD=X' (FX pair) for BUY", async () => {
    mockQuerySingle.mockResolvedValue(null);
    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "cash_fx" }];
          if (sql.includes("INSERT INTO transactions")) return [{ id: 100 }];
          if (sql.includes("refresh_daily_returns_sql")) return [];
          if (sql.includes("SELECT id, date")) return [{
            id: 100,
            date: new Date("2026-01-01"),
            asset: "EURUSD=X",
            action: "BUY",
            quantity: 1000,
            asset_type: "cash_fx",
            price: 1.05,
            currency: "USD",
            fees: null,
            fee_currency: null,
            exchange: "Interactive",
            data_source: "",
            account: null,
            created_at: new Date(),
            updated_at: null,
          }];
          return [];
        }),
      };
      return fn(fakeTx);
    });
    const { addTransaction } = await import("../src/commands/add.js");
    const result = await addTransaction({
      dateStr: "01-01-2026",
      asset: "EURUSD=X",
      action: "BUY",
      quantity: 1000,
      price: 1.05,
      exchange: "Interactive",
    });
    expect(result.recalculated).toBe(true);
    expect(result.transaction.asset).toBe("EURUSD=X");
  });

  test("rejects invalid currency value", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "01-01-2026",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        price: 150,
        currency: "XYZ",
        exchange: "Interactive",
      }),
    ).rejects.toThrow(ValidationError);
  });

  test("BUY with foreign fee_currency preserves fee info in response (#20)", async () => {
    mockQuerySingle.mockResolvedValue(null);

    const fakeRow = {
      id: 200,
      date: new Date("2026-01-15"),
      asset: "BTC-USD",
      action: "BUY",
      quantity: 0.1,
      asset_type: "crypto",
      price: 50000,
      currency: "USD",
      fees: 0.0001,
      fee_currency: "BTC",
      exchange: "Binance",
      data_source: "",
      account: null,
      created_at: new Date("2026-01-15T10:00:00Z"),
      updated_at: null,
    };

    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "crypto" }];
          if (sql.includes("INSERT INTO transactions")) return [{ id: 200 }];
          if (sql.includes("refresh_daily_returns_sql")) return [];
          if (sql.includes("SELECT id, date")) return [fakeRow];
          return [];
        }),
      };
      return fn(fakeTx);
    });

    const { addTransaction } = await import("../src/commands/add.js");
    const result = await addTransaction({
      dateStr: "2026-01-15",
      asset: "BTC-USD",
      action: "BUY",
      quantity: 0.1,
      price: 50000,
      fees: 0.0001,
      feeCurrency: "BTC",
      exchange: "Binance",
    });

    expect(result.recalculated).toBe(true);
    expect(result.transaction.id).toBe(200);
    expect(result.transaction.asset).toBe("BTC-USD");
    expect(result.transaction.fees).toBe(0.0001);
    expect(result.transaction.fee_currency).toBe("BTC");
    expect(result.transaction.currency).toBe("USD");
  });

  test("BUY with fee in quote currency (regression #20, null fee_currency)", async () => {
    mockQuerySingle.mockResolvedValue(null);

    const fakeRow = {
      id: 201,
      date: new Date("2026-01-15"),
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
      asset_type: "stock_usd",
      price: 150,
      currency: "USD",
      fees: 1.99,
      fee_currency: null,
      exchange: "Interactive",
      data_source: "",
      account: null,
      created_at: new Date("2026-01-15T10:00:00Z"),
      updated_at: null,
    };

    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "stock_usd" }];
          if (sql.includes("INSERT INTO transactions")) return [{ id: 201 }];
          if (sql.includes("refresh_daily_returns_sql")) return [];
          if (sql.includes("SELECT id, date")) return [fakeRow];
          return [];
        }),
      };
      return fn(fakeTx);
    });

    const { addTransaction } = await import("../src/commands/add.js");
    const result = await addTransaction({
      dateStr: "2026-01-15",
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
      price: 150,
      fees: 1.99,
      exchange: "Interactive",
    });

    expect(result.recalculated).toBe(true);
    expect(result.transaction.id).toBe(201);
    expect(result.transaction.asset).toBe("AAPL");
    expect(result.transaction.fees).toBe(1.99);
    expect(result.transaction.fee_currency).toBeNull();
  });

  test("succeeds: inserts, recalculates, returns transaction", async () => {
    mockQuerySingle.mockResolvedValue(null); // SELL check not called for BUY

    const fakeRow = {
      id: 99,
      date: new Date("2026-01-01"),
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
    };

    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "stock_usd" }];
          if (sql.includes("INSERT INTO transactions")) return [{ id: 99 }];
          if (sql.includes("refresh_daily_returns_sql")) return [];
          if (sql.includes("SELECT id, date")) return [fakeRow];
          return [];
        }),
      };
      return fn(fakeTx);
    });

    const { addTransaction } = await import("../src/commands/add.js");
    const result = await addTransaction({
      dateStr: "01-01-2026",
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
      price: 150,
      exchange: "Interactive",
    });

    expect(result.recalculated).toBe(true);
    expect(result.transaction.id).toBe(99);
    expect(result.transaction.asset).toBe("AAPL");
    expect(result.transaction.action).toBe("BUY");
  });
});

describe("addTransaction CLI integration — fee_currency (#20)", () => {
  test("dispatches add --fee-currency BTC and emits JSON with fee_currency", async () => {
    mockQuerySingle.mockResolvedValue(null);

    const fakeRow: Record<string, unknown> = {
      id: 300,
      date: new Date("2026-05-15"),
      asset: "BTC-USD",
      action: "BUY",
      quantity: 0.1,
      asset_type: "crypto",
      price: 50000,
      currency: "USD",
      fees: 0.0001,
      fee_currency: "BTC",
      exchange: "Binance",
      data_source: "",
      account: null,
      created_at: new Date("2026-05-15T10:00:00Z"),
      updated_at: null,
    };

    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "crypto" }];
          if (sql.includes("INSERT INTO transactions")) return [{ id: 300 }];
          if (sql.includes("refresh_daily_returns_sql")) return [];
          if (sql.includes("SELECT id, date")) return [fakeRow];
          return [];
        }),
      };
      return fn(fakeTx);
    });

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch([
      "bun", "src/cli.ts", "add",
      "--date", "2026-05-15",
      "--asset", "BTC-USD",
      "--action", "BUY",
      "--quantity", "0.1",
      "--price", "50000",
      "--fees", "0.0001",
      "--fee-currency", "BTC",
      "--exchange", "Binance",
    ]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("add");
    expect(output.data.transaction.fee_currency).toBe("BTC");
    expect(output.data.transaction.fees).toBe(0.0001);
    expect(output.data.transaction.currency).toBe("USD");
    expect(output.data.transaction.asset).toBe("BTC-USD");
    expect(output.data.transaction.exchange).toBe("Binance");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
