import { getSql } from "./db.js";
import { beginTx } from "./tx_core.js";

export async function runTx(fn: any, sqlOverride?: any): Promise<any> {
  const sql = sqlOverride ?? getSql();
  return beginTx(sql, fn);
}
