import { getAssetMetadata, upsertAssetMetadata } from "../db.js";
import { normalizeAssetKind, fetchAssetMetadata, type AssetMetadata } from "../asset_kind.js";
import {
  fetchAssetProfile,
  getStaticAssetProfile,
  isYahooFetchable,
  type AssetProfileAndSectorWeights,
} from "../providers/yahoo.js";

export interface AssetMetadataRecord {
  asset: string;
  asset_kind: string;
  sector?: string;
  industry?: string;
  region?: string;
  sector_weights?: Array<{ sector: string; weight: number }>;
  source: "yahoo" | "static" | "none";
  fetched_at: string;
}

export interface AssetMetadataFetchFn {
  (ticker: string): Promise<AssetProfileAndSectorWeights>;
}

export interface AssetMetadataResult {
  assets: AssetMetadataRecord[];
  fetched?: string[];
  failed?: Array<{ ticker: string; error: string }>;
}

function mapRowToRecord(row: {
  asset: string;
  asset_kind: string | null;
  sector: string | null;
  industry: string | null;
  region: string | null;
  sector_weights: unknown;
  source: string | null;
  fetched_at: string | null;
}): AssetMetadataRecord {
  let swParsed: Array<{ sector: string; weight: number }> | undefined;
  if (row.sector_weights) {
    if (typeof row.sector_weights === "string") {
      try {
        swParsed = JSON.parse(row.sector_weights);
      } catch {
        swParsed = undefined;
      }
    } else if (Array.isArray(row.sector_weights)) {
      swParsed = row.sector_weights as Array<{ sector: string; weight: number }>;
    }
  }

  return {
    asset: row.asset,
    asset_kind: row.asset_kind ?? "unknown",
    sector: row.sector ?? undefined,
    industry: row.industry ?? undefined,
    region: row.region ?? undefined,
    sector_weights: swParsed,
    source: (row.source as "yahoo" | "static" | "none") ?? "none",
    fetched_at: row.fetched_at ?? new Date().toISOString(),
  };
}

async function buildStaticRecord(ticker: string): Promise<AssetMetadataRecord> {
  const profile = getStaticAssetProfile(ticker);
  let region = profile?.region ?? undefined;
  if (profile?.sector === "FX") {
    const m = /^([A-Z]{3})$/.exec(ticker.toUpperCase());
    region = m ? m[1] : (region ?? "Global");
  }
  return {
    asset: ticker,
    asset_kind: profile?.sector === "FX" ? "fx"
      : profile?.sector === "Crypto" ? "crypto"
      : profile?.sector === "Cash" ? "cash"
      : "unknown",
    sector: profile?.sector,
    region,
    source: "static",
    fetched_at: new Date().toISOString(),
  };
}

export async function getAssetMetadataRecords(
  params: {
    asset?: string;
    refresh?: boolean;
  },
  fetchFn: AssetMetadataFetchFn = fetchAssetProfile,
  metadataFn: (ticker: string) => Promise<AssetMetadata | null> = fetchAssetMetadata,
): Promise<AssetMetadataResult> {
  async function resolveKind(t: string): Promise<string> {
    try {
      const meta = await metadataFn(t);
      return normalizeAssetKind(meta?.yahoo_quote_type ?? null);
    } catch {
      return "unknown";
    }
  }

  if (params.asset) {
    const ticker = params.asset.toUpperCase();

    if (!isYahooFetchable(ticker)) {
      const record = await buildStaticRecord(ticker);
      return { assets: [record] };
    }

    if (!params.refresh) {
      const rows = await getAssetMetadata(ticker);
      if (rows.length > 0) {
        return { assets: rows.map(mapRowToRecord) };
      }

      const assetKind = await resolveKind(ticker);
      return {
        assets: [{
          asset: ticker,
          asset_kind: assetKind,
          source: "none",
          fetched_at: new Date().toISOString(),
        }],
      };
    }

    const assetKind = await resolveKind(ticker);
    try {
      const profile = await fetchFn(ticker);

      await upsertAssetMetadata(ticker, {
        asset_kind: assetKind,
        sector: profile.sector,
        industry: profile.industry,
        region: profile.region,
        sector_weights: profile.sectorWeights,
        source: "yahoo",
      });

      return {
        assets: [{
          asset: ticker,
          asset_kind: assetKind,
          sector: profile.sector,
          industry: profile.industry,
          region: profile.region,
          sector_weights: profile.sectorWeights,
          source: "yahoo",
          fetched_at: new Date().toISOString(),
        }],
        fetched: [ticker],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        assets: [{
          asset: ticker,
          asset_kind: assetKind,
          source: "none",
          fetched_at: new Date().toISOString(),
        }],
        failed: [{ ticker, error: msg }],
      };
    }
  }

  const rows = await getAssetMetadata();
  if (rows.length > 0) {
    return { assets: rows.map(mapRowToRecord) };
  }

  return { assets: [] };
}
