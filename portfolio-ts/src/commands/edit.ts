import * as db from "../db.js";
import {
  ValidationError,
  NotFoundError,
  parseWriteDate,
  validatePositiveFloat,
  validateNonNegativeFloat,
  validatePositiveInt,
} from "../validators.js";
import { parseRow, type TransactionRow } from "./transactions.js";

export interface EditChanges {
  dateStr?: string;
  asset?: string;
  action?: string;
  quantity?: number;
  price?: number;
  currency?: string;
  fees?: number;
  exchange?: string;
  dataSource?: string;
  account?: string;
}

export interface EditResult {
  before: TransactionRow;
  transaction: TransactionRow;
  recalculated: boolean;
  from_date: string;
}

export interface EditDryRunResult {
  dry_run: true;
  transaction_id: number;
  current: TransactionRow;
  proposed_changes: Record<string, string>;
}

async function fetchById(transId: number): Promise<TransactionRow | null> {
  const row = await db.querySingle<Record<string, unknown>>(
    `SELECT id, date, asset, action, quantity, asset_type, price, currency,
            fees, fee_currency, exchange, data_source, account, created_at, updated_at
     FROM transactions WHERE id = $1`,
    [transId],
  );
  return row ? parseRow(row) : null;
}

export async function editDryRun(
  transId: number,
  changes: EditChanges,
): Promise<EditDryRunResult> {
  validatePositiveInt(transId, "--id", "edit");

  const hasChanges = Object.values(changes).some((v) => v !== undefined);
  if (!hasChanges) {
    throw new ValidationError(
      "Provide at least one field to update.\n" +
        "Example: portfolio-ts edit --id 42 --price 155.50",
    );
  }

  const existing = await fetchById(transId);
  if (!existing) throw new NotFoundError(`Transaction ID ${transId} not found`);

  const proposed: Record<string, string> = {};
  for (const [k, v] of Object.entries(changes)) {
    if (v !== undefined) proposed[k] = String(v);
  }

  return { dry_run: true, transaction_id: transId, current: existing, proposed_changes: proposed };
}

export async function editTransaction(
  transId: number,
  changes: EditChanges,
): Promise<EditResult> {
  validatePositiveInt(transId, "--id", "edit");

  const hasChanges = Object.values(changes).some((v) => v !== undefined);
  if (!hasChanges) {
    throw new ValidationError(
      "Provide at least one field to update.\n" +
        "Example: portfolio-ts edit --id 42 --price 155.50",
    );
  }

  if (changes.quantity !== undefined) validatePositiveFloat(changes.quantity, "--quantity", "edit");
  if (changes.price !== undefined) validatePositiveFloat(changes.price, "--price", "edit");
  if (changes.fees !== undefined) validateNonNegativeFloat(changes.fees, "--fees", "edit");

  const existing = await fetchById(transId);
  if (!existing) {
    throw new NotFoundError(
      `Transaction ID ${transId} not found.\n` +
        "Hint: run portfolio-ts transactions to list IDs",
    );
  }

  const before = existing;
  const newDate = changes.dateStr ? parseWriteDate(changes.dateStr, "--date") : existing.date;
  const newAction = (changes.action ?? existing.action).toUpperCase();
  const newQuantity = changes.quantity ?? existing.quantity;
  const newAsset = changes.asset ?? existing.asset;

  if (newAction === "SELL") {
    const row = await db.querySingle<{ net: string }>(
      `SELECT COALESCE(SUM(CASE WHEN action = 'BUY' THEN quantity
                               WHEN action = 'SELL' THEN -quantity
                               ELSE 0 END), 0)::text AS net
       FROM transactions WHERE asset = $1 AND date <= $2 AND id != $3`,
      [newAsset, newDate, transId],
    );
    const net = Number(row?.net ?? 0);
    if (newQuantity > net) {
      throw new ValidationError(
        `Cannot SELL ${newQuantity} of ${newAsset}: only ${net} shares held as of ${newDate}`,
      );
    }
  }

  const fromDate = newDate < existing.date ? newDate : existing.date;
  
  const updated = await db.withTransaction(async (tx) => {
    const [atRow] = await tx.unsafe<{ asset_type: string }>(
      "SELECT get_asset_type_sql($1) AS asset_type",
      [newAsset],
    );
    const assetType = atRow?.asset_type ?? existing.asset_type;

    const newFees = changes.fees !== undefined ? changes.fees : existing.fees;

    const [updRow] = await tx.unsafe<Record<string, unknown>>(
      `UPDATE transactions SET
         date = $1, asset = $2, action = $3, quantity = $4, asset_type = $5,
         price = $6, currency = $7, fees = $8, fee_currency = $9,
         exchange = $10, data_source = $11, account = $12, updated_at = NOW()
       WHERE id = $13
       RETURNING id, date, asset, action, quantity, asset_type, price, currency,
                 fees, fee_currency, exchange, data_source, account, created_at, updated_at`,
      [
        newDate,
        newAsset,
        newAction,
        newQuantity,
        assetType,
        changes.price !== undefined ? changes.price : existing.price,
        changes.currency ?? existing.currency,
        newFees,
        existing.fee_currency,
        changes.exchange ?? existing.exchange,
        changes.dataSource ?? existing.data_source,
        changes.account ?? existing.account,
        transId,
      ],
    );

    await tx.unsafe("SELECT refresh_daily_returns_sql($1)", [fromDate]);
    return updRow;
  });

  return { before, transaction: parseRow(updated), recalculated: true, from_date: fromDate };
}
