import { expect, test, mock, describe } from "bun:test";
import { formatDate } from "../src/commands/realized_gains.js";

// ── Unit tests for formatDate helper ──────────────────────────────────

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

// ── Parametrized: ISO dates under multiple TZ settings ────────────────

const importFresh = () => import("../src/commands/realized_gains.js");

describe("getRealizedGains emits ISO dates when DB returns JS Date objects", () => {
  for (const tz of ["UTC", "America/Los_Angeles"]) {
    test(`sell_date and matched_buy_date are ISO under TZ=${tz}`, async () => {
      const originalTZ = process.env.TZ;
      process.env.TZ = tz;

      const mockQuery = mock(() =>
        Promise.resolve([
          {
            sell_date: new Date("2025-10-16T00:00:00Z"),
            sell_id: 1,
            asset: "AAPL",
            sell_quantity: 10,
            proceeds_usd: 1200,
            cost_basis_usd: 1000,
            realized_gain: 200,
            holding_days: 90,
            matched_buy_id: 1,
            matched_buy_date: new Date("2025-07-18T00:00:00Z"),
          },
        ])
      );

      mock.module("../src/db.js", () => ({ query: mockQuery }));

      const { getRealizedGains } = await importFresh();
      const result = await getRealizedGains({ toDate: "2025-10-16" });

      expect(result.rows[0].sell_date).toBe("2025-10-16");
      expect(result.rows[0].matched_buy_date).toBe("2025-07-18");

      mock.restore();
      process.env.TZ = originalTZ;
    });
  }
});
