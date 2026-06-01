import { describe, expect, test, mock } from "bun:test";

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
});
