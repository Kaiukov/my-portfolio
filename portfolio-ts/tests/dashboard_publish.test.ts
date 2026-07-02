import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { APP_VERSION } from "../src/version.js";

import { saveLocalConfig } from "../src/cloudflare/config.js";
import type { DashboardSnapshot } from "../src/commands/dashboard.js";

const snapshot: DashboardSnapshot = {
  summary: {
    holding_count: 5,
    total_cash_usd: 2500.75,
    portfolio_value_usd: 42500.12,
    last_transaction_date: "2026-06-01",
    transaction_count: 42,
    as_of_date: "2026-06-03",
  },
  status: {
    transactions: 42,
    start_date: "2025-01-15",
    end_date: "2026-06-03",
    portfolio_value: 42500.12,
    total_invested: 38000.0,
    deposits: 40000.0,
    withdrawals: 2000.0,
    income: 500.0,
    fees: 75.0,
    taxes: 25.0,
    total_gain: 4500.12,
    total_gain_pct: 11.84,
    cost_basis: 38000.0,
    realized_gain: 1200.0,
    unrealized_gain: 3300.12,
    total_profit: 4500.12,
    as_of_date: "2026-06-03",
  },
  allocation_rows: [
    { asset: "AAPL", asset_type: "stock", asset_kind: "equity", net_quantity: 50, value_usd: 9750.0, allocation_pct: 24.375, sector: "Technology" },
  ],
  cash_rows: [
    { cash_key: "usd", currency: "USD", display_bucket: "USD Cash", balance: 2500.75, usd_value: 2500.75 },
  ],
  performance: {} as DashboardSnapshot["performance"],
  today: { abs: 125.5, pct: 0.296 },
  total: { abs: 4500.12, pct: 11.84 },
  history: [{ date: "2026-06-03", value: 42500.12 }],
  prices_as_of: "2026-06-03",
  version: APP_VERSION,
  updatedAt: "2026-06-03T00:00:00.000Z",
};

