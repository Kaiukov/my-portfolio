#!/usr/bin/env bun
import { success, error, buildPagination } from "./response.js";
import { getStatus } from "./commands/status.js";
import { getTransactions } from "./commands/transactions.js";
import { addTransaction } from "./commands/add.js";
import { editTransaction, editDryRun } from "./commands/edit.js";
import { deleteTransaction, deletePreview } from "./commands/delete.js";
import { exchangeCurrency } from "./commands/exchange.js";
import { recalculate, recalculateDryRun } from "./commands/recalculate.js";
import { verifyPrices } from "./commands/verify_prices.js";
import { repairPrices, repairPricesDryRun } from "./commands/repair_prices.js";
import { fetchPrices } from "./providers/yahoo.js";
import { getReport } from "./commands/report.js";
import { getHealth } from "./commands/health.js";
import { initDb } from "./commands/init.js";
import { backupDb } from "./commands/backup.js";
import { ValidationError, NotFoundError } from "./validators.js";
import { close } from "./db.js";

const HELP_TEXT = `
Portfolio tracking with TypeScript/Bun.

Usage:
  portfolio-ts <command> [options]

Commands:
  status          Current portfolio status snapshot
  transactions    Paginated transaction list
  add             Add a transaction and recalculate
  edit            Edit an existing transaction and recalculate
  delete          Delete a transaction and recalculate
  exchange        Record a currency exchange (two linked transactions)
  recalculate     Rebuild daily_returns from cached prices
  verify_prices   Show price coverage diagnostics (read-only)
  repair_prices   Fetch missing prices from Yahoo Finance
  sync            repair_prices + recalculate (daily maintenance)
  report          Paginated daily portfolio returns
  health          DB reachability and price coverage diagnostic
  init            Verify database schema is ready
  backup          Create a pg_dump backup
  --help          Show this help message

Read command dates: YYYY-MM-DD
Write command dates: DD-MM-YYYY

Environment:
  PORTFOLIO_DB_URL  PostgreSQL connection string

Examples:
  portfolio-ts status
  portfolio-ts transactions --limit 20 --offset 40
  portfolio-ts add --date 01-01-2026 --asset AAPL --action BUY --quantity 10 --price 150 --exchange Interactive
  portfolio-ts edit --id 42 --price 155.50
  portfolio-ts delete --id 42 --confirm
  portfolio-ts exchange --date 01-01-2026 --from USD --to EURUSD=X --quantity 1000 --rate 0.92
  portfolio-ts --help
`.trim();

type FlagValue = string | true;

function parseArgs(argv: string[]): { command: string; flags: Map<string, FlagValue> } {
  const args = argv.slice(2);
  const raw = args[0] ?? "";
  const command =
    raw === "--help" || raw === "-h" || raw === "" ? "help" : raw;

  const flags = new Map<string, FlagValue>();
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  return { command, flags };
}

function str(flags: Map<string, FlagValue>, key: string): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

