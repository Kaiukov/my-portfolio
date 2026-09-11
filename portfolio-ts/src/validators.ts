export const STALE_MAX_AGE_DAYS = 5;

export function getDustAllocationThresholdPct(): number {
  const raw = process.env.PORTFOLIO_DUST_THRESHOLD_PCT;
  if (raw === undefined || raw === null) return 1;
  if (raw.trim() === "") return 1;
  const val = Number(raw);
  if (!Number.isFinite(val) || val < 0) return 1;
  return val;
}

export const STABLECOINS = new Set([
  "USDT", "USDC", "DAI", "TUSD", "USDP", "FDUSD", "PYUSD", "USDE", "GUSD",
]);

export function isStablecoin(asset: string): boolean {
  return STABLECOINS.has(asset.toUpperCase());
}

export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export function parseDate(dateStr: string, flagName: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (iso) {
    return dateStr;
  }
  const legacy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateStr);
  if (legacy) {
    console.warn(
      `[deprecated] ${flagName}: DD-MM-YYYY format is deprecated, use YYYY-MM-DD instead`,
    );
    return `${legacy[3]}-${legacy[2]}-${legacy[1]}`;
  }
  throw new ValidationError(
    `${flagName}: expected YYYY-MM-DD (or legacy DD-MM-YYYY), got ${JSON.stringify(dateStr)}`,
  );
}

export function validatePositiveFloat(
  val: number | undefined,
  flagName: string,
  command: string,
): void {
  if (val === undefined || !Number.isFinite(val) || val <= 0) {
    throw new ValidationError(`${flagName} must be a positive number (command: ${command})`);
  }
}

export function validateNonNegativeFloat(
  val: number | undefined,
  flagName: string,
  command: string,
): void {
  if (val === undefined || !Number.isFinite(val) || val < 0) {
    throw new ValidationError(
      `${flagName} must be a non-negative number (command: ${command})`,
    );
  }
}

export function validatePositiveInt(
  val: number | undefined,
  flagName: string,
  command: string,
): void {
  if (val === undefined || !Number.isInteger(val) || val <= 0) {
    throw new ValidationError(`${flagName} must be a positive integer (command: ${command})`);
  }
}

export const USER_ACTIONS = new Set([
  "BUY", "SELL", "DEPOSIT", "WITHDRAW", "TRANSFER",
  "DIVIDEND", "INTEREST", "FEE", "TAX", "SPLIT",
  "STAKING_REWARD", "WRAP", "UNWRAP",
]);

export const ALLOWED_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "UAH", "JPY", "CHF", "CAD", "AUD", "HKD", "SGD",
]);

export function validateAssetSymbol(asset: string, action: string): void {
  if (!asset || !asset.trim()) {
    throw new ValidationError(
      "--asset is required.\n" +
      "Expected: --asset <ticker symbol>\n" +
      "Example:  portfolio add --date 2026-01-01 --asset AAPL --action BUY --quantity 10 --price 150 --exchange Interactive",
    );
  }

  const upper = asset.toUpperCase();

  if ((action === "BUY" || action === "SELL") && ALLOWED_CURRENCIES.has(upper)) {
    throw new ValidationError(
      `--asset: ${JSON.stringify(asset)} looks like an ISO currency code. ` +
      `Use the FX pair format (e.g. EURUSD=X) instead of a bare currency code.\n` +
      "Expected: --asset <SYMBOL> or <XXXYYY=X>\n" +
      "Example:  portfolio add --date 2026-01-01 --asset EURUSD=X --action BUY --quantity 1000 --price 1.05 --exchange Interactive",
    );
  }
}

export function validateAction(action: string): string {
  if (!action || !action.trim()) {
    throw new ValidationError("--action is required");
  }
  const upper = action.toUpperCase();
  if (!USER_ACTIONS.has(upper)) {
    throw new ValidationError(
      `--action: unknown action ${JSON.stringify(action)}. ` +
      `Valid: ${[...USER_ACTIONS].join(", ")}`,
    );
  }
  return upper;
}

export function validateCurrency(currency: string | undefined, flagName: string): void {
  if (currency === undefined || currency === null) return;
  const upper = currency.toUpperCase();
  if (!ALLOWED_CURRENCIES.has(upper) && !isStablecoin(upper)) {
    throw new ValidationError(
      `${flagName}: unknown currency ${JSON.stringify(currency)}. ` +
      `Valid: ${[...ALLOWED_CURRENCIES, ...STABLECOINS].join(", ")}`,
    );
  }
}

/**
 * Quote (market) currency implied by a Yahoo-style exchange suffix.
 * Mirrors the suffix handling of `get_asset_type_sql()` /
 * `get_cash_key_for_asset_sql()` in `portfolio_db/sql/functions.sql` — keep in sync.
 */
export const MARKET_CURRENCY_BY_SUFFIX: Record<string, string> = {
  ".DE": "EUR",
  ".L": "GBP",
  ".T": "JPY",
  ".SW": "CHF",
  ".TO": "CAD",
  ".AX": "AUD",
  ".HK": "HKD",
  ".SG": "SGD",
};

/**
 * Market quote currency for a listed instrument, or `null` when the suffix
 * carries no currency information (US listings, FX pairs, crypto, stablecoins).
 */
export function instrumentQuoteCurrency(asset: string): string | null {
  const upper = (asset ?? "").toUpperCase().trim();
  for (const [suffix, currency] of Object.entries(MARKET_CURRENCY_BY_SUFFIX)) {
    if (upper.endsWith(suffix)) return currency;
  }
  return null;
}

/**
 * Warn when a transaction records a currency that contradicts the instrument's
 * market currency. `portfolio_cash_sql()` books the cash leg of a BUY/SELL into
 * the bucket named by the transaction `currency` (see #362/#365), so a wrong
 * value silently inflates one cash bucket and deflates another — the failure mode
 * behind #368 (EUR/GBP phantom). Warning only: a trade in a foreign listing can
 * legitimately settle in another currency, so this must not block a write.
 *
 * Returns the warning message (also emitted via `console.warn`, matching the
 * deprecated-date warning above) or `null` when there is nothing to flag.
 */
export function warnOnQuoteCurrencyMismatch(
  asset: string,
  currency: string | undefined,
): string | null {
  if (!asset || !asset.trim()) return null;
  if (currency === undefined || currency === null || !String(currency).trim()) return null;

  const upper = asset.toUpperCase().trim();
  if (isStablecoin(upper)) return null;
  if (upper.endsWith("USD=X") || upper.endsWith("-USD")) return null;
  if (ALLOWED_CURRENCIES.has(upper)) return null;

  const expected = instrumentQuoteCurrency(upper);
  if (expected === null) return null;

  const provided = String(currency).toUpperCase().trim();
  if (provided === expected || isStablecoin(provided)) return null;

  const message =
    `${asset} is a ${expected}-denominated listing but --currency is ${provided}. ` +
    `The cash leg of this transaction will be booked into the ${provided} bucket ` +
    `(portfolio_cash_sql), inflating it. Use --currency ${expected} unless the trade ` +
    `really settled in ${provided}.`;
  console.warn(`[warning] ${message}`);
  return message;
}
