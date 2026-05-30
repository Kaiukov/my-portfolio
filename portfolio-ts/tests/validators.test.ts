import { describe, expect, test } from "bun:test";
import {
  parseDate,
  validatePositiveFloat,
  validateNonNegativeFloat,
  validatePositiveInt,
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
