#!/usr/bin/env bun
import { success, error, buildPagination } from "./response.js";
import { getStatus } from "./commands/status.js";
import { getTransactions } from "./commands/transactions.js";
import { close } from "./db.js";

const HELP_TEXT = `
Portfolio tracking with TypeScript/Bun.

Usage:
  portfolio-ts <command> [options]

Commands:
  status          Current portfolio status snapshot
  transactions    Paginated transaction list
  --help          Show this help message

Environment:
  PORTFOLIO_DB_URL  PostgreSQL connection string

Examples:
  portfolio-ts status
  portfolio-ts transactions
  portfolio-ts transactions --limit 20 --offset 40
  portfolio-ts --help
`.trim();

function parseArgs(argv: string[]): {
  command: string;
  limit: number;
  offset: number;
  startDate?: string;
  endDate?: string;
} {
  const args = argv.slice(2);
  const command = args[0] ?? "";

  if (command === "--help" || command === "-h" || command === "") {
    return { command: "help", limit: 50, offset: 0 };
  }

  let limit = 50;
  let offset = 0;
  let startDate: string | undefined;
  let endDate: string | undefined;

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--limit": {
        const v = parseInt(args[++i] ?? "50", 10);
        limit = Number.isFinite(v) && v > 0 ? v : 50;
        break;
      }
      case "--offset": {
        const v = parseInt(args[++i] ?? "0", 10);
        offset = Number.isFinite(v) && v >= 0 ? v : 0;
        break;
      }
      case "--start-date":
      case "--start_date":
        startDate = args[++i];
        break;
      case "--end-date":
      case "--end_date":
        endDate = args[++i];
        break;
    }
  }

  return { command, limit, offset, startDate, endDate };
}

export async function dispatch(argv: string[]): Promise<void> {
  const { command, limit, offset, startDate, endDate } = parseArgs(argv);

  switch (command) {
    case "help": {
      console.log(HELP_TEXT);
      return;
    }

    case "status": {
      const data = await getStatus();
      const envelope = success("status", data);
      console.log(JSON.stringify(envelope, null, 2));
      return;
    }

    case "transactions": {
      const { data, total } = await getTransactions(limit, offset, startDate, endDate);
      const pagination = buildPagination(limit, offset, total);
      const envelope = success("transactions", data, data.length, pagination);
      console.log(JSON.stringify(envelope, null, 2));
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
  dispatch(process.argv).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const envelope = error("_", "INTERNAL_ERROR", msg);
    console.log(JSON.stringify(envelope, null, 2));
    process.exit(1);
  }).finally(() => {
    close().catch(() => {});
  });
}
