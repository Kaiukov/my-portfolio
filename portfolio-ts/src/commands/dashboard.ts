import { getSummary, type SummaryData } from "./summary.js";
import { getStatus, type StatusData } from "./status.js";
import { getWidget } from "./widget.js";
import { getAllocation, type AllocationRow } from "./allocation.js";
import { getCash, type CashRow } from "./cash.js";
import { getPerformance, type PerformanceResult } from "./performance.js";
import { getPriceFreshness, type PriceFreshness } from "./freshness.js";

export interface DashboardSnapshot {
  summary: {
    holding_count: number;
    total_cash_usd: number;
    portfolio_value_usd: number;
    last_transaction_date: string;
    transaction_count: number;
    as_of_date: string;
  };
  status: StatusData;
  allocation_rows: Array<{
    asset: string;
    asset_type: string;
    asset_kind: string;
    net_quantity: number;
    value_usd: number;
    allocation_pct: number;
  }>;
  cash_rows: Array<{
    cash_key: string;
    currency: string;
    display_bucket: string;
    balance: number;
    usd_value: number;
  }>;
  performance: PerformanceResult;
  today: { abs: number; pct: number };
  total: { abs: number; pct: number };
  history: Array<{ date: string; value: number }>;
  prices_as_of: string | null;
  updatedAt: string;
}

export async function buildDashboardSnapshot(
  asOfDate?: string,
): Promise<DashboardSnapshot> {
  const actualDate = asOfDate ?? new Date().toISOString().split("T")[0];

  const [
    summaryRaw,
    status,
    widget,
    allocation,
    cash,
    performanceRaw,
    freshness,
  ] = await Promise.all([
    getSummary(actualDate),
    getStatus(actualDate),
    getWidget(365, actualDate),
    getAllocation(actualDate),
    getCash(actualDate),
    getPerformance({ asOfDate: actualDate }),
    getPriceFreshness(actualDate),
  ]);

  const summary: DashboardSnapshot["summary"] = {
    holding_count: summaryRaw.holding_count,
    total_cash_usd: summaryRaw.total_cash_usd,
    portfolio_value_usd: summaryRaw.portfolio_value_usd,
    last_transaction_date: summaryRaw.last_transaction_date ?? "",
    transaction_count: summaryRaw.transaction_count,
    as_of_date: summaryRaw.as_of_date ?? actualDate,
  };

  const allocation_rows = (allocation.rows as AllocationRow[]).map(
    (r) => ({
      asset: r.asset,
      asset_type: r.asset_type,
      asset_kind: r.asset_kind,
      net_quantity: r.net_quantity,
      value_usd: r.value_usd,
      allocation_pct: r.allocation_pct,
    }),
  );

  const cash_rows = (cash.rows as CashRow[]).map((r) => ({
    cash_key: r.cash_key,
    currency: r.currency,
    display_bucket: r.display_bucket,
    balance: r.balance,
    usd_value: r.usd_value,
  }));

  const today = {
    abs: widget.today.amount,
    pct: widget.today.pct,
  };

  const total = {
    abs: status.total_gain ?? 0,
    pct: status.total_gain_pct ?? 0,
  };

  const history = widget.series.map((s) => ({ date: s.date, value: s.value }));

  const prices_as_of: string | null =
    (freshness as PriceFreshness).prices_as_of ?? null;

  const updatedAt = new Date().toISOString();

  return {
    summary,
    status,
    allocation_rows,
    cash_rows,
    performance: performanceRaw.data,
    today,
    total,
    history,
    prices_as_of,
    updatedAt,
  };
}
