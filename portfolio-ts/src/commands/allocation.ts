import { query, getAssetMetadata } from "../db.js";
import type { AssetMetadataRow } from "../db.js";

export interface SectorWeight {
  sector: string;
  weight: number;
}

export interface AllocationRow {
  asset: string;
  asset_type: string;
  asset_kind: string;
  net_quantity: number;
  value_usd: number;
  allocation_pct: number;
  sector?: string;
  sector_weights?: SectorWeight[];
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

function parseSectorWeights(raw: unknown): SectorWeight[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    const result: SectorWeight[] = [];
    for (const item of raw) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).sector === "string" &&
        typeof (item as Record<string, unknown>).weight === "number"
      ) {
        const sw = item as { sector: string; weight: number };
        result.push({ sector: sw.sector, weight: sw.weight });
      }
    }
    return result.length > 0 ? result : undefined;
  }
  if (typeof raw === "string") {
    try {
      return parseSectorWeights(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function getAllocation(asOfDate?: string): Promise<AllocationResult> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];

  const rows = await query<Record<string, unknown>>(
    "SELECT asset, asset_type, asset_kind, net_quantity, value_usd, allocation_pct FROM portfolio_allocation_sql($1)",
    [actualDate],
  );

  const assetNames = [...new Set(rows.map((r) => str(r["asset"])).filter(Boolean))];

  let metaMap = new Map<string, AssetMetadataRow>();
  if (assetNames.length > 0) {
    try {
      const metaRows = await getAssetMetadata();
      if (metaRows && Array.isArray(metaRows)) {
        for (const m of metaRows) {
          metaMap.set(m.asset, m);
        }
      }
    } catch {
      // graceful degradation — metadata is best-effort enrichment
    }
  }

  const allocRows: AllocationRow[] = rows.map((r) => {
    const asset = str(r["asset"]);
    const meta = metaMap.get(asset);
    return {
      asset,
      asset_type: str(r["asset_type"]),
      asset_kind: str(r["asset_kind"]),
      net_quantity: num(r["net_quantity"]),
      value_usd: num(r["value_usd"]),
      allocation_pct: num(r["allocation_pct"]),
      sector: meta?.sector ?? undefined,
      sector_weights: parseSectorWeights(meta?.sector_weights),
    };
  });

  const portfolio_value = allocRows.reduce((sum, r) => sum + r.value_usd, 0);

  return { as_of_date: actualDate, portfolio_value, rows: allocRows };
}
