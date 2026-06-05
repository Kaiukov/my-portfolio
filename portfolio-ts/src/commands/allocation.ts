import { query, getAssetMetadata } from "../db.js";
import type { AssetMetadataRow } from "../db.js";
import { getAssetMetadataFallback } from "../asset_metadata_fallback.js";

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
  last_price?: number;
  day_gain_usd?: number;
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

function hasSectorMetadata(
  sector: string | null | undefined,
  sectorWeights: SectorWeight[] | undefined,
): boolean {
  return Boolean(sector) || Boolean(sectorWeights && sectorWeights.length > 0);
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
    const parsedSectorWeights = parseSectorWeights(meta?.sector_weights);
    const fallback = !hasSectorMetadata(meta?.sector, parsedSectorWeights)
      ? getAssetMetadataFallback(asset, str(r["asset_kind"]))
      : undefined;
    return {
      asset,
      asset_type: str(r["asset_type"]),
      asset_kind: str(r["asset_kind"]),
      net_quantity: num(r["net_quantity"]),
      value_usd: num(r["value_usd"]),
      allocation_pct: num(r["allocation_pct"]),
      sector: meta?.sector ?? fallback?.sector ?? undefined,
      sector_weights: parsedSectorWeights ?? fallback?.sector_weights,
    };
  });

  // Fetch last prices and previous close for day-change calculation.
  // Prices are capped at actualDate so historical snapshots stay aligned.
  const priceCandidates = allocRows.filter((r) => r.net_quantity > 0);
  if (priceCandidates.length > 0) {
    try {
      const tickerList = priceCandidates.map((r) => r.asset);
      const priceRows = await query<{
        ticker: string;
        last_price: number;
        prev_price: number | null;
      }>(
        `WITH latest AS (
          SELECT DISTINCT ON (ticker) ticker, price, date
          FROM prices
          WHERE ticker = ANY($1::varchar[]) AND date <= $2::date
          ORDER BY ticker, date DESC
        ),
        prev AS (
          SELECT DISTINCT ON (p.ticker) p.ticker, p.price
          FROM prices p
          JOIN latest l ON p.ticker = l.ticker AND p.date < l.date
          WHERE p.date <= $2::date
          ORDER BY p.ticker, p.date DESC
        )
        SELECT l.ticker, l.price AS last_price, p.price AS prev_price
        FROM latest l
        LEFT JOIN prev p ON l.ticker = p.ticker`,
        [tickerList, actualDate],
      );

      const priceMap = new Map<
        string,
        { last_price: number; prev_price: number | null }
      >();
      for (const pr of priceRows) {
        priceMap.set(pr.ticker, {
          last_price: pr.last_price,
          prev_price: pr.prev_price,
        });
      }

      for (const row of allocRows) {
        const p = priceMap.get(row.asset);
        if (p) {
          row.last_price = p.last_price;
          if (
            p.prev_price !== null &&
            p.prev_price !== undefined &&
            p.prev_price > 0
          ) {
            // Use price-ratio × current value_usd so foreign stocks
            // get USD-correct day gain without a separate FX-rate fetch.
            // value_usd already incorporates FX conversion per portfolio_allocation_sql.
            const priceRatio = p.last_price / p.prev_price;
            row.day_gain_usd = row.value_usd - row.value_usd / priceRatio;
          }
        }
      }
    } catch {
      // Graceful degradation — prices are best-effort enrichment
    }
  }

  const portfolio_value = allocRows.reduce((sum, r) => sum + r.value_usd, 0);

  return { as_of_date: actualDate, portfolio_value, rows: allocRows };
}
