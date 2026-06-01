import { describe, expect, test } from "bun:test";
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
});
