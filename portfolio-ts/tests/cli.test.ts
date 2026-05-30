import { describe, expect, test, mock, jest } from "bun:test";

mock.module("../src/db.js", () => ({
  query: mock(),
  querySingle: mock(),
  runTx: mock(),
  connect: () => {},
  close: async () => {},
}));

describe("CLI parsing", () => {
  test("--help prints help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("portfolio-ts");
    expect(output).toContain("status");
    expect(output).toContain("transactions");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("-h prints help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "-h"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("portfolio-ts");
    expect(output).toContain("status");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("unknown command returns error envelope", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "nonexistent"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("nonexistent");
    expect(output.error.code).toBe("UNKNOWN_COMMAND");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("no command prints help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("portfolio-ts");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
