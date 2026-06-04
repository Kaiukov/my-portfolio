import { SQL } from "bun";
import { STALE_MAX_AGE_DAYS } from "./validators.js";

export interface AssetMetadataRow {
  asset: string;
  asset_kind: string | null;
  sector: string | null;
  industry: string | null;
  region: string | null;
  sector_weights: unknown;
  source: string | null;
  fetched_at: string | null;
  is_stale: boolean;
}

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

export function getSql(): SQL {
  if (!sql) connect();
  return sql!;
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

export async function upsertAssetMetadata(
  ticker: string,
  data: {
    asset_kind?: string;
    sector?: string;
    industry?: string;
    region?: string;
    sector_weights?: unknown;
    source?: string;
  },
): Promise<void> {
  await query(
    `INSERT INTO asset_metadata (ticker, asset_kind, sector, industry, region, sector_weights, source, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (ticker) DO UPDATE SET
       asset_kind = EXCLUDED.asset_kind,
       sector = EXCLUDED.sector,
       industry = EXCLUDED.industry,
       region = EXCLUDED.region,
       sector_weights = EXCLUDED.sector_weights,
       source = EXCLUDED.source,
       fetched_at = EXCLUDED.fetched_at`,
    [
      ticker,
      data.asset_kind ?? null,
      data.sector ?? null,
      data.industry ?? null,
      data.region ?? null,
      data.sector_weights ? JSON.stringify(data.sector_weights) : null,
      data.source ?? null,
    ],
  );
}

export async function getAssetMetadata(
  asset?: string,
  maxAgeDays?: number,
): Promise<AssetMetadataRow[]> {
  const maxAge = maxAgeDays ?? STALE_MAX_AGE_DAYS;
  return query<AssetMetadataRow>(
    "SELECT * FROM portfolio_asset_metadata_sql($1, $2)",
    [asset ?? null, maxAge],
  );
}