describe("publishDashboardToKv key resolution", () => {
  let envBackup: Record<string, string | undefined>;
  let tmpDir: string;
  let apiCalls: Array<{ key: string }>;
  let spawnCalls: string[][];

  const buildSnapshotMock = mock(async () => snapshot);

  beforeEach(() => {
    envBackup = { ...process.env };
    tmpDir = mkdtempSync(join(tmpdir(), "publish-dashboard-kv-"));
    apiCalls = [];
    spawnCalls = [];

    saveLocalConfig(
      {
        account_id: "abcdef1234567890abcdef1234567890",
        kv_namespace_id: "kv-namespace-12345",
        wrangler_project_name: "portfolio-widget",
        initialized_at: "2026-06-03T00:00:00.000Z",
      },
      tmpDir,
    );

    buildSnapshotMock.mockClear();
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.PORTFOLIO_DASHBOARD_KV_KEY;
  });

  afterEach(() => {
    process.env = envBackup;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("uses PORTFOLIO_DASHBOARD_KV_KEY for the REST API path and falls back to dashboard when unset", async () => {
    const apiPublishMock = mock(async (input: { key: string }) => {
      apiCalls.push(input);
      return { ok: true as const };
    });
    const spawnWranglerMock = mock((args: string[]) => {
      spawnCalls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    process.env.CLOUDFLARE_API_TOKEN = "api-token-123";
    process.env.CLOUDFLARE_ACCOUNT_ID = "abcdef1234567890abcdef1234567890";
    process.env.PORTFOLIO_DASHBOARD_KV_KEY = "prod-dashboard";

    const { publishDashboardToKv } = await import("../src/cloudflare/dashboard_publish.js");

    const prodResult = await publishDashboardToKv(tmpDir, {
      buildSnapshot: buildSnapshotMock,
      putKvValueViaApi: apiPublishMock,
      spawnWrangler: spawnWranglerMock,
    });

    expect(prodResult.success).toBe(true);
    expect(prodResult.key).toBe("prod-dashboard");
    expect(apiPublishMock).toHaveBeenCalledTimes(1);
    expect(spawnWranglerMock).not.toHaveBeenCalled();
    expect(apiCalls[0].key).toBe("prod-dashboard");

    apiPublishMock.mockClear();
    spawnWranglerMock.mockClear();
    apiCalls = [];
    spawnCalls = [];
    delete process.env.PORTFOLIO_DASHBOARD_KV_KEY;

    const { publishDashboardToKv: publishDashboardToKv2 } = await import("../src/cloudflare/dashboard_publish.js");

    const defaultResult = await publishDashboardToKv2(tmpDir, {
      buildSnapshot: buildSnapshotMock,
      putKvValueViaApi: apiPublishMock,
      spawnWrangler: spawnWranglerMock,
    });

    expect(defaultResult.success).toBe(true);
    expect(defaultResult.key).toBe("dashboard");
    expect(apiPublishMock).toHaveBeenCalledTimes(1);
    expect(spawnWranglerMock).not.toHaveBeenCalled();
    expect(apiCalls[0].key).toBe("dashboard");
  });

  test("uses PORTFOLIO_DASHBOARD_KV_KEY for the wrangler path and falls back to dashboard when unset", async () => {
    const apiPublishMock = mock(async (input: { key: string }) => {
      apiCalls.push(input);
      return { ok: true as const };
    });
    const spawnWranglerMock = mock((args: string[]) => {
      spawnCalls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    delete process.env.CLOUDFLARE_API_TOKEN;
    process.env.PORTFOLIO_DASHBOARD_KV_KEY = "prod-dashboard";

    const { publishDashboardToKv } = await import("../src/cloudflare/dashboard_publish.js");

    const prodResult = await publishDashboardToKv(tmpDir, {
      buildSnapshot: buildSnapshotMock,
      putKvValueViaApi: apiPublishMock,
      spawnWrangler: spawnWranglerMock,
    });

    expect(prodResult.success).toBe(true);
    expect(prodResult.key).toBe("prod-dashboard");
    expect(spawnWranglerMock).toHaveBeenCalledTimes(1);
    expect(apiPublishMock).not.toHaveBeenCalled();
    expect(spawnCalls[0][3]).toBe("prod-dashboard");

    apiPublishMock.mockClear();
    spawnWranglerMock.mockClear();
    apiCalls = [];
    spawnCalls = [];
    delete process.env.PORTFOLIO_DASHBOARD_KV_KEY;

    const { publishDashboardToKv: publishDashboardToKv2 } = await import("../src/cloudflare/dashboard_publish.js");

    const defaultResult = await publishDashboardToKv2(tmpDir, {
      buildSnapshot: buildSnapshotMock,
      putKvValueViaApi: apiPublishMock,
      spawnWrangler: spawnWranglerMock,
    });

    expect(defaultResult.success).toBe(true);
    expect(defaultResult.key).toBe("dashboard");
    expect(spawnWranglerMock).toHaveBeenCalledTimes(1);
    expect(apiPublishMock).not.toHaveBeenCalled();
    expect(spawnCalls[0][3]).toBe("dashboard");
  });

  test("key is never portfolio", async () => {
    const apiPublishMock = mock(async (input: { key: string }) => {
      apiCalls.push(input);
      return { ok: true as const };
    });
    const spawnWranglerMock = mock((args: string[]) => {
      spawnCalls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    process.env.CLOUDFLARE_API_TOKEN = "api-token-123";
    process.env.CLOUDFLARE_ACCOUNT_ID = "abcdef1234567890abcdef1234567890";
    delete process.env.PORTFOLIO_DASHBOARD_KV_KEY;

    const { publishDashboardToKv } = await import("../src/cloudflare/dashboard_publish.js");

    const result = await publishDashboardToKv(tmpDir, {
      buildSnapshot: buildSnapshotMock,
      putKvValueViaApi: apiPublishMock,
      spawnWrangler: spawnWranglerMock,
    });

    expect(result.success).toBe(true);
    expect(result.key).not.toBe("portfolio");
    expect(result.key).toBe("dashboard");
    expect(apiCalls[0].key).not.toBe("portfolio");
    expect(apiCalls[0].key).toBe("dashboard");
  });
});

describe("validateDashboardSnapshot", () => {
  test("passes a valid snapshot", async () => {
    const { validateDashboardSnapshot } = await import("../src/cloudflare/dashboard_publish.js");
    const err = validateDashboardSnapshot(snapshot);
    expect(err).toBeNull();
  });

  test("fails when summary.portfolio_value_usd is NaN", async () => {
    const { validateDashboardSnapshot } = await import("../src/cloudflare/dashboard_publish.js");
    const bad = { ...snapshot, summary: { ...snapshot.summary, portfolio_value_usd: NaN } };
    const err = validateDashboardSnapshot(bad);
    expect(err).toBe("summary.portfolio_value_usd is missing or NaN");
  });

  test("fails when status is missing", async () => {
    const { validateDashboardSnapshot } = await import("../src/cloudflare/dashboard_publish.js");
    const bad = { ...snapshot, status: null as unknown as DashboardSnapshot["status"] };
    const err = validateDashboardSnapshot(bad);
    expect(err).toBe("status is missing");
  });

  test("fails when allocation_rows is not an array", async () => {
    const { validateDashboardSnapshot } = await import("../src/cloudflare/dashboard_publish.js");
    const bad = { ...snapshot, allocation_rows: null as unknown as DashboardSnapshot["allocation_rows"] };
    const err = validateDashboardSnapshot(bad);
    expect(err).toBe("allocation_rows is missing or not an array");
  });

  test("fails when history is not an array", async () => {
    const { validateDashboardSnapshot } = await import("../src/cloudflare/dashboard_publish.js");
    const bad = { ...snapshot, history: null as unknown as DashboardSnapshot["history"] };
    const err = validateDashboardSnapshot(bad);
    expect(err).toBe("history is missing or not an array");
  });

  test("fails when updatedAt is empty", async () => {
    const { validateDashboardSnapshot } = await import("../src/cloudflare/dashboard_publish.js");
    const bad = { ...snapshot, updatedAt: "" };
    const err = validateDashboardSnapshot(bad);
    expect(err).toBe("updatedAt is missing or empty");
  });
});

describe("publishDashboardToKv — not initialized", () => {
  let envBackup: Record<string, string | undefined>;
  let tmpDir: string;

  beforeEach(() => {
    envBackup = { ...process.env };
    tmpDir = mkdtempSync(join(tmpdir(), "publish-dashboard-no-config-"));
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.PORTFOLIO_DASHBOARD_KV_KEY;
  });

  afterEach(() => {
    process.env = envBackup;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns error when no config exists", async () => {
    const { publishDashboardToKv } = await import("../src/cloudflare/dashboard_publish.js");

    const result = await publishDashboardToKv(tmpDir, {
      buildSnapshot: mock(async () => snapshot),
      putKvValueViaApi: mock(async () => ({ ok: true as const })),
      spawnWrangler: mock(() => ({ stdout: "", stderr: "", exitCode: 0 })),
    });

    expect(result.success).toBe(false);
    expect(result.key).toBe("dashboard");
    expect(result.namespaceId).toBeNull();
    expect(result.snapshot).toBeNull();
    expect(result.error).toContain("Not initialized");
  });
});
