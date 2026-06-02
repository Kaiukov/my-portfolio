import { querySingle } from "../db.js";
import { getSummary } from "./summary.js";

export interface MwrData {
  mwr_pct: number;
  as_of_date: string;
  portfolio_value: number;
  note: string;
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

export async function getMwr(asOfDate?: string): Promise<MwrData> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];

  const row = await querySingle<Record<string, unknown>>(
    "SELECT * FROM portfolio_mwr_sql($1) AS mwr",
    [actualDate],
  );

  const mwrRaw = row?.["mwr"] !== null && row?.["mwr"] !== undefined
    ? Number(row["mwr"])
    : null;

  const summary = await getSummary(actualDate);

  if (mwrRaw === null || !Number.isFinite(mwrRaw)) {
    return {
      mwr_pct: 0,
      as_of_date: actualDate,
      portfolio_value: summary.portfolio_value_usd,
      note: "MWR not available — insufficient transaction data or no valid portfolio value",
    };
  }

  return {
    mwr_pct: round4(mwrRaw * 100),
    as_of_date: actualDate,
    portfolio_value: summary.portfolio_value_usd,
    note: "Money-Weighted Return (XIRR) — accounts for deposit/withdrawal timing",
  };
}
