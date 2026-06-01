import * as fs from "node:fs";
import * as path from "node:path";
import { query } from "./db.js";

export const SQL_APPLY_ORDER = [
  "schema.sql",
  "functions.sql",
  "procedures.sql",
  "views.sql",
  "triggers.sql",
] as const;

export type SqlApplyFile = (typeof SQL_APPLY_ORDER)[number];

export interface SqlApplyFileResult {
  file: SqlApplyFile;
  ok: boolean;
  bytes: number;
  error: string | null;
}

export interface SqlApplyResult {
  sql_dir: string;
  files: SqlApplyFileResult[];
  applied: SqlApplyFile[];
  failed: SqlApplyFile[];
  ok: boolean;
}

const CANDIDATE_OFFSETS: ReadonlyArray<readonly string[]> = [
  ["..", "..", "..", "portfolio_db", "sql"],
  ["..", "..", "portfolio_db", "sql"],
  ["..", "portfolio_db", "sql"],
];

export function resolveSqlDir(startDir: string = import.meta.dir): string {
  for (const parts of CANDIDATE_OFFSETS) {
    const candidate = path.resolve(startDir, ...parts);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(startDir, ...CANDIDATE_OFFSETS[0]);
}

export async function applySqlFiles(opts: {
  sqlDir?: string;
  order?: readonly SqlApplyFile[];
} = {}): Promise<SqlApplyResult> {
  const sqlDir = opts.sqlDir ?? resolveSqlDir();
  const order = opts.order ?? SQL_APPLY_ORDER;
  const files: SqlApplyFileResult[] = [];
  const applied: SqlApplyFile[] = [];
  const failed: SqlApplyFile[] = [];

  for (const name of order) {
    const filePath = path.join(sqlDir, name);
    if (!fs.existsSync(filePath)) {
      const message = `init: missing SQL file: ${filePath}`;
      files.push({ file: name, ok: false, bytes: 0, error: message });
      failed.push(name);
      throw new Error(message);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    try {
      await query(content);
      files.push({ file: name, ok: true, bytes: content.length, error: null });
      applied.push(name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      files.push({ file: name, ok: false, bytes: content.length, error: message });
      failed.push(name);
      throw new Error(`init: failed to apply ${name}: ${message}`);
    }
  }

  return { sql_dir: sqlDir, files, applied, failed, ok: failed.length === 0 };
}
