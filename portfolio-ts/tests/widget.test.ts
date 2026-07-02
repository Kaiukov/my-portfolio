import { describe, expect, test, mock, jest } from "bun:test";

const mockQuerySingle = mock();
const mockQuery = mock();

mock.module("../src/db.js", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  getSql: () => ({}),
  connect: () => {},
  close: () => {},
}));

describe("getWidget — shape and keys", () => {
  test("returns correct widget shape with all required keys", async () => {
    mockQuerySingle.mockResolvedValue({
      portfolio_value: 19257.13,
      total_gain: 4257.13,
      total_gain_pct: 28.3,
      as_of_date: "2026-05-30",
    });

    mockQuery.mockResolvedValue([
      { date: "2026-05-30", portfolio_value: 19257.13, investment_return: 0.65 },
      { date: "2026-05-29", portfolio_value: 19131.63, investment_return: -0.12 },
      { date: "2026-05-28", portfolio_value: 19155.00, investment_return: 0.80 },
    ]);

    const { getWidget } = await import("../src/commands/widget.js");
    const result = await getWidget(30, "2026-05-30");

    expect(result.title).toBe("My holdings");
    expect(result.currency).toBe("USD");
    expect(result.as_of_date).toBe("2026-05-30");
    expect(result.last_refresh).toBe("2026-05-30");
    expect(result.value).toBe(19257.13);
    expect(result.today.amount).toBe(125.50);
    expect(result.today.pct).toBe(0.65);
    expect(result.total.amount).toBe(4257.13);
    expect(result.total.pct).toBe(28.3);
    expect(Array.isArray(result.series)).toBe(true);
    expect(result.series.length).toBe(3);
    expect(result.series[0]).toEqual({ date: "2026-05-28", value: 19155.00 });
    expect(result.series[1]).toEqual({ date: "2026-05-29", value: 19131.63 });
    expect(result.series[2]).toEqual({ date: "2026-05-30", value: 19257.13 });
  });

  test("series is limited to --days count", async () => {
    mockQuerySingle.mockResolvedValue({
      portfolio_value: 19257.13,
      total_gain: 4257.13,
      total_gain_pct: 28.3,
      as_of_date: "2026-05-30",
    });

    const rows = [];
    for (let i = 0; i < 10; i++) {
      rows.push({
        date: `2026-05-${20 + i}`,
        portfolio_value: 19000 + i * 10,
        investment_return: 0.1,
      });
    }
    mockQuery.mockResolvedValue(rows);

    const { getWidget } = await import("../src/commands/widget.js");
    const result = await getWidget(5, "2026-05-30");

    expect(result.series.length).toBe(5);
  });
});

describe("getWidget — consistency with status", () => {
  test("widget value == status portfolio_value on same as-of-date", async () => {
    mockQuerySingle.mockResolvedValue({
      portfolio_value: 19257.13,
      total_gain: 4257.13,
      total_gain_pct: 28.3,
      as_of_date: "2026-05-30",
    });
    mockQuery.mockResolvedValue([
      { date: "2026-05-30", portfolio_value: 19257.13, investment_return: 0.65 },
    ]);

    const { getWidget } = await import("../src/commands/widget.js");
    const { getStatus } = await import("../src/commands/status.js");

    const widget = await getWidget(30, "2026-05-30");
    const status = await getStatus("2026-05-30");

    expect(widget.value).toBe(status.portfolio_value);
    expect(widget.as_of_date).toBe(status.as_of_date!);
  });

  test("widget total matches status total_gain", async () => {
    mockQuerySingle.mockResolvedValue({
      portfolio_value: 19257.13,
      total_gain: 4257.13,
      total_gain_pct: 28.3,
      as_of_date: "2026-05-30",
    });
    mockQuery.mockResolvedValue([]);

    const { getWidget } = await import("../src/commands/widget.js");
    const { getStatus } = await import("../src/commands/status.js");

    const widget = await getWidget(30, "2026-05-30");
    const status = await getStatus("2026-05-30");

    expect(widget.total.amount).toBe(status.total_gain);
    expect(widget.total.pct).toBe(status.total_gain_pct);
  });
});

