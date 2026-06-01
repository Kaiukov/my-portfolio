import { query, querySingle } from "../db.js";
import { runTx } from "../tx.js";
import { NotFoundError, ValidationError, validatePositiveInt } from "../validators.js";

export interface DeleteDryRunRow {
  id: number;
  date: string;
  asset: string;
  action: string;
  quantity: number;
}

export interface DeleteDryRunResult {
  dry_run: true;
  transaction_id: number;
  would_delete: DeleteDryRunRow[];
  is_exchange_group: boolean;
}

export interface DeleteResult {
  deleted_ids: number[];
  recalculated: boolean;
}

function rowDate(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split("T")[0];
  return String(val ?? "");
}

function fmtRow(row: Record<string, unknown>): DeleteDryRunRow {
  return {
    id: Number(row["id"] ?? 0),
    date: rowDate(row["date"]),
    asset: String(row["asset"] ?? ""),
    action: String(row["action"] ?? ""),
    quantity: Number(row["quantity"] ?? 0),
  };
}

export async function deletePreview(transId: number): Promise<DeleteDryRunResult> {
  validatePositiveInt(transId, "--id", "delete");

  const row = await querySingle<Record<string, unknown>>(
    `SELECT id, date, asset, action, quantity, exchange_group_id
     FROM transactions WHERE id = $1`,
    [transId],
  );
  if (!row) throw new NotFoundError(`Transaction ID ${transId} not found`);

  const action = String(row["action"] ?? "");
  const groupId = row["exchange_group_id"] as string | null;

  if ((action === "EXCHANGE_FROM" || action === "EXCHANGE_TO") && groupId) {
    const siblings = await query<Record<string, unknown>>(
      `SELECT id, date, asset, action, quantity
       FROM transactions
       WHERE exchange_group_id = $1
       ORDER BY id`,
      [groupId],
    );
    return {
      dry_run: true,
      transaction_id: transId,
      would_delete: siblings.map(fmtRow),
      is_exchange_group: true,
    };
  }

  if (action === "EXCHANGE_FROM" || action === "EXCHANGE_TO") {
    return {
      dry_run: true,
      transaction_id: transId,
      would_delete: [fmtRow(row)],
      is_exchange_group: false,
    };
  }

  return {
    dry_run: true,
    transaction_id: transId,
    would_delete: [fmtRow(row)],
    is_exchange_group: false,
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
        `Expected: portfolio delete --id ${transId} --confirm\n` +
        "Tip:      use --dry-run first to preview what will be deleted",
    );
  }

  const existing = await querySingle<Record<string, unknown>>(
    `SELECT id, date, action, exchange_group_id FROM transactions WHERE id = $1`,
    [transId],
  );
  if (!existing) {
    throw new NotFoundError(
      `Transaction ID ${transId} not found.\nHint: run portfolio transactions to list IDs`,
    );
  }

  const transDate = rowDate(existing["date"]);
  const action = String(existing["action"] ?? "");
  const groupId = existing["exchange_group_id"] as string | null;

  if (action === "EXCHANGE_FROM" || action === "EXCHANGE_TO") {
    if (groupId) {
      // Group-aware: delete both legs together
      const removed = await runTx(async (tx: { unsafe: typeof query }) => {
        const deletedRows = (await tx.unsafe(
          `DELETE FROM transactions
           WHERE exchange_group_id = $1
           RETURNING id`,
          [groupId],
        )) as { id: number }[];
        await tx.unsafe("SELECT refresh_daily_returns_sql($1)", [transDate]);
        return deletedRows.map((r) => r.id);
      });
      return { deleted_ids: removed, recalculated: true };
    }

    // Legacy: ungrouped exchange leg — reject to prevent value creation/destruction
    throw new ValidationError(
      `Transaction ID ${transId} is one leg of an exchange recorded before exchange grouping.\n` +
        "Deleting a single leg would create or destroy portfolio value.\n" +
        "This delete is blocked to preserve value conservation.\n" +
        "Tip: use the exchange command for new exchanges to enable safe paired deletion.",
    );
  }

  // Non-exchange transactions: single-row delete (existing behaviour)
  await runTx(async (tx: { unsafe: typeof query }) => {
    await tx.unsafe("DELETE FROM transactions WHERE id = $1", [transId]);
    await tx.unsafe("SELECT refresh_daily_returns_sql($1)", [transDate]);
  });

  return { deleted_ids: [transId], recalculated: true };
}
