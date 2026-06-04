import { describe, expect, test, mock, jest } from "bun:test";
import type { AllocationRow } from "../src/commands/allocation.js";

const mockQuery = mock();
mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mock(),
  connect: () => {},
  close: () => {},
  getAssetMetadata: mock(),
  upsertAssetMetadata: mock(),
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

function makeAllocRow(overrides: Partial<AllocationRow> = {}): AllocationRow {
  return {
    asset: "VTI",
    asset_type: "etf_usd",
    asset_kind: "etf",
    net_quantity: 100,
    value_usd: 25000,
    allocation_pct: 50,
    ...overrides,
  };
}

describe("parseTargetString", () => {
  test("parses valid target string", async () => {
    const { parseTargetString } = await import("../src/commands/rebalance.js");
    const entries = parseTargetString("VTI=50,VXUS=20,BND=30");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ asset: "VTI", target_pct: 50 });
    expect(entries[1]).toEqual({ asset: "VXUS", target_pct: 20 });
    expect(entries[2]).toEqual({ asset: "BND", target_pct: 30 });
  });

  test("normalizes asset symbols to uppercase", async () => {
    const { parseTargetString } = await import("../src/commands/rebalance.js");
    const entries = parseTargetString("vti=50,vxus=20,bnd=30");
    expect(entries[0].asset).toBe("VTI");
    expect(entries[1].asset).toBe("VXUS");
    expect(entries[2].asset).toBe("BND");
  });

  test("accepts decimal percentages", async () => {
    const { parseTargetString } = await import("../src/commands/rebalance.js");
    const entries = parseTargetString("VTI=50.5,VXUS=19.5,BND=30");
    expect(entries).toHaveLength(3);
    expect(entries[0].target_pct).toBe(50.5);
    expect(entries[1].target_pct).toBe(19.5);
    expect(entries[2].target_pct).toBe(30);
  });

  test("rejects empty target string", async () => {
    const { parseTargetString, TARGET_SUM_EPSILON } = await import("../src/commands/rebalance.js");
    expect(() => parseTargetString("")).toThrow("--target must be non-empty");
    expect(() => parseTargetString("  ")).toThrow("--target must be non-empty");
  });

  test("rejects sum != 100", async () => {
    const { parseTargetString } = await import("../src/commands/rebalance.js");
    expect(() => parseTargetString("VTI=50,VXUS=20")).toThrow(/sum to 70%.*expected 100%/);
    expect(() => parseTargetString("VTI=50,VXUS=20,BND=40")).toThrow(/sum to 110%.*expected 100%/);
  });

  test("accepts sum within epsilon of 100", async () => {
    const { parseTargetString } = await import("../src/commands/rebalance.js");
    expect(() => parseTargetString("VTI=50.005,VXUS=49.995")).not.toThrow();
  });

  test("rejects malformed entries", async () => {
    const { parseTargetString } = await import("../src/commands/rebalance.js");
    expect(() => parseTargetString("VTI")).toThrow(/expected ASSET=PCT/);
    expect(() => parseTargetString("=50")).toThrow(/asset symbol is empty/);
    expect(() => parseTargetString("VTI=abc")).toThrow(/percentage must be a number/);
  });

  test("rejects negative percentage", async () => {
    const { parseTargetString } = await import("../src/commands/rebalance.js");
    expect(() => parseTargetString("VTI=-10,BND=110")).toThrow(/percentage must be non-negative/);
  });
});

