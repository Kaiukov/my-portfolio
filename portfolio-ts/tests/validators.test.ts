import { describe, expect, test } from "bun:test";
import {
  parseDate,
  validatePositiveFloat,
  validateNonNegativeFloat,
  validatePositiveInt,
  validateAssetSymbol,
  validateAction,
  validateCurrency,
  USER_ACTIONS,
  STABLECOINS,
  isStablecoin,
  ValidationError,
} from "../src/validators.js";

describe("parseDate", () => {
  test("accepts ISO YYYY-MM-DD (primary format)", () => {
    expect(parseDate("2026-01-15", "--date")).toBe("2026-01-15");
    expect(parseDate("2025-12-01", "--date")).toBe("2025-12-01");
  });

  test("still accepts legacy DD-MM-YYYY (deprecated)", () => {
    expect(parseDate("15-01-2026", "--date")).toBe("2026-01-15");
    expect(parseDate("01-12-2025", "--date")).toBe("2025-12-01");
  });

  test("throws on wrong format", () => {
    expect(() => parseDate("15/01/2026", "--date")).toThrow(ValidationError);
    expect(() => parseDate("", "--date")).toThrow(ValidationError);
    expect(() => parseDate("not-a-date", "--date")).toThrow(ValidationError);
  });

  test("error message mentions both YYYY-MM-DD and DD-MM-YYYY", () => {
    const err = tryParseDate("15/01/2026", "--date");
    expect(err).toBeInstanceOf(ValidationError);
    expect(err!.message).toContain("YYYY-MM-DD");
    expect(err!.message).toContain("DD-MM-YYYY");
    expect(err!.message).toContain("15/01/2026");
  });
});

function tryParseDate(dateStr: string, flagName: string): Error | null {
  try {
    parseDate(dateStr, flagName);
    return null;
  } catch (e) {
    return e as Error;
  }
}

describe("validatePositiveFloat", () => {
  test("passes for positive numbers", () => {
    expect(() => validatePositiveFloat(1, "--qty", "add")).not.toThrow();
    expect(() => validatePositiveFloat(0.001, "--qty", "add")).not.toThrow();
  });

  test("throws for zero and negative", () => {
    expect(() => validatePositiveFloat(0, "--qty", "add")).toThrow(ValidationError);
    expect(() => validatePositiveFloat(-1, "--qty", "add")).toThrow(ValidationError);
  });

  test("throws for undefined and NaN", () => {
    expect(() => validatePositiveFloat(undefined, "--qty", "add")).toThrow(ValidationError);
    expect(() => validatePositiveFloat(NaN, "--qty", "add")).toThrow(ValidationError);
  });
});

describe("validateNonNegativeFloat", () => {
  test("passes for zero and positive", () => {
    expect(() => validateNonNegativeFloat(0, "--fees", "add")).not.toThrow();
    expect(() => validateNonNegativeFloat(1.5, "--fees", "add")).not.toThrow();
  });

  test("throws for negative", () => {
    expect(() => validateNonNegativeFloat(-0.01, "--fees", "add")).toThrow(ValidationError);
  });
});

describe("validatePositiveInt", () => {
  test("passes for positive integers", () => {
    expect(() => validatePositiveInt(1, "--id", "edit")).not.toThrow();
    expect(() => validatePositiveInt(42, "--id", "edit")).not.toThrow();
  });

  test("throws for zero, negative, float, or undefined", () => {
    expect(() => validatePositiveInt(0, "--id", "edit")).toThrow(ValidationError);
    expect(() => validatePositiveInt(-1, "--id", "edit")).toThrow(ValidationError);
    expect(() => validatePositiveInt(1.5, "--id", "edit")).toThrow(ValidationError);
    expect(() => validatePositiveInt(undefined, "--id", "edit")).toThrow(ValidationError);
  });
});

describe("USER_ACTIONS", () => {
  test("contains all canonical actions", () => {
    expect(USER_ACTIONS.has("BUY")).toBe(true);
    expect(USER_ACTIONS.has("SELL")).toBe(true);
    expect(USER_ACTIONS.has("DEPOSIT")).toBe(true);
    expect(USER_ACTIONS.has("WITHDRAW")).toBe(true);
    expect(USER_ACTIONS.has("TRANSFER")).toBe(true);
    expect(USER_ACTIONS.has("DIVIDEND")).toBe(true);
    expect(USER_ACTIONS.has("INTEREST")).toBe(true);
    expect(USER_ACTIONS.has("FEE")).toBe(true);
    expect(USER_ACTIONS.has("TAX")).toBe(true);
    expect(USER_ACTIONS.has("SPLIT")).toBe(true);
    expect(USER_ACTIONS.size).toBe(10);
  });
});

