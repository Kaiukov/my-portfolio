import { querySingle, query } from "../db.js";
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

  let priceAgeDays: number | null = null;
  if (pricesAsOf) {
    const pricesDate = new Date(pricesAsOf);
    const refDate = new Date(referenceDate);
    const diffMs = refDate.getTime() - pricesDate.getTime();
    priceAgeDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  let stale = false;

  try {
    const checkpointRows = await query<{ ticker: string }>(
      `SELECT DISTINCT c.ticker
       FROM get_required_price_checkpoints_sql($1::date) c
       WHERE NOT EXISTS (
         SELECT 1 FROM prices p
         WHERE p.ticker = c.ticker AND p.date = c.checkpoint_date::date
       )`,
      [referenceDate],
    );
    if ((checkpointRows ?? []).length > 0) {
      stale = true;
    }
  } catch {
    // Degrade gracefully: treat query failures as no coverage gaps
  }

  if (!stale) {
    try {
      const staleRows = await query<{ ticker: string }>(
        "SELECT ticker FROM stale_tickers_sql($1)",
        [maxAgeDays],
      );
      if ((staleRows ?? []).length > 0) {
        stale = true;
      }
    } catch {
      // Degrade gracefully: treat query failures as no stale tickers
    }
  }

  return {
    prices_as_of: pricesAsOf,
    price_age_days: priceAgeDays,
    stale,
  };
}
