import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { saveLocalConfig } from "../src/cloudflare/config.js";
import { publishToKv } from "../src/cloudflare/publish.js";
import type { PortfolioSnapshot } from "../src/cloudflare/types.js";

const snapshot: PortfolioSnapshot = {
  portfolio_value_usd: 12345.67,
  today: { abs: 12.34, pct: 0.56 },
  total: { abs: 45.67, pct: 1.23 },
  history: [{ date: "2026-05-31", value: 12345.67 }],
  prices_as_of: "2026-05-31",
  as_of_date: "2026-05-31",
  updatedAt: "2026-05-31T00:00:00.000Z",
};

describe("publishToKv key resolution", () => {
  let envBackup: Record<string, string | undefined>;
  let tmpDir: string;
  let apiCalls: Array<{ key: string }>;
  let spawnCalls: string[][];

  const buildSnapshotMock = mock(async () => snapshot);

  beforeEach(() => {
    envBackup = { ...process.env };
    tmpDir = mkdtempSync(join(tmpdir(), "publish-kv-key-"));
    apiCalls = [];
    spawnCalls = [];

    saveLocalConfig(
      {
        account_id: "abcdef1234567890abcdef1234567890",
        kv_namespace_id: "kv-namespace-12345",
        wrangler_project_name: "portfolio-widget",
        initialized_at: "2026-05-31T00:00:00.000Z",
      },
      tmpDir,
    );

    buildSnapshotMock.mockClear();
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.PORTFOLIO_KV_KEY;
  });

  afterEach(() => {
    process.env = envBackup;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("uses PORTFOLIO_KV_KEY for the REST API path and falls back to portfolio when unset", async () => {
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
    process.env.PORTFOLIO_KV_KEY = "prod-portfolio";

    const prodResult = await publishToKv(tmpDir, {
      buildSnapshot: buildSnapshotMock,
      putKvValueViaApi: apiPublishMock,
      spawnWrangler: spawnWranglerMock,
    });

    expect(prodResult.success).toBe(true);
    expect(prodResult.key).toBe("prod-portfolio");
    expect(apiPublishMock).toHaveBeenCalledTimes(1);
    expect(spawnWranglerMock).not.toHaveBeenCalled();
    expect(apiCalls[0].key).toBe("prod-portfolio");

    apiPublishMock.mockClear();
    spawnWranglerMock.mockClear();
    apiCalls = [];
    spawnCalls = [];
    delete process.env.PORTFOLIO_KV_KEY;

    const defaultResult = await publishToKv(tmpDir, {
      buildSnapshot: buildSnapshotMock,
      putKvValueViaApi: apiPublishMock,
      spawnWrangler: spawnWranglerMock,
    });

    expect(defaultResult.success).toBe(true);
    expect(defaultResult.key).toBe("portfolio");
    expect(apiPublishMock).toHaveBeenCalledTimes(1);
    expect(spawnWranglerMock).not.toHaveBeenCalled();
    expect(apiCalls[0].key).toBe("portfolio");
  });

  test("uses PORTFOLIO_KV_KEY for the wrangler path and falls back to portfolio when unset", async () => {
    const apiPublishMock = mock(async (input: { key: string }) => {
      apiCalls.push(input);
      return { ok: true as const };
    });
    const spawnWranglerMock = mock((args: string[]) => {
      spawnCalls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    delete process.env.CLOUDFLARE_API_TOKEN;
    process.env.PORTFOLIO_KV_KEY = "prod-portfolio";

    const prodResult = await publishToKv(tmpDir, {
      buildSnapshot: buildSnapshotMock,
      putKvValueViaApi: apiPublishMock,
      spawnWrangler: spawnWranglerMock,
    });

    expect(prodResult.success).toBe(true);
    expect(prodResult.key).toBe("prod-portfolio");
    expect(spawnWranglerMock).toHaveBeenCalledTimes(1);
    expect(apiPublishMock).not.toHaveBeenCalled();
    expect(spawnCalls[0][3]).toBe("prod-portfolio");

    apiPublishMock.mockClear();
    spawnWranglerMock.mockClear();
    apiCalls = [];
    spawnCalls = [];
    delete process.env.PORTFOLIO_KV_KEY;

    const defaultResult = await publishToKv(tmpDir, {
      buildSnapshot: buildSnapshotMock,
      putKvValueViaApi: apiPublishMock,
      spawnWrangler: spawnWranglerMock,
    });

    expect(defaultResult.success).toBe(true);
    expect(defaultResult.key).toBe("portfolio");
    expect(spawnWranglerMock).toHaveBeenCalledTimes(1);
    expect(apiPublishMock).not.toHaveBeenCalled();
    expect(spawnCalls[0][3]).toBe("portfolio");
  });
});
