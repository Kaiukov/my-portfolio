import { getSql } from "./db.js";

export async function runTx(fn: any): Promise<any> {
  const sql = getSql();
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
