import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import type { PortfolioSnapshot } from "../src/cloudflare/types.js";
import type { DashboardSnapshot } from "../src/commands/dashboard.js";

mock.module("../src/api/server.js", () => ({
  createApiServer: () => ({
    stop: () => {},
  }),
}));

mock.module("../src/db.js", () => ({
  query: mock(() => Promise.resolve([])),
  querySingle: mock(() => Promise.resolve(null)),
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  connect: () => {},
  close: async () => {},
  getSql: () => ({
    unsafe: async () => [],
  }),
}));

mock.module("../src/tx.js", () => ({
  runTx: async <T>(
    fn: (tx: { unsafe: (...args: unknown[]) => unknown }) => Promise<T>,
  ): Promise<T> => fn({ unsafe: async () => [] }),
  beginTx: mock(() => Promise.resolve({})),
  commit: mock(() => Promise.resolve()),
  rollback: mock(() => Promise.resolve()),
}));

const TRACKED_ENV_VARS = [
  "PORTFOLIO_DB_URL",
  "PORTFOLIO_S3_ENDPOINT",
  "PORTFOLIO_S3_BUCKET",
  "PORTFOLIO_S3_ACCESS_KEY_ID",
  "PORTFOLIO_S3_SECRET_ACCESS_KEY",
  "PORTFOLIO_S3_REGION",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_REGION",
];

let originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalEnv = {};
  for (const key of TRACKED_ENV_VARS) {
    originalEnv[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of TRACKED_ENV_VARS) {
    delete process.env[key];
    if (originalEnv[key] !== undefined) {
      process.env[key] = originalEnv[key];
    }
  }
});

