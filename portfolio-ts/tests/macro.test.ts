import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type MacroIndicatorsPayload,
  computeRegime,
  fetchMacroIndicators,
} from "../src/asset_analysis/macro.js";

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetch(
  handler: (url: string) => Response | Promise<Response>,
) {
  const fn = (input: RequestInfo | URL) => handler(String(input));
  global.fetch = fn as unknown as typeof global.fetch;
}

function makeResponse(
  body: string,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(body, {
    status,
    headers: { ...headers, "content-type": "text/plain" },
  });
}

function makeJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const FRED_CSV = `observation_date,UNRATE
2023-01-01,3.5
2023-02-01,3.6
2024-01-01,3.7`;

function yahooChartResponse(closes: number[]) {
  const timestamps = closes.map(
    (_, i) => 1700000000 + i * 86400,
  );
  return {
    chart: {
      result: [
        {
          timestamp: timestamps,
          indicators: {
            adjclose: [{ adjclose: closes }],
            quote: [{ close: closes }],
          },
        },
      ],
    },
  };
}

function makeSpxCloses(
  length: number,
  {
    latest,
    sma200Target,
  }: { latest?: number; sma200Target?: number } = {},
): number[] {
  const closes: number[] = [];
  const base = latest ?? 5000;
  const targetAvg = sma200Target ?? 4900;
  for (let i = 0; i < length; i++) {
    const offset = i - (length - 1);
    closes.push(base + offset);
  }
  closes[length - 1] = latest ?? base;
  return closes;
}

