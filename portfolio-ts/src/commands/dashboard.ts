import { getSummary as _getSummary, type SummaryData } from "./summary.js";
import { getStatus as _getStatus, type StatusData } from "./status.js";
import { getWidget as _getWidget, type WidgetData } from "./widget.js";
import { getAllocation as _getAllocation, type AllocationRow } from "./allocation.js";
import { getCash as _getCash, type CashRow } from "./cash.js";
import { getPerformance as _getPerformance, type PerformanceResult } from "./performance.js";
import { getPriceFreshness as _getPriceFreshness } from "./freshness.js";
import {
  buildPublishSnapshotContext,
  type PublishSnapshotContext,
} from "./publish_snapshot.js";

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
    sector?: string;
    sector_weights?: Array<{ sector: string; weight: number }>;
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

export interface DashboardSnapshotDeps {
  getSummary: typeof _getSummary;
  getStatus: typeof _getStatus;
  getWidget: typeof _getWidget;
  getAllocation: typeof _getAllocation;
  getCash: typeof _getCash;
  getPerformance: typeof _getPerformance;
  getPriceFreshness: typeof _getPriceFreshness;
  now?: () => Date;
}

const defaultDeps: DashboardSnapshotDeps = {
  getSummary: _getSummary,
  getStatus: _getStatus,
  getWidget: _getWidget,
  getAllocation: _getAllocation,
  getCash: _getCash,
  getPerformance: _getPerformance,
  getPriceFreshness: _getPriceFreshness,
};

export async function buildDashboardSnapshot(
  asOfDate?: string,
  deps: DashboardSnapshotDeps = defaultDeps,
): Promise<DashboardSnapshot> {
  const context = await buildPublishSnapshotContext(asOfDate, {
    getSummary: deps.getSummary,
    getStatus: deps.getStatus,
    getWidget: (days: number, actualDate?: string) =>
      deps.getWidget(Math.max(days, 365), actualDate),
    getPriceFreshness: deps.getPriceFreshness,
    now: deps.now,
  });

  return buildDashboardSnapshotFromContext(context, deps);
}

export async function buildDashboardSnapshotFromContext(
  context: PublishSnapshotContext,
  deps: DashboardSnapshotDeps = defaultDeps,
): Promise<DashboardSnapshot> {
  const [allocation, cash, performanceRaw] = await Promise.all([
    deps.getAllocation(context.asOfDate),
    deps.getCash(context.asOfDate),
    deps.getPerformance({ asOfDate: context.asOfDate }),
  ]);

  const summary: DashboardSnapshot["summary"] = {
    holding_count: context.summary.holding_count,
    total_cash_usd: context.summary.total_cash_usd,
    portfolio_value_usd: context.summary.portfolio_value_usd,
    last_transaction_date: context.summary.last_transaction_date ?? "",
    transaction_count: context.summary.transaction_count,
    as_of_date: context.summary.as_of_date ?? context.asOfDate,
  };

  const allocation_rows = (allocation.rows as AllocationRow[]).map(
    (r) => ({
      asset: r.asset,
      asset_type: r.asset_type,
      asset_kind: r.asset_kind,
      net_quantity: r.net_quantity,
      value_usd: r.value_usd,
      allocation_pct: r.allocation_pct,
      sector: r.sector,
      sector_weights: r.sector_weights,
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
    abs: context.widget.today.amount,
    pct: context.widget.today.pct,
  };

  const total = {
    abs: context.status.total_gain ?? 0,
    pct: context.status.total_gain_pct ?? 0,
  };

  const history = context.widget.series.map((s) => ({
    date: s.date,
    value: s.value,
  }));

  const prices_as_of: string | null = context.freshness.prices_as_of ?? null;

  return {
    summary,
    status: context.status,
    allocation_rows,
    cash_rows,
    performance: performanceRaw.data,
    today,
    total,
    history,
    prices_as_of,
    updatedAt: context.updatedAt,
  };
}