describe("computeDrift", () => {
  test("computes drift and actions for standard allocation", async () => {
    const { computeDrift, parseTargetString } = await import("../src/commands/rebalance.js");
    const targetEntries = parseTargetString("VTI=50,VXUS=20,BND=30");
    const allocRows = [
      makeAllocRow({ asset: "VTI", value_usd: 30000, allocation_pct: 60 }),
      makeAllocRow({ asset: "VXUS", value_usd: 10000, allocation_pct: 20 }),
      makeAllocRow({ asset: "BND", value_usd: 10000, allocation_pct: 20 }),
    ];
    const totalValue = 50000;

    const result = computeDrift(targetEntries, allocRows, totalValue, "2026-06-01");

    expect(result.as_of_date).toBe("2026-06-01");
    expect(result.total_portfolio_value).toBe(50000);
    expect(result.rows).toHaveLength(3);

    const vti = result.rows.find((r) => r.asset === "VTI")!;
    expect(vti.current_pct).toBe(60);
    expect(vti.target_pct).toBe(50);
    expect(vti.drift_pct).toBe(10);
    expect(vti.current_value_usd).toBe(30000);
    expect(vti.target_value_usd).toBe(25000);
    expect(vti.suggested_delta_usd).toBe(-5000);
    expect(vti.action).toBe("SELL");

    const vxus = result.rows.find((r) => r.asset === "VXUS")!;
    expect(vxus.current_pct).toBe(20);
    expect(vxus.target_pct).toBe(20);
    expect(vxus.drift_pct).toBe(0);
    expect(vxus.suggested_delta_usd).toBe(0);
    expect(vxus.action).toBe("HOLD");

    const bnd = result.rows.find((r) => r.asset === "BND")!;
    expect(bnd.current_pct).toBe(20);
    expect(bnd.target_pct).toBe(30);
    expect(bnd.drift_pct).toBe(-10);
    expect(bnd.target_value_usd).toBe(15000);
    expect(bnd.suggested_delta_usd).toBe(5000);
    expect(bnd.action).toBe("BUY");
  });

  test("handles assets in current but not in target", async () => {
    const { computeDrift, parseTargetString } = await import("../src/commands/rebalance.js");
    const targetEntries = parseTargetString("VTI=100");
    const allocRows = [
      makeAllocRow({ asset: "VTI", value_usd: 40000, allocation_pct: 80 }),
      makeAllocRow({ asset: "GOOGL", value_usd: 10000, allocation_pct: 20 }),
    ];

    const result = computeDrift(targetEntries, allocRows, 50000, "2026-06-01");

    expect(result.rows).toHaveLength(2);
    const googl = result.rows.find((r) => r.asset === "GOOGL")!;
    expect(googl.current_pct).toBe(20);
    expect(googl.target_pct).toBe(0);
    expect(googl.drift_pct).toBe(20);
    expect(googl.suggested_delta_usd).toBe(-10000);
    expect(googl.action).toBe("SELL");
  });

  test("handles assets in target but not in current", async () => {
    const { computeDrift, parseTargetString } = await import("../src/commands/rebalance.js");
    const targetEntries = parseTargetString("VTI=50,BND=50");
    const allocRows = [
      makeAllocRow({ asset: "VTI", value_usd: 50000, allocation_pct: 100 }),
    ];

    const result = computeDrift(targetEntries, allocRows, 50000, "2026-06-01");

    expect(result.rows).toHaveLength(2);
    const bnd = result.rows.find((r) => r.asset === "BND")!;
    expect(bnd.current_pct).toBe(0);
    expect(bnd.target_pct).toBe(50);
    expect(bnd.drift_pct).toBe(-50);
    expect(bnd.current_value_usd).toBe(0);
    expect(bnd.target_value_usd).toBe(25000);
    expect(bnd.suggested_delta_usd).toBe(25000);
    expect(bnd.action).toBe("BUY");
  });

  test("sorts rows by abs(drift_pct) descending", async () => {
    const { computeDrift, parseTargetString } = await import("../src/commands/rebalance.js");
    const targetEntries = parseTargetString("A=10,B=30,C=60");
    const allocRows = [
      makeAllocRow({ asset: "A", allocation_pct: 5, value_usd: 500 }),
      makeAllocRow({ asset: "B", allocation_pct: 60, value_usd: 6000 }),
      makeAllocRow({ asset: "C", allocation_pct: 35, value_usd: 3500 }),
    ];

    const result = computeDrift(targetEntries, allocRows, 10000, "2026-06-01");
    const drifts = result.rows.map((r) => Math.abs(r.drift_pct));
    for (let i = 1; i < drifts.length; i++) {
      expect(drifts[i - 1]).toBeGreaterThanOrEqual(drifts[i]);
    }
  });

  test("computes total_absolute_drift correctly", async () => {
    const { computeDrift, parseTargetString } = await import("../src/commands/rebalance.js");
    const targetEntries = parseTargetString("VTI=100");
    const allocRows = [
      makeAllocRow({ asset: "VTI", allocation_pct: 50, value_usd: 5000 }),
      makeAllocRow({ asset: "BND", allocation_pct: 50, value_usd: 5000 }),
    ];

    const result = computeDrift(targetEntries, allocRows, 10000, "2026-06-01");
    expect(result.total_absolute_drift).toBe(100);
  });

  test("handles empty allocation gracefully", async () => {
    const { computeDrift, parseTargetString } = await import("../src/commands/rebalance.js");
    const targetEntries = parseTargetString("VTI=100");

    const result = computeDrift(targetEntries, [], 0, "2026-06-01");

    expect(result.rows).toHaveLength(1);
    expect(result.total_portfolio_value).toBe(0);
    expect(result.rows[0].current_pct).toBe(0);
    expect(result.rows[0].target_pct).toBe(100);
    expect(result.rows[0].drift_pct).toBe(-100);
  });

  test("marks near-zero drift as HOLD", async () => {
    const { computeDrift, parseTargetString } = await import("../src/commands/rebalance.js");
    const targetEntries = parseTargetString("VTI=50,VXUS=50");
    const allocRows = [
      makeAllocRow({ asset: "VTI", allocation_pct: 50, value_usd: 5000 }),
      makeAllocRow({ asset: "VXUS", allocation_pct: 50, value_usd: 5000 }),
    ];

    const result = computeDrift(targetEntries, allocRows, 10000, "2026-06-01");

    for (const row of result.rows) {
      expect(row.action).toBe("HOLD");
    }
  });
});

