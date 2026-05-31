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
import { repairPrices, repairPricesDryRun, runDailyMaintenanceCheck } from "./commands/repair_prices.js";
import { fetchPrices } from "./providers/yahoo.js";
import { getReport } from "./commands/report.js";
import { getCash } from "./commands/cash.js";
import { getAllocation } from "./commands/allocation.js";
import { getSummary } from "./commands/summary.js";
import { getConcentration } from "./commands/concentration.js";
import { getPerformance } from "./commands/performance.js";
import { getMwr } from "./commands/mwr.js";
import { getHealth } from "./commands/health.js";
import { getWidget } from "./commands/widget.js";
import { initDb } from "./commands/init.js";
import { backupDb } from "./commands/backup.js";
import { cronInstall, cronList, cronRemove } from "./commands/cron.js";
import { getPriceFreshness } from "./commands/freshness.js";
import { refreshPortfolio, refreshPortfolioDryRun } from "./commands/refresh.js";
import { scheduleEmit, scheduleInstall, scheduleRemove } from "./commands/schedule.js";
import { ValidationError, NotFoundError } from "./validators.js";
import { close } from "./db.js";

const HELP_TEXT = `
Portfolio tracking with TypeScript/Bun.

Usage:
  portfolio-ts <command> [options]

Commands:
  status          Current portfolio status snapshot (--as-of-date YYYY-MM-DD)
  transactions    Paginated transaction list
  add             Add a transaction and recalculate
  edit            Edit an existing transaction and recalculate
  delete          Delete a transaction and recalculate
  exchange        Record a currency exchange (two linked transactions)
  recalculate     Rebuild daily_returns from cached prices
  verify_prices   Show price coverage diagnostics (read-only)
  repair_prices   Fetch missing prices from Yahoo Finance
  cash            Cash balances by currency with USD values
  allocation      Portfolio allocation breakdown by asset
  summary         High-level portfolio summary metrics
  concentration   Portfolio concentration metrics (HHI + top holdings)
  performance     Performance metrics: TWR, Sharpe, max drawdown, benchmark
  mwr             Money-weighted return (XIRR) accounting for deposit/withdrawal timing
  widget          Compact portfolio widget JSON for dashboards
  sync            repair_prices + recalculate (daily maintenance)
  refresh         Fetch Yahoo prices via HTTPS, recalculate, and return summary (OS-cron)
  schedule        Manage OS crontab for automatic portfolio refresh (--emit/--install/--remove)
  report          Paginated daily portfolio returns
  health          DB reachability and price coverage diagnostic
  init            Verify database schema is ready
  backup          Create a pg_dump backup
  cron            Manage pg_cron scheduled jobs (install / list / remove)
  --help          Show this help message

Dates: ISO YYYY-MM-DD (legacy DD-MM-YYYY also accepted on write commands)

Environment:
  PORTFOLIO_DB_URL  PostgreSQL connection string

Examples:
  portfolio-ts status
  portfolio-ts transactions --limit 20 --offset 40
  portfolio-ts add --date 2026-01-01 --asset AAPL --action BUY --quantity 10 --price 150 --exchange Interactive
  portfolio-ts edit --id 42 --price 155.50
  portfolio-ts delete --id 42 --confirm
  portfolio-ts exchange --date 2026-01-01 --from USD --to EURUSD=X --quantity 1000 --rate 0.92
  portfolio-ts schedule emit
  portfolio-ts schedule install / schedule remove
  portfolio-ts refresh
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
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const freshnessMeta = await getPriceFreshness(asOfDate);
      const data = await getStatus(asOfDate);
      console.log(JSON.stringify(success("status", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>), null, 2));
      return;
    }

    case "transactions": {
      const limit = (() => {
        const v = int(flags, "limit");
        if (v !== undefined && (!Number.isFinite(v) || v <= 0)) {
          console.log(JSON.stringify(error("transactions", "VALIDATION_ERROR", "--limit must be a positive number"), null, 2));
          process.exit(1);
        }
        return v ?? 50;
      })();
      const offset = (() => {
        const v = int(flags, "offset");
        if (v !== undefined && (!Number.isFinite(v) || v < 0)) {
          console.log(JSON.stringify(error("transactions", "VALIDATION_ERROR", "--offset must be a non-negative number"), null, 2));
          process.exit(1);
        }
        return v ?? 0;
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
          "Required: --date YYYY-MM-DD --asset SYMBOL --action ACTION --quantity N --exchange NAME",
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
        feeCurrency: str(flags, "fee-currency") ?? str(flags, "fee_currency"),
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
        console.log(JSON.stringify(success("delete", result, result.would_delete.length), null, 2));
      } else {
        const result = await deleteTransaction(transId, bool(flags, "confirm"));
        console.log(JSON.stringify(success("delete", result, result.deleted_ids.length), null, 2));
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
          "Required: --date YYYY-MM-DD --from ASSET --to ASSET --quantity N --rate N",
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
      const maxAgeDays = int(flags, "max-age-days");
      if (isDryRun) {
        const result = await recalculateDryRun({
          fromDateStr: str(flags, "from-date") ?? str(flags, "from_date"),
          force: bool(flags, "force"),
          maxAgeDays,
        });
        console.log(JSON.stringify(success("recalculate", result), null, 2));
      } else {
        const result = await recalculate({
          fromDateStr: str(flags, "from-date") ?? str(flags, "from_date"),
          force: bool(flags, "force"),
          maxAgeDays,
        });
        console.log(JSON.stringify(success("recalculate", result), null, 2));
      }
      return;
    }

    case "verify_prices": {
      const maxAgeDays = int(flags, "max-age-days");
      const result = await verifyPrices(maxAgeDays);
      console.log(JSON.stringify(success("verify_prices", result), null, 2));
      return;
    }

    case "repair_prices": {
      const tickerArg = str(flags, "ticker");
      const tickers = tickerArg ? tickerArg.split(",").map((t) => t.trim()) : undefined;
      const isDryRun = bool(flags, "dry-run");
      const maxAgeDays = int(flags, "max-age-days");

      if (isDryRun) {
        const result = await repairPricesDryRun({
          tickers,
          startDate: str(flags, "start-date"),
          endDate: str(flags, "end-date"),
          maxAgeDays,
        });
        console.log(JSON.stringify(success("repair_prices", result), null, 2));
      } else {
        const result = await repairPrices(
          { tickers, startDate: str(flags, "start-date"), endDate: str(flags, "end-date"), maxAgeDays },
          fetchPrices,
        );
        console.log(JSON.stringify(success("repair_prices", result), null, 2));
      }
      return;
    }

    case "sync": {
      const isDryRun = bool(flags, "dry-run");
      const maxAgeDays = int(flags, "max-age-days");
      if (isDryRun) {
        const repairResult = await repairPricesDryRun({ maxAgeDays });
        const recalcResult = await recalculateDryRun({ force: false, maxAgeDays });
        console.log(
          JSON.stringify(
            success("sync", { dry_run: true, repair_prices: repairResult, recalculate: recalcResult }),
            null,
            2,
          ),
        );
      } else {
        await runDailyMaintenanceCheck(maxAgeDays);
        const repairResult = await repairPrices({ maxAgeDays }, fetchPrices);
        const recalcResult = await recalculate({ force: true, maxAgeDays });
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
      const limit = (() => {
        const v = int(flags, "limit");
        if (v !== undefined && (!Number.isFinite(v) || v <= 0)) {
          console.log(JSON.stringify(error("report", "VALIDATION_ERROR", "--limit must be a positive number"), null, 2));
          process.exit(1);
        }
        return v ?? 50;
      })();
      const offset = (() => {
        const v = int(flags, "offset");
        if (v !== undefined && (!Number.isFinite(v) || v < 0)) {
          console.log(JSON.stringify(error("report", "VALIDATION_ERROR", "--offset must be a non-negative number"), null, 2));
          process.exit(1);
        }
        return v ?? 0;
      })();
      const startDate = str(flags, "start-date") ?? str(flags, "start_date");
      const endDate = str(flags, "end-date") ?? str(flags, "end_date");
      const { data, total } = await getReport(limit, offset, startDate, endDate);
      const pagination = buildPagination(limit, offset, total);
      console.log(JSON.stringify(success("report", data, data.length, pagination), null, 2));
      return;
    }

    case "health": {
      const maxAgeDays = int(flags, "max-age-days");
      const result = await getHealth(maxAgeDays);
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

    case "cron": {
      const sub = argv[3];
      if (!sub || sub.startsWith("--")) {
        console.log(
          JSON.stringify(
            error("cron", "VALIDATION_ERROR", "Subcommand required: cron install | cron list | cron remove"),
            null,
            2,
          ),
        );
        process.exit(1);
        return;
      }

      switch (sub) {
        case "install": {
          const result = await cronInstall();
          if (result.applied) {
            console.log(JSON.stringify(success("cron:install", result), null, 2));
          } else {
            console.log(JSON.stringify(error("cron:install", result.pg_cron_available ? "CRON_REGISTRATION_FAILED" : "CRON_UNAVAILABLE", result.message), null, 2));
            process.exit(1);
          }
          return;
        }
        case "list": {
          const result = await cronList();
          console.log(JSON.stringify(success("cron:list", result, result.jobs.length), null, 2));
          return;
        }
        case "remove": {
          const result = await cronRemove();
          console.log(JSON.stringify(success("cron:remove", result, result.removed_count), null, 2));
          return;
        }
        default: {
          console.log(
            JSON.stringify(
              error("cron", "UNKNOWN_SUBCOMMAND", `Unknown: cron ${sub}. Use: cron install | cron list | cron remove`),
              null,
              2,
            ),
          );
          process.exit(1);
          return;
        }
      }
    }

    case "refresh": {
      const isDryRun = bool(flags, "dry-run");
      if (isDryRun) {
        const result = await refreshPortfolioDryRun();
        const freshnessMeta = await getPriceFreshness();
        const data = { ...result, ...freshnessMeta };
        console.log(JSON.stringify(success("refresh", data), null, 2));
      } else {
        const result = await refreshPortfolio();
        const freshnessMeta = await getPriceFreshness();
        console.log(JSON.stringify(success("refresh", result, null, undefined, freshnessMeta as unknown as Record<string, unknown>), null, 2));
      }
      return;
    }

    case "schedule": {
      const projectDir = str(flags, "project-dir") ?? str(flags, "project_dir");
      const posSub = argv[3] as string | undefined;
      const sub = bool(flags, "remove") ? "remove"
        : bool(flags, "install") ? "install"
        : bool(flags, "emit") ? "emit"
        : posSub && !posSub.startsWith("--") ? posSub
        : "emit";
      if (sub === "remove") {
        const result = scheduleRemove(projectDir);
        console.log(JSON.stringify(success("schedule", result), null, 2));
        return;
      }
      if (sub === "install") {
        const result = scheduleInstall(projectDir);
        console.log(JSON.stringify(success("schedule", result), null, 2));
        return;
      }
      const emitResult = scheduleEmit(projectDir);
      console.log(JSON.stringify(success("schedule", { cron_line: emitResult.block }), null, 2));
      return;
    }

    case "cash": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const result = await getCash(asOfDate);
      console.log(JSON.stringify(success("cash", result, result.rows.length), null, 2));
      return;
    }

    case "allocation": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const result = await getAllocation(asOfDate);
      console.log(JSON.stringify(success("allocation", result, result.rows.length), null, 2));
      return;
    }

    case "summary": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const freshnessMeta = await getPriceFreshness(asOfDate ?? new Date().toISOString().split("T")[0]);
      const result = await getSummary(asOfDate);
      console.log(JSON.stringify(success("summary", result, null, undefined, freshnessMeta as unknown as Record<string, unknown>), null, 2));
      return;
    }

    case "concentration": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const topN = int(flags, "top-n") ?? int(flags, "top_n") ?? 5;
      const result = await getConcentration(asOfDate, topN);
      console.log(JSON.stringify(success("concentration", result), null, 2));
      return;
    }

    case "performance": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const benchmark = str(flags, "benchmark");
      const fromDate = str(flags, "from-date") ?? str(flags, "from_date");
      const period = str(flags, "period");
      const result = await getPerformance({ asOfDate, benchmark, fromDate, period });
      console.log(JSON.stringify(success("performance", result), null, 2));
      return;
    }

    case "mwr": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const result = await getMwr(asOfDate);
      console.log(JSON.stringify(success("mwr", result), null, 2));
      return;
    }

    case "widget": {
      const days = (() => {
        const v = int(flags, "days");
        if (v !== undefined && (!Number.isFinite(v) || v <= 0)) {
          console.log(JSON.stringify(error("widget", "VALIDATION_ERROR", "--days must be a positive number"), null, 2));
          process.exit(1);
          return 30;
        }
        return v ?? 30;
      })();
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const result = await getWidget(days, asOfDate);
      console.log(JSON.stringify(success("widget", result, result.series.length), null, 2));
      return;
    }

    case "schedule": {
      if (bool(flags, "remove")) {
        const result = scheduleRemove();
        console.log(JSON.stringify(success("schedule", result), null, 2));
        return;
      }
      if (bool(flags, "install")) {
        const result = scheduleInstall();
        if (result.installed) {
          console.log(JSON.stringify(success("schedule", result), null, 2));
        } else {
          console.log(JSON.stringify(error("schedule", "CRON_INSTALL_FAILED", result.message), null, 2));
          process.exit(1);
        }
        return;
      }
      const result = scheduleEmit();
      console.log(JSON.stringify(success("schedule", { cron_line: result.block }), null, 2));
      return;
    }

    case "cash": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const freshnessMeta = await getPriceFreshness(asOfDate);
      const result = await getCash(asOfDate);
      console.log(JSON.stringify(success("cash", result, result.rows.length, undefined, freshnessMeta as unknown as Record<string, unknown>), null, 2));
      return;
    }

    case "allocation": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const freshnessMeta = await getPriceFreshness(asOfDate);
      const result = await getAllocation(asOfDate);
      console.log(JSON.stringify(success("allocation", result, result.rows.length, undefined, freshnessMeta as unknown as Record<string, unknown>), null, 2));
      return;
    }

    case "summary": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const freshnessMeta = await getPriceFreshness(asOfDate);
      const result = await getSummary(asOfDate);
      console.log(JSON.stringify(success("summary", result, null, undefined, freshnessMeta as unknown as Record<string, unknown>), null, 2));
      return;
    }

    case "concentration": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const topN = int(flags, "top-n") ?? int(flags, "top_n") ?? 5;
      const freshnessMeta = await getPriceFreshness(asOfDate);
      const result = await getConcentration(asOfDate, topN);
      console.log(JSON.stringify(success("concentration", result, null, undefined, freshnessMeta as unknown as Record<string, unknown>), null, 2));
      return;
    }

    case "performance": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const benchmark = str(flags, "benchmark");
      const fromDate = str(flags, "from-date") ?? str(flags, "from_date");
      const period = str(flags, "period");
      const freshnessMeta = await getPriceFreshness(asOfDate);
      const result = await getPerformance({ asOfDate, benchmark, fromDate, period });
      console.log(JSON.stringify(success("performance", result, null, undefined, freshnessMeta as unknown as Record<string, unknown>), null, 2));
      return;
    }

    case "mwr": {
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const freshnessMeta = await getPriceFreshness(asOfDate);
      const result = await getMwr(asOfDate);
      console.log(JSON.stringify(success("mwr", result, null, undefined, freshnessMeta as unknown as Record<string, unknown>), null, 2));
      return;
    }

    case "widget": {
      const days = (() => {
        const v = int(flags, "days");
        if (v !== undefined && (!Number.isFinite(v) || v <= 0)) {
          console.log(JSON.stringify(error("widget", "VALIDATION_ERROR", "--days must be a positive number"), null, 2));
          process.exit(1);
          return 30;
        }
        return v ?? 30;
      })();
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      const result = await getWidget(days, asOfDate);
      console.log(JSON.stringify(success("widget", result, result.series.length), null, 2));
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
