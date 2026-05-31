export const STALE_MAX_AGE_DAYS = 5;

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
  "DIVIDEND", "INTEREST", "FEE", "TAX",
]);

export const ALLOWED_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "UAH", "JPY", "CHF", "CAD", "AUD", "HKD", "SGD",
]);

const FX_PAIR_RE = /^[A-Z]{6}=X$/;
const ISO_CURRENCY_RE = /^[A-Z]{3}$/;

export function validateAssetSymbol(asset: string, action: string): void {
  if (!asset || !asset.trim()) {
    throw new ValidationError(
      "--asset is required.\n" +
      "Expected: --asset <ticker symbol>\n" +
      "Example:  portfolio-ts add --date 2026-01-01 --asset AAPL --action BUY --quantity 10 --price 150 --exchange Interactive",
    );
  }

  const upper = asset.toUpperCase();

  if ((action === "BUY" || action === "SELL") && ISO_CURRENCY_RE.test(upper) && !FX_PAIR_RE.test(upper)) {
    throw new ValidationError(
      `--asset: ${JSON.stringify(asset)} looks like an ISO currency code. ` +
      `Use the FX pair format (e.g. EURUSD=X) instead of a bare currency code.\n` +
      "Expected: --asset <SYMBOL> or <XXXYYY=X>\n" +
      "Example:  portfolio-ts add --date 2026-01-01 --asset EURUSD=X --action BUY --quantity 1000 --price 1.05 --exchange Interactive",
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
  if (!ALLOWED_CURRENCIES.has(upper)) {
    throw new ValidationError(
      `${flagName}: unknown currency ${JSON.stringify(currency)}. ` +
      `Valid: ${[...ALLOWED_CURRENCIES].join(", ")}`,
    );
  }
}
