import { describe, expect, test } from "bun:test";
import { beginTx } from "../src/tx_core.js";

// These tests inject a fake `sql` directly via beginTx. No mock.module is used
// because 23 other test files mock ../src/tx.js and on Linux Bun those mocks
// leak across test files, clobbering the import. tx_core.js is never mocked
// by any test so this import is leak-proof.

describe("beginTx (pinned-connection transaction)", () => {
  test("commits and returns result when fn succeeds", async () => {
    let committed = false;
    let beginCalls = 0;
    const fakeSql = {
      begin: async (fn: any) => {
        beginCalls++;
        const result = await fn({ unsafe: async () => [{ id: 42 }] });
        committed = true;
        return result;
      },
    };

    const result = await beginTx(fakeSql, async (tx: any) => {
      const rows = await tx.unsafe("SELECT 1");
      return { ok: true, rows };
    });

    expect(committed).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([{ id: 42 }]);
    expect(beginCalls).toBe(1);
  });

  test("rolls back and rethrows when fn throws partway", async () => {
    let committed = false;
    let beginCalls = 0;
    const tempResults: string[] = [];
    const fakeSql = {
      begin: async (fn: any) => {
        beginCalls++;
        const result = await fn({
          unsafe: async (sql: string) => {
            tempResults.push(sql);
            return [];
          },
        });
        committed = true;
        return result;
      },
    };

    await expect(
      beginTx(fakeSql, async (tx: any) => {
        await tx.unsafe("INSERT INTO transactions (...) VALUES (...)");
        throw new Error("BOOM");
      }),
    ).rejects.toThrow("BOOM");

    expect(committed).toBe(false);
    expect(tempResults).toEqual(["INSERT INTO transactions (...) VALUES (...)"]);
    expect(beginCalls).toBe(1);
  });

  test("unsafe routes params through when provided", async () => {
    let capturedParams: unknown[] | undefined;
    const fakeSql = {
      begin: async (fn: any) =>
        fn({
          unsafe: async (_sql: string, params?: unknown[]) => {
            capturedParams = params;
            return [{ id: 1 }];
          },
        }),
    };

    await beginTx(fakeSql, async (tx: any) => {
      return tx.unsafe("INSERT INTO t VALUES ($1, $2)", ["a", 42]);
    });

    expect(capturedParams).toEqual(["a", 42]);
  });

  test("unsafe skips empty params array (matches query() behavior)", async () => {
    let paramsReceived = false;
    const fakeSql = {
      begin: async (fn: any) =>
        fn({
          unsafe: async (_sql: string, params?: unknown[]) => {
            paramsReceived = params !== undefined;
            return [];
          },
        }),
    };

    await beginTx(fakeSql, async (tx: any) => {
      return tx.unsafe("SELECT refresh_daily_returns_sql($1)", []);
    });

    expect(paramsReceived).toBe(false);
  });

  test("uses begin() exactly once per call, on both success and failure", async () => {
    let beginCalls = 0;
    const fakeSql = {
      begin: async (fn: any) => {
        beginCalls++;
        return fn({ unsafe: async () => [] });
      },
    };

    await beginTx(fakeSql, async (tx: any) => {
      await tx.unsafe("INSERT ...");
      return 42;
    });
    expect(beginCalls).toBe(1);

    await expect(
      beginTx(fakeSql, async (tx: any) => {
        await tx.unsafe("INSERT ...");
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(beginCalls).toBe(2);
  });
});
