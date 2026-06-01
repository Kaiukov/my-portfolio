import { type ErrorEnvelope, error } from "../response.js";
import { addTransaction } from "../commands/add.js";
import { editTransaction, editDryRun } from "../commands/edit.js";
import { deleteTransaction, deletePreview } from "../commands/delete.js";
import { exchangeCurrency } from "../commands/exchange.js";
import { NotFoundError, ValidationError } from "../validators.js";

export type WriteHandlers = {
  addTransaction: typeof addTransaction;
  editTransaction: typeof editTransaction;
  editDryRun: typeof editDryRun;
  deleteTransaction: typeof deleteTransaction;
  deletePreview: typeof deletePreview;
  exchangeCurrency: typeof exchangeCurrency;
};

export const defaultWriteHandlers: WriteHandlers = {
  addTransaction,
  editTransaction,
  editDryRun,
  deleteTransaction,
  deletePreview,
  exchangeCurrency,
};

export function resolveWriteHandlers(overrides: Partial<WriteHandlers> = {}): WriteHandlers {
  return {
    addTransaction: overrides.addTransaction ?? defaultWriteHandlers.addTransaction,
    editTransaction: overrides.editTransaction ?? defaultWriteHandlers.editTransaction,
    editDryRun: overrides.editDryRun ?? defaultWriteHandlers.editDryRun,
    deleteTransaction: overrides.deleteTransaction ?? defaultWriteHandlers.deleteTransaction,
    deletePreview: overrides.deletePreview ?? defaultWriteHandlers.deletePreview,
    exchangeCurrency: overrides.exchangeCurrency ?? defaultWriteHandlers.exchangeCurrency,
  };
}

export function toWriteErrorEnvelope(
  command: string,
  err: unknown,
): { body: ErrorEnvelope; status: number } {
  const msg = err instanceof Error ? err.message : String(err);

  if (err instanceof ValidationError) {
    const code = msg.includes("requires explicit confirmation") ? "CONFIRM_REQUIRED" : err.code;
    return { body: error(command, code, msg), status: 400 };
  }

  if (err instanceof NotFoundError) {
    return { body: error(command, err.code, msg), status: 404 };
  }

  return { body: error(command, "INTERNAL_ERROR", msg), status: 500 };
}
