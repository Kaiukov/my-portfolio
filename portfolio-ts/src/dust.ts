import { DUST_ALLOCATION_THRESHOLD_PCT } from "./validators.js";

export interface DustFilterMeta {
  threshold_pct: number;
  include_dust: boolean;
  filtered: boolean;
  raw_count: number;
  visible_count: number;
  hidden_count: number;
  hidden_assets: string[];
}

export interface DustHolding {
  asset: string;
  allocation_pct: number;
}

export interface DustFilterResult<T extends DustHolding> {
  rows: T[];
  meta: DustFilterMeta;
}

function isDust(allocationPct: number): boolean {
  return Math.abs(allocationPct) < DUST_ALLOCATION_THRESHOLD_PCT;
}

export function filterDustHoldings<T extends DustHolding>(
  rows: T[],
  includeDust = false,
): DustFilterResult<T> {
  const hiddenAssets = rows
    .filter((row) => isDust(Number(row.allocation_pct)))
    .map((row) => row.asset);
  const visibleRows = includeDust ? rows : rows.filter((row) => !isDust(Number(row.allocation_pct)));

  return {
    rows: visibleRows,
    meta: {
      threshold_pct: DUST_ALLOCATION_THRESHOLD_PCT,
      include_dust: includeDust,
      filtered: !includeDust,
      raw_count: rows.length,
      visible_count: visibleRows.length,
      hidden_count: hiddenAssets.length,
      hidden_assets: hiddenAssets,
    },
  };
}
