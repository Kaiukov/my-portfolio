import { querySingle } from "../db.js";

export interface InitResult {
  db_target: string;
  status: string;
  tables_found: number;
}

export async function initDb(): Promise<InitResult> {
  const row = await querySingle<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('transactions', 'daily_returns', 'prices', 'service_state')`,
  );
  const found = Number(row?.count ?? 0);
  return {
    db_target: "postgresql",
    status: found === 4 ? "ready" : "schema_incomplete",
    tables_found: found,
  };
}
