import { describe, expect, test, beforeEach, afterEach, jest } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadEnv, parseEnv } from "../src/env.js";

const TRACKED_VARS = [
  "PORTFOLIO_DB_URL",
  "ENV_LOADER_TEST_KEY",
  "ENV_LOADER_TEST_QUOTED",
  "ENV_LOADER_TEST_EXPORT",
  "ENV_LOADER_TEST_COMMENT",
  "ENV_LOADER_TEST_LOWER_PRIORITY",
  "ENV_LOADER_TEST_INNER",
  "ENV_LOADER_TEST_OUTER",
];

let originalEnv: Record<string, string | undefined> = {};
let originalCwd: string = "";
let tmpRoot: string = "";

function captureEnv(): void {
  originalEnv = {};
  for (const key of TRACKED_VARS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  originalCwd = process.cwd();
}

function restoreEnv(): void {
  for (const key of TRACKED_VARS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
  process.chdir(originalCwd);
  if (tmpRoot) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = "";
  }
}

function makeTree(): string {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "env-loader-")));
  return tmpRoot;
}

function writeEnv(dir: string, content: string): string {
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, content);
  return file;
}

beforeEach(captureEnv);
afterEach(restoreEnv);

describe("parseEnv", () => {
  test("handles basic KEY=VALUE pairs", () => {
    expect(parseEnv("A=1\nB=two\nC=")).toEqual({ A: "1", B: "two", C: "" });
  });

  test("ignores blank lines and comments", () => {
    const content = `
# this is a comment
A=1

# another comment
B=2
`;
    expect(parseEnv(content)).toEqual({ A: "1", B: "2" });
  });

  test("strips surrounding single and double quotes", () => {
    expect(parseEnv('A="hi there"\nB=\'single\'\nC=plain')).toEqual({
      A: "hi there",
      B: "single",
      C: "plain",
    });
  });

  test("supports `export` prefix", () => {
    expect(parseEnv("export FOO=bar\nexport  BAR=qux")).toEqual({
      FOO: "bar",
      BAR: "qux",
    });
  });

  test("skips lines without a key separator", () => {
    expect(parseEnv("JUST_NOISE\n=missing_key\n1INVALID=x\nVALID=y")).toEqual({
      VALID: "y",
    });
  });
});

describe("loadEnv upward search", () => {
  test("loads .env from a parent directory when cwd is a child", () => {
    const root = makeTree();
    const child = path.join(root, "a", "b", "c");
    fs.mkdirSync(child, { recursive: true });
    writeEnv(
      root,
      [
        "# parent .env",
        "PORTFOLIO_DB_URL=postgres://x",
        "ENV_LOADER_TEST_KEY=from_parent",
      ].join("\n"),
    );

    process.chdir(child);
    const result = loadEnv();

    expect(result.loaded).toBe(true);
    expect(result.path).toBe(path.join(root, ".env"));
    expect(result.keysLoaded).toBe(2);
    expect(process.env.PORTFOLIO_DB_URL).toBe("postgres://x");
    expect(process.env.ENV_LOADER_TEST_KEY).toBe("from_parent");
  });

  test("stops at the FIRST .env found on the way up", () => {
    const root = makeTree();
    const inner = path.join(root, "inner");
    const leaf = path.join(inner, "leaf");
    fs.mkdirSync(leaf, { recursive: true });
    writeEnv(root, "ENV_LOADER_TEST_OUTER=outer");
    writeEnv(inner, "ENV_LOADER_TEST_INNER=inner");

    process.chdir(leaf);
    const result = loadEnv();

    expect(result.loaded).toBe(true);
    expect(result.path).toBe(path.join(inner, ".env"));
    expect(process.env.ENV_LOADER_TEST_INNER).toBe("inner");
    expect(process.env.ENV_LOADER_TEST_OUTER).toBeUndefined();
  });

  test("returns loaded=false when no .env exists on the path to root", () => {
    const root = makeTree();
    process.chdir(root);
    const result = loadEnv();
    expect(result.loaded).toBe(false);
    expect(result.path).toBeNull();
    expect(result.keysLoaded).toBe(0);
  });
});

describe("loadEnv precedence", () => {
  test("does NOT overwrite a value already in process.env", () => {
    const root = makeTree();
    writeEnv(root, "ENV_LOADER_TEST_KEY=from_file");

    process.env.ENV_LOADER_TEST_KEY = "from_shell";
    process.chdir(root);
    const result = loadEnv();

    expect(result.loaded).toBe(true);
    expect(result.keysLoaded).toBe(0);
    expect(process.env.ENV_LOADER_TEST_KEY).toBe("from_shell");
  });

  test("loads only keys that are undefined in process.env", () => {
    const root = makeTree();
    writeEnv(
      root,
      [
        "ENV_LOADER_TEST_LOWER_PRIORITY=from_file",
        "ENV_LOADER_TEST_KEY=from_file_too",
      ].join("\n"),
    );

    process.env.ENV_LOADER_TEST_LOWER_PRIORITY = "from_shell";
    process.chdir(root);
    const result = loadEnv();

    expect(result.loaded).toBe(true);
    expect(result.keysLoaded).toBe(1);
    expect(process.env.ENV_LOADER_TEST_LOWER_PRIORITY).toBe("from_shell");
    expect(process.env.ENV_LOADER_TEST_KEY).toBe("from_file_too");
  });
});

describe("loadEnv parsing integration", () => {
  test("parses quotes, comments, and `export` prefix from disk", () => {
    const root = makeTree();
    writeEnv(
      root,
      [
        "# top-level comment",
        "export ENV_LOADER_TEST_EXPORT=exported_value",
        "ENV_LOADER_TEST_QUOTED=\"double quoted\"",
        "PORTFOLIO_DB_URL='postgres://from-file'",
        "",
        "  # indented comment",
        "ENV_LOADER_TEST_KEY=plain_value",
      ].join("\n"),
    );

    process.chdir(root);
    const result = loadEnv();

    expect(result.loaded).toBe(true);
    expect(process.env.PORTFOLIO_DB_URL).toBe("postgres://from-file");
    expect(process.env.ENV_LOADER_TEST_QUOTED).toBe("double quoted");
    expect(process.env.ENV_LOADER_TEST_EXPORT).toBe("exported_value");
    expect(process.env.ENV_LOADER_TEST_KEY).toBe("plain_value");
  });

  test("loader is silent — does not write anything to stdout/stderr", () => {
    const root = makeTree();
    writeEnv(root, "PORTFOLIO_DB_URL=postgres://silent");

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    process.chdir(root);
    const result = loadEnv();

    expect(result.loaded).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
