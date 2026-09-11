import { describe, expect, test } from "bun:test";
import {
  MARKET_CURRENCY_BY_SUFFIX,
  instrumentQuoteCurrency,
  warnOnQuoteCurrencyMismatch,
} from "../src/validators.js";

/** Capture console.warn output for the duration of fn(). */
function captureWarnings(fn: () => unknown): string[] {
  const original = console.warn;
  const calls: string[] = [];
  console.warn = (...args: unknown[]) => {
    calls.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return calls;
}

describe("instrumentQuoteCurrency", () => {
  test("maps each known exchange suffix to its market currency", () => {
    // Hand-calculated from get_asset_type_sql() in portfolio_db/sql/functions.sql.
    expect(instrumentQuoteCurrency("VGEU.DE")).toBe("EUR");
    expect(instrumentQuoteCurrency("IGLN.L")).toBe("GBP");
    expect(instrumentQuoteCurrency("7203.T")).toBe("JPY");
    expect(instrumentQuoteCurrency("NESN.SW")).toBe("CHF");
    expect(instrumentQuoteCurrency("SHOP.TO")).toBe("CAD");
    expect(instrumentQuoteCurrency("BHP.AX")).toBe("AUD");
    expect(instrumentQuoteCurrency("0700.HK")).toBe("HKD");
    expect(instrumentQuoteCurrency("D05.SG")).toBe("SGD");
  });

  test("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(instrumentQuoteCurrency("vgeu.de")).toBe("EUR");
    expect(instrumentQuoteCurrency("  igln.l  ")).toBe("GBP");
  });

  test("returns null for tickers without currency information", () => {
    expect(instrumentQuoteCurrency("AAPL")).toBeNull();
    expect(instrumentQuoteCurrency("SCHD")).toBeNull();
    expect(instrumentQuoteCurrency("BTC-USD")).toBeNull();
    expect(instrumentQuoteCurrency("EURUSD=X")).toBeNull();
    expect(instrumentQuoteCurrency("USDT")).toBeNull();
    expect(instrumentQuoteCurrency("")).toBeNull();
  });

  test("suffix table mirrors the SQL asset-type classification", () => {
    expect(Object.keys(MARKET_CURRENCY_BY_SUFFIX).sort()).toEqual([
      ".AX", ".DE", ".HK", ".L", ".SG", ".SW", ".T", ".TO",
    ]);
  });
});

describe("warnOnQuoteCurrencyMismatch", () => {
  test("regression #368: EUR-listed fund recorded with currency=USD warns", () => {
    const warnings = captureWarnings(() =>
      warnOnQuoteCurrencyMismatch("VGEU.DE", "USD"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("EUR-denominated");
    expect(warnings[0]).toContain("--currency EUR");
  });

  test("regression #368: GBP-listed instrument recorded with currency=USD warns", () => {
    const warnings = captureWarnings(() =>
      warnOnQuoteCurrencyMismatch("IGLN.L", "USD"),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("GBP-denominated");
  });

  test("does not warn when the recorded currency matches the listing", () => {
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("VGEU.DE", "EUR"))).toHaveLength(0);
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("IGLN.L", "GBP"))).toHaveLength(0);
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("VGEU.DE", "eur"))).toHaveLength(0);
  });

  test("stays silent for US listings, FX pairs, crypto and stablecoins", () => {
    // #361 case: a crypto trade settled in a stablecoin must not be flagged.
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("BTC-USD", "USDT"))).toHaveLength(0);
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("AAPL", "EUR"))).toHaveLength(0);
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("EURUSD=X", "USD"))).toHaveLength(0);
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("USDT", "USD"))).toHaveLength(0);
  });

  test("stays silent when no currency is recorded or the asset is blank", () => {
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("VGEU.DE", undefined))).toHaveLength(0);
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("VGEU.DE", ""))).toHaveLength(0);
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("VGEU.DE", "   "))).toHaveLength(0);
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("", "USD"))).toHaveLength(0);
  });

  test("allows stablecoin settlement of a foreign listing", () => {
    expect(captureWarnings(() => warnOnQuoteCurrencyMismatch("VGEU.DE", "USDT"))).toHaveLength(0);
  });

  test("returns the message it warns with, and null when silent", () => {
    const [message] = captureWarnings(() =>
      expect(warnOnQuoteCurrencyMismatch("VGEU.DE", "USD")).toContain("VGEU.DE"),
    );
    expect(message).toContain("[warning]");
    expect(captureWarnings(() => expect(warnOnQuoteCurrencyMismatch("VGEU.DE", "EUR")).toBeNull()))
      .toHaveLength(0);
  });
});
