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
});

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
    expect(USER_ACTIONS.size).toBe(9);
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
