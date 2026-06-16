#!/usr/bin/env bun
import { loadEnv } from "./env.js";
import { success, error, buildPagination } from "./response.js";
import { dispatchRead } from "./adapters/read_shared.js";
import { APP_VERSION } from "./version.js";
import { getTransactions } from "./commands/transactions.js";
import { addTransaction } from "./commands/add.js";
import { editTransaction, editDryRun } from "./commands/edit.js";
import { deleteTransaction, deletePreview } from "./commands/delete.js";
import { exchangeCurrency } from "./commands/exchange.js";
import { applySplit } from "./commands/split.js";
import { recalculate, recalculateDryRun } from "./commands/recalculate.js";
import { verifyPrices } from "./commands/verify_prices.js";
import { repairPrices, repairPricesDryRun, runDailyMaintenanceCheck } from "./commands/repair_prices.js";
import { fetchPrices } from "./providers/yahoo.js";
import { getReport } from "./commands/report.js";
import { initDb } from "./commands/init.js";
import { backupDb } from "./commands/backup.js";
import {
  loadS3Config,
  createS3Client,
  pushBackupToS3,
  pullBackupFromS3,
} from "./commands/backup_s3.js";
import { cronInstall, cronList, cronRemove } from "./commands/cron.js";
import { getPriceFreshness } from "./commands/freshness.js";
import { refreshPortfolio, refreshPortfolioDryRun } from "./commands/refresh.js";
import { scheduleEmit, scheduleInstall, scheduleRemove } from "./commands/schedule.js";
import { cloudflareInit } from "./cloudflare/init.js";
import { deployWorker } from "./cloudflare/deploy.js";
import { getWidgetUrl } from "./cloudflare/url.js";
import { runWranglerLogin, runWranglerLogout, runWranglerWhoami } from "./cloudflare/auth.js";
import { publishToKv } from "./cloudflare/publish.js";
import { publishDashboardToKv } from "./cloudflare/dashboard_publish.js";
import { syncOnce, syncLoop, parseInterval, DEFAULT_SYNC_INTERVAL_MS } from "./cloudflare/sync.js";
import { createApiServer } from "./api/server.js";
import { ValidationError, NotFoundError } from "./validators.js";
import { close } from "./db.js";

