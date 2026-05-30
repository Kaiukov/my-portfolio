import { query, querySingle } from "../db.js";

export interface TransactionRow {
  id: number;
  date: string;
  asset: string;
  action: string;
  quantity: number;
  asset_type: string;
  price: number | null;
  currency: string;
  fees: number | null;
  fee_currency: string | null;
  exchange: string;
  data_source: string;
  account: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PaginatedResult {
  data: TransactionRow[];
  total: number;
}

function formatDate(val: unknown): string {
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, "0");
    const d = String(val.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return val != null ? String(val) : "";
}

function formatTimestamp(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function formatNullableString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

function numOrNull(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function int(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

export function parseRow(row: Record<string, unknown>): TransactionRow {
  return {
    id: int(row["id"]),
    date: formatDate(row["date"]),
    asset: String(row["asset"] ?? ""),
    action: String(row["action"] ?? ""),
    quantity: numOrNull(row["quantity"]) ?? 0,
    asset_type: String(row["asset_type"] ?? ""),
    price: numOrNull(row["price"]),
    currency: String(row["currency"] ?? ""),
    fees: numOrNull(row["fees"]),
    fee_currency: formatNullableString(row["fee_currency"]),
    exchange: String(row["exchange"] ?? ""),
    data_source: String(row["data_source"] ?? ""),
    account: formatNullableString(row["account"]),
    created_at: formatTimestamp(row["created_at"]),
    updated_at: formatTimestamp(row["updated_at"]),
  };
}

export async function getTransactions(
  limit: number = 50,
  offset: number = 0,
  startDate?: string,
  endDate?: string,
): Promise<PaginatedResult> {
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (startDate) {
    whereClauses.push(`date >= $${params.length + 1}`);
    params.push(startDate);
  }
  if (endDate) {
    whereClauses.push(`date <= $${params.length + 1}`);
    params.push(endDate);
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const countRow = await querySingle(
    `SELECT COUNT(*)::int AS count FROM transactions ${whereSQL}`,
    params,
  );
  const total = int(countRow?.count ?? 0);

  const pageParams = [...params, limit, offset];
  const rows = (await query(
    `SELECT id, date, asset, action, quantity, asset_type, price, currency, fees, fee_currency, exchange, data_source, account, created_at, updated_at
     FROM transactions ${whereSQL}
     ORDER BY date ASC, id ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    pageParams,
  )) as Record<string, unknown>[];

  const data = rows.map(parseRow);
  return { data, total };
}
