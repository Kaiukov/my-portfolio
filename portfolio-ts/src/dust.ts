import { getDustAllocationThresholdPct } from "./validators.js";

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

function isDust(allocationPct: number, thresholdPct: number): boolean {
  return Math.abs(allocationPct) < thresholdPct;
}

export function filterDustHoldings<T extends DustHolding>(
  rows: T[],
  includeDust = false,
): DustFilterResult<T> {
  const thresholdPct = getDustAllocationThresholdPct();
  const hiddenAssets = rows
    .filter((row) => isDust(Number(row.allocation_pct), thresholdPct))
    .map((row) => row.asset);
  const visibleRows = includeDust ? rows : rows.filter((row) => !isDust(Number(row.allocation_pct), thresholdPct));

  return {
    rows: visibleRows,
    meta: {
      threshold_pct: thresholdPct,
      include_dust: includeDust,
      filtered: !includeDust,
      raw_count: rows.length,
      visible_count: visibleRows.length,
      hidden_count: hiddenAssets.length,
      hidden_assets: hiddenAssets,
    },
  };
}
