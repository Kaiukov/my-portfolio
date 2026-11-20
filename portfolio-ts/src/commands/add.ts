import { querySingle } from "../db.js";
import { runTx } from "../tx.js";
import {
  ValidationError,
  PriceUnavailableError,
  parseDate,
  validatePositiveFloat,
  validateNonNegativeFloat,
  validateAssetSymbol,
  validateAction,
  validateCurrency,
  warnOnQuoteCurrencyMismatch,
  isStablecoin,
  normalizeSymbol,
} from "../validators.js";
import { fetchPrices, isYahooFetchable, type PriceRow } from "../providers/yahoo.js";
import { upsertPrices } from "./repair_prices.js";
import { applyStakingReward } from "./reward.js";
import { parseRow, type TransactionRow } from "./transactions.js";

export interface AddResult {
  transaction: TransactionRow;
  recalculated: boolean;
}

export interface AddDryRunResult {
  dry_run: true;
  preview: {
    date: string;
    asset: string;
    action: string;
    quantity: number;
    price?: number;
    currency?: string;
    fees?: number;
    fee_currency?: string;
    exchange: string;
    asset_type?: string;
    account?: string;
  };
}

interface NormalizedAdd {
  date: string;
  asset: string;
  action: string;
  quantity: number;
  price: number | null;
  currency: string;
  fees: number | null;
  feeCurrency: string | null;
  exchange: string;
  account: string | null;
  assetType: string;
  /** false = definitely no price on/before the trade date; null = not observed. */
  priceAvailable: boolean | null;
}

async function prepareAdd(params: {
  dateStr: string;
  asset: string;
  action: string;
  quantity: number;
  price?: number;
  currency?: string;
  fees?: number;
  feeCurrency?: string;
  exchange: string;
  account?: string;
}): Promise<NormalizedAdd> {
  const date = parseDate(params.dateStr, "--date");
  const action = validateAction(params.action);
  // One canonical symbol everywhere: storage and price lookup must agree.
  const asset = normalizeSymbol(params.asset);

  validateAssetSymbol(asset, action);
  validateCurrency(params.currency, "--currency");
  warnOnQuoteCurrencyMismatch(asset, params.currency);

  if (!params.exchange || !params.exchange.trim()) {
    throw new ValidationError(
      "--exchange is required.\n" +
        "Expected: --exchange <broker or exchange name>\n" +
        "Example:  portfolio add --date 01-01-2026 --asset AAPL --action BUY " +
        "--quantity 10 --price 150 --exchange Interactive",
    );
  }

  validatePositiveFloat(params.quantity, "--quantity", "add");
  if (params.price !== undefined) validatePositiveFloat(params.price, "--price", "add");
  if (params.fees !== undefined) validateNonNegativeFloat(params.fees, "--fees", "add");

  if (action === "TRANSFER" && !params.account) {
    throw new ValidationError(
      "--account is required for TRANSFER transactions.\n" +
        "Expected: --account <account label>",
    );
  }

  if ((action === "BUY" || action === "SELL") && params.price === undefined) {
    throw new ValidationError(`--price is required for ${action} transactions`);
  }

  // One round trip: the asset type and whether a price already exists as of the
  // trade date. A NULL price on a brand-new instrument is the deadlock case.
  const atRow = await querySingle<{ asset_type: string; price?: number | null }>(
    "SELECT get_asset_type_sql($1) AS asset_type, price_asof_sql($1, $2::date) AS price",
    [asset, date],
  );
  const assetType = atRow?.asset_type ?? "stock_usd";
  const priceAvailable = atRow && "price" in atRow ? atRow.price != null : null;

  if (action === "FEE" || action === "TAX" || action === "DIVIDEND" || action === "INTEREST") {
    if (params.price !== undefined) {
      throw new ValidationError(`${action} does not accept a price`);
    }
    if (!isStablecoin(asset)) {
      const cashRow = await querySingle<{ ok: boolean }>(
        "SELECT is_cash_like_sql($1) AS ok",
        [asset],
      );
      if (!cashRow?.ok) {
        throw new ValidationError(
          `${action} requires a cash asset, got ${asset}`,
        );
      }
    }
  }

  if (action === "STAKING_REWARD") {
    if (params.price !== undefined) {
      throw new ValidationError("STAKING_REWARD does not accept a price");
    }
    if (params.fees !== undefined && params.fees !== 0) {
      throw new ValidationError("STAKING_REWARD does not accept fees");
    }
    if (params.feeCurrency !== undefined) {
      throw new ValidationError("STAKING_REWARD does not accept fee currency");
    }

    const cashRow = await querySingle<{ ok: boolean }>(
      "SELECT is_cash_like_sql($1) AS ok",
      [asset],
    );
    if (cashRow?.ok || assetType !== "crypto") {
      throw new ValidationError(
        `STAKING_REWARD requires a non-cash crypto asset, got ${asset}`,
      );
    }
  }

  if (action === "SELL") {
    const row = await querySingle<{ net: string }>(
      `SELECT COALESCE(SUM(CASE WHEN action = 'BUY' THEN quantity
                               WHEN action = 'SELL' THEN -quantity
                               ELSE 0 END), 0)::text AS net
       FROM transactions WHERE asset = $1 AND date <= $2`,
      [asset, date],
    );
    const net = Number(row?.net ?? 0);
    if (params.quantity > net) {
      throw new ValidationError(
        `Cannot SELL ${params.quantity} of ${asset}: ` +
          `only ${net} shares held as of ${date}`,
      );
    }
  }

  return {
    date,
    asset,
    action,
    quantity: params.quantity,
    price: params.price ?? null,
    currency: params.currency ?? "USD",
    fees: params.fees ?? null,
    feeCurrency: params.feeCurrency ?? null,
    exchange: params.exchange,
    account: params.account ?? null,
    assetType,
    priceAvailable,
  };
}