describe("getWidget — today sign", () => {
  test("today.pct is positive when investment_return > 0", async () => {
    mockQuerySingle.mockResolvedValue({
      portfolio_value: 20000,
      total_gain: 1000,
      total_gain_pct: 5.0,
      as_of_date: "2026-05-30",
    });
    mockQuery.mockResolvedValue([
      { date: "2026-05-30", portfolio_value: 20000, investment_return: 2.5 },
      { date: "2026-05-29", portfolio_value: 19500, investment_return: 0.0 },
    ]);

    const { getWidget } = await import("../src/commands/widget.js");
    const result = await getWidget(30, "2026-05-30");

    expect(result.today.amount).toBe(500);
    expect(result.today.pct).toBe(2.5);
  });

  test("today.pct is negative when investment_return < 0", async () => {
    mockQuerySingle.mockResolvedValue({
      portfolio_value: 19000,
      total_gain: 500,
      total_gain_pct: 2.5,
      as_of_date: "2026-05-30",
    });
    mockQuery.mockResolvedValue([
      { date: "2026-05-30", portfolio_value: 19000, investment_return: -1.8 },
      { date: "2026-05-29", portfolio_value: 19400, investment_return: 0.5 },
    ]);

    const { getWidget } = await import("../src/commands/widget.js");
    const result = await getWidget(30, "2026-05-30");

    expect(result.today.amount).toBe(-400);
    expect(result.today.pct).toBe(-1.8);
  });

  test("today.amount is zero when only one day of data", async () => {
    mockQuerySingle.mockResolvedValue({
      portfolio_value: 10000,
      total_gain: 0,
      total_gain_pct: 0,
      as_of_date: "2026-05-30",
    });
    mockQuery.mockResolvedValue([
      { date: "2026-05-30", portfolio_value: 10000, investment_return: 0 },
    ]);

    const { getWidget } = await import("../src/commands/widget.js");
    const result = await getWidget(30, "2026-05-30");

    expect(result.today.amount).toBe(0);
    expect(result.today.pct).toBe(0);
  });

  test("today is zero when no daily_returns data", async () => {
    mockQuerySingle.mockResolvedValue({
      portfolio_value: 10000,
      total_gain: 0,
      total_gain_pct: 0,
      as_of_date: "2026-05-30",
    });
    mockQuery.mockResolvedValue([]);

    const { getWidget } = await import("../src/commands/widget.js");
    const result = await getWidget(30, "2026-05-30");

    expect(result.today.amount).toBe(0);
    expect(result.today.pct).toBe(0);
    expect(result.series).toEqual([]);
    expect(result.last_refresh).toBeNull();
  });
});

describe("getWidget — empty database", () => {
  test("handles null status row gracefully", async () => {
    mockQuerySingle.mockResolvedValue(null);
    mockQuery.mockResolvedValue([]);

    const { getWidget } = await import("../src/commands/widget.js");
    const result = await getWidget(30, "2026-05-30");

    expect(result.title).toBe("My holdings");
    expect(result.currency).toBe("USD");
    expect(result.value).toBeNull();
    expect(result.total.amount).toBeNull();
    expect(result.total.pct).toBeNull();
    expect(result.today.amount).toBe(0);
    expect(result.today.pct).toBe(0);
    expect(result.series).toEqual([]);
  });
});

describe("getWidget — CLI integration", () => {
  test("dispatches widget command with default days and returns success envelope", async () => {
    mockQuerySingle.mockResolvedValue({
      portfolio_value: 19257.13,
      total_gain: 4257.13,
      total_gain_pct: 28.3,
      as_of_date: "2026-05-30",
    });
    mockQuery.mockResolvedValue([
      { date: "2026-05-30", portfolio_value: 19257.13, investment_return: 0.65 },
      { date: "2026-05-29", portfolio_value: 19131.63, investment_return: -0.12 },
    ]);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "widget"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("widget");
    expect(output.data.title).toBe("My holdings");
    expect(output.data.currency).toBe("USD");
    expect(output.data.value).toBe(19257.13);
    expect(output.data.today.amount).toBe(125.50);
    expect(output.data.total.amount).toBe(4257.13);
    expect(output.data.total.pct).toBe(28.3);
    expect(output.meta.generated_at).toBeDefined();
    expect(output.meta.count).toBe(2);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("widget with --days 7 limits series", async () => {
    mockQuerySingle.mockResolvedValue({
      portfolio_value: 10000,
      total_gain: 1000,
      total_gain_pct: 10,
      as_of_date: "2026-05-30",
    });
    const rows = [];
    for (let i = 0; i < 8; i++) {
      rows.push({
        date: `2026-05-${23 + i}`,
        portfolio_value: 10000 + i * 10,
        investment_return: 0.1,
      });
    }
    mockQuery.mockResolvedValue(rows);

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "widget", "--days", "7"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.data.series.length).toBe(7);
    expect(output.meta.count).toBe(7);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("widget rejects negative --days", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "widget", "--days", "-1"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.error.code).toBe("VALIDATION_ERROR");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("widget appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("widget");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("getWidget — JSON shape conformance", () => {
  test("all top-level keys present in expected order", async () => {
    mockQuerySingle.mockResolvedValue({
      portfolio_value: 19257.13,
      total_gain: 4257.13,
      total_gain_pct: 28.3,
      as_of_date: "2026-05-30",
    });
    mockQuery.mockResolvedValue([
      { date: "2026-05-30", portfolio_value: 19257.13, investment_return: 0.65 },
      { date: "2026-05-29", portfolio_value: 19131.63, investment_return: -0.12 },
    ]);

    const { getWidget } = await import("../src/commands/widget.js");
    const result = await getWidget(30, "2026-05-30");

    const keys = Object.keys(result);
    expect(keys).toContain("title");
    expect(keys).toContain("currency");
    expect(keys).toContain("as_of_date");
    expect(keys).toContain("last_refresh");
    expect(keys).toContain("value");
    expect(keys).toContain("today");
    expect(keys).toContain("total");
    expect(keys).toContain("series");

    expect(typeof result.title).toBe("string");
    expect(typeof result.currency).toBe("string");
    expect(typeof result.as_of_date).toBe("string");
    expect(typeof result.value === "number" || result.value === null).toBe(true);
    expect(typeof result.today).toBe("object");
    expect(typeof result.total).toBe("object");
    expect(Array.isArray(result.series)).toBe(true);

    if (result.series.length > 0) {
      const pt = result.series[0];
      expect(typeof pt.date).toBe("string");
      expect(typeof pt.value).toBe("number");
    }
  });
});
