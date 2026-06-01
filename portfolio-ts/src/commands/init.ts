import { querySingle } from "../db.js";
import { applySqlFiles, SQL_APPLY_ORDER } from "../sql_apply.js";

const REQUIRED_TABLES = [
  "transactions",
  "daily_returns",
  "prices",
  "service_state",
] as const;

export interface InitResult {
  db_target: string;
  status: "ready" | "schema_incomplete";
  tables_found: number;
  applied: string[];
  sql_dir: string;
  sql_files: string[];
}

export async function initDb(): Promise<InitResult> {
  const applyResult = await applySqlFiles();

  const row = await querySingle<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [...REQUIRED_TABLES],
  );
  const found = Number(row?.count ?? 0);
  return {
    db_target: "postgresql",
    status: found === REQUIRED_TABLES.length ? "ready" : "schema_incomplete",
    tables_found: found,
    applied: applyResult.applied as string[],
    sql_dir: applyResult.sql_dir,
    sql_files: [...SQL_APPLY_ORDER],
  };
}
