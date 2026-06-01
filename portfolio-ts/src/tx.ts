import { getSql } from "./db.js";

// `sqlOverride` is a dependency-injection seam for tests: it lets a test pass a
// fake `sql` with a stubbed `.begin()` directly, instead of mocking the db.js
// module. Transitive `mock.module("../src/db.js")` is unreliable on Linux Bun
// (it does not always propagate into tx.js), which produced false CI failures.
// Production callers pass only `fn`, so behavior is unchanged.
export async function runTx(fn: any, sqlOverride?: any): Promise<any> {
  const sql = sqlOverride ?? getSql();
  return sql.begin(async (txSql: any) => {
    const unsafe = (sqlStr: string, params?: unknown[]) => {
      if (params && params.length > 0) {
        return txSql.unsafe(sqlStr, params);
      }
      return txSql.unsafe(sqlStr);
    };
    return fn({ unsafe });
  });
}