describe("computeRegime", () => {
  test("0 peaks -> AGGRESSIVE", () => {
    const result = computeRegime({
      cape: { value: 25, peak: false, source: "multpl.com" },
      fear_greed: {
        value: 50,
        rating: "Fear",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 4.5,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(result.regime).toBe("AGGRESSIVE");
    expect(result.peak_count).toBe(0);
    expect(result.missing_count).toBe(0);
    expect(result.regime_reason).toBe("0 PEAK");
  });

  test("1 peak -> AGGRESSIVE", () => {
    const result = computeRegime({
      cape: { value: 35, peak: true, source: "multpl.com" },
      fear_greed: {
        value: 50,
        rating: "Fear",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 4.5,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(result.regime).toBe("AGGRESSIVE");
    expect(result.peak_count).toBe(1);
  });

  test("2 peaks -> CAUTION", () => {
    const result = computeRegime({
      cape: { value: 35, peak: true, source: "multpl.com" },
      fear_greed: {
        value: 80,
        rating: "Greed",
        peak: true,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 4.5,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(result.regime).toBe("CAUTION");
    expect(result.peak_count).toBe(2);
    expect(result.regime_reason).toBe("2 PEAK");
  });

  test("3 peaks -> PROTECTION", () => {
    const result = computeRegime({
      cape: { value: 35, peak: true, source: "multpl.com" },
      fear_greed: {
        value: 80,
        rating: "Greed",
        peak: true,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 3.5,
        date: "2024-01-01",
        peak: true,
        ok_band: false,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(result.regime).toBe("PROTECTION");
    expect(result.peak_count).toBe(3);
    expect(result.regime_reason).toBe("3 PEAK");
  });

  test("4 peaks -> PROTECTION", () => {
    const result = computeRegime({
      cape: { value: 35, peak: true, source: "multpl.com" },
      fear_greed: {
        value: 80,
        rating: "Greed",
        peak: true,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 3.5,
        date: "2024-01-01",
        peak: true,
        ok_band: false,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 4800,
        sma200: 5500,
        above_sma200: false,
        peak: true,
        source: "Yahoo Finance",
      },
    });
    expect(result.regime).toBe("PROTECTION");
    expect(result.peak_count).toBe(4);
    expect(result.regime_reason).toBe("4 PEAK");
  });

  test("1 missing -> no regime fallback", () => {
    const result = computeRegime({
      cape: { value: null, error: "parse_failed", source: "multpl.com" },
      fear_greed: {
        value: 50,
        rating: "Fear",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 4.5,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(result.missing_count).toBe(1);
    expect(result.regime).toBe("AGGRESSIVE");
  });

  test("2 missing -> CAUTION regime fallback", () => {
    const result = computeRegime({
      cape: { value: null, error: "parse_failed", source: "multpl.com" },
      fear_greed: {
        value: 80,
        rating: "Greed",
        peak: true,
        source: "CNN dataviz API",
      },
      unrate: { value: null, error: "timeout", source: "FRED" },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(result.missing_count).toBe(2);
    expect(result.regime).toBe("CAUTION");
    expect(result.regime_reason).toBe("2 indicators missing");
  });

  test("3 missing -> CAUTION", () => {
    const result = computeRegime({
      cape: { value: null, error: "parse_failed", source: "multpl.com" },
      fear_greed: {
        value: null,
        error: "network",
        source: "CNN dataviz API",
      },
      unrate: { value: null, error: "timeout", source: "FRED" },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(result.missing_count).toBe(3);
    expect(result.regime).toBe("CAUTION");
    expect(result.regime_reason).toBe("3 indicators missing");
  });

  test("CAPE boundary: 30 is not peak, 30.01 is peak", () => {
    const noPeak = computeRegime({
      cape: { value: 30, peak: false, source: "multpl.com" },
      fear_greed: {
        value: 50,
        rating: "Fear",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 4.5,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(noPeak.peak_count).toBe(0);

    const peak = computeRegime({
      cape: { value: 30.01, peak: true, source: "multpl.com" },
      fear_greed: {
        value: 50,
        rating: "Fear",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 4.5,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(peak.peak_count).toBe(1);
  });

  test("F&G boundary: 75 is not peak, 75.01 is peak", () => {
    const noPeak = computeRegime({
      cape: { value: 25, peak: false, source: "multpl.com" },
      fear_greed: {
        value: 75,
        rating: "Greed",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 4.5,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(noPeak.peak_count).toBe(0);

    const peak = computeRegime({
      cape: { value: 25, peak: false, source: "multpl.com" },
      fear_greed: {
        value: 75.01,
        rating: "Extreme Greed",
        peak: true,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 4.5,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(peak.peak_count).toBe(1);
  });

  test("UNRATE boundary: 3.8 is peak, 3.81 is not", () => {
    const peak = computeRegime({
      cape: { value: 25, peak: false, source: "multpl.com" },
      fear_greed: {
        value: 50,
        rating: "Fear",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 3.8,
        date: "2024-01-01",
        peak: true,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(peak.peak_count).toBe(1);

    const noPeak = computeRegime({
      cape: { value: 25, peak: false, source: "multpl.com" },
      fear_greed: {
        value: 50,
        rating: "Fear",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 3.81,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(noPeak.peak_count).toBe(0);
  });

  test("SPX boundary: price > SMA200 is not peak, price < SMA200 is peak", () => {
    const below = computeRegime({
      cape: { value: 25, peak: false, source: "multpl.com" },
      fear_greed: {
        value: 50,
        rating: "Fear",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 4.5,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 4800,
        sma200: 5000,
        above_sma200: false,
        peak: true,
        source: "Yahoo Finance",
      },
    });
    expect(below.peak_count).toBe(1);

    const above = computeRegime({
      cape: { value: 25, peak: false, source: "multpl.com" },
      fear_greed: {
        value: 50,
        rating: "Fear",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 4.5,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: 5200,
        sma200: 5000,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(above.peak_count).toBe(0);
  });

  test("spx_sma200 missing via spx_price=null", () => {
    const result = computeRegime({
      cape: { value: 25, peak: false, source: "multpl.com" },
      fear_greed: {
        value: 50,
        rating: "Fear",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: {
        value: 4.5,
        date: "2024-01-01",
        peak: false,
        ok_band: true,
        source: "FRED",
      },
      spx_sma200: {
        spx_price: null,
        sma200: null,
        above_sma200: null,
        peak: false,
        error: "insufficient_data",
        source: "Yahoo Finance",
      },
    });
    expect(result.missing_count).toBe(1);
  });

  test("errors array populated", () => {
    const result = computeRegime({
      cape: { value: null, error: "parse_failed", source: "multpl.com" },
      fear_greed: {
        value: 50,
        rating: "Fear",
        peak: false,
        source: "CNN dataviz API",
      },
      unrate: { value: null, error: "timeout", source: "FRED" },
      spx_sma200: {
        spx_price: 6000,
        sma200: 5500,
        above_sma200: true,
        peak: false,
        source: "Yahoo Finance",
      },
    });
    expect(result.errors).toContain("cape: parse_failed");
    expect(result.errors).toContain("unrate: timeout");
    expect(result.errors.length).toBe(2);
  });
});

describe("fetchMacroIndicators", () => {
  test("all sources ok - full payload shape", async () => {
    mockFetch((url: string) => {
      if (url.includes("multpl.com")) {
        return makeResponse(
          '<div>Current Shiller PE Ratio<span>34.56</span></div>',
        );
      }
      if (url.includes("cnn.io")) {
        return makeJsonResponse({
          fear_and_greed: { score: "45.67", rating: "Fear" },
        });
      }
      if (url.includes("fred")) {
        return makeResponse(FRED_CSV);
      }
      if (url.includes("yahoo.com")) {
        return makeJsonResponse(yahooChartResponse(makeSpxCloses(250)));
      }
      return makeResponse("", 404);
    });

    const result = await fetchMacroIndicators();
    expect(result.peak_count).toBeGreaterThanOrEqual(0);
    expect(result.missing_count).toBe(0);
    expect(result.regime).toBeDefined();
    expect(result.regime_reason).toBeDefined();
    expect(result.generated_at).toBeDefined();
    expect(result.errors).toEqual([]);

    expect(result.indicators.cape.value).toBeCloseTo(34.56, 1);
    expect(result.indicators.cape.source).toBe("multpl.com");
    expect(result.indicators.fear_greed.value).toBeCloseTo(45.67, 1);
    expect(result.indicators.fear_greed.rating).toBe("Fear");
    expect(result.indicators.unrate.value).toBe(3.7);
    expect(result.indicators.unrate.date).toBe("2024-01-01");
    expect(result.indicators.spx_sma200.spx_price).toBeGreaterThan(0);
    expect(result.indicators.spx_sma200.sma200).toBeGreaterThan(0);
    expect(result.indicators.spx_sma200.source).toBe("Yahoo Finance");
  });

  test("CAPE parse fails gracefully", async () => {
    mockFetch((url: string) => {
      if (url.includes("multpl.com")) {
        return makeResponse("<html>no data here</html>");
      }
      if (url.includes("cnn.io")) {
        return makeJsonResponse({
          fear_and_greed: { score: "50", rating: "Fear" },
        });
      }
      if (url.includes("fred")) {
        return makeResponse(FRED_CSV);
      }
      if (url.includes("yahoo.com")) {
        return makeJsonResponse(yahooChartResponse(makeSpxCloses(250)));
      }
      return makeResponse("", 404);
    });

    const result = await fetchMacroIndicators();
    expect(result.indicators.cape.value).toBeNull();
    expect(result.indicators.cape.error).toBe("parse_failed");
    expect(result.missing_count).toBe(1);
    expect(result.regime).toBe("AGGRESSIVE");
    expect(result.errors).toContain("cape: parse_failed");
  });

  test("multiple failures still produce complete payload", async () => {
    mockFetch((url: string) => {
      if (url.includes("yahoo.com")) {
        return makeJsonResponse(yahooChartResponse(makeSpxCloses(250)));
      }
      throw new Error("network error");
    });

    const result = await fetchMacroIndicators();
    expect(result.indicators.cape.error).toBeDefined();
    expect(result.indicators.fear_greed.error).toBeDefined();
    expect(result.indicators.unrate.error).toBeDefined();
    expect(result.indicators.spx_sma200.spx_price).toBeGreaterThan(0);
    expect(result.missing_count).toBe(3);
    expect(result.regime).toBe("CAUTION");
    expect(result.regime_reason).toBe("3 indicators missing");
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  test("all sources fail - partial-failure resilient", async () => {
    mockFetch(() => {
      throw new Error("network error");
    });

    const result = await fetchMacroIndicators();
    expect(result.peak_count).toBe(0);
    expect(result.missing_count).toBe(4);
    expect(result.regime).toBe("CAUTION");
    expect(result.regime_reason).toBe("4 indicators missing");
    expect(result.errors.length).toBe(4);
    expect(result.indicators.cape.error).toBeDefined();
    expect(result.indicators.fear_greed.error).toBeDefined();
    expect(result.indicators.unrate.error).toBeDefined();
    expect(result.indicators.spx_sma200.error).toBeDefined();
  });

  test("Yahoo HTTP error returns error not throw", async () => {
    mockFetch((url: string) => {
      if (url.includes("yahoo.com")) {
        return makeResponse("", 429);
      }
      if (url.includes("multpl.com")) {
        return makeResponse(
          '<div>Current Shiller PE Ratio<span>25.0</span></div>',
        );
      }
      if (url.includes("cnn.io")) {
        return makeJsonResponse({
          fear_and_greed: { score: "50", rating: "Fear" },
        });
      }
      if (url.includes("fred")) {
        return makeResponse(FRED_CSV);
      }
      return makeResponse("", 404);
    });

    const result = await fetchMacroIndicators();
    expect(result.indicators.spx_sma200.error).toBe("HTTP 429");
    expect(result.missing_count).toBe(1);
  });

  test("Fear & Greed missing score field", async () => {
    mockFetch((url: string) => {
      if (url.includes("multpl.com")) {
        return makeResponse(
          '<div>Current Shiller PE Ratio<span>25.0</span></div>',
        );
      }
      if (url.includes("cnn.io")) {
        return makeJsonResponse({});
      }
      if (url.includes("fred")) {
        return makeResponse(FRED_CSV);
      }
      if (url.includes("yahoo.com")) {
        return makeJsonResponse(yahooChartResponse(makeSpxCloses(250)));
      }
      return makeResponse("", 404);
    });

    const result = await fetchMacroIndicators();
    expect(result.indicators.fear_greed.error).toBe("parse_failed");
    expect(result.missing_count).toBe(1);
  });

  test("FRED CSV empty", async () => {
    mockFetch((url: string) => {
      if (url.includes("multpl.com")) {
        return makeResponse(
          '<div>Current Shiller PE Ratio<span>25.0</span></div>',
        );
      }
      if (url.includes("cnn.io")) {
        return makeJsonResponse({
          fear_and_greed: { score: "50", rating: "Fear" },
        });
      }
      if (url.includes("fred")) {
        return makeResponse("observation_date,UNRATE\n");
      }
      if (url.includes("yahoo.com")) {
        return makeJsonResponse(yahooChartResponse(makeSpxCloses(250)));
      }
      return makeResponse("", 404);
    });

    const result = await fetchMacroIndicators();
    expect(result.indicators.unrate.error).toBe("parse_failed");
    expect(result.missing_count).toBe(1);
  });

  test("generated_at is ISO format", async () => {
    mockFetch((url: string) => {
      if (url.includes("multpl.com")) {
        return makeResponse(
          '<div>Current Shiller PE Ratio<span>25.0</span></div>',
        );
      }
      if (url.includes("cnn.io")) {
        return makeJsonResponse({
          fear_and_greed: { score: "50", rating: "Fear" },
        });
      }
      if (url.includes("fred")) {
        return makeResponse(FRED_CSV);
      }
      if (url.includes("yahoo.com")) {
        return makeJsonResponse(yahooChartResponse(makeSpxCloses(250)));
      }
      return makeResponse("", 404);
    });

    const result = await fetchMacroIndicators();
    expect(result.generated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
  });
});
