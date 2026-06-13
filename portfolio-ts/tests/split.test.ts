import { describe, expect, test, mock, jest, beforeEach } from "bun:test";
import { ValidationError } from "../src/validators.js";

const mockQuerySingle = mock();
const mockWithTransaction = mock();

mock.module("../src/db.js", () => ({
  query: mock(),
  querySingle: mockQuerySingle,
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mockWithTransaction,
}));

beforeEach(() => {
  mockQuerySingle.mockReset();
  mockWithTransaction.mockReset();
});

describe("applySplit validation", () => {
  test("throws on missing asset", async () => {
    const { applySplit } = await import("../src/commands/split.js");
    await expect(
      applySplit({
        dateStr: "2026-06-01",
        asset: "",
        ratio: 2,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws on zero ratio", async () => {
    const { applySplit } = await import("../src/commands/split.js");
    mockQuerySingle.mockResolvedValueOnce({ ok: false });
    await expect(
      applySplit({
        dateStr: "2026-06-01",
        asset: "AAPL",
        ratio: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws on negative ratio", async () => {
    const { applySplit } = await import("../src/commands/split.js");
    mockQuerySingle.mockResolvedValueOnce({ ok: false });
    await expect(
      applySplit({
        dateStr: "2026-06-01",
        asset: "AAPL",
        ratio: -2,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("throws on cash-like asset", async () => {
    const { applySplit } = await import("../src/commands/split.js");
    mockQuerySingle.mockResolvedValueOnce({ ok: true });
    await expect(
      applySplit({
        dateStr: "2026-06-01",
        asset: "USD",
        ratio: 2,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("accepts ISO YYYY-MM-DD date format", async () => {
    const { applySplit } = await import("../src/commands/split.js");
    mockQuerySingle.mockResolvedValueOnce({ ok: false });
    mockWithTransaction.mockImplementation(async (fn: any) => {
      return fn({
        unsafe: async () => [],
      });
    });
    await expect(
      applySplit({
        dateStr: "2026-06-01",
        asset: "AAPL",
        ratio: 2,
      }),
    ).rejects.toThrow();
  });
});

describe("CLI split command", () => {
  test("rejects without --confirm", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch([
      "bun", "src/cli.ts", "split",
      "--date", "2026-06-01",
      "--asset", "AAPL",
      "--ratio", "2",
    ]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("split");
    expect(output.error.message).toContain("--confirm");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("rejects without --ratio", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch([
      "bun", "src/cli.ts", "split",
      "--date", "2026-06-01",
      "--asset", "AAPL",
      "--confirm",
    ]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("split");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("rejects without --date", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch([
      "bun", "src/cli.ts", "split",
      "--asset", "AAPL",
      "--ratio", "2",
      "--confirm",
    ]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("split");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