describe("getRebalance — CLI integration", () => {
  const MOCK_ALLOC_RESULT = {
    as_of_date: "2026-06-01",
    portfolio_value: 100000,
    rows: [
      { asset: "VTI", asset_type: "etf_usd", asset_kind: "etf", net_quantity: 100, value_usd: 55000, allocation_pct: 55 },
      { asset: "VXUS", asset_type: "etf_usd", asset_kind: "etf", net_quantity: 50, value_usd: 20000, allocation_pct: 20 },
      { asset: "BND", asset_type: "etf_usd", asset_kind: "etf", net_quantity: 200, value_usd: 25000, allocation_pct: 25 },
    ],
  };

  test("dispatches rebalance command and returns success envelope", async () => {
    mockQuery.mockResolvedValue(MOCK_ALLOC_RESULT.rows.map((r) => ({
      ...r,
      allocation_pct: r.allocation_pct.toString(),
      value_usd: r.value_usd.toString(),
    })));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch([
      "bun", "src/cli.ts", "rebalance",
      "--target", "VTI=50,VXUS=20,BND=30",
    ]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("rebalance");
    expect(output.data.as_of_date).toBeDefined();
    expect(output.data.total_portfolio_value).toBe(100000);
    expect(output.data.total_absolute_drift).toBeGreaterThan(0);
    expect(output.data.rows).toHaveLength(3);
    expect(output.meta.count).toBe(3);

    const vti = output.data.rows.find((r: { asset: string }) => r.asset === "VTI");
    expect(vti).toBeDefined();
    expect(vti.action).toBe("SELL");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("rejects missing --target", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "rebalance"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.error.code).toBe("VALIDATION_ERROR");
    expect(output.error.message).toContain("--target is required");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("rebalance appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("rebalance");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
