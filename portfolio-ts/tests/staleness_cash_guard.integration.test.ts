import { describe, expect, test } from "bun:test";

const DB_URL = process.env.PORTFOLIO_DB_URL;
const MAYBE_SKIP = DB_URL ? describe : describe.skip;

MAYBE_SKIP("regression: cash-like tickers never cause false staleness (#today-0)", () => {
  test("checkPricesStale returns no cash-like ticker", async () => {
    const { checkPricesStale } = await import("../src/commands/recalculate.js");
    const r = await checkPricesStale(5);
    const cashLike = r.tickers.filter((t: string) =>
      ["USD", "EUR", "GBP", "CHF", "CAD", "AUD", "HKD", "SGD", "JPY"].includes(t) ||
      /USD=X$/.test(t),
    );
    expect(cashLike).toEqual([]);
  });
});
