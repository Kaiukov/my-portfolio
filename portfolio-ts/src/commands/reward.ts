import { querySingle } from "../db.js";
import { runTx } from "../tx.js";
import {
  ValidationError,
  parseDate,
  validatePositiveFloat,
} from "../validators.js";
import { parseRow, type TransactionRow } from "./transactions.js";

export interface StakingRewardResult {
  transaction: TransactionRow;
  recalculated: boolean;
}

export async function applyStakingReward(params: {
  dateStr: string;
  asset: string;
  quantity: number;
  exchange: string;
  account?: string;
  price?: number;
  currency?: string;
  fees?: number;
  feeCurrency?: string;
}): Promise<StakingRewardResult> {
  const date = parseDate(params.dateStr, "--date");

  if (!params.asset || !params.asset.trim()) {
    throw new ValidationError("--asset is required for STAKING_REWARD");
  }
  const asset = params.asset.trim().toUpperCase();

  validatePositiveFloat(params.quantity, "--quantity", "staking_reward");

  if (!params.exchange || !params.exchange.trim()) {
    throw new ValidationError(
      "--exchange is required.\n" +
        "Expected: --exchange <broker or exchange name>\n" +
        "Example:  portfolio add --date 2026-01-01 --asset BTC-USD --action STAKING_REWARD --quantity 0.0001 --exchange Binance",
    );
  }

  if (params.price !== undefined) {
    throw new ValidationError("STAKING_REWARD does not accept a price");
  }
  if (params.fees !== undefined && params.fees !== 0) {
    throw new ValidationError("STAKING_REWARD does not accept fees");
  }
  if (params.feeCurrency !== undefined) {
    throw new ValidationError("STAKING_REWARD does not accept fee currency");
  }

  const assetRow = await querySingle<{ asset_type: string; cash_like: boolean }>(
    "SELECT get_asset_type_sql($1) AS asset_type, is_cash_like_sql($1) AS cash_like",
    [asset],
  );

  if (!assetRow || assetRow.cash_like || assetRow.asset_type !== "crypto") {
    throw new ValidationError(`STAKING_REWARD requires a non-cash crypto asset, got ${asset}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inserted = await runTx(async (tx: any) => {
    const [ins] = (await tx.unsafe(
      `INSERT INTO transactions
       (date, asset, action, quantity, asset_type, price, currency,
        fees, fee_currency, exchange, data_source, account)
       VALUES ($1, $2, 'STAKING_REWARD', $3, $4, NULL, $5, NULL, NULL, $6, '', $7)
       RETURNING id`,
      [
        date,
        asset,
        params.quantity,
        assetRow.asset_type,
        params.currency ?? "USD",
        params.exchange,
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
