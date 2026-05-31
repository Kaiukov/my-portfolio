import { querySingle } from "../db.js";
import { runTx } from "../tx.js";
import {
  ValidationError,
  parseDate,
  validatePositiveFloat,
  validateNonNegativeFloat,
  validateAssetSymbol,
  validateAction,
  validateCurrency,
} from "../validators.js";
import { parseRow, type TransactionRow } from "./transactions.js";

export interface AddResult {
  transaction: TransactionRow;
  recalculated: boolean;
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
}): Promise<AddResult> {
  const date = parseDate(params.dateStr, "--date");
  const action = validateAction(params.action);

  validateAssetSymbol(params.asset, action);
  validateCurrency(params.currency, "--currency");

  if (!params.exchange || !params.exchange.trim()) {
    throw new ValidationError(
      "--exchange is required.\n" +
        "Expected: --exchange <broker or exchange name>\n" +
        "Example:  portfolio-ts add --date 01-01-2026 --asset AAPL --action BUY " +
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

  if (action === "FEE" || action === "TAX" || action === "DIVIDEND" || action === "INTEREST") {
    if (params.price !== undefined) {
      throw new ValidationError(`${action} does not accept a price`);
    }
    const cashRow = await querySingle<{ ok: boolean }>(
      "SELECT is_cash_like_sql($1) AS ok",
      [params.asset],
    );
    if (!cashRow?.ok) {
      throw new ValidationError(
        `${action} requires a cash asset, got ${params.asset}`,
      );
    }
  }

  if (action === "SELL") {
    const row = await querySingle<{ net: string }>(
      `SELECT COALESCE(SUM(CASE WHEN action = 'BUY' THEN quantity
                               WHEN action = 'SELL' THEN -quantity
                               ELSE 0 END), 0)::text AS net
       FROM transactions WHERE asset = $1 AND date <= $2`,
      [params.asset, date],
    );
    const net = Number(row?.net ?? 0);
    if (params.quantity > net) {
      throw new ValidationError(
        `Cannot SELL ${params.quantity} of ${params.asset}: ` +
          `only ${net} shares held as of ${date}`,
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inserted = await runTx(async (tx: any) => {
    const [atRow] = (await tx.unsafe(
      "SELECT get_asset_type_sql($1) AS asset_type",
      [params.asset],
    )) as { asset_type: string }[];
    const assetType = atRow?.asset_type ?? "stock_usd";

    const [ins] = (await tx.unsafe(
      `INSERT INTO transactions
       (date, asset, action, quantity, asset_type, price, currency,
        fees, fee_currency, exchange, data_source, account)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        date,
        params.asset,
        action,
        params.quantity,
        assetType,
        params.price ?? null,
        params.currency ?? "USD",
        params.fees ?? null,
        params.feeCurrency ?? null,
        params.exchange,
        "",
        params.account ?? null,
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
