import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";

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
      snapshot: { projectRoot },
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
        snapshot: { projectRoot?: string };
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
