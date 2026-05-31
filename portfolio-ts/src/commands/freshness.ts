import { querySingle } from "../db.js";
import { STALE_MAX_AGE_DAYS } from "../validators.js";

export interface PriceFreshness {
  [key: string]: unknown;
  prices_as_of: string | null;
  price_age_days: number | null;
  stale: boolean;
}

function getMaxAgeDays(): number {
  const envVal = process.env["PORTFOLIO_PRICE_MAX_AGE_DAYS"];
  if (envVal !== undefined) {
    const parsed = parseInt(envVal, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return STALE_MAX_AGE_DAYS;
}

export async function getPriceFreshness(asOfDate?: string): Promise<PriceFreshness> {
  const maxAgeDays = getMaxAgeDays();
  const referenceDate = asOfDate ?? new Date().toISOString().split("T")[0];

  const row = await querySingle<{ prices_as_of: string | null }>(
    "SELECT MAX(date)::text AS prices_as_of FROM prices WHERE date <= $1",
    [referenceDate],
  );

  const pricesAsOf = row?.prices_as_of ?? null;

  if (!pricesAsOf) {
    return { prices_as_of: null, price_age_days: null, stale: false };
  }

  const pricesDate = new Date(pricesAsOf);
  const refDate = new Date(referenceDate);
  const diffMs = refDate.getTime() - pricesDate.getTime();
  const ageDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return {
    prices_as_of: pricesAsOf,
    price_age_days: ageDays,
    stale: ageDays > maxAgeDays,
  };
}
