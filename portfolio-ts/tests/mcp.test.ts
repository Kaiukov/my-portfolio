import { describe, test, expect, mock, beforeEach } from "bun:test";
import { NotFoundError, ValidationError } from "../src/validators.js";

const mockAddTransaction = mock();
const mockEditTransaction = mock();
const mockEditDryRun = mock();
const mockDeleteTransaction = mock();
const mockDeletePreview = mock();
const mockExchangeCurrency = mock();

const mockDbQuery = mock();
const mockDbQuerySingle = mock();

mock.module("../src/db.js", () => ({
  query: mockDbQuery,
  querySingle: mockDbQuerySingle,
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

const mockYahooQuote = mock();
mock.module("yahoo-finance2", () => {
  const MockYahooFinance = function (this: any) {
    this.quote = mockYahooQuote;
  };
  return { default: MockYahooFinance };
});

beforeEach(() => {
  mockAddTransaction.mockReset();
  mockEditTransaction.mockReset();
  mockEditDryRun.mockReset();
  mockDeleteTransaction.mockReset();
  mockDeletePreview.mockReset();
  mockExchangeCurrency.mockReset();
  mockDbQuery.mockReset();
  mockDbQuerySingle.mockReset();
});

function writeCtx() {
  return {
    write: {
      addTransaction: mockAddTransaction,
      editTransaction: mockEditTransaction,
      editDryRun: mockEditDryRun,
      deleteTransaction: mockDeleteTransaction,
      deletePreview: mockDeletePreview,
      exchangeCurrency: mockExchangeCurrency,
    },
  };
}

// ── helpers for setting up DB mocks sequentially ──
function freshQuerySingleRow(date: string | null) {
  return { prices_as_of: date };
}

function freshCoverageEmpty() {
  return [] as { ticker: string }[];
}

function freshStaleEmpty() {
  return [] as { ticker: string }[];
}

// Set up default freshness: no stale/coverage issues, prices_as_of = 2026-01-20
// Order must match getPriceFreshness() query sequence:
//   1. querySingle MAX(date) -> 2. querySingle needs_recalc()
//   3. query checkpoints     -> 4. query stale tickers
function setupFreshnessDb() {
  mockDbQuerySingle.mockResolvedValueOnce(freshQuerySingleRow("2026-01-20"));
  mockDbQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
  mockDbQuery.mockResolvedValueOnce(freshCoverageEmpty());
  mockDbQuery.mockResolvedValueOnce(freshStaleEmpty());
}

// ═════════════════════════════════════════════════
// mcpWrite tests
// ═════════════════════════════════════════════════
describe("mcpWrite", () => {
  test("add_transaction routes to addTransaction", async () => {
    mockAddTransaction.mockResolvedValue({ transaction: { id: 1 }, recalculated: true });

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite(
      "add_transaction",
      {
        date: "2026-01-20",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        price: 155.5,
        currency: "USD",
        fees: 1,
        fee_currency: "USD",
        exchange: "IBKR",
      },
      writeCtx(),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe("add");
    expect(mockAddTransaction).toHaveBeenCalledWith({
      dateStr: "2026-01-20",
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
      price: 155.5,
      currency: "USD",
      fees: 1,
      feeCurrency: "USD",
      exchange: "IBKR",
      account: undefined,
    });
  });

  test("edit_transaction routes dry-run to editDryRun", async () => {
    mockEditDryRun.mockResolvedValue({ dry_run: true, transaction_id: 42, current: { id: 42 }, proposed_changes: {} });

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite(
      "edit_transaction",
      { id: 42, price: 155.5, dry_run: "1" },
      writeCtx(),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe("edit");
    expect(mockEditDryRun).toHaveBeenCalledTimes(1);
    expect(mockEditDryRun).toHaveBeenCalledWith(42, expect.objectContaining({ price: 155.5 }));
    expect(mockEditTransaction).not.toHaveBeenCalled();
  });

  test("delete_transaction routes confirmed delete to deleteTransaction", async () => {
    mockDeleteTransaction.mockResolvedValue({ deleted_ids: [42], recalculated: true });

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite(
      "delete_transaction",
      { id: 42, confirm: true },
      writeCtx(),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe("delete");
    expect(mockDeleteTransaction).toHaveBeenCalledWith(42, true);
  });

  test("exchange_currency routes to exchangeCurrency with aliases", async () => {
    mockExchangeCurrency.mockResolvedValue({ rate: 0.92, transaction_ids: [1, 2] });

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite(
      "exchange_currency",
      {
        date: "2026-01-20",
        from_asset: "USD",
        to: "EURUSD=X",
        quantity: "1000",
        rate: "0.92",
      },
      writeCtx(),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe("exchange");
    expect(mockExchangeCurrency).toHaveBeenCalledWith({
      dateStr: "2026-01-20",
      fromAsset: "USD",
      toAsset: "EURUSD=X",
      quantity: 1000,
      rate: 0.92,
    });
  });

  test("delete_transaction maps explicit-confirmation validation to VALIDATION_ERROR", async () => {
    mockDeleteTransaction.mockImplementation(async () => {
      throw new ValidationError("Deletion of transaction ID 42 requires explicit confirmation.");
    });

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite("delete_transaction", { id: 42 }, writeCtx());

    if (result.ok) throw new Error("Expected error envelope");
    expect(result.ok).toBe(false);
    expect(result.command).toBe("delete");
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  test("edit_transaction maps not-found errors", async () => {
    mockEditTransaction.mockRejectedValue(new NotFoundError("Transaction ID 999 not found"));

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite("edit_transaction", { id: 999, price: 100 }, writeCtx());

    if (result.ok) throw new Error("Expected error envelope");
    expect(result.ok).toBe(false);
    expect(result.command).toBe("edit");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  test("exchange_currency maps unexpected errors to INTERNAL_ERROR", async () => {
    mockExchangeCurrency.mockRejectedValue(new Error("boom"));

    const { mcpWrite } = await import("../src/mcp/adapter.js");
    const result = await mcpWrite(
      "exchange_currency",
      { date: "2026-01-20", fromAsset: "USD", toAsset: "EURUSD=X", quantity: 10, rate: 0.92 },
      writeCtx(),
    );

    if (result.ok) throw new Error("Expected error envelope");
    expect(result.ok).toBe(false);
    expect(result.command).toBe("exchange");
    expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(result.error.message).toBe("boom");
  });
});

// ═════════════════════════════════════════════════
// mcpRead tests (mock at DB layer only)
// ═════════════════════════════════════════════════
describe("mcpRead", () => {
  test("status returns correct envelope with freshness meta", async () => {
    // freshness: querySingle MAX(date) + query coverage gaps + query stale tickers
    setupFreshnessDb();
    // status: querySingle portfolio_status_sql
    mockDbQuerySingle.mockResolvedValueOnce({
      transactions_count: 42, start_date: "2024-01-15", end_date: "2026-03-20",
      portfolio_value: 125000.50, total_invested: 85000, deposits: 100000,
      withdrawals: 15000, income: 2500, fees: 120, taxes: 50,
      total_gain: 40000.50, total_gain_pct: 47.06, cost_basis: 60000,
      realized_gain: 5000, unrealized_gain: 35000.50, total_profit: 40000.50,
      as_of_date: "2026-03-20",
    });

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("status", { as_of: "2026-03-20" });

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("status");
    const data = result.data as Record<string, unknown>;
    expect(data.transactions).toBe(42);
    expect(data.portfolio_value).toBe(125000.50);
    expect(data.as_of_date).toBe("2026-03-20");
    expect(result.meta.count).toBeNull();
    expect(result.meta).toHaveProperty("prices_as_of", "2026-01-20");
    expect(result.meta).toHaveProperty("stale", false);
    expect(result.meta).toHaveProperty("needs_recalc", false);
  });

  test("status with asOf alias works", async () => {
    setupFreshnessDb();
    mockDbQuerySingle.mockResolvedValueOnce({ transactions_count: 1, as_of_date: "2026-01-20" });

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("status", { asOf: "2026-01-20" });

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("status");
    const data = result.data as Record<string, unknown>;
    expect(data.as_of_date).toBe("2026-01-20");
  });

  test("summary returns correct envelope with freshness meta", async () => {
    setupFreshnessDb();
    mockDbQuerySingle.mockResolvedValueOnce({
      holding_count: 5, total_cash_usd: 5000, portfolio_value_usd: 25000,
      last_transaction_date: "2026-01-15", transaction_count: 42, as_of_date: "2026-01-15",
    });

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("summary", {});

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("summary");
    const data = result.data as Record<string, unknown>;
    expect(data.holding_count).toBe(5);
    expect(data.portfolio_value_usd).toBe(25000);
    expect(result.meta.count).toBeNull();
    expect(result.meta).toHaveProperty("prices_as_of", "2026-01-20");
  });

  test("cash returns correct envelope with freshness meta", async () => {
    setupFreshnessDb();
    mockDbQuery.mockResolvedValueOnce([
      { cash_key: "USD:CASH", currency: "USD", display_bucket: "USD Cash", balance: 5000, usd_value: 5000 },
      { cash_key: "EUR:CASH", currency: "EUR", display_bucket: "EUR Cash", balance: 3000, usd_value: 3300 },
    ]);

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("cash", {});

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("cash");
    const data = result.data as Record<string, unknown>;
    expect(data.total_usd).toBe(8300);
    expect(result.meta.count).toBe(2);
    expect(result.meta).toHaveProperty("prices_as_of", "2026-01-20");
  });

  test("allocation returns correct envelope with freshness meta", async () => {
    setupFreshnessDb();
    mockDbQuery.mockResolvedValueOnce([
      { asset: "AAPL", asset_type: "stock_usd", asset_kind: "", net_quantity: 10, value_usd: 1500, allocation_pct: 62.5 },
      { asset: "GOOGL", asset_type: "stock_usd", asset_kind: "", net_quantity: 5, value_usd: 900, allocation_pct: 37.5 },
    ]);

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("allocation", {});

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("allocation");
    const data = result.data as Record<string, unknown>;
    expect(data.portfolio_value).toBe(2400);
    expect(result.meta.count).toBe(2);
    expect(result.meta).toHaveProperty("prices_as_of", "2026-01-20");
  });

  test("concentration returns correct envelope with freshness meta", async () => {
    setupFreshnessDb();
    mockDbQuerySingle.mockResolvedValueOnce({ hhi: 2500, total_holdings: 5, as_of_date: "2026-01-15" });
    mockDbQuery.mockResolvedValueOnce([
      { asset: "AAPL", asset_type: "stock_usd", allocation_pct: 40 },
      { asset: "GOOGL", asset_type: "stock_usd", allocation_pct: 30 },
    ]);

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("concentration", {});

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("concentration");
    const data = result.data as Record<string, unknown>;
    expect(data.hhi).toBe(2500);
    expect(data.total_holdings).toBe(5);
    expect(result.meta.count).toBeNull();
    expect(result.meta).toHaveProperty("prices_as_of", "2026-01-20");
  });

  test("diversification returns correct envelope with freshness meta", async () => {
    setupFreshnessDb();
    mockDbQuerySingle.mockResolvedValueOnce({
      as_of_date: "2026-01-15",
      hhi: 2500,
      total_holdings: 5,
      effective_holdings: 4.0,
      avg_pairwise_correlation: 0.35,
      max_pairwise_correlation: 0.72,
      min_pairwise_correlation: -0.15,
      correlation_weighted_hhi: 3800,
    });

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("diversification", {});

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("diversification");
    const data = result.data as Record<string, unknown>;
    expect(data.hhi).toBe(2500);
    expect(data.effective_holdings).toBe(4.0);
    expect(data.avg_pairwise_correlation).toBe(0.35);
    expect(data.correlation_weighted_hhi).toBe(3800);
    expect(result.meta).toHaveProperty("prices_as_of", "2026-01-20");
  });

  test("performance returns correct envelope with freshness meta", async () => {
    setupFreshnessDb();
    mockDbQuery.mockResolvedValueOnce([{
      total_days: 100, start_date: "2025-01-01", end_date: "2026-06-01",
      start_value: 100000, end_value: 115000, total_gain: 15000,
      avg_daily_return: 0.001, avg_investment_return: 0.0008, std_dev: 0.015,
      hist_volatility: 0.22, var_95: -0.02, var_99: -0.03,
      cvar_95: -0.025, cvar_99: -0.04, max_drawdown: -0.15, avg_drawdown: -0.05,
      avg_drawdown_duration: 3, time_weighted_return_pct: 15, total_return_pct: 15,
      median_monthly_return: 0.012, cagr: 0.14, beta: 1.05,
      sharpe_ratio: 1.2, sortino_ratio: 1.5, treynor_ratio: 0.02,
      information_ratio: 0.5, jensens_alpha: 0.02, relative_return: 0.03,
      tracking_error: 0.05, spy_twr_pct: 10, spy_cagr_pct: 8,
      up_capture_ratio: 1.1, down_capture_ratio: 0.9,
    }]);
    mockDbQuery.mockResolvedValueOnce([]); // period returns
    mockDbQuery.mockResolvedValueOnce([]); // rolling returns

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("performance", { as_of: "2026-06-01", benchmark: "QQQ" });

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("performance");
    const data = result.data as Record<string, unknown>;
    expect(data.total_days).toBe(100);
    expect(data.time_weighted_return_pct).toBe(15);
    expect(result.meta.count).toBeNull();
    expect(result.meta).toHaveProperty("prices_as_of", "2026-01-20");
  });

  test("mwr returns correct envelope with freshness meta", async () => {
    setupFreshnessDb();
    mockDbQuerySingle.mockResolvedValueOnce({ mwr: 0.1234 });
    mockDbQuerySingle.mockResolvedValueOnce({
      holding_count: 5, total_cash_usd: 5000, portfolio_value_usd: 25000,
      last_transaction_date: "2026-01-15", transaction_count: 42, as_of_date: "2026-01-15",
    });

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("mwr", {});

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("mwr");
    const data = result.data as Record<string, unknown>;
    expect(data.mwr_pct).toBe(12.34);
    expect(data.portfolio_value).toBe(25000);
    expect(data.as_of_date).toBeDefined();
    expect(result.meta.count).toBeNull();
    expect(result.meta).toHaveProperty("prices_as_of", "2026-01-20");
  });

  test("transactions returns correct envelope with pagination", async () => {
    mockDbQuerySingle.mockResolvedValueOnce({ count: 1 });
    mockDbQuery.mockResolvedValueOnce([
      { id: 1, date: "2026-01-01", asset: "AAPL", action: "BUY", quantity: 10, asset_type: "stock_usd", price: 150, currency: "USD", fees: 1, fee_currency: "USD", exchange: "NYSE", data_source: "manual", account: null, created_at: null, updated_at: null },
    ]);

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("transactions", { limit: 10, offset: 0 });

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("transactions");
    const data = result.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0].asset).toBe("AAPL");
    expect(result.meta.count).toBe(1);
    expect(result.meta.pagination).toEqual({
      limit: 10, offset: 0, total: 1, has_more: false, next_offset: null,
    });
  });

  test("transactions pagination has_more true when total > page", async () => {
    mockDbQuerySingle.mockResolvedValueOnce({ count: 20 });
    const txRows = Array(5).fill(null).map((_, i) => ({
      id: i + 1, date: "2026-01-01", asset: "A", action: "BUY", quantity: 1,
      asset_type: "stock_usd", price: 1, currency: "USD", fees: 0,
      fee_currency: "USD", exchange: "X", data_source: "m", account: null,
      created_at: null, updated_at: null,
    }));
    mockDbQuery.mockResolvedValueOnce(txRows);

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("transactions", { limit: 5, offset: 0 });

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.meta.pagination).toHaveProperty("has_more", true);
    expect(result.meta.pagination).toHaveProperty("next_offset", 5);
  });

  test("report returns correct envelope with pagination", async () => {
    mockDbQuerySingle.mockResolvedValueOnce({ count: 2 });
    mockDbQuery.mockResolvedValueOnce([
      { date: "2026-01-01", portfolio_value: 100000, portfolio_daily_return: 0, investment_return: 0, cash_flow_impact: 0, adjusted_base: 100000 },
      { date: "2026-01-02", portfolio_value: 101000, portfolio_daily_return: 0.01, investment_return: 0.005, cash_flow_impact: 0, adjusted_base: 100500 },
    ]);

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("report", {});

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("report");
    const data = result.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(2);
    expect(data[0].date).toBe("2026-01-01");
    expect(result.meta.count).toBe(2);
    expect(result.meta.pagination).toBeDefined();
  });

  test("health returns correct envelope (no freshness meta)", async () => {
    // needs_recalc
    mockDbQuerySingle.mockResolvedValueOnce({ needs_recalc: false });
    // service_state
    mockDbQuery.mockResolvedValueOnce([]);
    // coverage issues
    mockDbQuery.mockResolvedValueOnce([]);
    // stale tickers (maxAgeDays > 0 triggers this extra call)
    mockDbQuery.mockResolvedValueOnce([]);

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("health", { max_age_days: 5 });

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("health");
    const data = result.data as Record<string, unknown>;
    expect(data.status).toBe("ok");
    expect(data.db_reachable).toBe(true);
    expect(result.meta).not.toHaveProperty("prices_as_of");
  });

  test("verify_prices returns correct envelope (no freshness meta)", async () => {
    // stats row
    mockDbQuerySingle.mockResolvedValueOnce({ total_rows: 1000, min_date: "2025-01-01", max_date: "2026-06-01" });
    // distinct tickers
    mockDbQuery.mockResolvedValueOnce([]);
    // required tickers
    mockDbQuery.mockResolvedValueOnce([]);
    // checkpoint rows
    mockDbQuery.mockResolvedValueOnce([]);
    // needs_recalc
    mockDbQuerySingle.mockResolvedValueOnce({ needs_recalc: false });

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("verify_prices", {});

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("verify_prices");
    const data = result.data as Record<string, unknown>;
    expect(data.total_rows).toBe(1000);
    expect(data.date_range).toBeDefined();
    expect(result.meta).not.toHaveProperty("prices_as_of");
  });

  test("widget returns correct envelope with series count", async () => {
    mockDbQuerySingle.mockResolvedValueOnce({
      portfolio_value: 19257.13, total_gain: 4257.13, total_gain_pct: 28.3,
      as_of_date: "2026-05-30",
    });
    mockDbQuery.mockResolvedValueOnce([
      { date: "2026-05-30", portfolio_value: 19257.13, investment_return: 0.65 },
      { date: "2026-05-29", portfolio_value: 19131.63, investment_return: -0.12 },
      { date: "2026-05-28", portfolio_value: 19155.00, investment_return: 0.80 },
    ]);

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("widget", { days: 30 });

    if (!result.ok) throw new Error("Expected success envelope");
    expect(result.command).toBe("widget");
    const data = result.data as Record<string, unknown>;
    expect(data.title).toBe("My holdings");
    expect(data.value).toBe(19257.13);
    expect(result.meta.count).toBe(3);
  });

  test("mcpRead maps unexpected errors to INTERNAL_ERROR", async () => {
    // trigger an error by not providing any mock data
    mockDbQuerySingle.mockRejectedValue(new Error("DB connection failed"));

    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("status", {});

    if (result.ok) throw new Error("Expected error envelope");
    expect(result.command).toBe("status");
    expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(result.error.message).toBe("DB connection failed");
  });

  test("mcpRead returns NOT_FOUND for unsupported tool", async () => {
    const { mcpRead } = await import("../src/mcp/read.js");
    const result = await mcpRead("recalculate", {});

    if (result.ok) throw new Error("Expected error envelope");
    expect(result.error.code).toBe("NOT_FOUND");
    expect(result.error.message).toBe("Unsupported MCP read tool: recalculate");
  });
});
