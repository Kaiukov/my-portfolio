import { query } from "../db.js";

export interface AllocationRow {
  asset: string;
  asset_type: string;
  net_quantity: number;
  value_usd: number;
  allocation_pct: number;
}

export interface AllocationResult {
  as_of_date: string;
  portfolio_value: number;
  rows: AllocationRow[];
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val);
}

export async function getAllocation(asOfDate?: string): Promise<AllocationResult> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];

  const rows = await query<Record<string, unknown>>(
    "SELECT asset, asset_type, net_quantity, value_usd, allocation_pct FROM portfolio_allocation_sql($1)",
    [actualDate],
  );

  const allocRows: AllocationRow[] = rows.map((r) => ({
    asset: str(r["asset"]),
    asset_type: str(r["asset_type"]),
    net_quantity: num(r["net_quantity"]),
    value_usd: num(r["value_usd"]),
    allocation_pct: num(r["allocation_pct"]),
  }));

  const portfolio_value = allocRows.reduce((sum, r) => sum + r.value_usd, 0);

  return { as_of_date: actualDate, portfolio_value, rows: allocRows };
}
