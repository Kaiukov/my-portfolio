import { describe, expect, test, mock } from "bun:test";

mock.module("../src/db.js", () => ({
  query: mock(() => Promise.resolve([])),
  querySingle: mock(() => Promise.resolve(null)),
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  connect: () => {},
  close: () => {},
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

import { readServiceConfig } from "../src/service.js";

describe("readServiceConfig backup settings", () => {
  test("defaults backupEnabled to false and backupIntervalMs to 24h", () => {
    const config = readServiceConfig({} as NodeJS.ProcessEnv, "/app");

    expect(config.backupEnabled).toBe(false);
    expect(config.backupIntervalMs).toBe(86_400_000);
  });

  test('parses PORTFOLIO_BACKUP_ENABLED when set to "true"', () => {
    const config = readServiceConfig(
      {
        PORTFOLIO_BACKUP_ENABLED: "true",
      } as NodeJS.ProcessEnv,
      "/app",
    );

    expect(config.backupEnabled).toBe(true);
  });

  test("parses PORTFOLIO_BACKUP_INTERVAL via parseInterval", () => {
    const config = readServiceConfig(
      {
        PORTFOLIO_BACKUP_INTERVAL: "6h",
      } as NodeJS.ProcessEnv,
      "/app",
    );

    expect(config.backupIntervalMs).toBe(6 * 3600 * 1000);
  });

  test("throws when PORTFOLIO_BACKUP_INTERVAL is zero", () => {
    expect(() =>
      readServiceConfig(
        {
          PORTFOLIO_BACKUP_INTERVAL: "0ms",
        } as NodeJS.ProcessEnv,
        "/app",
      ),
    ).toThrow("PORTFOLIO_BACKUP_INTERVAL must be greater than zero");
  });

  test("throws when widget and dashboard publish intervals differ while both are enabled", () => {
    expect(() =>
      readServiceConfig(
        {
          PORTFOLIO_CLOUDFLARE_PUBLISH: "true",
          PORTFOLIO_DASHBOARD_PUBLISH: "true",
          PORTFOLIO_PUBLISH_INTERVAL: "1h",
          PORTFOLIO_DASHBOARD_PUBLISH_INTERVAL: "30m",
        } as NodeJS.ProcessEnv,
        "/app",
      ),
    ).toThrow(
      "PORTFOLIO_PUBLISH_INTERVAL and PORTFOLIO_DASHBOARD_PUBLISH_INTERVAL must match when both publish jobs are enabled",
    );
  });
});
