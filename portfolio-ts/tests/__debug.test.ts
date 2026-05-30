import { test, expect, mock } from "bun:test";

// Test: mock db.js WITHOUT runTx, then import exchange.js
// The real runTx from db.ts should be used
mock.module("../src/db.js", () => ({
  query: mock(),
  querySingle: mock(),
  connect: () => {},
  close: () => {},
  // DELIBERATELY OMIT runTx — test if Bun falls back to real export
}));

test("debug: import exchange.js when mock omits runTx", async () => {
  // This imports exchange.js which imports runTx from ../db.js
  // Since mock omits runTx, Bun should fall back to real runTx from db.ts
  const { exchangeCurrency } = await import("../src/commands/exchange.js");
  expect(typeof exchangeCurrency).toBe("function");
});
