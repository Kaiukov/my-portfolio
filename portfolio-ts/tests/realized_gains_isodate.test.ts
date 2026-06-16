import { expect, test } from "bun:test";
import { formatDate } from "../src/commands/realized_gains.js";

test("formatDate returns ISO date from Date regardless of TZ", () => {
  const originalTZ = process.env.TZ;
  try {
    process.env.TZ = "America/Los_Angeles";
    expect(formatDate(new Date("2025-10-16T00:00:00Z"))).toBe("2025-10-16");

    process.env.TZ = "UTC";
    expect(formatDate(new Date("2025-10-16T00:00:00Z"))).toBe("2025-10-16");
  } finally {
    process.env.TZ = originalTZ;
  }
});

test("formatDate passes through strings and normalizes nullish values", () => {
  expect(formatDate("2025-10-16")).toBe("2025-10-16");
  expect(formatDate(null)).toBe("");
  expect(formatDate(undefined)).toBe("");
});