const HELP_TEXT = `
Portfolio tracking with TypeScript/Bun.

Usage:
  portfolio <command> [options]

Commands:
  status          Current portfolio status snapshot (--as-of-date YYYY-MM-DD)
  transactions    Paginated transaction list
  add             Add a transaction and recalculate
  edit            Edit an existing transaction and recalculate
  delete          Delete a transaction and recalculate
  exchange        Record a currency exchange (two linked transactions)
  split           Record a stock split (forward or reverse corporate action)
  recalculate     Rebuild daily_returns from cached prices
  verify_prices   Show price coverage diagnostics (read-only)
  repair_prices   Fetch missing prices from Yahoo Finance
  asset-metadata  Show asset metadata (sector/industry/region, ETF sector weights) from cache; use --refresh to fetch
  cash            Cash balances by currency with USD values
  cash_drag       Opportunity cost of idle cash vs being invested (--as-of-date, --from-date, --benchmark-return-rate, --cash-return-rate)
  projection      Portfolio future-value projection (--monthly-contribution, --annual-return-rate, --target-value, --projection-years, --inflation-rate, --as-of-date)
  allocation      Portfolio allocation breakdown by asset
  rebalance       Target-vs-actual drift report with suggested trades (--target "VTI=50,VXUS=20,BND=30", --as-of-date)
  summary         High-level portfolio summary metrics
  concentration   Portfolio concentration metrics (HHI + top holdings)
  decomposition   Split portfolio growth into contributions vs market returns (--as-of-date)
  currency_exposure  Portfolio exposure broken down by currency
  performance     Performance metrics: TWR, CAGR, Calmar, Sharpe, max drawdown, benchmark-relative (beta, alpha, IR), real (inflation-adjusted) return. Includes period_returns (1M,3M,6M,YTD,1Y,SII) and rolling_12m_returns. Use --benchmark SPY (default) for full risk-adjusted suite; --inflation-rate 0.025 for real return.
  mwr             Money-weighted return (XIRR) accounting for deposit/withdrawal timing
  widget          Compact portfolio widget JSON for dashboards
  cloudflare      Cloudflare Workers: init, deploy, publish, sync, url, login, logout, whoami
  dashboard       Publish a richer dashboard snapshot to Cloudflare KV (subcommands: publish)
  sync            repair_prices + recalculate (daily maintenance)
  refresh         Fetch Yahoo prices via HTTPS, recalculate, and return summary (OS-cron)
  schedule        Manage OS crontab for automatic portfolio refresh (--emit/--install/--remove)
  report          Paginated daily portfolio returns
  health          DB reachability and price coverage diagnostic
  diversification  Correlation matrix and effective-holdings diversification analysis (--as-of-date, --window-months)
  income          Dividend and interest income report (--as-of-date, --from-date, --asset)
  realized-gains  FIFO realized gains detail by lot and tax year (--from-date, --to-date, --asset, --by-year)
  init            Verify database schema is ready
  backup          Create a pg_dump backup
  backup push     Upload portfolio snapshot to S3-compatible storage
  backup pull     Restore latest snapshot from S3-compatible storage
  cron            Manage pg_cron scheduled jobs (install / list / remove)
  withdrawal      Safe withdrawal rate / decumulation analysis (--annual-withdrawal, --withdrawal-rate, --time-horizon-years, --expected-return, --inflation-rate, --as-of-date)
  asset_analysis  Analyze any Yahoo Finance ticker with risk metrics and technical indicators (--ticker/--asset, --period/--lookback-days, --benchmark, --as-of-date, --risk-free-rate)
  api             Start a local read-only REST API server (--port 8787)
  --help          Show this help message

Dates: ISO YYYY-MM-DD (legacy DD-MM-YYYY also accepted on write commands)

Environment:
  PORTFOLIO_DB_URL  PostgreSQL connection string

Examples:
  portfolio status
  portfolio transactions --limit 20 --offset 40
  portfolio add --date 2026-01-01 --asset AAPL --action BUY --quantity 10 --price 150 --exchange Interactive
  portfolio edit --id 42 --price 155.50
  portfolio delete --id 42 --confirm
  portfolio exchange --date 2026-01-01 --from USD --to EURUSD=X --quantity 1000 --rate 0.92
  portfolio schedule emit
  portfolio schedule install / schedule remove
  portfolio refresh
  portfolio backup push
  portfolio backup pull
  portfolio --help
`.trim();

type FlagValue = string | true;

export function normalizeCommandName(command: string): string {
  if (command === "asset-analysis") return "asset_analysis";
  return command;
}

