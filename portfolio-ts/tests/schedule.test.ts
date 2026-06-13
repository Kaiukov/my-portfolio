import { describe, expect, test, jest, mock } from "bun:test";

const mockScheduleEmit = mock(() => ({
  project_dir: "/tmp/test",
  block: "### portfolio-refresh-start\ntest block\n### portfolio-refresh-end",
}));

const mockScheduleInstall = mock(() => ({
  installed: true,
  already_present: false,
  message: "installed",
}));

const mockScheduleRemove = mock(() => ({
  removed: true,
  message: "removed",
}));

mock.module("../src/commands/schedule.js", () => ({
  scheduleEmit: mockScheduleEmit,
  scheduleInstall: mockScheduleInstall,
  scheduleRemove: mockScheduleRemove,
}));

mock.module("../src/db.js", () => ({
  query: mock(),
  querySingle: mock(),
  getAssetMetadata: mock(async () => []),
  upsertAssetMetadata: mock(async () => {}),
  getSql: () => ({}),
  connect: () => {},
  close: () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

describe("scheduleEmit", () => {
  test("returns correct crontab block with project_dir", async () => {
    mockScheduleEmit.mockReturnValue({
      project_dir: "/home/user/my-portfolio",
      block: "### start\n30 18 * * 1-5 cd /home/user/my-portfolio && bun run portfolio-ts/src/cli.ts refresh\n### end",
    });

    const { scheduleEmit } = await import("../src/commands/schedule.js");
    const result = scheduleEmit("/home/user/my-portfolio");

    expect(result.project_dir).toBe("/home/user/my-portfolio");
    expect(result.block).toContain("30 18 * * 1-5");
    expect(result.block).toContain("/home/user/my-portfolio");
    expect(result.block).toContain("cli.ts refresh");
  });

  test("block contains managed markers for idempotent install/remove", async () => {
    mockScheduleEmit.mockReturnValue({
      project_dir: "/home/user/repo",
      block: "### portfolio-refresh-start\n### portfolio-refresh-end",
    });

    const { scheduleEmit } = await import("../src/commands/schedule.js");
    const result = scheduleEmit("/home/user/repo");

    expect(result.block).toContain("### portfolio-refresh-start");
    expect(result.block).toContain("### portfolio-refresh-end");
  });

  test("block has no crontab-invalid export line", async () => {
    mockScheduleEmit.mockReturnValue({
      project_dir: "/home/user/repo",
      block: "### start\n# Set PORTFOLIO_DB_URL=... below\n30 18 * * 1-5 cli.ts refresh\n### end",
    });

    const { scheduleEmit } = await import("../src/commands/schedule.js");
    const result = scheduleEmit("/home/user/repo");
    const lines = result.block.split("\n");
    const exportLines = lines.filter((l: string) => l.trim().startsWith("export "));
    expect(exportLines).toEqual([]);
  });
});

describe("schedule CLI dispatch", () => {
  test("schedule emit (bare positional) routes to emit", async () => {
    mockScheduleEmit.mockReturnValue({
      project_dir: "/tmp",
      block: "### start\nschedule emit test\n### end",
    });

    const { dispatch } = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await dispatch(["bun", "src/cli.ts", "schedule", "emit"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("schedule");
    expect(output.data.cron_line).toContain("schedule emit test");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("schedule --emit flag routes to emit", async () => {
    mockScheduleEmit.mockReturnValue({
      project_dir: "/tmp",
      block: "### start\nflag emit test\n### end",
    });

    const { dispatch } = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await dispatch(["bun", "src/cli.ts", "schedule", "--emit"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("schedule");
    expect(output.data.cron_line).toContain("flag emit test");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("schedule install (bare positional) routes to install handler", async () => {
    mockScheduleInstall.mockReturnValue({
      installed: true,
      already_present: false,
      message: "installed",
    });

    const { dispatch } = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await dispatch(["bun", "src/cli.ts", "schedule", "install"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("schedule");
    expect(output.data.installed).toBe(true);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("schedule remove (bare positional) routes to remove handler", async () => {
    mockScheduleRemove.mockReturnValue({
      removed: true,
      message: "removed",
    });

    const { dispatch } = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await dispatch(["bun", "src/cli.ts", "schedule", "remove"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("schedule");
    expect(output.data.removed).toBe(true);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("schedule (no subcommand) defaults to emit", async () => {
    mockScheduleEmit.mockReturnValue({
      project_dir: "/tmp",
      block: "### start\ndefault emit\n### end",
    });

    const { dispatch } = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await dispatch(["bun", "src/cli.ts", "schedule"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("schedule");
    expect(output.data).toHaveProperty("cron_line");

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
