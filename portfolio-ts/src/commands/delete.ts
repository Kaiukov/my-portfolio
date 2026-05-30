import * as db from "../db.js";
import { NotFoundError, ValidationError, validatePositiveInt } from "../validators.js";

export interface DeleteDryRunResult {
  dry_run: true;
  transaction_id: number;
  would_delete: {
    date: string;
    asset: string;
    action: string;
    quantity: number;
  };
}

export interface DeleteResult {
  deleted_id: number;
  recalculated: boolean;
}

function rowDate(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split("T")[0];
  return String(val ?? "");
}

export async function deletePreview(transId: number): Promise<DeleteDryRunResult> {
  validatePositiveInt(transId, "--id", "delete");

  const row = await db.querySingle<Record<string, unknown>>(
    `SELECT date, asset, action, quantity FROM transactions WHERE id = $1`,
    [transId],
  );
  if (!row) throw new NotFoundError(`Transaction ID ${transId} not found`);

  return {
    dry_run: true,
    transaction_id: transId,
    would_delete: {
      date: rowDate(row["date"]),
      asset: String(row["asset"] ?? ""),
      action: String(row["action"] ?? ""),
      quantity: Number(row["quantity"] ?? 0),
    },
  };
}

export async function deleteTransaction(
  transId: number,
  confirm: boolean,
): Promise<DeleteResult> {
  validatePositiveInt(transId, "--id", "delete");

  if (!confirm) {
    throw new ValidationError(
      `Deletion of transaction ID ${transId} requires explicit confirmation.\n` +
        "Problem: --confirm flag was not provided.\n" +
        `Expected: portfolio-ts delete --id ${transId} --confirm\n` +
        "Tip:      use --dry-run first to preview what will be deleted",
    );
  }

  const existing = await db.querySingle<Record<string, unknown>>(
    `SELECT id, date FROM transactions WHERE id = $1`,
    [transId],
  );
  if (!existing) {
    throw new NotFoundError(
      `Transaction ID ${transId} not found.\nHint: run portfolio-ts transactions to list IDs`,
    );
  }

  const transDate = rowDate(existing["date"]);
  await db.withTransaction(async (tx) => {
    await tx.unsafe("DELETE FROM transactions WHERE id = $1", [transId]);
    await tx.unsafe("SELECT refresh_daily_returns_sql($1)", [transDate]);
  });

  return { deleted_id: transId, recalculated: true };
}
