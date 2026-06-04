import { getSummary as _getSummary, type SummaryData } from "./summary.js";
import { getStatus as _getStatus, type StatusData } from "./status.js";
import { getWidget as _getWidget, type WidgetData } from "./widget.js";
import { getPriceFreshness as _getPriceFreshness, type PriceFreshness } from "./freshness.js";
import type { PortfolioSnapshot } from "../cloudflare/types.js";

const WIDGET_PUBLISH_HISTORY_DAYS = 180;
const SHARED_WIDGET_HISTORY_DAYS = 365;

export interface PublishSnapshotContext {
  asOfDate: string;
  updatedAt: string;
  summary: SummaryData;
  status: StatusData;
  widget: WidgetData;
  freshness: PriceFreshness;
}

export interface PublishSnapshotDeps {
  getSummary?: typeof _getSummary;
  getStatus?: typeof _getStatus;
  getWidget?: typeof _getWidget;
  getPriceFreshness?: typeof _getPriceFreshness;
  now?: () => Date;
}

export async function buildPublishSnapshotContext(
  asOfDate?: string,
  deps: PublishSnapshotDeps = {},
): Promise<PublishSnapshotContext> {
  const now = deps.now ?? (() => new Date());
  const snapshotTime = now();
  const actualDate = asOfDate ?? snapshotTime.toISOString().split("T")[0];
  const getSummary = deps.getSummary ?? _getSummary;
  const getStatus = deps.getStatus ?? _getStatus;
  const getWidget = deps.getWidget ?? _getWidget;
  const getPriceFreshness = deps.getPriceFreshness ?? _getPriceFreshness;

  const [summary, status, widget, freshness] = await Promise.all([
    getSummary(actualDate),
    getStatus(actualDate),
    getWidget(SHARED_WIDGET_HISTORY_DAYS, actualDate),
    getPriceFreshness(actualDate),
  ]);

  return {
    asOfDate: actualDate,
    updatedAt: snapshotTime.toISOString(),
    summary,
    status,
    widget,
    freshness,
  };
}

export function buildPortfolioSnapshotFromContext(
  context: PublishSnapshotContext,
): PortfolioSnapshot {
  return {
    portfolio_value_usd: context.summary.portfolio_value_usd,
    today: { abs: context.widget.today.amount, pct: context.widget.today.pct },
    total: {
      abs: context.status.total_gain ?? 0,
      pct: context.status.total_gain_pct ?? 0,
    },
    history: context.widget.series
      .slice(-WIDGET_PUBLISH_HISTORY_DAYS)
      .map((s) => ({ date: s.date, value: s.value })),
    prices_as_of: context.freshness.prices_as_of ?? "",
    as_of_date: context.summary.as_of_date,
    updatedAt: context.updatedAt,
  };
}
