import { querySingle } from "../db.js";
import { runTx } from "../tx.js";
import {
  ValidationError,
  parseDate,
  validatePositiveFloat,
} from "../validators.js";

export interface ExchangeResult {
  from: { asset: string; quantity: number };
  to: { asset: string; quantity: number };
  rate: number;
  date: string;
  transaction_ids: [number, number];
}

export async function exchangeCurrency(params: {
  dateStr: string;
  fromAsset: string;
  toAsset: string;
  quantity: number;
  rate: number;
}): Promise<ExchangeResult> {
  const date = parseDate(params.dateStr, "--date");
  validatePositiveFloat(params.quantity, "--quantity", "exchange");
  validatePositiveFloat(params.rate, "--rate", "exchange");

  if (params.fromAsset.toUpperCase() === params.toAsset.toUpperCase()) {
    throw new ValidationError(
      `--from and --to must be different assets; both are ${JSON.stringify(params.fromAsset)}.\n` +
        "Expected: --from <currency> --to <different currency>\n" +
        "Example:  portfolio-ts exchange --date 01-01-2026 --from USD --to EURUSD=X --quantity 1000 --rate 0.92",
    );
  }

  // Cash-like validation via PostgreSQL — avoids duplicating domain logic
  const fromCashRow = await querySingle<{ ok: boolean }>(
    "SELECT is_cash_like_sql($1) AS ok",
    [params.fromAsset],
  );
  const toCashRow = await querySingle<{ ok: boolean }>(
    "SELECT is_cash_like_sql($1) AS ok",
    [params.toAsset],
  );

  if (!fromCashRow?.ok) {
    throw new ValidationError(
      `Exchange --from asset must be cash-like, got ${JSON.stringify(params.fromAsset)}`,
    );
  }
  if (!toCashRow?.ok) {
    throw new ValidationError(
      `Exchange --to asset must be cash-like, got ${JSON.stringify(params.toAsset)}`,
    );
  }

  const targetAmount = params.quantity * params.rate;
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await runTx(async (tx: any) => {
    const [fromAt] = (await tx.unsafe(
      "SELECT get_asset_type_sql($1) AS asset_type",
      [params.fromAsset],
    )) as { asset_type: string }[];
    const [toAt] = (await tx.unsafe(
      "SELECT get_asset_type_sql($1) AS asset_type",
      [params.toAsset],
    )) as { asset_type: string }[];

    const [fromIns] = (await tx.unsafe(
      `INSERT INTO transactions
       (date, asset, action, quantity, asset_type, price, currency,
        fees, fee_currency, exchange, data_source, account)
       VALUES ($1, $2, 'EXCHANGE_FROM', $3, $4, NULL, '', NULL, NULL, '', $5, NULL)
       RETURNING id`,
      [
        date,
        params.fromAsset,
        -params.quantity,
        fromAt.asset_type,
        `→ ${params.toAsset} @ ${params.rate}`,
      ],
    )) as { id: number }[];

    const [toIns] = (await tx.unsafe(
      `INSERT INTO transactions
       (date, asset, action, quantity, asset_type, price, currency,
        fees, fee_currency, exchange, data_source, account)
       VALUES ($1, $2, 'EXCHANGE_TO', $3, $4, NULL, '', NULL, NULL, '', $5, NULL)
       RETURNING id`,
      [
        date,
        params.toAsset,
        targetAmount,
        toAt.asset_type,
        `← ${params.fromAsset} @ ${params.rate}`,
      ],
    )) as { id: number }[];

    await tx.unsafe("SELECT refresh_daily_returns_sql($1)", [date]);

    return { fromId: fromIns.id, toId: toIns.id };
  });

  return {
    from: { asset: params.fromAsset, quantity: params.quantity },
    to: { asset: params.toAsset, quantity: Math.round(targetAmount * 1e6) / 1e6 },
    rate: params.rate,
    date,
    transaction_ids: [result.fromId, result.toId],
  };
}