describe("validateAssetSymbol", () => {
  test("passes for stock ticker with BUY", () => {
    expect(() => validateAssetSymbol("AAPL", "BUY")).not.toThrow();
    expect(() => validateAssetSymbol("MSFT", "SELL")).not.toThrow();
  });

  test("passes for FX pair format with BUY/SELL", () => {
    expect(() => validateAssetSymbol("EURUSD=X", "BUY")).not.toThrow();
    expect(() => validateAssetSymbol("GBPUSD=X", "SELL")).not.toThrow();
  });

  test("rejects bare ISO currency code with BUY", () => {
    const err = tryValidateAsset("EUR", "BUY");
    expect(err).toBeInstanceOf(ValidationError);
    expect(err!.message).toContain("EURUSD=X");
  });

  test("rejects bare ISO currency code with SELL", () => {
    const err = tryValidateAsset("GBP", "SELL");
    expect(err).toBeInstanceOf(ValidationError);
    expect(err!.message).toContain("EURUSD=X");
  });

  test("passes for non-BUY/SELL action with bare currency (DEPOSIT)", () => {
    expect(() => validateAssetSymbol("EUR", "DEPOSIT")).not.toThrow();
  });

  test("passes for 3-letter ETF tickers with BUY/SELL (regression #191)", () => {
    expect(() => validateAssetSymbol("IWM", "BUY")).not.toThrow();
    expect(() => validateAssetSymbol("SPY", "BUY")).not.toThrow();
    expect(() => validateAssetSymbol("QQQ", "BUY")).not.toThrow();
    expect(() => validateAssetSymbol("VTI", "BUY")).not.toThrow();
    expect(() => validateAssetSymbol("IWM", "SELL")).not.toThrow();
    expect(() => validateAssetSymbol("SPY", "SELL")).not.toThrow();
    expect(() => validateAssetSymbol("GLD", "BUY")).not.toThrow();
    expect(() => validateAssetSymbol("TLT", "SELL")).not.toThrow();
    expect(() => validateAssetSymbol("DIA", "BUY")).not.toThrow();
    expect(() => validateAssetSymbol("XLF", "BUY")).not.toThrow();
  });

  test("throws for empty asset", () => {
    expect(() => validateAssetSymbol("", "BUY")).toThrow(ValidationError);
  });
});

function tryValidateAsset(asset: string, action: string): Error | null {
  try {
    validateAssetSymbol(asset, action);
    return null;
  } catch (e) {
    return e as Error;
  }
}

describe("validateAction", () => {
  test("passes for known actions", () => {
    expect(validateAction("buy")).toBe("BUY");
    expect(validateAction("SELL")).toBe("SELL");
    expect(validateAction("Deposit")).toBe("DEPOSIT");
  });

  test("throws for unknown action", () => {
    expect(() => validateAction("INVALID")).toThrow(ValidationError);
    expect(() => validateAction("")).toThrow(ValidationError);
  });
});

describe("validateCurrency", () => {
  test("passes for known currencies", () => {
    expect(() => validateCurrency("USD", "--currency")).not.toThrow();
    expect(() => validateCurrency("EUR", "--currency")).not.toThrow();
    expect(() => validateCurrency("GBP", "--currency")).not.toThrow();
  });

  test("passes when currency is undefined (optional)", () => {
    expect(() => validateCurrency(undefined, "--currency")).not.toThrow();
  });

  test("throws for unknown currency", () => {
    expect(() => validateCurrency("XYZ", "--currency")).toThrow(ValidationError);
    expect(() => validateCurrency("BTC", "--currency")).toThrow(ValidationError);
  });
});

describe("isStablecoin", () => {
  test("true for all 9 stablecoins (any case)", () => {
    const coins = ["USDT", "USDC", "DAI", "TUSD", "USDP", "FDUSD", "PYUSD", "USDE", "GUSD"];
    for (const c of coins) {
      expect(isStablecoin(c)).toBe(true);
      expect(isStablecoin(c.toLowerCase())).toBe(true);
    }
    expect(STABLECOINS.size).toBe(9);
  });

  test("false for USD", () => {
    expect(isStablecoin("USD")).toBe(false);
    expect(isStablecoin("usd")).toBe(false);
  });

  test("false for BTC-USD", () => {
    expect(isStablecoin("BTC-USD")).toBe(false);
  });

  test("false for EURUSD=X", () => {
    expect(isStablecoin("EURUSD=X")).toBe(false);
  });

  test("false for stock-like tickers", () => {
    expect(isStablecoin("SPYM")).toBe(false);
    expect(isStablecoin("AAPL")).toBe(false);
  });
});
