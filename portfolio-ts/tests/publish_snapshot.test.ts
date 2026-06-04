import { describe, expect, mock, test } from "bun:test";

describe("publish snapshot helpers", () => {
  test("buildPublishSnapshotContext uses one timestamp and one as-of date across shared reads", async () => {
    const now = new Date("2026-06-03T12:34:56.000Z");
    const getSummary = mock(async () => ({
      holding_count: 5,
      total_cash_usd: 2500.75,
      portfolio_value_usd: 42500.12,
      last_transaction_date: "2026-06-01",
      transaction_count: 42,
      as_of_date: "2026-06-03",
    }));
    const getStatus = mock(async () => ({
      transactions: 42,
      start_date: "2025-01-15",
      end_date: "2026-06-03",
      portfolio_value: 42500.12,
      total_invested: 38000,
      deposits: 40000,
      withdrawals: 2000,
      income: 500,
      fees: 75,
      taxes: 25,
      total_gain: 4500.12,
      total_gain_pct: 11.84,
      cost_basis: 38000,
      realized_gain: 1200,
      unrealized_gain: 3300.12,
      total_profit: 4500.12,
      as_of_date: "2026-06-03",
    }));
    const getWidget = mock(async () => ({
      title: "My holdings",
      currency: "USD",
      as_of_date: "2026-06-03",
      last_refresh: "2026-06-03",
      value: 42500.12,
      today: { amount: 125.5, pct: 0.296 },
      total: { amount: 4500.12, pct: 11.84 },
      series: [{ date: "2026-06-03", value: 42500.12 }],
    }));
    const getPriceFreshness = mock(async () => ({
      prices_as_of: "2026-06-03",
      price_age_days: 0,
      stale: false,
      needs_recalc: false,
    }));

    const { buildPublishSnapshotContext } = await import(
      "../src/commands/publish_snapshot.js"
    );
    const context = await buildPublishSnapshotContext(undefined, {
      getSummary,
      getStatus,
      getWidget,
      getPriceFreshness,
      now: () => now,
    });

    expect(context.asOfDate).toBe("2026-06-03");
    expect(context.updatedAt).toBe("2026-06-03T12:34:56.000Z");
    expect(getSummary).toHaveBeenCalledWith("2026-06-03");
    expect(getStatus).toHaveBeenCalledWith("2026-06-03");
    expect(getWidget).toHaveBeenCalledWith(365, "2026-06-03");
    expect(getPriceFreshness).toHaveBeenCalledWith("2026-06-03");
  });

  test("buildPortfolioSnapshotFromContext keeps widget publish history at 180 points", async () => {
    const { buildPortfolioSnapshotFromContext } = await import(
      "../src/commands/publish_snapshot.js"
    );
    const snapshot = buildPortfolioSnapshotFromContext({
      asOfDate: "2026-06-03",
      updatedAt: "2026-06-03T12:34:56.000Z",
      summary: {
        holding_count: 1,
        total_cash_usd: 100,
        portfolio_value_usd: 1000,
        last_transaction_date: "2026-06-03",
        transaction_count: 1,
        as_of_date: "2026-06-03",
      },
      status: {
        transactions: 1,
        start_date: "2026-06-03",
        end_date: "2026-06-03",
        portfolio_value: 1000,
        total_invested: 900,
        deposits: 900,
        withdrawals: 0,
        income: 0,
        fees: 0,
        taxes: 0,
        total_gain: 100,
        total_gain_pct: 11.11,
        cost_basis: 900,
        realized_gain: 0,
        unrealized_gain: 100,
        total_profit: 100,
        as_of_date: "2026-06-03",
      },
      widget: {
        title: "My holdings",
        currency: "USD",
        as_of_date: "2026-06-03",
        last_refresh: "2026-06-03",
        value: 1000,
        today: { amount: 10, pct: 1 },
        total: { amount: 100, pct: 11.11 },
        series: Array.from({ length: 200 }, (_, index) => ({
          date: `day-${index}`,
          value: index,
        })),
      },
      freshness: {
        prices_as_of: "2026-06-03",
        price_age_days: 0,
        stale: false,
        needs_recalc: false,
      },
    });

    expect(snapshot.updatedAt).toBe("2026-06-03T12:34:56.000Z");
    expect(snapshot.as_of_date).toBe("2026-06-03");
    expect(snapshot.history).toHaveLength(180);
    expect(snapshot.history[0]).toEqual({ date: "day-20", value: 20 });
    expect(snapshot.history[179]).toEqual({ date: "day-199", value: 199 });
  });
});