describe("service job wrappers", () => {
  const widgetSnapshot: PortfolioSnapshot = {
    portfolio_value_usd: 1000,
    today: { abs: 10, pct: 1 },
    total: { abs: 100, pct: 10 },
    history: [{ date: "2026-06-05", value: 1000 }],
    prices_as_of: "2026-06-05",
    as_of_date: "2026-06-05",
    updatedAt: "2026-06-05T12:00:00.000Z",
  };

  const dashboardSnapshot: DashboardSnapshot = {
    summary: {
      holding_count: 1,
      total_cash_usd: 1000,
      portfolio_value_usd: 1000,
      last_transaction_date: "2026-06-05",
      transaction_count: 1,
      as_of_date: "2026-06-05",
    },
    status: {
      transactions: 1,
      start_date: "2026-06-05",
      end_date: "2026-06-05",
      portfolio_value: 1000,
      total_invested: 900,
      deposits: 900,
      withdrawals: 0,
      income: 0,
      fees: 0,
      taxes: 0,
      total_gain: 100,
      total_gain_pct: 10,
      cost_basis: 900,
      realized_gain: 0,
      unrealized_gain: 100,
      total_profit: 100,
      as_of_date: "2026-06-05",
    },
    allocation_rows: [],
    cash_rows: [],
    performance: {} as DashboardSnapshot["performance"],
    today: { abs: 10, pct: 1 },
    total: { abs: 100, pct: 10 },
    history: [{ date: "2026-06-05", value: 1000 }],
    prices_as_of: "2026-06-05",
    updatedAt: "2026-06-05T12:00:00.000Z",
  };

  test("runRefreshJob returns ok:true on success", async () => {
    const refreshPortfolio = mock(async () => ({
      refreshed: { status: "ok" },
      recalculated: true,
      summary: { portfolio_value_usd: 1 },
    }));

    const { runRefreshJob } = await import("../src/service.js");
    const result = await runRefreshJob({ refreshPortfolio });

    expect(result.ok).toBe(true);
    expect(refreshPortfolio).toHaveBeenCalledTimes(1);
    if (result.ok) {
      const data = result.data as {
        refreshed: { status: string };
        recalculated: boolean;
        summary: { portfolio_value_usd: number };
      };
      expect(result.job).toBe("refresh");
      expect(data.recalculated).toBe(true);
      expect(data.summary.portfolio_value_usd).toBe(1);
    }
  });

  test("runRefreshJob returns ok:false when the underlying job throws", async () => {
    const refreshPortfolio = mock(async () => {
      throw new Error("refresh failed");
    });

    const { runRefreshJob } = await import("../src/service.js");
    const result = await runRefreshJob({ refreshPortfolio });

    expect(result.ok).toBe(false);
    expect(refreshPortfolio).toHaveBeenCalledTimes(1);
    if (!result.ok) {
      expect(result.job).toBe("refresh");
      expect(result.error).toContain("refresh failed");
    }
  });

  test("runCloudflarePublishJob returns ok:true on success", async () => {
    const publishToKv = mock(async (projectRoot?: string) => ({
      success: true,
      key: "portfolio",
      namespaceId: "namespace-1",
      snapshot: {
        ...widgetSnapshot,
        history: [{ date: "2026-06-05", value: projectRoot ? 1 : 0 }],
      },
    }));

    const { runCloudflarePublishJob } = await import("../src/service.js");
    const result = await runCloudflarePublishJob({ publishToKv, projectRoot: "/app" });

    expect(result.ok).toBe(true);
    expect(publishToKv).toHaveBeenCalledTimes(1);
    if (result.ok) {
      const data = result.data as {
        success: boolean;
        key: string;
        namespaceId: string;
        snapshot: PortfolioSnapshot;
      };
      expect(result.job).toBe("cloudflare_publish");
      expect(data.success).toBe(true);
      expect(data.namespaceId).toBe("namespace-1");
    }
  });

  test("runCloudflarePublishJob returns ok:false when the underlying job throws", async () => {
    const publishToKv = mock(async () => {
      throw new Error("publish failed");
    });

    const { runCloudflarePublishJob } = await import("../src/service.js");
    const result = await runCloudflarePublishJob({ publishToKv, projectRoot: "/app" });

    expect(result.ok).toBe(false);
    expect(publishToKv).toHaveBeenCalledTimes(1);
    if (!result.ok) {
      expect(result.job).toBe("cloudflare_publish");
      expect(result.error).toContain("publish failed");
    }
  });

  test("runCombinedCloudflarePublishJob publishes widget and dashboard from one shared context", async () => {
    const context = {
      asOfDate: "2026-06-03",
      updatedAt: "2026-06-03T12:34:56.000Z",
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
      },
      widget: {
        title: "My holdings",
        currency: "USD",
        as_of_date: "2026-06-03",
        last_refresh: "2026-06-03",
        value: 42500.12,
        today: { amount: 125.5, pct: 0.296 },
        total: { amount: 4500.12, pct: 11.84 },
        series: [
          { date: "2026-06-02", value: 42374.62 },
          { date: "2026-06-03", value: 42500.12 },
        ],
      },
      freshness: {
        prices_as_of: "2026-06-03",
        price_age_days: 0,
        stale: false,
        needs_recalc: false,
      },
    };
    const publishToKv = mock(
      async (
        _projectRoot?: string,
        deps?: { buildSnapshot?: () => Promise<PortfolioSnapshot> },
      ) => ({
        success: true,
        key: "portfolio",
        namespaceId: "ns-1",
        snapshot: deps ? (await deps.buildSnapshot?.()) ?? null : null,
      }),
    );
    const publishDashboardToKv = mock(
      async (
        _projectRoot?: string,
        deps?: { buildSnapshot?: () => Promise<DashboardSnapshot> },
      ) => ({
        success: true,
        key: "dashboard",
        namespaceId: "ns-1",
        snapshot: deps ? (await deps.buildSnapshot?.()) ?? null : null,
      }),
    );

    const { runCombinedCloudflarePublishJob } = await import("../src/service.js");
    const result = await runCombinedCloudflarePublishJob({
      projectRoot: "/app",
      buildPublishSnapshotContext: async () => context,
      publishToKv,
      publishDashboardToKv,
    });

    expect(result.ok).toBe(true);
    expect(publishToKv).toHaveBeenCalledTimes(1);
    expect(publishDashboardToKv).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.job).toBe("cloudflare_publish_cycle");
      const data = result.data as {
        as_of_date: string;
        updatedAt: string;
        cloudflare_publish: { snapshot: PortfolioSnapshot };
        dashboard_publish: { snapshot: DashboardSnapshot };
      };
      expect(data.as_of_date).toBe("2026-06-03");
      expect(data.updatedAt).toBe("2026-06-03T12:34:56.000Z");
      expect(data.cloudflare_publish.snapshot.updatedAt).toBe(
        "2026-06-03T12:34:56.000Z",
      );
      expect(data.dashboard_publish.snapshot.updatedAt).toBe(
        "2026-06-03T12:34:56.000Z",
      );
      expect(data.cloudflare_publish.snapshot.as_of_date).toBe("2026-06-03");
      expect(data.dashboard_publish.snapshot.summary.as_of_date).toBe(
        "2026-06-03",
      );
    }
  });

  test("runCombinedCloudflarePublishJob fails when one publish result is unsuccessful", async () => {
    const context = {
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
        series: [{ date: "2026-06-03", value: 1000 }],
      },
      freshness: {
        prices_as_of: "2026-06-03",
        price_age_days: 0,
        stale: false,
        needs_recalc: false,
      },
    };
    const publishToKv = mock(async () => ({
      success: false,
      key: "portfolio",
      namespaceId: "ns-1",
      snapshot: null,
      error: "Validation failed",
    }));
    const publishDashboardToKv = mock(async () => ({
      success: true,
      key: "dashboard",
      namespaceId: "ns-1",
      snapshot: null,
    }));

    const { runCombinedCloudflarePublishJob } = await import("../src/service.js");
    const result = await runCombinedCloudflarePublishJob({
      projectRoot: "/app",
      buildPublishSnapshotContext: async () => context,
      publishToKv,
      publishDashboardToKv,
    });

    expect(result.ok).toBe(false);
    expect(publishToKv).toHaveBeenCalledTimes(1);
    expect(publishDashboardToKv).toHaveBeenCalledTimes(1);
    if (!result.ok) {
      expect(result.job).toBe("cloudflare_publish_cycle");
      expect(result.error).toContain("cloudflare_publish failed: Validation failed");
    }
  });

  test("startPortfolioService schedules one combined publish job when both publish modes are enabled", async () => {
    const { startPortfolioService } = await import("../src/service.js");
    const service = await startPortfolioService({
      port: 8787,
      refreshIntervalMs: 60_000,
      publishEnabled: true,
      publishIntervalMs: 300_000,
      dashboardPublishEnabled: true,
      dashboardPublishIntervalMs: 300_000,
      backupEnabled: false,
      backupIntervalMs: 86_400_000,
      initOnBoot: false,
      projectRoot: "/app",
    });

    expect(service.scheduler.jobs.map((job) => job.name)).toEqual([
      "refresh",
      "cloudflare_publish_cycle",
    ]);

    await service.stop();
  });

  test("runBackupJob returns ok:true when the injected push succeeds", async () => {
    process.env.PORTFOLIO_DB_URL = "postgresql://localhost/portfolio";

    const loadS3Config = mock(() => ({
      ok: true as const,
      config: {
        endpoint: "https://r2.example.com",
        bucket: "backup-bucket",
        accessKeyId: "key-123",
        secretAccessKey: "secret-123",
        region: "auto",
      },
    }));
    const destroy = mock(() => {});
    const createS3Client = mock(() => ({ destroy }));
    const pushBackupToS3 = mock(async (_client: unknown, bucket: string, dbUrl: string) => ({
      bucket,
      dump_path: "/tmp/portfolio.backup.sql",
      dump_size_bytes: 123,
      objects: ["portfolio.backup.sql", "latest.sql"],
      snapshot: { dbUrl },
    }));

    const { runBackupJob } = await import("../src/service.js");
    const result = await runBackupJob({
      loadS3Config,
      createS3Client,
      pushBackupToS3,
    });

    expect(result.ok).toBe(true);
    expect(loadS3Config).toHaveBeenCalledTimes(1);
    expect(createS3Client).toHaveBeenCalledTimes(1);
    expect(pushBackupToS3).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.job).toBe("backup");
      const data = result.data as {
        bucket: string;
        dump_path: string;
        dump_size_bytes: number;
        objects: string[];
        snapshot: { dbUrl: string };
      };
      expect(data.bucket).toBe("backup-bucket");
      expect(data.objects).toEqual(["portfolio.backup.sql", "latest.sql"]);
      expect(data.snapshot.dbUrl).toBe("postgresql://localhost/portfolio");
    }
  });

  test("runBackupJob returns ok:false when S3 config is missing", async () => {
    delete process.env.PORTFOLIO_DB_URL;
    delete process.env.PORTFOLIO_S3_ENDPOINT;
    delete process.env.PORTFOLIO_S3_BUCKET;
    delete process.env.PORTFOLIO_S3_ACCESS_KEY_ID;
    delete process.env.PORTFOLIO_S3_SECRET_ACCESS_KEY;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;

    const { runBackupJob } = await import("../src/service.js");
    const result = await runBackupJob();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.job).toBe("backup");
      expect(result.error).toContain("Missing S3 configuration");
    }
  });

  test("runBackupJob returns ok:false when PORTFOLIO_DB_URL is unset", async () => {
    delete process.env.PORTFOLIO_DB_URL;

    const loadS3Config = mock(() => ({
      ok: true as const,
      config: {
        endpoint: "https://r2.example.com",
        bucket: "backup-bucket",
        accessKeyId: "key-123",
        secretAccessKey: "secret-123",
        region: "auto",
      },
    }));
    const createS3Client = mock(() => ({ destroy: mock(() => {}) }));
    const pushBackupToS3 = mock(async () => ({
      bucket: "backup-bucket",
      dump_path: "/tmp/portfolio.backup.sql",
      dump_size_bytes: 123,
      objects: ["portfolio.backup.sql", "latest.sql"],
    }));

    const { runBackupJob } = await import("../src/service.js");
    const result = await runBackupJob({
      loadS3Config,
      createS3Client,
      pushBackupToS3,
    });

    expect(result.ok).toBe(false);
    expect(loadS3Config).toHaveBeenCalledTimes(1);
    expect(createS3Client).not.toHaveBeenCalled();
    expect(pushBackupToS3).not.toHaveBeenCalled();
    if (!result.ok) {
      expect(result.job).toBe("backup");
      expect(result.error).toBe("PORTFOLIO_DB_URL is not set");
    }
  });

  test("runBackupJob returns ok:false when the push throws", async () => {
    process.env.PORTFOLIO_DB_URL = "postgresql://localhost/portfolio";

    const loadS3Config = mock(() => ({
      ok: true as const,
      config: {
        endpoint: "https://r2.example.com",
        bucket: "backup-bucket",
        accessKeyId: "key-123",
        secretAccessKey: "secret-123",
        region: "auto",
      },
    }));
    const destroy = mock(() => {});
    const createS3Client = mock(() => ({ destroy }));
    const pushBackupToS3 = mock(async () => {
      throw new Error("backup failed");
    });

    const { runBackupJob } = await import("../src/service.js");
    const result = await runBackupJob({
      loadS3Config,
      createS3Client,
      pushBackupToS3,
    });

    expect(result.ok).toBe(false);
    expect(loadS3Config).toHaveBeenCalledTimes(1);
    expect(createS3Client).toHaveBeenCalledTimes(1);
    expect(pushBackupToS3).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    if (!result.ok) {
      expect(result.job).toBe("backup");
      expect(result.error).toContain("backup failed");
    }
  });
});
