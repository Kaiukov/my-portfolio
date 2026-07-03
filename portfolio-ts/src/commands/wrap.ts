import { querySingle } from "../db.js";
import { runTx } from "../tx.js";
import {
  ValidationError,
  parseDate,
  validatePositiveFloat,
} from "../validators.js";

export interface WrapResult {
  from: { asset: string; quantity: number };
  to: { asset: string; quantity: number };
  ratio: number;
  date: string;
  transaction_ids: [number, number];
  exchange_group_id: string;
}

type CryptoAssetRow = {
  asset_type: string;
  cash_like: boolean;
};

async function validateCryptoAsset(asset: string, flagName: string): Promise<string> {
  const row = await querySingle<CryptoAssetRow>(
    "SELECT get_asset_type_sql($1) AS asset_type, is_cash_like_sql($1) AS cash_like",
    [asset],
  );

  if (!row || row.cash_like || row.asset_type !== "crypto") {
    throw new ValidationError(`${flagName} must be a non-cash crypto asset, got ${asset}`);
  }

  return row.asset_type;
}

async function applyCryptoWrapConversion(params: {
  dateStr: string;
  fromAsset: string;
  toAsset: string;
  fromQuantity: number;
  toQuantity: number;
}): Promise<WrapResult> {
  const date = parseDate(params.dateStr, "--date");
  validatePositiveFloat(params.fromQuantity, "--from-quantity", "wrap");
  validatePositiveFloat(params.toQuantity, "--to-quantity", "wrap");

  const fromAsset = params.fromAsset.trim().toUpperCase();
  const toAsset = params.toAsset.trim().toUpperCase();

  if (!fromAsset || !toAsset) {
    throw new ValidationError("Both --from-asset and --to-asset are required");
  }

  if (fromAsset === toAsset) {
    throw new ValidationError(
      `--from-asset and --to-asset must be different assets; both are ${JSON.stringify(fromAsset)}.`,
    );
  }

  await validateCryptoAsset(fromAsset, "--from-asset");
  await validateCryptoAsset(toAsset, "--to-asset");

  const ratio = params.toQuantity / params.fromQuantity;
  const exchangeGroupId = crypto.randomUUID();
  const sourceExchange = `→ ${toAsset} @ ${ratio}`;
  const targetExchange = `← ${fromAsset} @ ${ratio}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await runTx(async (tx: any) => {
    const [fromAt] = (await tx.unsafe(
      "SELECT get_asset_type_sql($1) AS asset_type",
      [fromAsset],
    )) as { asset_type: string }[];
    const [toAt] = (await tx.unsafe(
      "SELECT get_asset_type_sql($1) AS asset_type",
      [toAsset],
    )) as { asset_type: string }[];

    const [fromIns] = (await tx.unsafe(
      `INSERT INTO transactions
       (date, asset, action, quantity, asset_type, price, currency,
        fees, fee_currency, exchange, data_source, account, exchange_group_id)
       VALUES ($1, $2, 'WRAP', $3, $4, NULL, '', NULL, NULL, $5, '', NULL, $6)
       RETURNING id`,
      [
        date,
        fromAsset,
        -params.fromQuantity,
        fromAt.asset_type,
        sourceExchange,
        exchangeGroupId,
      ],
    )) as { id: number }[];

    const [toIns] = (await tx.unsafe(
      `INSERT INTO transactions
       (date, asset, action, quantity, asset_type, price, currency,
        fees, fee_currency, exchange, data_source, account, exchange_group_id)
       VALUES ($1, $2, 'UNWRAP', $3, $4, NULL, '', NULL, NULL, $5, '', NULL, $6)
       RETURNING id`,
      [
        date,
        toAsset,
        params.toQuantity,
        toAt.asset_type,
        targetExchange,
        exchangeGroupId,
      ],
    )) as { id: number }[];

    await tx.unsafe("SELECT refresh_daily_returns_sql($1)", [date]);

    return { fromId: fromIns.id, toId: toIns.id };
  });

  return {
    from: { asset: fromAsset, quantity: params.fromQuantity },
    to: { asset: toAsset, quantity: params.toQuantity },
    ratio,
    date,
    transaction_ids: [result.fromId, result.toId],
    exchange_group_id: exchangeGroupId,
  };
}

export async function applyWrap(params: {
  dateStr: string;
  fromAsset: string;
  toAsset: string;
  fromQuantity: number;
  toQuantity: number;
}): Promise<WrapResult> {
  return applyCryptoWrapConversion(params);
}

export async function applyUnwrap(params: {
  dateStr: string;
  fromAsset: string;
  toAsset: string;
  fromQuantity: number;
  toQuantity: number;
}): Promise<WrapResult> {
  return applyCryptoWrapConversion(params);
}
