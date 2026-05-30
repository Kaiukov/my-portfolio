import { test, expect } from "bun:test";

// Test 1: Direct import of runTx from db.ts (NO mock)
test("debug: direct import runTx from db.ts", async () => {
  const { runTx, query } = await import("../src/db.js");
  expect(typeof runTx).toBe("function");
  expect(typeof query).toBe("function");
});

// Test 2: Import exchange.js via dynamic import (NO mock applied)
// This should trigger the same code path as the failing tests
test("debug: import exchange.js without mock", async () => {
  const { exchangeCurrency } = await import("../src/commands/exchange.js");
  expect(typeof exchangeCurrency).toBe("function");
});
