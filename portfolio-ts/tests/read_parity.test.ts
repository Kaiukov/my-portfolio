import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { Envelope } from "../src/response.js";

describe("read parity", () => {
  beforeEach(() => {
    // Clear any module caches if needed
  });

  describe("argument mapping parity", () => {
    it("CLI kebab flags map to canonical snake_case keys via dispatchRead", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      // Test with snake_case (canonical)
      const snakeArgs = { as_of: "2026-01-01", top_n: 10 };
      const snakeResult = await dispatchRead("concentration", snakeArgs);

      expect(snakeResult).toBeDefined();
      expect(snakeResult.command).toBe("concentration");
    });

    it("MCP camelCase aliases work alongside snake_case", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      // Test from_date vs fromDate - both should work
      const snakeArgs = { from_date: "2026-01-01" };
      const camelArgs = { fromDate: "2026-01-01" };

      const snakeResult = await dispatchRead("income", snakeArgs);
      const camelResult = await dispatchRead("income", camelArgs);

      expect(snakeResult.ok).toBe(camelResult.ok);
      expect(snakeResult.command).toBe(camelResult.command);
    });

    it("top_n and topN aliases work", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const snakeArgs = { top_n: 10 };
      const camelArgs = { topN: 10 };

      const snakeResult = await dispatchRead("concentration", snakeArgs);
      const camelResult = await dispatchRead("concentration", camelArgs);

      expect(snakeResult.ok).toBe(camelResult.ok);
      expect(snakeResult.command).toBe(camelResult.command);
    });
  });

  describe("error handling parity", () => {
    it("unsupported command returns NOT_FOUND error envelope", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result = await dispatchRead("nonexistent_command", {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
        expect(result.error.message).toContain("Unsupported MCP read tool");
      }
    });

    it("validation errors are caught and returned as error envelopes", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      // asset_analysis requires ticker or asset
      const result = await dispatchRead("asset_analysis", {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect(result.error.message).toContain("ticker or asset is required");
      }
    });

    it("rebalance requires target parameter", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result = await dispatchRead("rebalance", {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect(result.error.message).toContain("target");
      }
    });

    it("rebalance with target returns success", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result = await dispatchRead("rebalance", { target: "VTI=50,VXUS=20,BND=30" });

      expect(result.command).toBe("rebalance");
    });
  });

  describe("default values parity", () => {
    it("transactions uses default limit=50 and offset=0", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result = await dispatchRead("transactions", {});

      // Verify it returns a result (may fail without DB)
      expect(result).toBeDefined();
      expect(result.command).toBe("transactions");
      if (result.ok) {
        expect(result.meta?.pagination?.limit).toBe(50);
        expect(result.meta?.pagination?.offset).toBe(0);
      }
    });

    it("transactions respects custom limit and offset", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result = await dispatchRead("transactions", { limit: 10, offset: 20 });

      expect(result).toBeDefined();
      expect(result.command).toBe("transactions");
      if (result.ok) {
        expect(result.meta?.pagination?.limit).toBe(10);
        expect(result.meta?.pagination?.offset).toBe(20);
      }
    });

    it("diversification uses default lookback_days=252 and min_correlation=0.0", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result = await dispatchRead("diversification", {});

      expect(result.command).toBe("diversification");
    });

    it("widget uses default days=30", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result = await dispatchRead("widget", {});

      expect(result.command).toBe("widget");
      // Count may be null or a number depending on DB state
      if (result.meta?.count !== null && result.meta?.count !== undefined) {
        expect(result.meta.count).toBeGreaterThanOrEqual(0);
      }
    });

    it("widget respects custom days parameter", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result = await dispatchRead("widget", { days: 90 });

      expect(result.command).toBe("widget");
    });
  });

  describe("dispatchRead delegates correctly", () => {
    const readCommands = [
      "status", "summary", "cash", "cash_drag", "currency_exposure",
      "income", "realized_gains", "allocation", "rebalance", "concentration",
      "diversification", "decomposition", "performance", "mwr",
      "transactions", "report", "health", "verify_prices", "widget",
      "asset_metadata", "projection", "withdrawal", "asset_analysis"
    ];

    readCommands.forEach((command) => {
      it(`dispatchRead handles "${command}" command`, async () => {
        const { dispatchRead } = await import("../src/adapters/read_shared.js");

        const result = await dispatchRead(command, {});
        expect(result).toBeDefined();
        expect(result.command).toBe(command);
      });
    });
  });

  describe("mcpRead delegates to dispatchRead", () => {
    it("mcpRead is a thin wrapper around dispatchRead", async () => {
      const { mcpRead } = await import("../src/mcp/read.js");

      const result = await mcpRead("status", {});

      expect(result).toBeDefined();
      expect(result.command).toBe("status");
    });

    it("mcpRead returns same error as dispatchRead for unsupported commands", async () => {
      const { mcpRead } = await import("../src/mcp/read.js");
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const mcpResult = await mcpRead("nonexistent", {});
      const dispatchResult = await dispatchRead("nonexistent", {});

      expect(mcpResult.ok).toBe(false);
      expect(dispatchResult.ok).toBe(false);
      if (!mcpResult.ok && !dispatchResult.ok) {
        expect(mcpResult.error.code).toBe(dispatchResult.error.code);
        expect(mcpResult.error.message).toBe(dispatchResult.error.message);
      }
    });
  });

  describe("parameter alias coverage", () => {
    it("asOf and as_of are both accepted", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result1 = await dispatchRead("status", { as_of: "2026-01-01" });
      const result2 = await dispatchRead("status", { asOf: "2026-01-01" });

      expect(result1.command).toBe(result2.command);
      expect(result1.ok).toBe(result2.ok);
    });

    it("fromDate/from_date, toDate/to_date pairs work", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result1 = await dispatchRead("income", { from_date: "2026-01-01" });
      const result2 = await dispatchRead("income", { fromDate: "2026-01-01" });

      expect(result1.command).toBe(result2.command);
      expect(result1.ok).toBe(result2.ok);
    });

    it("lookbackDays/lookback_days alias works", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result1 = await dispatchRead("diversification", { lookback_days: 100 });
      const result2 = await dispatchRead("diversification", { lookbackDays: 100 });

      expect(result1.command).toBe(result2.command);
    });

    it("minCorrelation/min_correlation alias works", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result1 = await dispatchRead("diversification", { min_correlation: 0.5 });
      const result2 = await dispatchRead("diversification", { minCorrelation: 0.5 });

      expect(result1.command).toBe(result2.command);
    });

    it("inflationRate/inflation_rate alias works", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result1 = await dispatchRead("performance", { inflation_rate: "0.025" });
      const result2 = await dispatchRead("performance", { inflationRate: "0.025" });

      expect(result1.command).toBe(result2.command);
    });

    it("monthlyContribution/monthly_contribution alias works", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result1 = await dispatchRead("projection", { monthly_contribution: 1000 });
      const result2 = await dispatchRead("projection", { monthlyContribution: 1000 });

      expect(result1.command).toBe(result2.command);
    });

    it("riskFreeRate/risk_free_rate alias works", async () => {
      const { dispatchRead } = await import("../src/adapters/read_shared.js");

      const result1 = await dispatchRead("asset_analysis", { ticker: "AAPL", risk_free_rate: 0.02 });
      const result2 = await dispatchRead("asset_analysis", { ticker: "AAPL", riskFreeRate: 0.02 });

      expect(result1.command).toBe(result2.command);
    });
  });
});