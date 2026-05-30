import { SQL } from "bun";

let sql: SQL | null = null;

function getUrl(): string {
  const url = process.env.PORTFOLIO_DB_URL;
  if (!url) {
    throw new Error("PORTFOLIO_DB_URL environment variable is not set");
  }
  return url;
}

export function connect(url?: string): void {
  if (sql) return;
  sql = new SQL(url ?? getUrl());
}

export async function query<T = Record<string, unknown>>(
  sqlStr: string,
  params?: unknown[],
): Promise<T[]> {
  if (!sql) connect();
  if (params && params.length > 0) {
    return (await sql!.unsafe(sqlStr, params)) as T[];
  }
  return (await sql!.unsafe(sqlStr)) as T[];
}

export async function querySingle<T = Record<string, unknown>>(
  sqlStr: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(sqlStr, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function close(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
  }
}

export type TxClient = {
  unsafe<T = Record<string, unknown>>(sqlStr: string, params?: unknown[]): PromiseLike<T[]>;
};

async function withTransaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  if (!sql) connect();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sql!.begin as any)(fn) as Promise<T>;
}
export { withTransaction };
