import { describe, expect, test, jest, mock } from "bun:test";

const mockEmit = mock((_opts?: any) => ({
  project_dir: "/tmp/test",
  block: "### portfolio-cron-os-start\ntest\n### portfolio-cron-os-end",
  job_count: 1,
}));

const mockInstall = mock((_opts?: any) => ({
  installed: true,
  already_installed: false,
  message: "ok",
  job_count: 6,
}));

const mockRemove = mock((_opts?: any) => ({
  removed: true,
  message: "removed",
}));

const mockList = mock((_opts?: any) => ({
  block_installed: true,
  jobs: [{ name: "j1", command: "re", schedule: "*", enabled: true, log_path: "l", order: 1, installed: true }],
}));

mock.module("../src/commands/cron_os.js", () => ({
  cronOsEmit: mockEmit,
  cronOsInstall: mockInstall,
  cronOsRemove: mockRemove,
  cronOsList: mockList,
}));

mock.module("../src/db.js", () => ({
  query: mock(),
  querySingle: mock(),
  connect: () => {},
  close: async () => {},
}));

mock.module("../src/tx.js", () => ({
  runTx: mock(),
}));

describe("emit", () => {
  test("defaults to emit", async () => {
    const { dispatch } = await import("../src/cli.js");
    const s = jest.spyOn(console, "log").mockImplementation(() => {});
    const e = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await dispatch(["bun", "src/cli.ts", "cron-os"]);
    const o = JSON.parse(s.mock.calls[0][0]);
    expect(o.ok).toBe(true);
    expect(o.data.cron_block).toContain("portfolio-cron-os-start");
    s.mockRestore();
    e.mockRestore();
  });
});

describe("install", () => {
  test("success", async () => {
    const { dispatch } = await import("../src/cli.js");
    const s = jest.spyOn(console, "log").mockImplementation(() => {});
    const e = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await dispatch(["bun", "src/cli.ts", "cron-os", "install"]);
    const o = JSON.parse(s.mock.calls[0][0]);
    expect(o.ok).toBe(true);
    expect(o.data.installed).toBe(true);
    s.mockRestore();
    e.mockRestore();
  });
});

describe("remove", () => {
  test("success", async () => {
    const { dispatch } = await import("../src/cli.js");
    const s = jest.spyOn(console, "log").mockImplementation(() => {});
    const e = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await dispatch(["bun", "src/cli.ts", "cron-os", "remove"]);
    const o = JSON.parse(s.mock.calls[0][0]);
    expect(o.ok).toBe(true);
    expect(o.data.removed).toBe(true);
    s.mockRestore();
    e.mockRestore();
  });
});

describe("list", () => {
  test("success", async () => {
    const { dispatch } = await import("../src/cli.js");
    const s = jest.spyOn(console, "log").mockImplementation(() => {});
    const e = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await dispatch(["bun", "src/cli.ts", "cron-os", "list"]);
    const o = JSON.parse(s.mock.calls[0][0]);
    expect(o.ok).toBe(true);
    expect(o.data.block_installed).toBe(true);
    s.mockRestore();
    e.mockRestore();
  });
});
