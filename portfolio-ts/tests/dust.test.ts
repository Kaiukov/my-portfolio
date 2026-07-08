import { afterEach, describe, expect, test } from "bun:test";
import { filterDustHoldings } from "../src/dust.js";

const originalDustThreshold = process.env.PORTFOLIO_DUST_THRESHOLD_PCT;

afterEach(() => {
  if (originalDustThreshold === undefined) {
    delete process.env.PORTFOLIO_DUST_THRESHOLD_PCT;
  } else {
    process.env.PORTFOLIO_DUST_THRESHOLD_PCT = originalDustThreshold;
  }
});

describe("filterDustHoldings", () => {
  test("defaults dust threshold to 1.0 percent", () => {
    delete process.env.PORTFOLIO_DUST_THRESHOLD_PCT;

    const result = filterDustHoldings([
      { asset: "WBETH-USD", allocation_pct: 0.63 },
      { asset: "AAPL", allocation_pct: 10 },
    ]);

    expect(result.meta.threshold_pct).toBe(1);
    expect(result.rows.map((row) => row.asset)).toEqual(["AAPL"]);
    expect(result.meta.hidden_assets).toEqual(["WBETH-USD"]);
  });

  test("uses PORTFOLIO_DUST_THRESHOLD_PCT at filter time", () => {
    process.env.PORTFOLIO_DUST_THRESHOLD_PCT = "0.5";

    const result = filterDustHoldings([
      { asset: "WBETH-USD", allocation_pct: 0.63 },
      { asset: "EURUSD=X", allocation_pct: 0.12 },
      { asset: "AAPL", allocation_pct: 10 },
    ]);

    expect(result.meta.threshold_pct).toBe(0.5);
    expect(result.rows.map((row) => row.asset)).toEqual(["WBETH-USD", "AAPL"]);
    expect(result.meta.hidden_assets).toEqual(["EURUSD=X"]);
  });

  test("falls back to 1.0 for invalid or negative env values", () => {
    process.env.PORTFOLIO_DUST_THRESHOLD_PCT = "-0.5";

    const result = filterDustHoldings([
      { asset: "WBETH-USD", allocation_pct: 0.63 },
      { asset: "AAPL", allocation_pct: 10 },
    ]);

    expect(result.meta.threshold_pct).toBe(1);
    expect(result.rows.map((row) => row.asset)).toEqual(["AAPL"]);
  });
});
