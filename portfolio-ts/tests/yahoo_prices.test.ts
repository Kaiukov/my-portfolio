import { afterAll, expect, mock, test } from "bun:test";

const chart = mock(async () => ({
  quotes: [{ date: new Date("2026-11-20T21:00:00Z"), close: 10 }],
}));

mock.module("yahoo-finance2", () => ({
  default: class YahooFinanceMock {
    chart = chart;
  },
}));

afterAll(() => mock.restore());

test("fetchPrices includes its end date in Yahoo's exclusive period2", async () => {
  const { fetchPrices } = await import("../src/providers/yahoo.js");

  const rows = await fetchPrices("ANT", "2026-11-10", "2026-11-20");

  expect(chart).toHaveBeenCalledTimes(1);
  const [, options] = chart.mock.calls[0] as unknown as [string, { period2: Date }];
  expect(options.period2.toISOString()).toBe("2026-11-21T00:00:00.000Z");
  expect(rows).toEqual([{ ticker: "ANT", date: "2026-11-20", price: 10 }]);
});
