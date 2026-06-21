import { getAllocation, type AllocationRow } from "./allocation.js";
import { ValidationError } from "../validators.js";
import { roundTo } from "../utils.js";

export const TARGET_SUM_EPSILON = 0.01;
export const DRIFT_HOLD_THRESHOLD = 0.01;

export interface TargetEntry {
  asset: string;
  target_pct: number;
}

export interface DriftRow {
  asset: string;
  current_pct: number;
  target_pct: number;
  drift_pct: number;
  current_value_usd: number;
  target_value_usd: number;
  suggested_delta_usd: number;
  action: "BUY" | "SELL" | "HOLD";
}

export interface RebalanceResult {
  as_of_date: string;
  total_portfolio_value: number;
  total_absolute_drift: number;
  rows: DriftRow[];
}

export function parseTargetString(targetStr: string): TargetEntry[] {
  if (!targetStr || !targetStr.trim()) {
    throw new ValidationError("--target must be non-empty");
  }

  const parts = targetStr.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new ValidationError("--target must specify at least one asset");
  }

  const entries: TargetEntry[] = [];
  let sum = 0;

  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) {
      throw new ValidationError(
        `Invalid target entry ${JSON.stringify(part)}: expected ASSET=PCT`,
      );
    }
    const asset = part.slice(0, eqIdx).trim();
    const pctStr = part.slice(eqIdx + 1).trim();

    if (!asset) {
      throw new ValidationError(
        `Invalid target entry ${JSON.stringify(part)}: asset symbol is empty`,
      );
    }

    const pct = Number(pctStr);
    if (!Number.isFinite(pct)) {
      throw new ValidationError(
        `Invalid target entry ${JSON.stringify(part)}: percentage must be a number`,
      );
    }
    if (pct < 0) {
      throw new ValidationError(
        `Invalid target entry ${JSON.stringify(part)}: percentage must be non-negative`,
      );
    }

    sum += pct;
    entries.push({ asset: asset.toUpperCase(), target_pct: pct });
  }

  if (Math.abs(sum - 100) > TARGET_SUM_EPSILON) {
    throw new ValidationError(
      `Target percentages sum to ${roundTo(sum)}%, expected 100% (±${TARGET_SUM_EPSILON}%)`,
    );
  }

  return entries;
}

export function computeDrift(
  targetEntries: TargetEntry[],
  allocRows: AllocationRow[],
  totalPortfolioValue: number,
  asOfDate: string,
): RebalanceResult {
  const targetMap = new Map<string, number>();
  for (const te of targetEntries) {
    targetMap.set(te.asset, te.target_pct);
  }

  const currentMap = new Map<string, { pct: number; value: number }>();
  for (const row of allocRows) {
    currentMap.set(row.asset, { pct: row.allocation_pct, value: row.value_usd });
  }

  const allAssets = new Set([...currentMap.keys(), ...targetMap.keys()]);

  const rows: DriftRow[] = [];

  for (const asset of allAssets) {
    const currentPct = currentMap.get(asset)?.pct ?? 0;
    const currentValue = currentMap.get(asset)?.value ?? 0;
    const targetPct = targetMap.get(asset) ?? 0;
    const driftPct = currentPct - targetPct;
    const targetValue = (targetPct / 100) * totalPortfolioValue;
    const deltaUsd = targetValue - currentValue;

    let action: "BUY" | "SELL" | "HOLD";
    if (Math.abs(driftPct) < DRIFT_HOLD_THRESHOLD) {
      action = "HOLD";
    } else if (deltaUsd > 0) {
      action = "BUY";
    } else {
      action = "SELL";
    }

    rows.push({
      asset,
      current_pct: roundTo(currentPct),
      target_pct: targetPct,
      drift_pct: roundTo(driftPct),
      current_value_usd: roundTo(currentValue),
      target_value_usd: roundTo(targetValue),
      suggested_delta_usd: roundTo(deltaUsd),
      action,
    });
  }

  rows.sort((a, b) => Math.abs(b.drift_pct) - Math.abs(a.drift_pct));

  const totalAbsoluteDrift = roundTo(
    rows.reduce((sum, r) => sum + Math.abs(r.drift_pct), 0),
  );

  return {
    as_of_date: asOfDate,
    total_portfolio_value: roundTo(totalPortfolioValue),
    total_absolute_drift: totalAbsoluteDrift,
    rows,
  };
}

export async function getRebalance(
  targetStr: string,
  asOfDate?: string,
): Promise<RebalanceResult> {
  const targetEntries = parseTargetString(targetStr);
  const alloc = await getAllocation(asOfDate);
  return computeDrift(targetEntries, alloc.rows, alloc.portfolio_value, alloc.as_of_date);
}
