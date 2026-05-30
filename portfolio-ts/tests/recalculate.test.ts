import { describe, expect, test, mock } from "bun:test";
import { ValidationError } from "../src/validators.js";

const mockQuery = mock();
const mockQuerySingle = mock();

mock.module("../src/db.ts", () => ({
  query: mockQuery,
  querySingle: mockQuerySingle,
  withTransaction: mock(),
  connect: () => {},
  close: () => {},
}));

describe("recalculateDryRun", () => {
  test("returns dry_run state without executing SQL", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: true });
    const { recalculateDryRun } = await import("../src/commands/recalculate.js");
    const result = await recalculateDryRun({ force: false });
    expect(result.dry_run).toBe(true);
    expect(result.from_date).toBe("beginning");
    expect(result.forced).toBe(false);
    expect(result.needs_recalc).toBe(true);
  });

  test("parses DD-MM-YYYY from-date", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: false });
    const { recalculateDryRun } = await import("../src/commands/recalculate.js");
    const result = await recalculateDryRun({ fromDateStr: "15-01-2026", force: true });
    expect(result.from_date).toBe("2026-01-15");
    expect(result.forced).toBe(true);
  });

  test("throws on invalid date format", async () => {
    const { recalculateDryRun } = await import("../src/commands/recalculate.js");
    await expect(
      recalculateDryRun({ fromDateStr: "2026-01-15", force: false }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("recalculate", () => {
  test("calls refresh_daily_returns_sql and returns rows_affected", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: true });
    mockQuery.mockResolvedValue([{ refresh_daily_returns_sql: 42 }]);
    const { recalculate } = await import("../src/commands/recalculate.js");
    const result = await recalculate({ force: false });
    expect(result.rows_affected).toBe(42);
    expect(result.recalc_type).toBe("full");
    expect(result.from_date).toBeNull();
  });

  test("skips recalc when not needed", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: false });
    const { recalculate } = await import("../src/commands/recalculate.js");
    const result = await recalculate({ force: false });
    expect(result.rows_affected).toBe(0);
  });

  test("force=true bypasses needs_recalc check", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: false });
    mockQuery.mockResolvedValue([{ refresh_daily_returns_sql: 42 }]);
    const { recalculate } = await import("../src/commands/recalculate.js");
    const result = await recalculate({ force: true });
    expect(result.rows_affected).toBe(42);
  });

  test("partial recalc when from_date provided", async () => {
    mockQuerySingle.mockResolvedValue({ needs_recalc: true });
    mockQuery.mockResolvedValue([{ refresh_daily_returns_sql: 10 }]);
    const { recalculate } = await import("../src/commands/recalculate.js");
    const result = await recalculate({ fromDateStr: "01-01-2026", force: false });
    expect(result.recalc_type).toBe("partial");
    expect(result.from_date).toBe("2026-01-01");
  });
});