function float(flags: Map<string, FlagValue>, key: string): number | undefined {
  const s = str(flags, key);
  if (!s) return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

function int(flags: Map<string, FlagValue>, key: string): number | undefined {
  const s = str(flags, key);
  if (!s) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

function bool(flags: Map<string, FlagValue>, key: string): boolean {
  return flags.has(key);
}

export async function dispatch(argv: string[]): Promise<void> {
  const { command, flags } = parseArgs(argv);

  switch (command) {
    case "help": {
      console.log(HELP_TEXT);
      return;
    }

    case "status": {
      const data = await getStatus();
      console.log(JSON.stringify(success("status", data), null, 2));
      return;
    }

    case "transactions": {
      const limit = (() => {
        const v = int(flags, "limit");
        return Number.isFinite(v) && (v ?? 0) > 0 ? (v as number) : 50;
      })();
      const offset = (() => {
        const v = int(flags, "offset");
        return Number.isFinite(v) && (v ?? 0) >= 0 ? (v as number) : 0;
      })();
      const startDate = str(flags, "start-date") ?? str(flags, "start_date");
      const endDate = str(flags, "end-date") ?? str(flags, "end_date");
      const { data, total } = await getTransactions(limit, offset, startDate, endDate);
      const pagination = buildPagination(limit, offset, total);
      console.log(JSON.stringify(success("transactions", data, data.length, pagination), null, 2));
      return;
    }

    case "add": {
      const dateStr = str(flags, "date");
      const asset = str(flags, "asset");
      const action = str(flags, "action");
      const quantity = float(flags, "quantity");

      if (!dateStr || !asset || !action || quantity === undefined) {
        const env = error(
          "add",
          "VALIDATION_ERROR",
          "Required: --date DD-MM-YYYY --asset SYMBOL --action ACTION --quantity N --exchange NAME",
        );
        console.log(JSON.stringify(env, null, 2));
        process.exit(1);
        return;
      }

      const result = await addTransaction({
        dateStr,
        asset,
        action,
        quantity,
        price: float(flags, "price"),
        currency: str(flags, "currency"),
        fees: float(flags, "fees"),
        feeCurrency: str(flags, "fee-currency") ?? str(flags, "fee_currency"),
        exchange: str(flags, "exchange") ?? "",
        account: str(flags, "account"),
      });
      console.log(JSON.stringify(success("add", result), null, 2));
      return;
    }

    case "edit": {
      const transId = int(flags, "id");
      if (!transId) {
        console.log(JSON.stringify(error("edit", "VALIDATION_ERROR", "--id is required"), null, 2));
        process.exit(1);
        return;
      }
      const changes = {
        dateStr: str(flags, "date"),
        asset: str(flags, "asset"),
        action: str(flags, "action"),
        quantity: float(flags, "quantity"),
        price: float(flags, "price"),
        currency: str(flags, "currency"),
        fees: float(flags, "fees"),
        exchange: str(flags, "exchange"),
        dataSource: str(flags, "data-source") ?? str(flags, "data_source"),
        account: str(flags, "account"),
      };
      const isDryRun = bool(flags, "dry-run");
      if (isDryRun) {
        const result = await editDryRun(transId, changes);
        console.log(JSON.stringify(success("edit", result), null, 2));
      } else {
        const result = await editTransaction(transId, changes);
        console.log(JSON.stringify(success("edit", result), null, 2));
      }
      return;
    }

    case "delete": {
      const transId = int(flags, "id");
      if (!transId) {
        console.log(
          JSON.stringify(error("delete", "VALIDATION_ERROR", "--id is required"), null, 2),
        );
        process.exit(1);
        return;
      }
      const isDryRun = bool(flags, "dry-run");
      if (isDryRun) {
        const result = await deletePreview(transId);
        console.log(JSON.stringify(success("delete", result), null, 2));
      } else {
        const result = await deleteTransaction(transId, bool(flags, "confirm"));
        console.log(JSON.stringify(success("delete", result), null, 2));
      }
      return;
    }

    case "exchange": {
      const dateStr = str(flags, "date");
      const fromAsset = str(flags, "from");
      const toAsset = str(flags, "to");
      const quantity = float(flags, "quantity");
      const rate = float(flags, "rate");

      if (!dateStr || !fromAsset || !toAsset || quantity === undefined || rate === undefined) {
        const env = error(
          "exchange",
          "VALIDATION_ERROR",
          "Required: --date DD-MM-YYYY --from ASSET --to ASSET --quantity N --rate N",
        );
        console.log(JSON.stringify(env, null, 2));
        process.exit(1);
        return;
      }

      const result = await exchangeCurrency({ dateStr, fromAsset, toAsset, quantity, rate });
      console.log(JSON.stringify(success("exchange", result), null, 2));
      return;
    }

    case "recalculate": {
      const isDryRun = bool(flags, "dry-run");
      if (isDryRun) {
        const result = await recalculateDryRun({
          fromDateStr: str(flags, "from-date") ?? str(flags, "from_date"),
          force: bool(flags, "force"),
        });
        console.log(JSON.stringify(success("recalculate", result), null, 2));
      } else {
        const result = await recalculate({
          fromDateStr: str(flags, "from-date") ?? str(flags, "from_date"),
          force: bool(flags, "force"),
        });
        console.log(JSON.stringify(success("recalculate", result), null, 2));
      }
      return;
    }

    case "verify_prices": {
      const result = await verifyPrices();
      console.log(JSON.stringify(success("verify_prices", result), null, 2));
      return;
    }

    case "repair_prices": {
      const tickerArg = str(flags, "ticker");
      const tickers = tickerArg ? tickerArg.split(",").map((t) => t.trim()) : undefined;
      const isDryRun = bool(flags, "dry-run");

      if (isDryRun) {
        const result = await repairPricesDryRun({
          tickers,
          startDate: str(flags, "start-date"),
          endDate: str(flags, "end-date"),
        });
        console.log(JSON.stringify(success("repair_prices", result), null, 2));
      } else {
        const result = await repairPrices(
          { tickers, startDate: str(flags, "start-date"), endDate: str(flags, "end-date") },
          fetchPrices,
        );
        console.log(JSON.stringify(success("repair_prices", result), null, 2));
      }
      return;
    }

    case "sync": {
      const isDryRun = bool(flags, "dry-run");
      if (isDryRun) {
        const repairResult = await repairPricesDryRun({});
        const recalcResult = await recalculateDryRun({ force: false });
        console.log(
          JSON.stringify(
            success("sync", { dry_run: true, repair_prices: repairResult, recalculate: recalcResult }),
            null,
            2,
          ),
        );
      } else {
        const repairResult = await repairPrices({}, fetchPrices);
        const recalcResult = await recalculate({ force: true });
        console.log(
          JSON.stringify(
            success("sync", { repair_prices: repairResult, recalculate: recalcResult }),
            null,
            2,
          ),
        );
      }
      return;
    }

    case "report": {
      const limit = (() => { const v = int(flags, "limit"); return v && v > 0 ? v : 50; })();
      const offset = (() => { const v = int(flags, "offset"); return v != null && v >= 0 ? v : 0; })();
      const startDate = str(flags, "start-date") ?? str(flags, "start_date");
      const endDate = str(flags, "end-date") ?? str(flags, "end_date");
      const { data, total } = await getReport(limit, offset, startDate, endDate);
      const pagination = buildPagination(limit, offset, total);
      console.log(JSON.stringify(success("report", data, data.length, pagination), null, 2));
      return;
    }

    case "health": {
      const result = await getHealth();
      console.log(JSON.stringify(success("health", result), null, 2));
      return;
    }

    case "init": {
      const result = await initDb();
      console.log(JSON.stringify(success("init", result), null, 2));
      return;
    }

    case "backup": {
      const dbUrl = process.env.PORTFOLIO_DB_URL;
      if (!dbUrl) {
        console.log(JSON.stringify(error("backup", "CONFIG_ERROR", "PORTFOLIO_DB_URL is not set"), null, 2));
        process.exit(1);
        return;
      }
      const result = await backupDb({ dbUrl, outPath: str(flags, "out") });
      console.log(JSON.stringify(success("backup", result), null, 2));
      return;
    }

    default: {
      const envelope = error(command, "UNKNOWN_COMMAND", `Unknown command: ${command}`);
      console.log(JSON.stringify(envelope, null, 2));
      process.exit(1);
    }
  }
}

if (import.meta.main) {
  dispatch(process.argv)
    .catch((err: unknown) => {
      const cmd = process.argv[2] ?? "_";
      if (err instanceof ValidationError) {
        console.log(JSON.stringify(error(cmd, "VALIDATION_ERROR", err.message), null, 2));
      } else if (err instanceof NotFoundError) {
        console.log(JSON.stringify(error(cmd, "NOT_FOUND", err.message), null, 2));
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(JSON.stringify(error(cmd, "INTERNAL_ERROR", msg), null, 2));
      }
      process.exit(1);
    })
    .finally(() => {
      close().catch(() => {});
    });
}
