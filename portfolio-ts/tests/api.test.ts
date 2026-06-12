import { describe, expect, test, mock, jest, beforeEach } from "bun:test";
import { NotFoundError, ValidationError } from "../src/validators.js";

const mockQuerySingle = mock();
const mockQuery = mock();
const mockAddTransaction = mock();
const mockEditTransaction = mock();
const mockEditDryRun = mock();
const mockDeleteTransaction = mock();
const mockDeletePreview = mock();
const mockExchangeCurrency = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  connect: () => {},
  close: async () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(fn: (tx: { unsafe: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>): Promise<T> => {
    return fn({ unsafe: async (_sql: string, _params?: unknown[]) => [] });
  },
}));

beforeEach(() => {
  mockQuerySingle.mockReset();
  mockQuery.mockReset();
  mockAddTransaction.mockReset();
  mockEditTransaction.mockReset();
  mockEditDryRun.mockReset();
  mockDeleteTransaction.mockReset();
  mockDeletePreview.mockReset();
  mockExchangeCurrency.mockReset();
});

const DEFAULT_FRESHNESS = {
  prices_as_of: "2026-01-14",
  price_age_days: 1,
  stale: false,
};

function makeFreshness(
  overrides: Partial<typeof DEFAULT_FRESHNESS> = {},
): typeof DEFAULT_FRESHNESS {
  return {
    ...DEFAULT_FRESHNESS,
    ...overrides,
  };
}

function isFreshnessPriceQuery(sql: string) {
  return sql.includes("MAX(date)::text AS prices_as_of");
}

function isFreshnessCoverageQuery(sql: string) {
  return sql.includes("get_required_price_checkpoints_sql") || sql.includes("stale_tickers_sql");
}

function makeStatusRow(overrides: Record<string, unknown> = {}) {
  return {
    transactions_count: 42,
    start_date: "2025-01-01",
    end_date: "2026-01-01",
    portfolio_value: 100000,
    total_invested: 80000,
    deposits: 90000,
    withdrawals: 10000,
    income: 5000,
    fees: 200,
    taxes: 100,
    total_gain: 20000,
    total_gain_pct: 25,
    cost_basis: 80000,
    realized_gain: 5000,
    unrealized_gain: 15000,
    total_profit: 20000,
    as_of_date: "2026-01-01",
    ...overrides,
  };
}

