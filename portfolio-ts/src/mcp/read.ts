import { success, error, buildPagination, type Envelope } from "../response.js";
import { toWriteErrorEnvelope } from "../adapters/shared.js";
import { getStatus } from "../commands/status.js";
import { getSummary } from "../commands/summary.js";
import { getCash } from "../commands/cash.js";
import { getCurrencyExposure } from "../commands/currency_exposure.js";
import { getIncome } from "../commands/income.js";
import { getRealizedGains } from "../commands/realized_gains.js";
import { getAllocation } from "../commands/allocation.js";
import { getConcentration } from "../commands/concentration.js";
import { getPerformance } from "../commands/performance.js";
import { getMwr } from "../commands/mwr.js";
import { getTransactions } from "../commands/transactions.js";
import { getReport } from "../commands/report.js";
import { getHealth } from "../commands/health.js";
import { verifyPrices } from "../commands/verify_prices.js";
import { getWidget } from "../commands/widget.js";
import { getPriceFreshness } from "../commands/freshness.js";
import { strField, intField } from "./adapter.js";

type JsonObject = Record<string, unknown>;

function asOfVal(args: JsonObject): string | undefined {
  return strField(args, "as_of") ?? strField(args, "asOf");
}

export async function mcpRead(
  toolName: string,
  args: JsonObject,
): Promise<Envelope> {
  try {
    if (toolName === "status") {
      const asOf = asOfVal(args);
      const freshnessMeta = await getPriceFreshness(asOf);
      const data = await getStatus(asOf);
      return success("status", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
    }

    if (toolName === "summary") {
      const asOf = asOfVal(args);
      const freshnessMeta = await getPriceFreshness(asOf);
      const data = await getSummary(asOf);
      return success("summary", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
    }

    if (toolName === "cash") {
      const asOf = asOfVal(args);
      const freshnessMeta = await getPriceFreshness(asOf);
      const data = await getCash(asOf);
      return success("cash", data, data.rows.length, undefined, freshnessMeta as unknown as Record<string, unknown>);
    }

    if (toolName === "currency_exposure") {
      const asOf = asOfVal(args);
      const freshnessMeta = await getPriceFreshness(asOf);
      const data = await getCurrencyExposure(asOf);
      return success("currency_exposure", data, data.rows.length, undefined, freshnessMeta as unknown as Record<string, unknown>);
    }

    if (toolName === "income") {
      const asOf = asOfVal(args);
      const fromDate = strField(args, "from_date") ?? strField(args, "fromDate");
      const asset = strField(args, "asset");
      const data = await getIncome(asOf, fromDate, asset);
      return success("income", data, data.rows.length);
    }

    if (toolName === "realized_gains") {
      const fromDate = strField(args, "from_date") ?? strField(args, "fromDate");
      const toDate = strField(args, "to_date") ?? strField(args, "toDate");
      const asset = strField(args, "asset");
      const byYear = (args["by_year"] ?? args["byYear"]) === true;
      const data = await getRealizedGains({ fromDate, toDate, asset, byYear });
      return success("realized_gains", data, data.rows.length);
    }

    if (toolName === "allocation") {
      const asOf = asOfVal(args);
      const freshnessMeta = await getPriceFreshness(asOf);
      const data = await getAllocation(asOf);
      return success("allocation", data, data.rows.length, undefined, freshnessMeta as unknown as Record<string, unknown>);
    }

    if (toolName === "concentration") {
      const asOf = asOfVal(args);
      const topN = intField(args, "top_n", "topN");
      const freshnessMeta = await getPriceFreshness(asOf);
      const data = await getConcentration(asOf, topN);
      return success("concentration", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
    }

    if (toolName === "performance") {
      const asOfDate = asOfVal(args);
      const benchmark = strField(args, "benchmark");
      const fromDate = strField(args, "from_date") ?? strField(args, "fromDate");
      const period = strField(args, "period");
      const inflationRate = strField(args, "inflation_rate") ?? strField(args, "inflationRate");
      const freshnessMeta = await getPriceFreshness(asOfDate);
      const { data, benchmark: resolvedBenchmark } = await getPerformance({ asOfDate, benchmark, fromDate, period, inflationRate });
      const meta = { ...(freshnessMeta as unknown as Record<string, unknown>), benchmark: resolvedBenchmark };
      return success("performance", data, null, undefined, meta);
    }

    if (toolName === "mwr") {
      const asOf = asOfVal(args);
      const freshnessMeta = await getPriceFreshness(asOf);
      const data = await getMwr(asOf);
      return success("mwr", data, null, undefined, freshnessMeta as unknown as Record<string, unknown>);
    }

    if (toolName === "transactions") {
      const limit = intField(args, "limit") ?? 50;
      const offset = intField(args, "offset") ?? 0;
      const startDate = strField(args, "start_date") ?? strField(args, "startDate");
      const endDate = strField(args, "end_date") ?? strField(args, "endDate");
      const { data, total } = await getTransactions(limit, offset, startDate, endDate);
      const pagination = buildPagination(limit, offset, total);
      return success("transactions", data, data.length, pagination);
    }

    if (toolName === "report") {
      const limit = intField(args, "limit") ?? 50;
      const offset = intField(args, "offset") ?? 0;
      const startDate = strField(args, "start_date") ?? strField(args, "startDate");
      const endDate = strField(args, "end_date") ?? strField(args, "endDate");
      const { data, total } = await getReport(limit, offset, startDate, endDate);
      const pagination = buildPagination(limit, offset, total);
      return success("report", data, data.length, pagination);
    }

    if (toolName === "health") {
      const maxAgeDays = intField(args, "max_age_days", "maxAgeDays");
      const data = await getHealth(maxAgeDays);
      return success("health", data);
    }

    if (toolName === "verify_prices") {
      const maxAgeDays = intField(args, "max_age_days", "maxAgeDays");
      const data = await verifyPrices(maxAgeDays);
      return success("verify_prices", data);
    }

    if (toolName === "widget") {
      const days = intField(args, "days") ?? 30;
      const asOf = asOfVal(args);
      const data = await getWidget(days, asOf);
      return success("widget", data, data.series.length);
    }

    return error("mcp", "NOT_FOUND", `Unsupported MCP read tool: ${toolName}`);
  } catch (err) {
    return toWriteErrorEnvelope(toolName, err).body;
  }
}
