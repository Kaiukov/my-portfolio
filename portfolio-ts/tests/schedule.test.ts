import { describe, expect, test, jest } from "bun:test";

describe("scheduleEmit", () => {
  test("returns correct crontab block with project_dir", async () => {
    const { scheduleEmit } = await import("../src/commands/schedule.js");
    const result = scheduleEmit("/home/user/my-portfolio");
    expect(result.project_dir).toBe("/home/user/my-portfolio");
    expect(result.block).toContain("30 18 * * 1-5");
    expect(result.block).toContain("/home/user/my-portfolio");
    expect(result.block).toContain("portfolio refresh");
  });

  test("defaults project_dir to process.cwd()", async () => {
    const { scheduleEmit } = await import("../src/commands/schedule.js");
    const result = scheduleEmit();
    expect(result.project_dir).toBe(process.cwd());
    expect(result.block).toContain(process.cwd());
  });

  test("block contains managed markers for idempotent install/remove", async () => {
    const { scheduleEmit } = await import("../src/commands/schedule.js");
    const result = scheduleEmit("/home/user/repo");
    expect(result.block).toContain("### portfolio-refresh-start");
    expect(result.block).toContain("### portfolio-refresh-end");
  });

  test("multiple emits produce identical blocks (idempotency at emit level)", async () => {
    const { scheduleEmit } = await import("../src/commands/schedule.js");
    const r1 = scheduleEmit("/home/user/repo");
    const r2 = scheduleEmit("/home/user/repo");
    expect(r1.block).toBe(r2.block);
    expect(r1.project_dir).toBe(r2.project_dir);
  });
});

describe("schedule CLI dispatch", () => {
  test("schedule --emit prints crontab line JSON", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "schedule", "--emit"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("schedule");
    expect(output.data.cron_line).toContain("portfolio refresh");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("refresh appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("refresh");
    expect(output).toContain("schedule");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
