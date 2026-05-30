import { connect, query } from "./db.js";

export async function runTx(fn: any): Promise<any> {
  connect();
  await query("BEGIN");
  try {
    const result = await fn({ unsafe: query });
    await query("COMMIT");
    return result;
  } catch (e) {
    await query("ROLLBACK");
    throw e;
  }
}
