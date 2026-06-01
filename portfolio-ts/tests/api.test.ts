import { describe, expect, test, mock, jest } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

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
    mockQuerySingle.mockResolvedValue({
      holding_count: 5,
      total_cash_usd: 5000,
      portfolio_value_usd: 25000,
      last_transaction_date: "2026-01-15",
      transaction_count: 42,
      as_of_date: "2026-01-15",
    });
    mockQuery.mockResolvedValue([]);

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
    mockQuerySingle.mockResolvedValue(makeStatusRow());
    mockQuery.mockResolvedValue([]);

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
    mockQuery.mockResolvedValue([
      { asset: "AAPL", asset_type: "stock", asset_kind: "equity", net_quantity: 10, value_usd: 1500, allocation_pct: 15 },
      { asset: "GOOGL", asset_type: "stock", asset_kind: "equity", net_quantity: 5, value_usd: 8500, allocation_pct: 85 },
    ]);

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
    mockQuery.mockResolvedValue([
      { cash_key: "USD:default", currency: "USD", display_bucket: "USD", balance: 5000, usd_value: 5000 },
    ]);

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
    mockQuery.mockResolvedValue([{
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

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/performance?as_of=2026-01-01&benchmark=SPY&period=1y");
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("performance");
    expect(body.data.time_weighted_return_pct).toBe(25);
    expect(body.data.sharpe_ratio).toBe(1.5);
  });

  test("GET /mwr returns 200 with success envelope", async () => {
    mockQuerySingle.mockResolvedValue({ mwr: 0.15 });

    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/mwr?as_of=2026-01-01");
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("mwr");
    expect(body.data.mwr_pct).toBe(15);
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
    const res = await handleRequest(req);

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
    const res = await handleRequest(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).toBe("verify_prices");
    expect(body.data.total_rows).toBe(1000);
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

  test("POST returns 405 error envelope", async () => {
    const { handleRequest } = await import("../src/api/server.js");
    const req = new Request("http://localhost/summary", { method: "POST" });
    const res = await handleRequest(req);

    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
    expect(body.error.message).toContain("POST");
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
    mockQuerySingle.mockResolvedValue({
      holding_count: 0,
      total_cash_usd: 0,
      portfolio_value_usd: 0,
      last_transaction_date: null,
      transaction_count: 0,
      as_of_date: "2026-06-01",
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
