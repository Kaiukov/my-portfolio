import { querySingle } from "../db.js";
import { runTx } from "../tx.js";
import {
  ValidationError,
  parseDate,
  validatePositiveFloat,
} from "../validators.js";
import { parseRow, type TransactionRow } from "./transactions.js";

export interface SplitResult {
  transaction: TransactionRow;
  recalculated: boolean;
}

export async function applySplit(params: {
  dateStr: string;
  asset: string;
  ratio: number;
  exchange?: string;
  account?: string;
}): Promise<SplitResult> {
  const date = parseDate(params.dateStr, "--date");

  if (!params.asset || !params.asset.trim()) {
    throw new ValidationError("--asset is required for SPLIT");
  }
  const asset = params.asset.trim().toUpperCase();

  validatePositiveFloat(params.ratio, "--ratio", "split");

  const cashRow = await querySingle<{ ok: boolean }>(
    "SELECT is_cash_like_sql($1) AS ok",
    [asset],
  );
  if (cashRow?.ok) {
    throw new ValidationError(
      `SPLIT requires a non-cash asset, got ${asset}`,
    );
  }

  const ratio = params.ratio;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inserted = await runTx(async (tx: any) => {
    const [atRow] = (await tx.unsafe(
      "SELECT get_asset_type_sql($1) AS asset_type",
      [asset],
    )) as { asset_type: string }[];
    const assetType = atRow?.asset_type ?? "stock_usd";

    const [ins] = (await tx.unsafe(
      `INSERT INTO transactions
       (date, asset, action, quantity, asset_type, price, currency,
        fees, fee_currency, exchange, data_source, account)
       VALUES ($1, $2, 'SPLIT', $3, $4, NULL, NULL, NULL, NULL, $5, $6, $7)
       RETURNING id`,
      [
        date,
        asset,
        ratio,
        assetType,
        params.exchange ?? "",
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
