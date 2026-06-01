import { describe, expect, test } from "bun:test";
import { runTx } from "../src/tx.js";

// These tests inject a fake `sql` directly via runTx's second argument instead
// of mocking db.js. A transitive `mock.module("../src/db.js")` is not reliably
// applied inside tx.js on Linux Bun (it passed on macOS but failed in CI), so
// the DI seam is the portable way to stub `.begin()`.

describe("runTx (pinned-connection transaction)", () => {
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

    const result = await runTx(async (tx: any) => {
      const rows = await tx.unsafe("SELECT 1");
      return { ok: true, rows };
    }, fakeSql);

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
        // Mirror Bun's sql.begin: if the callback rejects, the transaction is
        // rolled back and the error propagates; commit (here `committed`) is
        // never reached.
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
      runTx(async (tx: any) => {
        await tx.unsafe("INSERT INTO transactions (...) VALUES (...)");
        throw new Error("BOOM");
      }, fakeSql),
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

    await runTx(async (tx: any) => {
      return tx.unsafe("INSERT INTO t VALUES ($1, $2)", ["a", 42]);
    }, fakeSql);

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

    await runTx(async (tx: any) => {
      return tx.unsafe("SELECT refresh_daily_returns_sql($1)", []);
    }, fakeSql);

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

    await runTx(async (tx: any) => {
      await tx.unsafe("INSERT ...");
      return 42;
    }, fakeSql);
    expect(beginCalls).toBe(1);

    await expect(
      runTx(async (tx: any) => {
        await tx.unsafe("INSERT ...");
        throw new Error("fail");
      }, fakeSql),
    ).rejects.toThrow("fail");
    expect(beginCalls).toBe(2);
  });
});
