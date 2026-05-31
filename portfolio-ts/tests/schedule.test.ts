import { describe, expect, test, mock, jest } from "bun:test";

describe("scheduleEmit", () => {
  test("returns correct crontab block with project_dir", () => {
    const schedule = require("../src/commands/schedule.js");
    const result = schedule.scheduleEmit("/home/user/my-portfolio");
    expect(result.project_dir).toBe("/home/user/my-portfolio");
    expect(result.block).toContain("30 18 * * 1-5");
    expect(result.block).toContain("/home/user/my-portfolio");
    expect(result.block).toContain("portfolio refresh");
  });

  test("defaults project_dir to process.cwd()", () => {
    const schedule = require("../src/commands/schedule.js");
    const result = schedule.scheduleEmit();
    expect(result.project_dir).toBe(process.cwd());
    expect(result.block).toContain(process.cwd());
  });
});

describe("scheduleInstall idempotency", () => {
  test("install detects already_present when block exists", async () => {
    const BLOCK_START = "### portfolio-refresh-start (managed — do not edit)";
    const schedule = require("../src/commands/schedule.js");
    const emit = schedule.scheduleEmit("/home/user/repo");

    mock.module("bun", () => ({
      spawnSync: mock((opts: string[] | { cmd?: string[]; stdin?: Uint8Array }) => {
        if (Array.isArray(opts)) {
          if (opts[0] === "crontab" && opts[1] === "-l") {
            return { exitCode: 0, stdout: new TextEncoder().encode(emit.block), stderr: new Uint8Array() };
          }
        }
        return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
      }),
    }));

    const fresh = await import("../src/commands/schedule.js");
    const result = fresh.scheduleInstall("/home/user/repo");
    expect(result.installed).toBe(false);
    expect(result.already_present).toBe(true);
    expect(result.message).toContain("already present");
  });

  test("install succeeds on empty crontab", async () => {
    mock.module("bun", () => ({
      spawnSync: mock((opts: string[] | { cmd?: string[]; stdin?: Uint8Array }) => {
        if (Array.isArray(opts)) {
          if (opts[0] === "crontab" && opts[1] === "-l") {
            return { exitCode: 1, stdout: new Uint8Array(), stderr: new TextEncoder().encode("no crontab for") };
          }
        }
        if (typeof opts === "object" && "cmd" in opts && opts.cmd) {
          if (opts.cmd[0] === "crontab" && opts.cmd[1] === "-") {
            return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
          }
        }
        return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
      }),
    }));

    const fresh = await import("../src/commands/schedule.js");
    const result = fresh.scheduleInstall("/home/user/repo");
    expect(result.installed).toBe(true);
    expect(result.already_present).toBe(false);
    expect(result.message).toContain("installed");
  });
});

describe("scheduleRemove", () => {
  test("remove strips managed block", async () => {
    const schedule = require("../src/commands/schedule.js");
    const emit = schedule.scheduleEmit("/home/user/repo");

    let writtenContent = "";
    mock.module("bun", () => ({
      spawnSync: mock((opts: string[] | { cmd?: string[]; stdin?: Uint8Array }) => {
        if (Array.isArray(opts)) {
          if (opts[0] === "crontab" && opts[1] === "-l") {
            const content = "0 2 * * * /usr/bin/backup.sh\n" + emit.block;
            return { exitCode: 0, stdout: new TextEncoder().encode(content), stderr: new Uint8Array() };
          }
        }
        if (typeof opts === "object" && "cmd" in opts && opts.cmd && opts.stdin) {
          writtenContent = new TextDecoder().decode(opts.stdin);
          return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
        }
        return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
      }),
    }));

    const fresh = await import("../src/commands/schedule.js");
    const result = fresh.scheduleRemove("/home/user/repo");
    expect(result.removed).toBe(true);

    const BLOCK_START = "### portfolio-refresh-start (managed — do not edit)";
    expect(writtenContent).not.toContain(BLOCK_START);
  });

  test("remove on empty crontab returns removed=false", async () => {
    mock.module("bun", () => ({
      spawnSync: mock((opts: string[] | { cmd?: string[]; stdin?: Uint8Array }) => {
        if (Array.isArray(opts)) {
          if (opts[0] === "crontab" && opts[1] === "-l") {
            return { exitCode: 0, stdout: new TextEncoder().encode("0 2 * * * /usr/bin/backup.sh"), stderr: new Uint8Array() };
          }
        }
        return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
      }),
    }));

    const fresh = await import("../src/commands/schedule.js");
    const result = fresh.scheduleRemove();
    expect(result.removed).toBe(false);
    expect(result.message).toContain("No portfolio refresh");
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
