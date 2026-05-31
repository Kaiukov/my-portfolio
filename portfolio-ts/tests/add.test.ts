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

  // ─── issue #90: income/expense actions require cash-like asset ───

  test("FEE with non-cash asset (AAPL) is rejected", async () => {
    mockQuerySingle.mockResolvedValue({ ok: false });
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "2026-01-15",
        asset: "AAPL",
        action: "FEE",
        quantity: 10,
        exchange: "Interactive",
      }),
    ).rejects.toThrow(ValidationError);
    try {
      await addTransaction({
        dateStr: "2026-01-15",
        asset: "AAPL",
        action: "FEE",
        quantity: 10,
        exchange: "Interactive",
      });
    } catch (e) {
      expect((e as ValidationError).message).toBe(
        "FEE requires a cash asset, got AAPL",
      );
    }
  });

  test("TAX with non-cash asset (GOOGL) is rejected", async () => {
    mockQuerySingle.mockResolvedValue({ ok: false });
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "2026-01-15",
        asset: "GOOGL",
        action: "TAX",
        quantity: 5,
        exchange: "Interactive",
      }),
    ).rejects.toThrow(ValidationError);
    try {
      await addTransaction({
        dateStr: "2026-01-15",
        asset: "GOOGL",
        action: "TAX",
        quantity: 5,
        exchange: "Interactive",
      });
    } catch (e) {
      expect((e as ValidationError).message).toBe(
        "TAX requires a cash asset, got GOOGL",
      );
    }
  });

  test("DIVIDEND with non-cash asset (MSFT) is rejected", async () => {
    mockQuerySingle.mockResolvedValue({ ok: false });
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "2026-01-15",
        asset: "MSFT",
        action: "DIVIDEND",
        quantity: 15,
        exchange: "Interactive",
      }),
    ).rejects.toThrow(ValidationError);
    try {
      await addTransaction({
        dateStr: "2026-01-15",
        asset: "MSFT",
        action: "DIVIDEND",
        quantity: 15,
        exchange: "Interactive",
      });
    } catch (e) {
      expect((e as ValidationError).message).toBe(
        "DIVIDEND requires a cash asset, got MSFT",
      );
    }
  });

  test("INTEREST with non-cash asset (BTC-USD) is rejected", async () => {
    mockQuerySingle.mockResolvedValue({ ok: false });
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "2026-01-15",
        asset: "BTC-USD",
        action: "INTEREST",
        quantity: 0.01,
        exchange: "Interactive",
      }),
    ).rejects.toThrow(ValidationError);
    try {
      await addTransaction({
        dateStr: "2026-01-15",
        asset: "BTC-USD",
        action: "INTEREST",
        quantity: 0.01,
        exchange: "Interactive",
      });
    } catch (e) {
      expect((e as ValidationError).message).toBe(
        "INTEREST requires a cash asset, got BTC-USD",
      );
    }
  });

  test("FEE with a price provided is rejected (before any DB call)", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "2026-01-15",
        asset: "USD",
        action: "FEE",
        quantity: 10,
        price: 5, // price forbidden per spec
        exchange: "Interactive",
      }),
    ).rejects.toThrow(ValidationError);
    try {
      await addTransaction({
        dateStr: "2026-01-15",
        asset: "USD",
        action: "FEE",
        quantity: 10,
        price: 5,
        exchange: "Interactive",
      });
    } catch (e) {
      expect((e as ValidationError).message).toBe("FEE does not accept a price");
    }
  });

  test("DIVIDEND with a price provided is rejected (before any DB call)", async () => {
    const { addTransaction } = await import("../src/commands/add.js");
    await expect(
      addTransaction({
        dateStr: "2026-01-15",
        asset: "USD",
        action: "DIVIDEND",
        quantity: 10,
        price: 5,
        exchange: "Interactive",
      }),
    ).rejects.toThrow(ValidationError);
    try {
      await addTransaction({
        dateStr: "2026-01-15",
        asset: "USD",
        action: "DIVIDEND",
        quantity: 10,
        price: 5,
        exchange: "Interactive",
      });
    } catch (e) {
      expect((e as ValidationError).message).toBe("DIVIDEND does not accept a price");
    }
  });

  // ─── regression: valid income/expense with cash asset still work ───

  test("FEE with USD (cash-like) succeeds and produces correct result", async () => {
    mockQuerySingle.mockResolvedValue({ ok: true });

    const fakeRow = {
      id: 500,
      date: new Date("2026-01-15"),
      asset: "USD",
      action: "FEE",
      quantity: 10,
      asset_type: "cash_base",
      price: null,
      currency: "USD",
      fees: null,
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
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "cash_base" }];
          if (sql.includes("INSERT INTO transactions")) return [{ id: 500 }];
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
      asset: "USD",
      action: "FEE",
      quantity: 10,
      exchange: "Interactive",
    });

    expect(result.recalculated).toBe(true);
    expect(result.transaction.id).toBe(500);
    expect(result.transaction.asset).toBe("USD");
    expect(result.transaction.action).toBe("FEE");
    expect(result.transaction.quantity).toBe(10);
    expect(result.transaction.price).toBeNull();
  });

  test("DIVIDEND with USD (cash-like) succeeds and produces correct result", async () => {
    mockQuerySingle.mockResolvedValue({ ok: true });

    const fakeRow = {
      id: 501,
      date: new Date("2026-01-15"),
      asset: "USD",
      action: "DIVIDEND",
      quantity: 25,
      asset_type: "cash_base",
      price: null,
      currency: "USD",
      fees: null,
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
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "cash_base" }];
          if (sql.includes("INSERT INTO transactions")) return [{ id: 501 }];
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
      asset: "USD",
      action: "DIVIDEND",
      quantity: 25,
      exchange: "Interactive",
    });

    expect(result.recalculated).toBe(true);
    expect(result.transaction.id).toBe(501);
    expect(result.transaction.asset).toBe("USD");
    expect(result.transaction.action).toBe("DIVIDEND");
    expect(result.transaction.quantity).toBe(25);
    expect(result.transaction.price).toBeNull();
  });

  // ─── regression: BUY/SELL/DEPOSIT unaffected ───

  test("DEPOSIT with cash asset (EUR) is unaffected and still accepted", async () => {
    mockQuerySingle.mockResolvedValue({ ok: true });

    const fakeRow = {
      id: 502,
      date: new Date("2026-01-15"),
      asset: "EUR",
      action: "DEPOSIT",
      quantity: 1000,
      asset_type: "cash_fx",
      price: null,
      currency: "EUR",
      fees: null,
      fee_currency: null,
      exchange: "Revolut",
      data_source: "",
      account: null,
      created_at: new Date("2026-01-15T10:00:00Z"),
      updated_at: null,
    };

    mockWithTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const fakeTx = {
        unsafe: mock(async (sql: string) => {
          if (sql.includes("get_asset_type_sql")) return [{ asset_type: "cash_fx" }];
          if (sql.includes("INSERT INTO transactions")) return [{ id: 502 }];
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
      asset: "EUR",
      action: "DEPOSIT",
      quantity: 1000,
      exchange: "Revolut",
    });

    expect(result.recalculated).toBe(true);
    expect(result.transaction.action).toBe("DEPOSIT");
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

  // ─── issue #90: CLI JSON snapshot for rejected FEE with non-cash asset ───

  test("rejects FEE with AAPL via dispatch with JSON error envelope", async () => {
    mockQuerySingle.mockResolvedValue({ ok: false });

    const mod = await import("../src/cli.js");
    try {
      await mod.dispatch([
        "bun", "src/cli.ts", "add",
        "--date", "2026-05-15",
        "--asset", "AAPL",
        "--action", "FEE",
        "--quantity", "10",
        "--exchange", "Interactive",
      ]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toBe("FEE requires a cash asset, got AAPL");
      expect((e as ValidationError).code).toBe("VALIDATION_ERROR");
    }
  });
});
