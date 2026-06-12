import { success, error, type Envelope } from "../response.js";
import { ValidationError } from "../validators.js";
import { resolveWriteHandlers, toWriteErrorEnvelope, type WriteHandlers } from "../adapters/shared.js";

type JsonObject = Record<string, unknown>;

export type McpWriteContext = {
  write?: Partial<WriteHandlers>;
};

export function strField(body: JsonObject, key: string): string | undefined {
  const val = body[key];
  return typeof val === "string" ? val : undefined;
}

export function floatField(body: JsonObject, ...keys: string[]): number | undefined {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const raw = body[key];
    if (typeof raw === "number") {
      return Number.isFinite(raw) ? raw : undefined;
    }
    if (typeof raw === "string") {
      const parsed = parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }
  return undefined;
}

export function intField(body: JsonObject, ...keys: string[]): number | undefined {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const raw = body[key];
    if (typeof raw === "number" && Number.isInteger(raw)) return raw;
    if (typeof raw === "string") {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function parseBoolValue(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return undefined;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    return undefined;
  }
  return undefined;
}

function boolFlag(body: JsonObject, ...keys: string[]): boolean {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const raw = body[key];
    if (raw === "" || raw === null) return true;
    const parsed = parseBoolValue(raw);
    return parsed ?? false;
  }
  return false;
}

export async function mcpWrite(
  toolName: string,
  args: JsonObject,
  ctx: McpWriteContext = {},
): Promise<Envelope> {
  const write = resolveWriteHandlers(ctx.write);

  try {
    if (toolName === "add_transaction") {
      const dateStr = strField(args, "date");
      const asset = strField(args, "asset");
      const action = strField(args, "action");
      const quantity = floatField(args, "quantity");

      if (!dateStr || !asset || !action || quantity === undefined) {
        throw new ValidationError("Required: date, asset, action, quantity, exchange");
      }

      const result = await write.addTransaction({
        dateStr,
        asset,
        action,
        quantity,
        price: floatField(args, "price"),
        currency: strField(args, "currency"),
        fees: floatField(args, "fees"),
        feeCurrency: strField(args, "feeCurrency") ?? strField(args, "fee_currency"),
        exchange: strField(args, "exchange") ?? "",
        account: strField(args, "account"),
      });

      return success("add", result);
    }

    if (toolName === "edit_transaction") {
      const transId = intField(args, "id", "transactionId", "transaction_id", "transId");
      if (!transId) throw new ValidationError("Required: id");

      const changes = {
        dateStr: strField(args, "date"),
        asset: strField(args, "asset"),
        action: strField(args, "action"),
        quantity: floatField(args, "quantity"),
        price: floatField(args, "price"),
        currency: strField(args, "currency"),
        fees: floatField(args, "fees"),
        feeCurrency: strField(args, "feeCurrency") ?? strField(args, "fee_currency"),
        exchange: strField(args, "exchange"),
        dataSource: strField(args, "dataSource") ?? strField(args, "data_source"),
        account: strField(args, "account"),
      };

      const isDryRun = boolFlag(args, "dry_run", "dryRun", "dry-run");
      if (isDryRun) {
        const result = await write.editDryRun(transId, changes);
        return success("edit", result);
      }

      const result = await write.editTransaction(transId, changes);
      return success("edit", result);
    }

    if (toolName === "delete_transaction") {
      const transId = intField(args, "id", "transactionId", "transaction_id", "transId");
      if (!transId) throw new ValidationError("Required: id");

      const isDryRun = boolFlag(args, "dry_run", "dryRun", "dry-run");
      if (isDryRun) {
        const result = await write.deletePreview(transId);
        return success("delete", result, result.would_delete.length);
      }

      const confirm = boolFlag(args, "confirm");
      const result = await write.deleteTransaction(transId, confirm);
      return success("delete", result, result.deleted_ids.length);
    }

    if (toolName === "exchange_currency") {
      const dateStr = strField(args, "date");
      const fromAsset = strField(args, "fromAsset") ?? strField(args, "from_asset") ?? strField(args, "from");
      const toAsset = strField(args, "toAsset") ?? strField(args, "to_asset") ?? strField(args, "to");
      const quantity = floatField(args, "quantity");
      const rate = floatField(args, "rate");

      if (!dateStr || !fromAsset || !toAsset || quantity === undefined || rate === undefined) {
        throw new ValidationError("Required: date, fromAsset, toAsset, quantity, rate");
      }

      const result = await write.exchangeCurrency({ dateStr, fromAsset, toAsset, quantity, rate });
      return success("exchange", result);
    }

    if (toolName === "split") {
      const dateStr = strField(args, "date");
      const asset = strField(args, "asset");
      const ratio = floatField(args, "ratio");
      const confirm = args["confirm"];

      if (!dateStr || !asset || ratio === undefined) {
        throw new ValidationError("Required: date, asset, ratio, confirm");
      }

      if (!confirm) {
        throw new ValidationError("--confirm is required for split");
      }

      const result = await write.applySplit({
        dateStr,
        asset,
        ratio,
        exchange: strField(args, "exchange"),
        account: strField(args, "account"),
      });
      return success("split", result);
    }

    return error("mcp", "NOT_FOUND", `Unsupported MCP write tool: ${toolName}`);
  } catch (err) {
    const command =
      toolName === "add_transaction"
        ? "add"
        : toolName === "exchange_currency"
          ? "exchange"
          : toolName === "split"
            ? "split"
            : toolName === "delete_transaction"
              ? "delete"
              : toolName === "edit_transaction"
                ? "edit"
                : "mcp";
    return toWriteErrorEnvelope(command, err).body;
  }
}