function parseArgs(argv: string[]): { command: string; flags: Map<string, FlagValue> } {
  const args = argv.slice(2);
  const raw = args[0] ?? "";
  const command =
    raw === "--help" || raw === "-h" || raw === ""
      ? "help"
      : raw === "--version" || raw === "-v"
        ? "version"
        : raw;

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
  const normalizedCommand = normalizeCommandName(command);

  switch (normalizedCommand) {
    case "help": {
      console.log(HELP_TEXT);
      return;
    }

    case "version": {
      console.log(APP_VERSION);
      return;
    }

    case "status": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const env = await dispatchRead("status", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "transactions": {
      const args: Record<string, unknown> = {};
      const limit = (() => {
        const v = int(flags, "limit");
        if (v !== undefined && (!Number.isFinite(v) || v <= 0)) {
          console.log(JSON.stringify(error("transactions", "VALIDATION_ERROR", "--limit must be a positive number"), null, 2));
          process.exit(1);
        }
        return v ?? 50;
      })();
      args["limit"] = limit;
      const offset = (() => {
        const v = int(flags, "offset");
        if (v !== undefined && (!Number.isFinite(v) || v < 0)) {
          console.log(JSON.stringify(error("transactions", "VALIDATION_ERROR", "--offset must be a non-negative number"), null, 2));
          process.exit(1);
        }
        return v ?? 0;
      })();
      args["offset"] = offset;
      const startDate = str(flags, "start-date") ?? str(flags, "start_date");
      if (startDate !== undefined) args["start_date"] = startDate;
      const endDate = str(flags, "end-date") ?? str(flags, "end_date");
      if (endDate !== undefined) args["end_date"] = endDate;
      const env = await dispatchRead("transactions", args);
      console.log(JSON.stringify(env, null, 2));
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

    case "split": {
      const dateStr = str(flags, "date");
      const asset = str(flags, "asset");
      const ratio = float(flags, "ratio");
      const confirm = bool(flags, "confirm");

      if (!dateStr || !asset || ratio === undefined) {
        const env = error(
          "split",
          "VALIDATION_ERROR",
          "Required: --date YYYY-MM-DD --asset SYMBOL --ratio N --confirm",
        );
        console.log(JSON.stringify(env, null, 2));
        process.exit(1);
        return;
      }

      if (!confirm) {
        const env = error(
          "split",
          "VALIDATION_ERROR",
          "--confirm is required for split (use --confirm to proceed)",
        );
        console.log(JSON.stringify(env, null, 2));
        process.exit(1);
        return;
      }

      const result = await applySplit({
        dateStr,
        asset,
        ratio,
        exchange: str(flags, "exchange"),
        account: str(flags, "account"),
      });
      console.log(JSON.stringify(success("split", result), null, 2));
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
      const args: Record<string, unknown> = {};
      const maxAgeDays = int(flags, "max-age-days");
      if (maxAgeDays !== undefined) args["max_age_days"] = maxAgeDays;
      const env = await dispatchRead("verify_prices", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "asset-metadata":
    case "asset_metadata": {
      const args: Record<string, unknown> = {};
      const ticker = str(flags, "asset");
      if (ticker !== undefined) args["asset"] = ticker;
      const refresh = bool(flags, "refresh");
      if (refresh) args["refresh"] = true;
      const env = await dispatchRead("asset_metadata", args);
      // Preserve original command name for CLI
      if (env.ok) {
        env.command = "asset-metadata";
      }
      console.log(JSON.stringify(env, null, 2));
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
            success("sync", {
              status: repairResult.status,
              unresolved: repairResult.unresolved,
              repair_prices: repairResult,
              recalculate: recalcResult,
            }),
            null,
            2,
          ),
        );
      }
      return;
    }

    case "report": {
      const args: Record<string, unknown> = {};
      const limit = (() => {
        const v = int(flags, "limit");
        if (v !== undefined && (!Number.isFinite(v) || v <= 0)) {
          console.log(JSON.stringify(error("report", "VALIDATION_ERROR", "--limit must be a positive number"), null, 2));
          process.exit(1);
        }
        return v ?? 50;
      })();
      args["limit"] = limit;
      const offset = (() => {
        const v = int(flags, "offset");
        if (v !== undefined && (!Number.isFinite(v) || v < 0)) {
          console.log(JSON.stringify(error("report", "VALIDATION_ERROR", "--offset must be a non-negative number"), null, 2));
          process.exit(1);
        }
        return v ?? 0;
      })();
      args["offset"] = offset;
      const startDate = str(flags, "start-date") ?? str(flags, "start_date");
      if (startDate !== undefined) args["start_date"] = startDate;
      const endDate = str(flags, "end-date") ?? str(flags, "end_date");
      if (endDate !== undefined) args["end_date"] = endDate;
      const env = await dispatchRead("report", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "health": {
      const args: Record<string, unknown> = {};
      const maxAgeDays = int(flags, "max-age-days");
      if (maxAgeDays !== undefined) args["max_age_days"] = maxAgeDays;
      const env = await dispatchRead("health", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "asset_analysis": {
      const args: Record<string, unknown> = {};
      const ticker = str(flags, "ticker");
      if (ticker !== undefined) args["ticker"] = ticker;
      const asset = str(flags, "asset");
      if (asset !== undefined) args["asset"] = asset;
      if (!ticker && !asset) {
        console.log(JSON.stringify(error("asset_analysis", "VALIDATION_ERROR", "--ticker or --asset is required"), null, 2));
        process.exit(1);
        return;
      }
      const period = str(flags, "period");
      if (period !== undefined) args["period"] = period;
      const lookbackDays = int(flags, "lookback-days") ?? int(flags, "lookback_days");
      if (lookbackDays !== undefined) args["lookback_days"] = lookbackDays;
      const benchmark = str(flags, "benchmark");
      if (benchmark !== undefined) args["benchmark"] = benchmark;
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const riskFreeRate = float(flags, "risk-free-rate") ?? float(flags, "risk_free_rate");
      if (riskFreeRate !== undefined) args["risk_free_rate"] = riskFreeRate;
      const env = await dispatchRead("asset_analysis", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "withdrawal": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const annualWithdrawal = float(flags, "annual-withdrawal") ?? float(flags, "annual_withdrawal");
      if (annualWithdrawal !== undefined) args["annual_withdrawal"] = annualWithdrawal;
      const withdrawalRate = float(flags, "withdrawal-rate") ?? float(flags, "withdrawal_rate");
      if (withdrawalRate !== undefined) args["withdrawal_rate"] = withdrawalRate;
      const timeHorizonYears = int(flags, "time-horizon-years") ?? int(flags, "time_horizon_years");
      if (timeHorizonYears !== undefined) args["time_horizon_years"] = timeHorizonYears;
      const expectedReturn = float(flags, "expected-return") ?? float(flags, "expected_return");
      if (expectedReturn !== undefined) args["expected_return"] = expectedReturn;
      const inflationRate = float(flags, "inflation-rate") ?? float(flags, "inflation_rate");
      if (inflationRate !== undefined) args["inflation_rate"] = inflationRate;
      const env = await dispatchRead("withdrawal", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "projection": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const monthlyContribution = float(flags, "monthly-contribution") ?? float(flags, "monthly_contribution");
      if (monthlyContribution !== undefined) args["monthly_contribution"] = monthlyContribution;
      const annualReturnRate = float(flags, "annual-return-rate") ?? float(flags, "annual_return_rate");
      if (annualReturnRate !== undefined) args["annual_return_rate"] = annualReturnRate;
      const targetValue = float(flags, "target-value") ?? float(flags, "target_value");
      if (targetValue !== undefined) args["target_value"] = targetValue;
      const projectionYears = int(flags, "projection-years") ?? int(flags, "projection_years");
      if (projectionYears !== undefined) args["projection_years"] = projectionYears;
      const inflationRate = float(flags, "inflation-rate") ?? float(flags, "inflation_rate");
      if (inflationRate !== undefined) args["inflation_rate"] = inflationRate;
      const env = await dispatchRead("projection", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "income": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const fromDate = str(flags, "from-date") ?? str(flags, "from_date");
      if (fromDate !== undefined) args["from_date"] = fromDate;
      const asset = str(flags, "asset");
      if (asset !== undefined) args["asset"] = asset;
      const env = await dispatchRead("income", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "realized-gains":
    case "gains": {
      const args: Record<string, unknown> = {};
      const fromDate = str(flags, "from-date") ?? str(flags, "from_date");
      if (fromDate !== undefined) args["from_date"] = fromDate;
      const toDate = str(flags, "to-date") ?? str(flags, "to_date");
      if (toDate !== undefined) args["to_date"] = toDate;
      const asset = str(flags, "asset");
      if (asset !== undefined) args["asset"] = asset;
      const byYear = bool(flags, "by-year") || bool(flags, "by_year");
      if (byYear) args["by_year"] = true;
      const env = await dispatchRead("realized_gains", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "init": {
      const result = await initDb();
      console.log(JSON.stringify(success("init", result), null, 2));
      return;
    }

    case "backup": {
      const sub = argv[3] as string | undefined;
      if (sub === "push") {
        const s3Config = loadS3Config();
        if (!s3Config.ok) {
          console.log(JSON.stringify(error("backup:push", "CONFIG_ERROR", s3Config.error), null, 2));
          process.exit(1);
          return;
        }

        const dbUrl = process.env.PORTFOLIO_DB_URL;
        if (!dbUrl) {
          console.log(JSON.stringify(error("backup:push", "CONFIG_ERROR", "PORTFOLIO_DB_URL is not set"), null, 2));
          process.exit(1);
          return;
        }

        const client = createS3Client(s3Config.config);
        try {
          const result = await pushBackupToS3(client, s3Config.config.bucket, dbUrl);
          console.log(JSON.stringify(success("backup:push", result, result.objects.length), null, 2));
        } finally {
          client.destroy();
        }
        return;
      }
      if (sub === "pull") {
        const s3Config = loadS3Config();
        if (!s3Config.ok) {
          console.log(JSON.stringify(error("backup:pull", "CONFIG_ERROR", s3Config.error), null, 2));
          process.exit(1);
          return;
        }

        const dbUrl = process.env.PORTFOLIO_DB_URL;
        if (!dbUrl) {
          console.log(JSON.stringify(error("backup:pull", "CONFIG_ERROR", "PORTFOLIO_DB_URL is not set"), null, 2));
          process.exit(1);
          return;
        }

        const client = createS3Client(s3Config.config);
        try {
          const result = await pullBackupFromS3(client, s3Config.config.bucket, dbUrl, str(flags, "key"));
          console.log(JSON.stringify(success("backup:pull", result), null, 2));
        } finally {
          client.destroy();
        }
        return;
      }

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
      const sub = bool(flags, "remove") || posSub === "remove" ? "remove"
        : bool(flags, "install") || posSub === "install" ? "install"
        : bool(flags, "emit") || posSub === "emit" ? "emit"
        : posSub && !posSub.startsWith("--") ? posSub
        : "emit";
      if (sub === "remove") {
        const result = scheduleRemove(projectDir);
        console.log(JSON.stringify(success("schedule", result), null, 2));
        return;
      }
      if (sub === "install") {
        const result = scheduleInstall(projectDir);
        if (result.installed) {
          console.log(JSON.stringify(success("schedule", result), null, 2));
        } else {
          console.log(JSON.stringify(error("schedule", "SCHEDULE_INSTALL_FAILED", result.message), null, 2));
          process.exit(1);
        }
        return;
      }
      const emitResult = scheduleEmit(projectDir);
      console.log(JSON.stringify(success("schedule", { cron_line: emitResult.block }), null, 2));
      return;
    }

    case "cash": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const env = await dispatchRead("cash", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "cash_drag": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const fromDate = str(flags, "from-date") ?? str(flags, "from_date");
      if (fromDate !== undefined) args["from_date"] = fromDate;
      const benchmarkReturnRate = float(flags, "benchmark-return-rate") ?? float(flags, "benchmark_return_rate");
      if (benchmarkReturnRate !== undefined) args["benchmark_return_rate"] = benchmarkReturnRate;
      const cashReturnRate = float(flags, "cash-return-rate") ?? float(flags, "cash_return_rate");
      if (cashReturnRate !== undefined) args["cash_return_rate"] = cashReturnRate;
      const env = await dispatchRead("cash_drag", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "allocation": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const env = await dispatchRead("allocation", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "rebalance": {
      const targetStr = str(flags, "target");
      if (!targetStr) {
        console.log(JSON.stringify(error("rebalance", "VALIDATION_ERROR", "--target is required (e.g. --target \"VTI=50,VXUS=20,BND=30\")"), null, 2));
        process.exit(1);
        return;
      }
      const args: Record<string, unknown> = { target: targetStr };
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const env = await dispatchRead("rebalance", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "summary": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const env = await dispatchRead("summary", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "concentration": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const topN = int(flags, "top-n") ?? int(flags, "top_n") ?? 5;
      args["top_n"] = topN;
      const env = await dispatchRead("concentration", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "decomposition": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const env = await dispatchRead("decomposition", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "diversification": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const lookbackDays = int(flags, "lookback-days") ?? int(flags, "lookback_days") ?? 252;
      args["lookback_days"] = lookbackDays;
      const minCorrelation = float(flags, "min-correlation") ?? float(flags, "min_correlation") ?? 0.0;
      args["min_correlation"] = minCorrelation;
      const env = await dispatchRead("diversification", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "currency_exposure": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const env = await dispatchRead("currency_exposure", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "performance": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const benchmark = str(flags, "benchmark");
      if (benchmark !== undefined) args["benchmark"] = benchmark;
      const fromDate = str(flags, "from-date") ?? str(flags, "from_date");
      if (fromDate !== undefined) args["from_date"] = fromDate;
      const period = str(flags, "period");
      if (period !== undefined) args["period"] = period;
      const inflationRate = str(flags, "inflation-rate") ?? str(flags, "inflation_rate");
      if (inflationRate !== undefined) args["inflation_rate"] = inflationRate;
      const env = await dispatchRead("performance", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "mwr": {
      const args: Record<string, unknown> = {};
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const env = await dispatchRead("mwr", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "widget": {
      const args: Record<string, unknown> = {};
      const days = (() => {
        const v = int(flags, "days");
        if (v !== undefined && (!Number.isFinite(v) || v <= 0)) {
          console.log(JSON.stringify(error("widget", "VALIDATION_ERROR", "--days must be a positive number"), null, 2));
          process.exit(1);
          return 30;
        }
        return v ?? 30;
      })();
      args["days"] = days;
      const asOfDate = str(flags, "as-of-date") ?? str(flags, "as_of_date");
      if (asOfDate !== undefined) args["as_of"] = asOfDate;
      const env = await dispatchRead("widget", args);
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    case "dashboard": {
      const sub = argv[3];
      if (!sub || sub.startsWith("--")) {
        console.log(
          JSON.stringify(
            error("dashboard", "VALIDATION_ERROR", "Subcommand required: dashboard publish"),
            null,
            2,
          ),
        );
        process.exit(1);
        return;
      }

      switch (sub) {
        case "publish": {
          const result = await publishDashboardToKv();
          if (result.success && result.snapshot) {
            console.log(
              JSON.stringify(
                success("dashboard:publish", {
                  key: result.key,
                  namespace_id: result.namespaceId,
                  updatedAt: result.snapshot.updatedAt,
                }),
                null,
                2,
              ),
            );
          } else {
            const errCode = result.namespaceId ? "KV_PUBLISH_FAILED" : "KV_NOT_CONFIGURED";
            console.log(
              JSON.stringify(
                error("dashboard:publish", errCode, result.error ?? "Publish failed"),
                null,
                2,
              ),
            );
            process.exit(1);
          }
          return;
        }

        default: {
          console.log(
            JSON.stringify(
              error("dashboard", "UNKNOWN_SUBCOMMAND", `Unknown: dashboard ${sub}. Use: dashboard publish`),
              null,
              2,
            ),
          );
          process.exit(1);
          return;
        }
      }
    }

    case "cloudflare": {
      const sub = argv[3];
      if (!sub || sub.startsWith("--")) {
        console.log(
          JSON.stringify(
              error("cloudflare", "VALIDATION_ERROR", "Subcommand required: cloudflare init | deploy | publish | sync | url | login | logout | whoami"),
            null,
            2,
          ),
        );
        process.exit(1);
        return;
      }

      switch (sub) {
        case "init": {
          const result = await cloudflareInit({
            projectName: str(flags, "project-name") ?? str(flags, "project_name"),
            accountId: str(flags, "account-id") ?? str(flags, "account_id"),
            kvNamespaceId: str(flags, "kv-namespace-id") ?? str(flags, "kv_namespace_id"),
            force: bool(flags, "force"),
          });

          if (result.config !== null) {
            console.log(
              JSON.stringify(
                success("cloudflare:init", result, null, undefined, { warnings: result.warnings }),
                null,
                2,
              ),
            );
          } else {
            const errCode = result.auth.error?.includes("CLOUDFLARE_ACCOUNT_ID")
              ? "MISSING_ACCOUNT_ID"
              : "AUTH_FAILED";
            console.log(
              JSON.stringify(
                error("cloudflare:init", errCode, result.auth.error ?? "Cloudflare not configured"),
                null,
                2,
              ),
            );
            process.exit(1);
          }
          return;
        }

        case "deploy": {
          const result = await deployWorker();
          if (result.success && result.url) {
            console.log(
              JSON.stringify(success("cloudflare:deploy", { url: result.url }), null, 2),
            );
          } else {
            console.log(
              JSON.stringify(
                error("cloudflare:deploy", "DEPLOY_FAILED", result.error ?? "Deploy failed"),
                null,
                2,
              ),
            );
            process.exit(1);
          }
          return;
        }

        case "url": {
          const result = getWidgetUrl();
          if (result.ok && result.url) {
            console.log(
              JSON.stringify(success("cloudflare:url", { url: result.url }), null, 2),
            );
          } else {
            console.log(
              JSON.stringify(
                error("cloudflare:url", "NOT_DEPLOYED", result.error ?? "URL not available"),
                null,
                2,
              ),
            );
            process.exit(1);
          }
          return;
        }

        case "login": {
          const result = runWranglerLogin();
          if (result.success) {
            console.log(
              JSON.stringify(success("cloudflare:login", { authenticated: true }), null, 2),
            );
          } else {
            console.log(
              JSON.stringify(
                error("cloudflare:login", "LOGIN_FAILED", result.error ?? "Login failed"),
                null,
                2,
              ),
            );
            process.exit(1);
          }
          return;
        }

        case "logout": {
          const result = runWranglerLogout();
          if (result.success) {
            console.log(
              JSON.stringify(success("cloudflare:logout", { authenticated: false }), null, 2),
            );
          } else {
            console.log(
              JSON.stringify(
                error("cloudflare:logout", "LOGOUT_FAILED", result.error ?? "Logout failed"),
                null,
                2,
              ),
            );
            process.exit(1);
          }
          return;
        }

        case "whoami": {
          const result = runWranglerWhoami();
          if (result.authenticated) {
            console.log(
              JSON.stringify(
                success("cloudflare:whoami", {
                  authenticated: result.authenticated,
                  account_name: result.accountName ?? null,
                  account_id: result.accountId ?? null,
                  email: result.email ?? null,
                }),
                null,
                2,
              ),
            );
          } else {
            console.log(
              JSON.stringify(
                error("cloudflare:whoami", "NOT_AUTHENTICATED", result.error ?? "Not authenticated"),
                null,
                2,
              ),
            );
            process.exit(1);
          }
          return;
        }

        case "publish": {
          const result = await publishToKv();
          if (result.success && result.snapshot) {
            console.log(
              JSON.stringify(
                success("cloudflare:publish", {
                  key: result.key,
                  namespace_id: result.namespaceId,
                  snapshot: result.snapshot,
                }),
                null,
                2,
              ),
            );
          } else {
            const errCode = result.namespaceId ? "KV_PUBLISH_FAILED" : "KV_NOT_CONFIGURED";
            console.log(
              JSON.stringify(
                error("cloudflare:publish", errCode, result.error ?? "Publish failed"),
                null,
                2,
              ),
            );
            process.exit(1);
          }
          return;
        }

        case "sync": {
          const intervalArg = str(flags, "interval");
          const watch = bool(flags, "watch");
          const projectRoot =
            str(flags, "project-root") ?? str(flags, "project_dir");

          if (intervalArg || watch) {
            let intervalMs: number;
            try {
              intervalMs = intervalArg
                ? parseInterval(intervalArg)
                : DEFAULT_SYNC_INTERVAL_MS;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.log(
                JSON.stringify(
                  error("cloudflare:sync", "INVALID_INTERVAL", msg),
                  null,
                  2,
                ),
              );
              process.exit(1);
              return;
            }
            if (intervalMs <= 0) {
              console.log(
                JSON.stringify(
                  error(
                    "cloudflare:sync",
                    "INVALID_INTERVAL",
                    "Interval must be a positive duration (e.g. 1h, 30m, 90s)",
                  ),
                  null,
                  2,
                ),
              );
              process.exit(1);
              return;
            }
            syncLoop({ intervalMs, projectRoot });
            return;
          }

          const result = await syncOnce(projectRoot);
          if (result.success && result.snapshot) {
            console.log(
              JSON.stringify(
                success("cloudflare:sync", {
                  key: result.key,
                  namespace_id: result.namespaceId,
                  snapshot: result.snapshot,
                }),
                null,
                2,
              ),
            );
          } else {
            const errCode = result.namespaceId
              ? "KV_SYNC_FAILED"
              : "KV_NOT_CONFIGURED";
            console.log(
              JSON.stringify(
                error(
                  "cloudflare:sync",
                  errCode,
                  result.error ?? "Sync failed",
                ),
                null,
                2,
              ),
            );
            process.exit(1);
          }
          return;
        }

        default: {
          console.log(
            JSON.stringify(
              error("cloudflare", "UNKNOWN_SUBCOMMAND", `Unknown: cloudflare ${sub}. Use: cloudflare init | deploy | publish | sync | url | login | logout | whoami`),
              null,
              2,
            ),
          );
          process.exit(1);
          return;
        }
      }
    }

    case "api":
    case "serve": {
      const port = int(flags, "port") ?? 8787;
      const server = createApiServer({ port });
      console.log(JSON.stringify(success("api", { port, url: `http://localhost:${port}` }), null, 2));
      // keep-alive: Bun.serve blocks the event loop; no explicit await needed
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
  loadEnv();
  dispatch(process.argv)
    .catch((err: unknown) => {
      const cmd = normalizeCommandName(process.argv[2] ?? "_");
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