type FetchPricesFn = (ticker: string, startDate: string, endDate: string) => Promise<PriceRow[]>;

const BOOTSTRAP_LOOKBACK_DAYS = 10;

function isoDay(date: Date): string {
  return date.toISOString().split("T")[0];
}

async function hasPriceAsOf(asset: string, date: string): Promise<boolean> {
  const row = await querySingle<{ price: number | null }>(
    "SELECT price_asof_sql($1, $2::date) AS price",
    [asset, date],
  );
  return row?.price != null;
}

/**
 * A brand-new instrument has no price, and discover_required_tickers_sql()
 * only lists tickers that already appear in transactions — so the first trade
 * could never be inserted: the daily-returns guard rejects it for a missing
 * price that nothing would ever fetch. Bootstrap that single ticker here,
 * before the insert transaction, and leave verify_held_prices_sql untouched.
 */
async function ensurePriceForNewAsset(
  asset: string,
  date: string,
  assetType: string,
  priceAvailable: boolean | null,
  fetchFn: FetchPricesFn,
): Promise<void> {
  if (assetType.startsWith("cash") || isStablecoin(asset)) return;
  // null = the caller could not observe a price column (legacy/mocked callers):
  // keep the previous behaviour and let the recalculation guard decide.
  if (priceAvailable !== false) return;

  if (isYahooFetchable(asset)) {
    const start = new Date(`${date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - BOOTSTRAP_LOOKBACK_DAYS);
    let rows: PriceRow[] = [];
    try {
      rows = await fetchFn(asset, isoDay(start), isoDay(new Date()));
    } catch {
      rows = []; // provider failure falls through to the actionable error below
    }
    if (rows.length > 0) await upsertPrices(rows);
    if (await hasPriceAsOf(asset, date)) return;
  }

  throw new PriceUnavailableError(
    `No price for ${asset} as of ${date}, so the trade cannot be valued or ` +
      `recalculated. Bootstrap it first: portfolio repair_prices --ticker ${asset}`,
  );
}

export async function addTransaction(params: {
  dateStr: string;
  asset: string;
  action: string;
  quantity: number;
  price?: number;
  currency?: string;
  fees?: number;
  feeCurrency?: string;
  exchange: string;
  account?: string;
  fetchFn?: FetchPricesFn;
}): Promise<AddResult> {
  const normalized = await prepareAdd(params);
  const { date, asset, action, quantity, price, currency, fees, feeCurrency, exchange, account,
    assetType, priceAvailable } = normalized;

  // Before the transaction: a network call must never hold a DB transaction open,
  // and a missing price must not roll the insert back.
  await ensurePriceForNewAsset(asset, date, assetType, priceAvailable,
                               params.fetchFn ?? fetchPrices);

  if (action === "STAKING_REWARD") {
    return applyStakingReward({
      dateStr: date,
      asset,
      quantity,
      price: price ?? undefined,
      currency,
      fees: fees ?? undefined,
      feeCurrency: feeCurrency ?? undefined,
      exchange,
      account: account ?? undefined,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inserted = await runTx(async (tx: any) => {
    const [ins] = (await tx.unsafe(
      `INSERT INTO transactions
       (date, asset, action, quantity, asset_type, price, currency,
        fees, fee_currency, exchange, data_source, account)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        date,
        asset,
        action,
        quantity,
        assetType,
        price,
        currency,
        fees,
        feeCurrency,
        exchange,
        "",
        account,
      ],
    )) as { id: number }[];
    const transId = ins.id;

    await tx.unsafe("SELECT refresh_daily_returns_sql($1)", [date]);

    const [row] = (await tx.unsafe(
      `SELECT id, date, asset, action, quantity, asset_type, price, currency,
              fees, fee_currency, exchange, data_source, account, created_at, updated_at
       FROM transactions WHERE id = $1`,
      [transId],
    )) as Record<string, unknown>[];
    return row;
  });

  return { transaction: parseRow(inserted), recalculated: true };
}

export async function addDryRun(params: {
  dateStr: string;
  asset: string;
  action: string;
  quantity: number;
  price?: number;
  currency?: string;
  fees?: number;
  feeCurrency?: string;
  exchange: string;
  account?: string;
}): Promise<AddDryRunResult> {
  const normalized = await prepareAdd(params);
  const { date, asset, action, quantity, price, currency, fees, feeCurrency, exchange, assetType, account } = normalized;

  return {
    dry_run: true,
    preview: {
      date,
      asset,
      action,
      quantity,
      ...(price !== null ? { price } : {}),
      ...(currency ? { currency } : {}),
      ...(fees !== null ? { fees } : {}),
      ...(feeCurrency !== null ? { fee_currency: feeCurrency } : {}),
      exchange,
      asset_type: assetType,
      ...(account !== null ? { account } : {}),
    },
  };
}