describe("handleRequest", () => {
  test("GET /summary returns 200 with success envelope", async () => {
    const freshness = makeFreshness();
    mockQuerySingle.mockImplementation((sql: string) => {
      if (isFreshnessPriceQuery(sql)) {
        return Promise.resolve({ prices_as_of: freshness.prices_as_of });
      }
      return Promise.resolve({
        holding_count: 5,
        total_cash_usd: 5000,
        portfolio_value_usd: 25000,
        last_transaction_date: "2026-01-15",
        transaction_count: 42,
        as_of_date: "2026-01-15",
      });
    });
    mockQuery.mockImplementation((sql: string) => {
      if (isFreshnessCoverageQuery(sql)) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/summary?as_of=2026-01-15");
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("summary");
    expect(body.data.holding_count).toBe(5);
    expect(body.data.portfolio_value_usd).toBe(25000);
  });

  test("GET /status returns 200 with success envelope", async () => {
    const freshness = makeFreshness();
    mockQuerySingle.mockImplementation((sql: string) => {
      if (isFreshnessPriceQuery(sql)) {
        return Promise.resolve({ prices_as_of: freshness.prices_as_of });
      }
      return Promise.resolve(makeStatusRow());
    });
    mockQuery.mockImplementation((sql: string) => {
      if (isFreshnessCoverageQuery(sql)) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/status?as_of=2026-01-15");
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("status");
    expect(body.data.transactions).toBe(42);
    expect(body.data.portfolio_value).toBe(100000);
  });

  test("GET /allocation returns 200 with success envelope", async () => {
    const freshness = makeFreshness();
    mockQuerySingle.mockImplementation((sql: string) => {
      if (isFreshnessPriceQuery(sql)) {
        return Promise.resolve({ prices_as_of: freshness.prices_as_of });
      }
      return Promise.resolve(null);
    });
    mockQuery.mockImplementation((sql: string) => {
      if (isFreshnessCoverageQuery(sql)) {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        { asset: "AAPL", asset_type: "stock", asset_kind: "equity", net_quantity: 10, value_usd: 1500, allocation_pct: 15 },
        { asset: "GOOGL", asset_type: "stock", asset_kind: "equity", net_quantity: 5, value_usd: 8500, allocation_pct: 85 },
      ]);
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/allocation?as_of=2026-01-15");
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("allocation");
    expect(body.data.rows.length).toBe(2);
    expect(body.data.rows[0].asset).toBe("AAPL");
  });

  test("GET /cash returns 200 with success envelope", async () => {
    const freshness = makeFreshness();
    mockQuerySingle.mockImplementation((sql: string) => {
      if (isFreshnessPriceQuery(sql)) {
        return Promise.resolve({ prices_as_of: freshness.prices_as_of });
      }
      return Promise.resolve(null);
    });
    mockQuery.mockImplementation((sql: string) => {
      if (isFreshnessCoverageQuery(sql)) {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        { cash_key: "USD:default", currency: "USD", display_bucket: "USD", balance: 5000, usd_value: 5000 },
      ]);
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/cash?as_of=2026-01-15");
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("cash");
    expect(body.data.total_usd).toBe(5000);
  });

  test("GET /performance returns 200 with success envelope", async () => {
    const freshness = makeFreshness();
    mockQuerySingle.mockImplementation((sql: string) => {
      if (isFreshnessPriceQuery(sql)) {
        return Promise.resolve({ prices_as_of: freshness.prices_as_of });
      }
      return Promise.resolve(null);
    });
    mockQuery.mockImplementation((sql: string) => {
      if (isFreshnessCoverageQuery(sql)) {
        return Promise.resolve([]);
      }
      return Promise.resolve([{
        total_days: 252,
        start_date: "2025-01-01",
        end_date: "2026-01-01",
        start_value: 80000,
        end_value: 100000,
        total_gain: 20000,
        avg_daily_return: 0.0008,
        avg_investment_return: 0.0007,
        std_dev: 0.012,
        hist_volatility: 0.19,
        var_95: -0.018,
        var_99: -0.027,
        cvar_95: -0.022,
        cvar_99: -0.031,
        max_drawdown: -0.15,
        avg_drawdown: -0.03,
        avg_drawdown_duration: 12,
        time_weighted_return_pct: 25,
        total_return_pct: 25,
        median_monthly_return: 1.5,
        cagr: 25,
        beta: 1.1,
        sharpe_ratio: 1.5,
        sortino_ratio: 2.0,
        treynor_ratio: 0.22,
        information_ratio: 0.5,
        jensens_alpha: 0.02,
        relative_return: 10,
        tracking_error: 0.08,
        spy_twr_pct: 15,
        spy_cagr_pct: 15,
        up_capture_ratio: 1.1,
        down_capture_ratio: 0.9,
      }]);
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/performance?as_of=2026-01-01&benchmark=SPY&period=1y");
    const res = await handleRequest(req, {
      write: { deletePreview: mockDeletePreview, deleteTransaction: mockDeleteTransaction },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("performance");
    expect(body.data.time_weighted_return_pct).toBe(25);
    expect(body.data.sharpe_ratio).toBe(1.5);
  });

  test("GET /mwr returns 200 with success envelope", async () => {
    const freshness = makeFreshness();
    mockQuerySingle.mockImplementation((sql: string) => {
      if (isFreshnessPriceQuery(sql)) {
        return Promise.resolve({ prices_as_of: freshness.prices_as_of });
      }
      return Promise.resolve({ mwr: 0.15 });
    });
    mockQuery.mockImplementation((sql: string) => {
      if (isFreshnessCoverageQuery(sql)) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/mwr?as_of=2026-01-01");
    const res = await handleRequest(req, {
      write: { deleteTransaction: mockDeleteTransaction },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("mwr");
    expect(body.data.mwr_pct).toBe(15);
  });

  test("API reporting endpoints emit CLI price-freshness meta (#159 parity)", async () => {
    const freshness = makeFreshness();
    const performanceRows = [{
      total_days: 252,
      start_date: "2025-01-01",
      end_date: "2026-01-01",
      start_value: 80000,
      end_value: 100000,
      total_gain: 20000,
      avg_daily_return: 0.0008,
      avg_investment_return: 0.0007,
      std_dev: 0.012,
      hist_volatility: 0.19,
      var_95: -0.018,
      var_99: -0.027,
      cvar_95: -0.022,
      cvar_99: -0.031,
      max_drawdown: -0.15,
      avg_drawdown: -0.03,
      avg_drawdown_duration: 12,
      time_weighted_return_pct: 25,
      total_return_pct: 25,
      median_monthly_return: 1.5,
      cagr: 25,
      beta: 1.1,
      sharpe_ratio: 1.5,
      sortino_ratio: 2.0,
      treynor_ratio: 0.22,
      information_ratio: 0.5,
      jensens_alpha: 0.02,
      relative_return: 10,
      tracking_error: 0.08,
      spy_twr_pct: 15,
      spy_cagr_pct: 15,
      up_capture_ratio: 1.1,
      down_capture_ratio: 0.9,
    }];
    mockQuerySingle.mockImplementation((sql: string) => {
      if (isFreshnessPriceQuery(sql)) {
        return Promise.resolve({ prices_as_of: freshness.prices_as_of });
      }
      if (sql.includes("portfolio_summary_sql")) {
        return Promise.resolve({
          holding_count: 5,
          total_cash_usd: 5000,
          portfolio_value_usd: 25000,
          last_transaction_date: "2026-01-15",
          transaction_count: 42,
          as_of_date: "2026-01-15",
        });
      }
      return Promise.resolve({
        mwr: 0.15,
      });
    });
    mockQuery.mockImplementation((sql: string) => {
      if (isFreshnessCoverageQuery(sql)) {
        return Promise.resolve([]);
      }
      if (sql.includes("portfolio_performance_sql")) {
        return Promise.resolve(performanceRows);
      }
      return Promise.resolve([]);
    });

    const { handleRequest } = await import("../src/api/server.js");

    const summaryRes = await handleRequest(new Request("http://localhost/summary?as_of=2026-01-15"));
    const summaryBody = await summaryRes.json();
    expect(summaryRes.status).toBe(200);
    expect(summaryBody.ok).toBe(true);
    expect(summaryBody.command).toBe("summary");
    expect(summaryBody.meta).toHaveProperty("prices_as_of", "2026-01-14");
    expect(summaryBody.meta).toHaveProperty("price_age_days", 1);
    expect(summaryBody.meta).toHaveProperty("stale", false);

    const perfRes = await handleRequest(new Request("http://localhost/performance?as_of=2026-01-15&benchmark=SPY&period=1y"));
    const perfBody = await perfRes.json();
    expect(perfRes.status).toBe(200);
    expect(perfBody.ok).toBe(true);
    expect(perfBody.command).toBe("performance");
    expect(perfBody.meta).toHaveProperty("prices_as_of", "2026-01-14");
    expect(perfBody.meta).toHaveProperty("price_age_days", 1);
    expect(perfBody.meta).toHaveProperty("stale", false);
  });

  test("GET /health returns 200 with success envelope", async () => {
    let callCount = 0;
    mockQuerySingle.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ needs_recalc: false });
    });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("service_state")) {
        return Promise.resolve([
          { state_key: "last_successful_price_refresh", state_value: "2026-01-14" },
          { state_key: "last_successful_recalc", state_value: "2026-01-15" },
        ]);
      }
      return Promise.resolve([]);
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/health?max_age_days=5");
    const res = await handleRequest(req, {
      write: { deleteTransaction: mockDeleteTransaction },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("health");
    expect(body.data.db_reachable).toBe(true);
  });

  test("GET /verify_prices returns 200 with success envelope", async () => {
    let callCount = 0;
    mockQuerySingle.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ total_rows: 1000, min_date: "2025-01-01", max_date: "2026-01-01" });
      }
      return Promise.resolve({ needs_recalc: false });
    });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("DISTINCT ticker FROM prices")) {
        return Promise.resolve([{ ticker: "AAPL" }, { ticker: "GOOGL" }]);
      }
      if (sql.includes("discover_required_tickers_sql")) {
        return Promise.resolve([{ ticker: "AAPL", ticker_category: "holding" }]);
      }
      if (sql.includes("get_required_price_checkpoints_sql")) {
        return Promise.resolve([{ ticker: "AAPL", checkpoint_date: "2026-01-01" }]);
      }
      if (sql.includes("stale_tickers_sql")) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/verify_prices?max_age_days=5");
    const res = await handleRequest(req, {
      write: { exchangeCurrency: mockExchangeCurrency },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("verify_prices");
    expect(body.data.total_rows).toBe(1000);
  });

  test("GET /diversification returns 200 with success envelope", async () => {
    let qsCall = 0;
    mockQuerySingle.mockImplementation(() => {
      qsCall++;
      if (qsCall === 1) {
        return Promise.resolve({ prices_as_of: "2026-01-14" });
      }
      if (qsCall === 2) {
        return Promise.resolve({ needs_recalc: false });
      }
      return Promise.resolve({
        as_of_date: "2026-01-15",
        hhi: 2500,
        total_holdings: 5,
        effective_holdings: 4.0,
        avg_pairwise_correlation: 0.35,
        max_pairwise_correlation: 0.72,
        min_pairwise_correlation: -0.15,
        correlation_weighted_hhi: 3800,
      });
    });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("get_required_price_checkpoints_sql") || sql.includes("stale_tickers_sql")) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/diversification?as_of=2026-01-15&lookback_days=126&min_correlation=0.3");
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("diversification");
    expect(body.data.hhi).toBe(2500);
    expect(body.data.effective_holdings).toBe(4.0);
    expect(body.data.avg_pairwise_correlation).toBe(0.35);
    expect(body.data.correlation_weighted_hhi).toBe(3800);
    expect(body.meta).toHaveProperty("prices_as_of", "2026-01-14");
  });

  test("unknown route returns 404 error envelope", async () => {
    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/nonexistent");
    const res = await handleRequest(req);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("nonexistent");
  });

  test("POST /summary remains method-not-allowed", async () => {
    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/summary", { method: "POST" });
    const res = await handleRequest(req);

    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
    expect(body.error.message).toContain("POST");
  });

  test("POST /transactions maps to addTransaction", async () => {
    mockAddTransaction.mockResolvedValue({
      transaction: { id: 101, asset: "AAPL", action: "BUY" },
      recalculated: true,
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-01-20",
        asset: "AAPL",
        action: "BUY",
        quantity: 10,
        price: 150.25,
        currency: "USD",
        fees: 1.5,
        fee_currency: "USD",
        exchange: "Interactive Brokers",
        account: "Main",
      }),
    });
    const res = await handleRequest(req, {
      write: { addTransaction: mockAddTransaction },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("add");
    expect(mockAddTransaction).toHaveBeenCalledWith({
      dateStr: "2026-01-20",
      asset: "AAPL",
      action: "BUY",
      quantity: 10,
      price: 150.25,
      currency: "USD",
      fees: 1.5,
      feeCurrency: "USD",
      exchange: "Interactive Brokers",
      account: "Main",
    });
  });

  test("PATCH /transactions/:id maps partial edit to editTransaction", async () => {
    mockEditTransaction.mockResolvedValue({
      before: { id: 42, price: 150 },
      transaction: { id: 42, price: 155.5 },
      recalculated: true,
      from_date: "2026-01-20",
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions/42", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price: 155.5 }),
    });
    const res = await handleRequest(req, {
      write: { editTransaction: mockEditTransaction, editDryRun: mockEditDryRun },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("edit");
    expect(mockEditTransaction).toHaveBeenCalledTimes(1);
    expect(mockEditTransaction).toHaveBeenCalledWith(42, expect.objectContaining({ price: 155.5 }));
    expect(mockEditDryRun).not.toHaveBeenCalled();
  });

  test("PATCH /transactions/:id dry-run routes to editDryRun", async () => {
    mockEditDryRun.mockResolvedValue({
      dry_run: true,
      transaction_id: 42,
      current: { id: 42, price: 150 },
      proposed_changes: { price: "155.5" },
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions/42", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price: 155.5, dry_run: true }),
    });
    const res = await handleRequest(req, {
      write: { editTransaction: mockEditTransaction, editDryRun: mockEditDryRun },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("edit");
    expect(mockEditDryRun).toHaveBeenCalledWith(42, expect.objectContaining({ price: 155.5 }));
    expect(mockEditTransaction).not.toHaveBeenCalled();
  });

  test("PUT /transactions/:id also routes through editTransaction", async () => {
    mockEditTransaction.mockResolvedValue({
      before: { id: 42, price: 150 },
      transaction: { id: 42, price: 160 },
      recalculated: true,
      from_date: "2026-01-20",
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions/42", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-01-20", asset: "AAPL", action: "BUY", quantity: 10, price: 160 }),
    });
    const res = await handleRequest(req, {
      write: { editTransaction: mockEditTransaction, editDryRun: mockEditDryRun },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("edit");
    expect(mockEditTransaction).toHaveBeenCalledTimes(1);
    expect(mockEditTransaction).toHaveBeenCalledWith(42, expect.objectContaining({ price: 160 }));
  });

  test("DELETE /transactions/:id dry-run routes to deletePreview", async () => {
    mockDeletePreview.mockResolvedValue({
      dry_run: true,
      transaction_id: 42,
      would_delete: [{ id: 42, date: "2026-01-20", asset: "AAPL", action: "BUY", quantity: 10 }],
      is_exchange_group: false,
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions/42?dry_run=true", {
      method: "DELETE",
    });
    const res = await handleRequest(req, {
      write: { deleteTransaction: mockDeleteTransaction, deletePreview: mockDeletePreview },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("delete");
    expect(mockDeletePreview).toHaveBeenCalledWith(42);
    expect(mockDeleteTransaction).not.toHaveBeenCalled();
  });

  test("DELETE /transactions/:id without confirm returns VALIDATION_ERROR", async () => {
    mockDeleteTransaction.mockImplementation(async (_id: number, confirm: boolean) => {
      if (!confirm) {
        throw new ValidationError(
          "Deletion of transaction ID 42 requires explicit confirmation.",
        );
      }
      return { deleted_ids: [42], recalculated: true };
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions/42", { method: "DELETE" });
    const res = await handleRequest(req, {
      write: { deleteTransaction: mockDeleteTransaction },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.command).toBe("delete");
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("explicit confirmation");
  });

  test("DELETE /transactions/:id with confirm routes to deleteTransaction", async () => {
    mockDeleteTransaction.mockResolvedValue({
      deleted_ids: [42],
      recalculated: true,
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions/42?confirm=true", {
      method: "DELETE",
    });
    const res = await handleRequest(req, {
      write: { deleteTransaction: mockDeleteTransaction },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("delete");
    expect(mockDeleteTransaction).toHaveBeenCalledWith(42, true);
  });

  test("POST /exchange maps to exchangeCurrency", async () => {
    mockExchangeCurrency.mockResolvedValue({
      from: { asset: "USD", quantity: 1000 },
      to: { asset: "EURUSD=X", quantity: 920 },
      rate: 0.92,
      date: "2026-01-20",
      transaction_ids: [201, 202],
      exchange_group_id: "group-1",
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-01-20",
        fromAsset: "USD",
        toAsset: "EURUSD=X",
        quantity: 1000,
        rate: 0.92,
      }),
    });
    const res = await handleRequest(req, {
      write: { exchangeCurrency: mockExchangeCurrency },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("exchange");
    expect(mockExchangeCurrency).toHaveBeenCalledWith({
      dateStr: "2026-01-20",
      fromAsset: "USD",
      toAsset: "EURUSD=X",
      quantity: 1000,
      rate: 0.92,
    });
  });

  test("write validation errors return 400 envelope", async () => {
    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-01-20",
        asset: "AAPL",
      }),
    });
    const res = await handleRequest(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.command).toBe("add");
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("write not-found errors return 404 envelope", async () => {
    mockEditTransaction.mockRejectedValue(new NotFoundError("Transaction ID 999 not found"));

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/transactions/999", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price: 100 }),
    });
    const res = await handleRequest(req, {
      write: { editTransaction: mockEditTransaction },
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.command).toBe("edit");
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("service throws -> 500 error envelope", async () => {
    mockQuerySingle.mockRejectedValue(new Error("Connection refused"));

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/summary");
    const res = await handleRequest(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.command).toBe("api");
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Connection refused");
  });

  test("GET without service params uses defaults (today)", async () => {
    const freshness = makeFreshness();
    mockQuerySingle.mockImplementation((sql: string) => {
      if (isFreshnessPriceQuery(sql)) {
        return Promise.resolve({ prices_as_of: freshness.prices_as_of });
      }
      return Promise.resolve({
        holding_count: 0,
        total_cash_usd: 0,
        portfolio_value_usd: 0,
        last_transaction_date: null,
        transaction_count: 0,
        as_of_date: "2026-06-01",
      });
    });
    mockQuery.mockImplementation((sql: string) => {
      if (isFreshnessCoverageQuery(sql)) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/summary");
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("GET /ready returns 200 with readiness body", async () => {
    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/ready");
    const res = await handleRequest(req, {
      ready: async () => ({
        status: 200 as const,
        body: {
          ready: true,
          started_at: "2026-06-01T00:00:00.000Z",
          port: 8787,
          refresh_interval_ms: 3600000,
          cloudflare_publish: false,
          publish_interval_ms: null,
          init_on_boot: true,
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(true);
    expect(body.port).toBe(8787);
    expect(body.init_on_boot).toBe(true);
  });

  test("GET /ready returns 503 when the DB probe fails", async () => {
    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/ready");
    const res = await handleRequest(req, {
      ready: async () => ({
        status: 503 as const,
        body: {
          ready: false,
          started_at: "2026-06-01T00:00:00.000Z",
          port: 8787,
          refresh_interval_ms: 3600000,
          cloudflare_publish: false,
          publish_interval_ms: null,
          init_on_boot: true,
          error: "connection refused",
        },
      }),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.error).toBe("connection refused");
  });

  test("GET /mcp returns an SSE stream for Cloudflare/OpenAI server URL mode", async () => {
    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/mcp", {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
      },
    });
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
  });

  test("OPTIONS /status returns CORS headers when enabled", async () => {
    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/status", { method: "OPTIONS" });
    const res = await handleRequest(req, { corsOrigin: "https://dashboard.example.com" });

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://dashboard.example.com");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
  });
});

describe("createApiServer", () => {
  test("exports createApiServer function", async () => {
    const mod = await import("../src/api/server.js");
    expect(typeof mod.createApiServer).toBe("function");
    expect(typeof mod.handleRequest).toBe("function");
  });
});

describe("CLI api dispatch", () => {
  test("api command prints success envelope with port", async () => {
    mockQuerySingle.mockResolvedValue(null);
    mockQuery.mockResolvedValue([]);

    // Mock Bun.serve to not actually start a server
    const mockServer = { stop: () => {}, port: 8787, hostname: "localhost" };
    mock.module("bun", () => ({
      serve: () => mockServer,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "api", "--port", "8787"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("api");
    expect(output.data.port).toBe(8787);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("api --help appears in help text", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const mod = await import("../src/cli.js");
    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy.mock.calls[0][0]).toContain("api");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
