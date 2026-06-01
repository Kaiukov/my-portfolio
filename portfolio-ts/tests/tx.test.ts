import { describe, expect, test, mock, beforeEach } from "bun:test";

const fakeTxUnsafe = mock();
const mockSqlBegin = mock();

const fakeSql = {
  begin: mockSqlBegin,
};

mock.module("../src/db.js", () => ({
  getSql: () => fakeSql,
  query: mock(),
  querySingle: mock(),
  connect: () => {},
  close: () => {},
}));

beforeEach(() => {
  mockSqlBegin.mockClear();
  fakeTxUnsafe.mockClear();
});

describe("runTx (pinned-connection transaction)", () => {
  test("commits and returns result when fn succeeds", async () => {
    let committed = false;
    mockSqlBegin.mockImplementation(async (fn: any) => {
      const result = await fn({ unsafe: fakeTxUnsafe });
      committed = true;
      return result;
    });
    fakeTxUnsafe.mockResolvedValue([{ id: 42 }]);

    const { runTx } = await import("../src/tx.js");
    const result = await runTx(async (tx: any) => {
      const rows = await tx.unsafe("SELECT 1");
      return { ok: true, rows };
    });

    expect(committed).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([{ id: 42 }]);
    expect(mockSqlBegin).toHaveBeenCalledTimes(1);
  });

  test("rolls back and rethrows when fn throws partway", async () => {
    let committed = false;
    const tempResults: string[] = [];

    mockSqlBegin.mockImplementation(async (fn: any) => {
      try {
        const result = await fn({
          unsafe: mock(async (sql: string) => {
            tempResults.push(sql);
            return [];
          }),
        });
        committed = true;
        return result;
      } catch (e) {
        throw e;
      }
    });

    const { runTx } = await import("../src/tx.js");

    await expect(
      runTx(async (tx: any) => {
        await tx.unsafe("INSERT INTO transactions (...) VALUES (...)");
        throw new Error("BOOM");
      }),
    ).rejects.toThrow("BOOM");

    expect(committed).toBe(false);
    expect(tempResults).toEqual(["INSERT INTO transactions (...) VALUES (...)"]);
    expect(mockSqlBegin).toHaveBeenCalledTimes(1);
  });

  test("unsafe routes params through when provided", async () => {
    let capturedParams: unknown[] | undefined;
    mockSqlBegin.mockImplementation(async (fn: any) => {
      const txDup = {
        unsafe: mock(async (_sql: string, params?: unknown[]) => {
          capturedParams = params;
          return [{ id: 1 }];
        }),
      };
      return fn(txDup);
    });

    const { runTx } = await import("../src/tx.js");
    await runTx(async (tx: any) => {
      return tx.unsafe("INSERT INTO t VALUES ($1, $2)", ["a", 42]);
    });

    expect(capturedParams).toEqual(["a", 42]);
    expect(mockSqlBegin).toHaveBeenCalledTimes(1);
  });

  test("unsafe skips empty params array (matches query() behavior)", async () => {
    let paramsReceived: boolean = false;
    mockSqlBegin.mockImplementation(async (fn: any) => {
      const txDup = {
        unsafe: mock(async (_sql: string, params?: unknown[]) => {
          paramsReceived = params !== undefined;
          return [];
        }),
      };
      return fn(txDup);
    });

    const { runTx } = await import("../src/tx.js");
    await runTx(async (tx: any) => {
      return tx.unsafe("SELECT refresh_daily_returns_sql($1)", []);
    });

    expect(paramsReceived).toBe(false);
    expect(mockSqlBegin).toHaveBeenCalledTimes(1);
  });

  test("does NOT issue COMMIT/ROLLBACK via query() — uses begin() only", async () => {
    let beginCalls = 0;

    const comp = async () => {
      mockSqlBegin.mockImplementationOnce(async (fn: any) => {
        beginCalls++;
        return fn({ unsafe: mock(async () => []) });
      });
      const { runTx } = await import("../src/tx.js");
      return runTx(async (tx: any) => {
        await tx.unsafe("INSERT ...");
        return 42;
      });
    };

    await comp();
    expect(beginCalls).toBe(1);

    const compFail = async () => {
      mockSqlBegin.mockImplementationOnce(async (fn: any) => {
        beginCalls++;
        return fn({ unsafe: mock(async () => []) });
      });
      const { runTx } = await import("../src/tx.js");
      return runTx(async (tx: any) => {
        await tx.unsafe("INSERT ...");
        throw new Error("fail");
      });
    };

    await expect(compFail()).rejects.toThrow("fail");
    expect(beginCalls).toBe(2);
  });
});
