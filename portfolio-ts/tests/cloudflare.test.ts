import { describe, expect, test, mock, jest, afterEach, beforeEach } from "bun:test";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { CloudflareConfig, InitResult } from "../src/cloudflare/types.js";

const tmpDir = join(import.meta.dir, "__cloudflare_test_tmp__");

function setupTmpDir() {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
}

function teardownTmpDir() {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
}

describe("cloudflare types", () => {
  test("AuthResult shape", () => {
    const { AuthResult } = require("../src/cloudflare/types.js");
    const ar = {
      authenticated: false,
      method: null,
      accountId: null,
      error: "test error",
    };
    expect(ar.authenticated).toBe(false);
    expect(ar.method).toBeNull();
  });
});

describe("wrangler.jsonc template", () => {
  test("generates valid JSON with account_id", () => {
    const { generateWranglerJsonc } = require("../src/cloudflare/templates.js");
    const config: CloudflareConfig = {
      account_id: "abcdef1234567890abcdef1234567890",
      wrangler_project_name: "test-widget",
      initialized_at: "2026-05-31T00:00:00.000Z",
    };
    const output = generateWranglerJsonc(config);
    expect(output).toContain('"name": "test-widget"');
    expect(output).toContain('"account_id": "abcdef1234567890abcdef1234567890"');
    expect(output).toContain("PORTFOLIO_KV");
    expect(output).toContain("REPLACE_WITH_YOUR_KV_NAMESPACE_ID");
  });

  test("generates with kv_namespace_id when provided", () => {
    const { generateWranglerJsonc } = require("../src/cloudflare/templates.js");
    const config: CloudflareConfig = {
      account_id: "abcdef1234567890abcdef1234567890",
      kv_namespace_id: "kv1234567890abcdef1234567890",
      wrangler_project_name: "test-widget",
      initialized_at: "2026-05-31T00:00:00.000Z",
    };
    const output = generateWranglerJsonc(config);
    expect(output).toContain('"id": "kv1234567890abcdef1234567890"');
    expect(output).not.toContain("REPLACE_WITH_YOUR_KV_NAMESPACE_ID");
  });
});

describe("worker.js template", () => {
  test("generates worker with fetch handler", () => {
    const { generateWorkerJs } = require("../src/cloudflare/templates.js");
    const output = generateWorkerJs();
    expect(output).toContain("export default");
    expect(output).toContain("async fetch");
    expect(output).toContain("PORTFOLIO_KV");
    expect(output).toContain("/portfolio");
    expect(output).toContain("Access-Control-Allow-Origin");
    expect(output).toContain("corsHeaders");
    expect(output).toContain("/health");
    expect(output).toContain("/version");
    expect(output).toContain("not found");
    expect(output).toContain("OPTIONS");
  });

  test("injects package.json version into /version route", () => {
    const { generateWorkerJs, API_VERSION } = require("../src/cloudflare/templates.js");
    expect(API_VERSION).toBeDefined();
    expect(typeof API_VERSION).toBe("string");
    const output = generateWorkerJs();
    expect(output).toContain(`{ version: "${API_VERSION}" }`);
  });
});

describe("portfolio.json template", () => {
  test("generates correct shape", () => {
    const { generatePortfolioJsonTemplate } = require("../src/cloudflare/templates.js");
    const output = generatePortfolioJsonTemplate();
    expect(output).toHaveProperty("portfolio_value_usd");
    expect(output).toHaveProperty("today");
    expect(output).toHaveProperty("total");
    expect(output).toHaveProperty("history");
    expect(output).toHaveProperty("prices_as_of");
    expect(output).toHaveProperty("as_of_date");
    expect(output).toHaveProperty("updatedAt");
    expect(output.today).toHaveProperty("abs");
    expect(output.today).toHaveProperty("pct");
    expect(output.total).toHaveProperty("abs");
    expect(output.total).toHaveProperty("pct");
    expect(Array.isArray(output.history)).toBe(true);
  });
});

describe("auth detection — explicit env (no global mutation)", () => {
  test("detects auth via env token with account_id", async () => {
    const mod = require("../src/cloudflare/auth.js");
    const result = await mod.detectAuth({
      CLOUDFLARE_API_TOKEN: "mock-token-123",
      CLOUDFLARE_ACCOUNT_ID: "abcdef1234567890abcdef1234567890",
    });
    expect(result.authenticated).toBe(true);
    expect(result.method).toBe("api_token");
    expect(result.accountId).toBe("abcdef1234567890abcdef1234567890");
  });

  test("detects auth via token without account_id", async () => {
    const mod = require("../src/cloudflare/auth.js");
    const result = await mod.detectAuth({
      CLOUDFLARE_API_TOKEN: "mock-token-123",
    });
    expect(result.authenticated).toBe(true);
    expect(result.method).toBe("api_token");
  });

  test("returns unauthenticated when no token and PATH empty", async () => {
    const mod = require("../src/cloudflare/auth.js");
    const result = await mod.detectAuth({ PATH: "", CLOUDFLARE_API_TOKEN: "" });
    expect(result.authenticated).toBe(false);
    expect(result.method).toBeNull();
    expect(result.error).toBeDefined();
  });

  test("error contains wrangler login suggestion", async () => {
    const mod = require("../src/cloudflare/auth.js");
    const result = await mod.detectAuth({ PATH: "/dev/null" });
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain("wrangler login");
    expect(result.error).toContain("CLOUDFLARE_API_TOKEN");
  });
});

describe("parseWranglerWhoami — box-drawing table", () => {
  test("extracts account id from box-drawing table with Account ID row", () => {
    const { parseWranglerWhoami } = require("../src/cloudflare/auth.js");
    const output =
      "├────────────────────────┼──────────────────────────────────┤\n" +
      "│ Account ID             │ abcdef1234567890abcdef1234567890 │\n" +
      "├────────────────────────┼──────────────────────────────────┤\n";
    const result = parseWranglerWhoami(output);
    expect(result).toBe("abcdef1234567890abcdef1234567890");
  });

  test("extracts account id from simple box table with │ separator", () => {
    const { parseWranglerWhoami } = require("../src/cloudflare/auth.js");
    const output = "│ abcdef1234567890abcdef1234567890 │";
    const result = parseWranglerWhoami(output);
    expect(result).toBe("abcdef1234567890abcdef1234567890");
  });

  test("falls back to 32-char hex anywhere in output", () => {
    const { parseWranglerWhoami } = require("../src/cloudflare/auth.js");
    const output = "Some random output containing abcdef1234567890abcdef1234567890 inside text";
    const result = parseWranglerWhoami(output);
    expect(result).toBe("abcdef1234567890abcdef1234567890");
  });

  test("returns null when no 32-char hex found", () => {
    const { parseWranglerWhoami } = require("../src/cloudflare/auth.js");
    const output = "No account id here, just some text";
    const result = parseWranglerWhoami(output);
    expect(result).toBeNull();
  });

  test("handles upper-case hex id", () => {
    const { parseWranglerWhoami } = require("../src/cloudflare/auth.js");
    const output = "│ ABCDEF1234567890ABCDEF1234567890 │";
    const result = parseWranglerWhoami(output);
    expect(result).toBe("ABCDEF1234567890ABCDEF1234567890");
  });

  test("handles mixed-case hex id", () => {
    const { parseWranglerWhoami } = require("../src/cloudflare/auth.js");
    const output = "│ AbCdEf1234567890AbCdEf1234567890 │";
    const result = parseWranglerWhoami(output);
    expect(result).toBe("AbCdEf1234567890AbCdEf1234567890");
  });
});

describe("validateAccountId", () => {
  test("accepts valid 32-char hex account ID", () => {
    const { validateAccountId } = require("../src/cloudflare/auth.js");
    const result = validateAccountId(null, "abcdef1234567890abcdef1234567890");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe("abcdef1234567890abcdef1234567890");
    }
  });

  test("rejects short account ID", () => {
    const { validateAccountId } = require("../src/cloudflare/auth.js");
    const result = validateAccountId(null, "short");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid");
    }
  });

  test("rejects account ID with non-hex chars", () => {
    const { validateAccountId } = require("../src/cloudflare/auth.js");
    const result = validateAccountId(null, "abcdef1234567890abcdef123456789z");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid");
    }
  });

  test("returns error when both are null", () => {
    const { validateAccountId } = require("../src/cloudflare/auth.js");
    const result = validateAccountId(null, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("CLOUDFLARE_ACCOUNT_ID");
    }
  });

  test("falls back to detected accountId when no provided override", () => {
    const { validateAccountId } = require("../src/cloudflare/auth.js");
    const result = validateAccountId("abcdef1234567890abcdef1234567890", undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe("abcdef1234567890abcdef1234567890");
    }
  });
});

describe("config persistence", () => {
  beforeEach(setupTmpDir);
  afterEach(teardownTmpDir);

  test("save and load local config", () => {
    const { saveLocalConfig, loadLocalConfig } = require("../src/cloudflare/config.js");
    const config: CloudflareConfig = {
      account_id: "test-account-id-1234567890abcdef",
      wrangler_project_name: "test-project",
      initialized_at: "2026-05-31T00:00:00.000Z",
    };
    const configPath = saveLocalConfig(config, tmpDir);
    expect(existsSync(configPath)).toBe(true);

    const loaded = loadLocalConfig(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.account_id).toBe("test-account-id-1234567890abcdef");
    expect(loaded!.wrangler_project_name).toBe("test-project");
    expect(loaded!.initialized_at).toBe("2026-05-31T00:00:00.000Z");
  });

  test("loadLocalConfig returns null when file missing", () => {
    const { loadLocalConfig } = require("../src/cloudflare/config.js");
    const loaded = loadLocalConfig(tmpDir);
    expect(loaded).toBeNull();
  });

  test("loadLocalConfig returns null on malformed JSON", () => {
    const { loadLocalConfig } = require("../src/cloudflare/config.js");
    const configDir = join(tmpDir, ".portfolio");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "{invalid json", "utf-8");

    const loaded = loadLocalConfig(tmpDir);
    expect(loaded).toBeNull();
  });
});

describe("cloudflareInit — mocked auth (no global env mutation)", () => {
  let mockDetectAuth: ReturnType<typeof mock>;

  beforeEach(() => {
    setupTmpDir();
    mockDetectAuth = mock();
    mock.module("../src/cloudflare/auth.js", () => ({
      detectAuth: mockDetectAuth,
      validateAccountId: require("../src/cloudflare/auth.js").validateAccountId,
      parseWranglerWhoami: require("../src/cloudflare/auth.js").parseWranglerWhoami,
    }));
  });

  afterEach(() => {
    teardownTmpDir();
    mock.module("../src/cloudflare/auth.js", () => require("../src/cloudflare/auth.js"));
  });

  test("init fails gracefully when no auth", async () => {
    mockDetectAuth.mockResolvedValue({
      authenticated: false,
      method: null,
      accountId: null,
      error: "Not authenticated",
    });

    const { cloudflareInit } = await import("../src/cloudflare/init.js");
    const result = await cloudflareInit({}, tmpDir);

    expect(result.auth.authenticated).toBe(false);
    expect(result.config).toBeNull();
    expect(result.files.wranglerJsonc).toBe("");
    expect(result.files.workerJs).toBe("");
  });

  test("init succeeds with authenticated + valid account_id", async () => {
    mockDetectAuth.mockResolvedValue({
      authenticated: true,
      method: "api_token",
      accountId: "deadbeef12345678deadbeef12345678",
    });

    const { cloudflareInit } = await import("../src/cloudflare/init.js");
    const result = await cloudflareInit({}, tmpDir);

    expect(result.auth.authenticated).toBe(true);
    expect(result.auth.method).toBe("api_token");
    expect(result.auth.accountId).toBe("deadbeef12345678deadbeef12345678");
    expect(result.config).not.toBeNull();
    expect(result.config!.account_id).toBe("deadbeef12345678deadbeef12345678");
    expect(result.files.wranglerJsonc).toContain("cloudflare/wrangler.jsonc");
    expect(result.files.workerJs).toContain("cloudflare/worker.js");
    expect(result.fileActions.wranglerJsonc).toBe("written");
    expect(result.fileActions.workerJs).toBe("written");

    expect(existsSync(join(tmpDir, "cloudflare/wrangler.jsonc"))).toBe(true);
    expect(existsSync(join(tmpDir, "cloudflare/worker.js"))).toBe(true);
    expect(existsSync(join(tmpDir, ".portfolio/config.json"))).toBe(true);

    const wranglerContent = readFileSync(join(tmpDir, "cloudflare/wrangler.jsonc"), "utf-8");
    expect(wranglerContent).toContain("deadbeef12345678deadbeef12345678");

    const workerContent = readFileSync(join(tmpDir, "cloudflare/worker.js"), "utf-8");
    expect(workerContent).toContain("PORTFOLIO_KV");
    expect(workerContent).toContain("/portfolio");
  });

  test("init fails with missing account_id", async () => {
    mockDetectAuth.mockResolvedValue({
      authenticated: true,
      method: "api_token",
      accountId: null,
    });

    const { cloudflareInit } = await import("../src/cloudflare/init.js");
    const result = await cloudflareInit({}, tmpDir);

    expect(result.auth.authenticated).toBe(true);
    expect(result.auth.error).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(result.config).toBeNull();
  });

  test("init uses --account-id override", async () => {
    mockDetectAuth.mockResolvedValue({
      authenticated: true,
      method: "api_token",
      accountId: "deadbeef12345678deadbeef12345678",
    });

    const { cloudflareInit } = await import("../src/cloudflare/init.js");
    const result = await cloudflareInit({ accountId: "cafecafe12345678cafecafe12345678" }, tmpDir);

    expect(result.config!.account_id).toBe("cafecafe12345678cafecafe12345678");

    const wranglerContent = readFileSync(join(tmpDir, "cloudflare/wrangler.jsonc"), "utf-8");
    expect(wranglerContent).toContain("cafecafe12345678cafecafe12345678");
  });

  test("init uses --project-name override", async () => {
    mockDetectAuth.mockResolvedValue({
      authenticated: true,
      method: "api_token",
      accountId: "deadbeef12345678deadbeef12345678",
    });

    const { cloudflareInit } = await import("../src/cloudflare/init.js");
    const result = await cloudflareInit({ projectName: "my-custom-widget" }, tmpDir);

    const wranglerContent = readFileSync(join(tmpDir, "cloudflare/wrangler.jsonc"), "utf-8");
    expect(wranglerContent).toContain('"name": "my-custom-widget"');
    expect(result.config!.wrangler_project_name).toBe("my-custom-widget");
  });

  test("init generates warnings when no kv_namespace_id", async () => {
    mockDetectAuth.mockResolvedValue({
      authenticated: true,
      method: "api_token",
      accountId: "deadbeef12345678deadbeef12345678",
    });

    const { cloudflareInit } = await import("../src/cloudflare/init.js");
    const result = await cloudflareInit({}, tmpDir);

    expect(result.warnings.length).toBeGreaterThan(0);
    const kvWarning = result.warnings.find((w) => w.includes("KV namespace"));
    expect(kvWarning).toBeDefined();
  });

  test("rejects invalid account_id format", async () => {
    mockDetectAuth.mockResolvedValue({
      authenticated: true,
      method: "api_token",
      accountId: null,
    });

    const { cloudflareInit } = await import("../src/cloudflare/init.js");
    const result = await cloudflareInit({ accountId: "bad-format" }, tmpDir);

    expect(result.auth.authenticated).toBe(true);
    expect(result.auth.error).toContain("Invalid");
    expect(result.config).toBeNull();
  });
});

describe("cloudflareInit — force guard", () => {
  let mockDetectAuth: ReturnType<typeof mock>;

  beforeEach(() => {
    setupTmpDir();
    mockDetectAuth = mock();
    mock.module("../src/cloudflare/auth.js", () => ({
      detectAuth: mockDetectAuth,
      validateAccountId: require("../src/cloudflare/auth.js").validateAccountId,
      parseWranglerWhoami: require("../src/cloudflare/auth.js").parseWranglerWhoami,
    }));
  });

  afterEach(() => {
    teardownTmpDir();
    mock.module("../src/cloudflare/auth.js", () => require("../src/cloudflare/auth.js"));
  });

  test("skips existing files when force is false", async () => {
    mockDetectAuth.mockResolvedValue({
      authenticated: true,
      method: "api_token",
      accountId: "deadbeef12345678deadbeef12345678",
    });

    const cloudflareDir = join(tmpDir, "cloudflare");
    mkdirSync(cloudflareDir, { recursive: true });
    writeFileSync(join(cloudflareDir, "wrangler.jsonc"), '{"name":"user-edited"}', "utf-8");
    writeFileSync(join(cloudflareDir, "worker.js"), "// user custom worker", "utf-8");

    const { cloudflareInit } = await import("../src/cloudflare/init.js");
    const result = await cloudflareInit({}, tmpDir);

    expect(result.fileActions.wranglerJsonc).toBe("skipped");
    expect(result.fileActions.workerJs).toBe("skipped");

    const wranglerContent = readFileSync(join(cloudflareDir, "wrangler.jsonc"), "utf-8");
    expect(wranglerContent).toBe('{"name":"user-edited"}');

    const workerContent = readFileSync(join(cloudflareDir, "worker.js"), "utf-8");
    expect(workerContent).toBe("// user custom worker");
  });

  test("overwrites existing files when force is true", async () => {
    mockDetectAuth.mockResolvedValue({
      authenticated: true,
      method: "api_token",
      accountId: "deadbeef12345678deadbeef12345678",
    });

    const cloudflareDir = join(tmpDir, "cloudflare");
    mkdirSync(cloudflareDir, { recursive: true });
    writeFileSync(join(cloudflareDir, "wrangler.jsonc"), '{"name":"user-edited"}', "utf-8");
    writeFileSync(join(cloudflareDir, "worker.js"), "// user custom worker", "utf-8");

    const { cloudflareInit } = await import("../src/cloudflare/init.js");
    const result = await cloudflareInit({ force: true }, tmpDir);

    expect(result.fileActions.wranglerJsonc).toBe("written");
    expect(result.fileActions.workerJs).toBe("written");

    const wranglerContent = readFileSync(join(cloudflareDir, "wrangler.jsonc"), "utf-8");
    expect(wranglerContent).toContain("deadbeef12345678deadbeef12345678");
    expect(wranglerContent).not.toContain("user-edited");

    const workerContent = readFileSync(join(cloudflareDir, "worker.js"), "utf-8");
    expect(workerContent).toContain("PORTFOLIO_KV");
    expect(workerContent).not.toContain("user custom worker");
  });

  test("warns when files are skipped", async () => {
    mockDetectAuth.mockResolvedValue({
      authenticated: true,
      method: "api_token",
      accountId: "deadbeef12345678deadbeef12345678",
    });

    const cloudflareDir = join(tmpDir, "cloudflare");
    mkdirSync(cloudflareDir, { recursive: true });
    writeFileSync(join(cloudflareDir, "wrangler.jsonc"), "existing", "utf-8");

    const { cloudflareInit } = await import("../src/cloudflare/init.js");
    const result = await cloudflareInit({}, tmpDir);

    const skipWarning = result.warnings.find((w) => w.includes("already exists"));
    expect(skipWarning).toBeDefined();
    expect(skipWarning).toContain("--force");
  });

  test("writes files on first run (no existing files)", async () => {
    mockDetectAuth.mockResolvedValue({
      authenticated: true,
      method: "api_token",
      accountId: "deadbeef12345678deadbeef12345678",
    });

    const { cloudflareInit } = await import("../src/cloudflare/init.js");
    const result = await cloudflareInit({}, tmpDir);

    expect(result.fileActions.wranglerJsonc).toBe("written");
    expect(result.fileActions.workerJs).toBe("written");
  });
});

describe("cloudflare CLI integration — mocked init (no global env)", () => {
  afterEach(() => {
    mock.module("../src/cloudflare/init.js", () => require("../src/cloudflare/init.js"));
  });

  test("dispatches cloudflare init with auth error returns error envelope", async () => {
    const mockInit = mock().mockResolvedValue({
      auth: {
        authenticated: false,
        method: null,
        accountId: null,
        error: "No Cloudflare authentication detected. Run `wrangler login` or set CLOUDFLARE_API_TOKEN env variable.",
      },
      config: null,
      files: { wranglerJsonc: "", workerJs: "" },
      fileActions: { wranglerJsonc: "none" as const, workerJs: "none" as const },
      warnings: [],
    } satisfies InitResult);

    mock.module("../src/cloudflare/init.js", () => ({
      cloudflareInit: mockInit,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "init"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("cloudflare:init");
    expect(output.error.code).toBe("AUTH_FAILED");
    expect(output.error.message).toContain("wrangler login");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("cloudflare with no subcommand returns error", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.error.code).toBe("VALIDATION_ERROR");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("cloudflare with unknown subcommand returns error", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "xyz-nope"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.error.code).toBe("UNKNOWN_SUBCOMMAND");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("cloudflare appears in help text", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "--help"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0];
    expect(output).toContain("cloudflare");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("cloudflare init — missing account_id error code via mocked init", () => {
  afterEach(() => {
    mock.module("../src/cloudflare/init.js", () => require("../src/cloudflare/init.js"));
  });

  test("returns MISSING_ACCOUNT_ID when CLOUDFLARE_ACCOUNT_ID not set", async () => {
    const mockInit = mock().mockResolvedValue({
      auth: {
        authenticated: true,
        method: "api_token",
        accountId: null,
        error: "CLOUDFLARE_ACCOUNT_ID is required. Set it via env variable or provide --account-id.",
      },
      config: null,
      files: { wranglerJsonc: "", workerJs: "" },
      fileActions: { wranglerJsonc: "none" as const, workerJs: "none" as const },
      warnings: [],
    } satisfies InitResult);

    mock.module("../src/cloudflare/init.js", () => ({
      cloudflareInit: mockInit,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "init"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.error.code).toBe("MISSING_ACCOUNT_ID");
    expect(output.error.message).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("returns success when config is present", async () => {
    const mockInit = mock().mockResolvedValue({
      auth: {
        authenticated: true,
        method: "api_token",
        accountId: "deadbeef12345678deadbeef12345678",
      },
      config: {
        account_id: "deadbeef12345678deadbeef12345678",
        wrangler_project_name: "portfolio-widget",
        initialized_at: "2026-05-31T00:00:00.000Z",
      },
      files: {
        wranglerJsonc: "cloudflare/wrangler.jsonc",
        workerJs: "cloudflare/worker.js",
      },
      fileActions: { wranglerJsonc: "written" as const, workerJs: "written" as const },
      warnings: [],
    } satisfies InitResult);

    mock.module("../src/cloudflare/init.js", () => ({
      cloudflareInit: mockInit,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "init"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cloudflare:init");
    expect(output.data.auth.accountId).toBe("deadbeef12345678deadbeef12345678");
    expect(output.data.config.account_id).toBe("deadbeef12345678deadbeef12345678");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ─── parseDeployedUrl ───────────────────────────────────────────

describe("parseDeployedUrl", () => {
  test("extracts workers.dev URL from realistic wrangler deploy output", () => {
    const { parseDeployedUrl } = require("../src/cloudflare/deploy.js");
    const output = `
 ⛅️ wrangler 4.46.0 (update available 4.47.3)
────────────────────────────────────────────

▲ [WARNING] Processing wrangler.jsonc configuration:

    - "kv_namespaces" fields are deprecated and will be removed in a future version of Wrangler.


Total Upload: 0.45 KiB / 1 file
Worker Startup Time: 5 ms
Uploaded portfolio-widget (2.34 sec)
Deployed portfolio-widget triggers (0.81 sec)
  https://portfolio-widget.username.workers.dev
Current Deployment ID: abc123-def456-ghi789
`;
    const result = parseDeployedUrl(output);
    expect(result).toBe("https://portfolio-widget.username.workers.dev");
  });

  test("extracts URL with subdomain dots", () => {
    const { parseDeployedUrl } = require("../src/cloudflare/deploy.js");
    const output = "  https://my-worker.sub.domain.workers.dev";
    expect(parseDeployedUrl(output)).toBe("https://my-worker.sub.domain.workers.dev");
  });

  test("strips trailing slash", () => {
    const { parseDeployedUrl } = require("../src/cloudflare/deploy.js");
    const output = "  https://portfolio-widget.username.workers.dev/";
    expect(parseDeployedUrl(output)).toBe("https://portfolio-widget.username.workers.dev");
  });

  test("returns null when no workers.dev URL present", () => {
    const { parseDeployedUrl } = require("../src/cloudflare/deploy.js");
    const output = "Some random output without a URL";
    expect(parseDeployedUrl(output)).toBeNull();
  });

  test("returns null when only non-workers.dev URLs present", () => {
    const { parseDeployedUrl } = require("../src/cloudflare/deploy.js");
    const output = "https://example.com/deploy-success";
    expect(parseDeployedUrl(output)).toBeNull();
  });
});

// ─── getWidgetUrl ───────────────────────────────────────────────

describe("getWidgetUrl", () => {
  beforeEach(setupTmpDir);
  afterEach(teardownTmpDir);

  test("returns saved URL from config", () => {
    const { saveLocalConfig } = require("../src/cloudflare/config.js");
    const { getWidgetUrl } = require("../src/cloudflare/url.js");

    saveLocalConfig(
      {
        account_id: "abc123",
        wrangler_project_name: "test",
        initialized_at: "2026-01-01T00:00:00.000Z",
        widget_url: "https://test.user.workers.dev/portfolio",
      },
      tmpDir,
    );

    const result = getWidgetUrl(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://test.user.workers.dev/portfolio");
  });

  test("returns error when no config exists", () => {
    const { getWidgetUrl } = require("../src/cloudflare/url.js");
    const result = getWidgetUrl(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Not deployed yet");
  });

  test("returns error when config has no widget_url", () => {
    const { saveLocalConfig } = require("../src/cloudflare/config.js");
    const { getWidgetUrl } = require("../src/cloudflare/url.js");

    saveLocalConfig(
      {
        account_id: "abc123",
        wrangler_project_name: "test",
        initialized_at: "2026-01-01T00:00:00.000Z",
      },
      tmpDir,
    );

    const result = getWidgetUrl(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("deploy");
  });
});

// ─── deployWorker — mocked spawn ─────────────────────────────────

describe("deployWorker — mocked spawn", () => {
  let mockSpawn: ReturnType<typeof mock>;

  beforeEach(() => {
    setupTmpDir();
    mockSpawn = mock();
    mock.module("../src/cloudflare/spawn.js", () => ({
      spawnWrangler: mockSpawn,
    }));
  });

  afterEach(() => {
    teardownTmpDir();
    mock.module("../src/cloudflare/spawn.js", () => require("../src/cloudflare/spawn.js"));
  });

  test("deploys, parses URL, saves config", async () => {
    mockSpawn.mockReturnValue({
      stdout: "Uploaded portfolio-widget (2.34 sec)\n  https://portfolio-widget.username.workers.dev\n",
      stderr: "",
      exitCode: 0,
    });

    const { deployWorker } = await import("../src/cloudflare/deploy.js");
    const result = await deployWorker(tmpDir);

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://portfolio-widget.username.workers.dev/portfolio");

    const { loadLocalConfig } = require("../src/cloudflare/config.js");
    const config = loadLocalConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.widget_url).toBe("https://portfolio-widget.username.workers.dev/portfolio");
  });

  test("returns error when wrangler deploy fails", async () => {
    mockSpawn.mockReturnValue({
      stdout: "",
      stderr: "Error: authentication failed",
      exitCode: 1,
    });

    const { deployWorker } = await import("../src/cloudflare/deploy.js");
    const result = await deployWorker(tmpDir);

    expect(result.success).toBe(false);
    expect(result.error).toContain("wrangler deploy failed");
    expect(result.url).toBeNull();
  });

  test("returns error when URL cannot be parsed", async () => {
    mockSpawn.mockReturnValue({
      stdout: "Deploy succeeded but no URL here",
      stderr: "",
      exitCode: 0,
    });

    const { deployWorker } = await import("../src/cloudflare/deploy.js");
    const result = await deployWorker(tmpDir);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not parse");
  });
});

// ─── parseWhoamiOutput ─────────────────────────────────────────

describe("parseWhoamiOutput", () => {
  test("parses authenticated whoami with full details", async () => {
    const mod = await import("../src/cloudflare/auth.js");
    const { parseWhoamiOutput } = mod;
    const output = `
 ⛅️ wrangler 4.46.0
──────────────────
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email kayukov2010@gmail.com.
┌─────────────────────────────────┬──────────────────────────────────┐
│ Account Name                    │ Account ID                       │
├─────────────────────────────────┼──────────────────────────────────┤
│ Kayukov2010@gmail.com's Account │ dd7ab9be93db46931523f62d3fe7f581 │
└─────────────────────────────────┴──────────────────────────────────┘
`;
    const result = parseWhoamiOutput(output);
    expect(result.authenticated).toBe(true);
    expect(result.email).toBe("kayukov2010@gmail.com");
    expect(result.accountName).toBe("Kayukov2010@gmail.com's Account");
    expect(result.accountId).toBe("dd7ab9be93db46931523f62d3fe7f581");
  });

  test("parses whoami with account ID but no email", async () => {
    const mod = await import("../src/cloudflare/auth.js");
    const { parseWhoamiOutput } = mod;
    const output = `
┌────────────────────────┬──────────────────────────────────┐
│ Account ID             │ abcdef1234567890abcdef1234567890 │
└────────────────────────┴──────────────────────────────────┘
`;
    const result = parseWhoamiOutput(output);
    expect(result.authenticated).toBe(true);
    expect(result.accountId).toBe("abcdef1234567890abcdef1234567890");
    expect(result.email).toBeUndefined();
  });

  test("detects not-authenticated state", async () => {
    const mod = await import("../src/cloudflare/auth.js");
    const { parseWhoamiOutput } = mod;
    const output = `
 ⛅️ wrangler 4.46.0
──────────────────
✘ You are not authenticated. Run \`wrangler login\` to authenticate.
`;
    const result = parseWhoamiOutput(output);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain("Not authenticated");
  });

  test("parses whoami with upper-case hex account ID", async () => {
    const mod = await import("../src/cloudflare/auth.js");
    const { parseWhoamiOutput } = mod;
    const output =
      "│ Account ID             │ ABCDEF1234567890ABCDEF1234567890 │";
    const result = parseWhoamiOutput(output);
    expect(result.authenticated).toBe(true);
    expect(result.accountId).toBe("ABCDEF1234567890ABCDEF1234567890");
  });

  test("handles empty whoami output gracefully", async () => {
    const mod = await import("../src/cloudflare/auth.js");
    const { parseWhoamiOutput } = mod;
    const output = "";
    const result = parseWhoamiOutput(output);
    expect(result.authenticated).toBe(false);
  });
});

// ─── runWranglerWhoami — mocked spawn ────────────────────────────

describe("runWranglerWhoami — mocked spawn", () => {
  let mockSpawn: ReturnType<typeof mock>;

  beforeEach(() => {
    mockSpawn = mock();
    mock.module("../src/cloudflare/spawn.js", () => ({
      spawnWrangler: mockSpawn,
    }));
  });

  afterEach(() => {
    mock.module("../src/cloudflare/spawn.js", () => require("../src/cloudflare/spawn.js"));
  });

  test("returns whoami info on success", async () => {
    mockSpawn.mockReturnValue({
      stdout: "👋 You are logged in with an OAuth Token, associated with the email user@example.com!\n│ Account ID │ abcdef1234567890abcdef1234567890 │",
      stderr: "",
      exitCode: 0,
    });

    const mod = await import("../src/cloudflare/auth.js");
    const { runWranglerWhoami } = mod;
    const result = runWranglerWhoami();

    expect(result.authenticated).toBe(true);
    expect(result.email).toBe("user@example.com");
  });

  test("returns error when whoami fails", async () => {
    mockSpawn.mockReturnValue({
      stdout: "",
      stderr: "You are not authenticated",
      exitCode: 1,
    });

    const mod = await import("../src/cloudflare/auth.js");
    const { runWranglerWhoami } = mod;
    const result = runWranglerWhoami();

    expect(result.authenticated).toBe(false);
    expect(result.error).toContain("wrangler whoami failed");
  });
});

// ─── runWranglerLogin / runWranglerLogout — mocked spawn ─────────

describe("runWranglerLogin / runWranglerLogout — mocked spawn", () => {
  let mockSpawn: ReturnType<typeof mock>;

  beforeEach(() => {
    mockSpawn = mock();
    mock.module("../src/cloudflare/spawn.js", () => ({
      spawnWrangler: mockSpawn,
    }));
  });

  afterEach(() => {
    mock.module("../src/cloudflare/spawn.js", () => require("../src/cloudflare/spawn.js"));
  });

  test("login invokes wrangler login with inherit", async () => {
    mockSpawn.mockReturnValue({ stdout: "", stderr: "", exitCode: 0 });

    const mod = await import("../src/cloudflare/auth.js");
    const { runWranglerLogin } = mod;
    const result = runWranglerLogin();

    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const callArgs = mockSpawn.mock.calls[0];
    expect(callArgs[0]).toEqual(["login"]);
    expect(callArgs[1]).toEqual({ inherit: true });
  });

  test("login returns error on failure", async () => {
    mockSpawn.mockReturnValue({
      stdout: "",
      stderr: "Failed to open browser",
      exitCode: 1,
    });

    const mod = await import("../src/cloudflare/auth.js");
    const { runWranglerLogin } = mod;
    const result = runWranglerLogin();

    expect(result.success).toBe(false);
    expect(result.error).toContain("wrangler login failed");
  });

  test("logout invokes wrangler logout with inherit", async () => {
    mockSpawn.mockReturnValue({ stdout: "", stderr: "", exitCode: 0 });

    const mod = await import("../src/cloudflare/auth.js");
    const { runWranglerLogout } = mod;
    const result = runWranglerLogout();

    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const callArgs = mockSpawn.mock.calls[0];
    expect(callArgs[0]).toEqual(["logout"]);
    expect(callArgs[1]).toEqual({ inherit: true });
  });

  test("logout returns error on failure", async () => {
    mockSpawn.mockReturnValue({
      stdout: "",
      stderr: "No credentials to remove",
      exitCode: 1,
    });

    const mod = await import("../src/cloudflare/auth.js");
    const { runWranglerLogout } = mod;
    const result = runWranglerLogout();

    expect(result.success).toBe(false);
    expect(result.error).toContain("wrangler logout failed");
  });
});

// ─── CLI integration — cloudflare deploy ─────────────────────────

describe("cloudflare deploy CLI — mocked deploy", () => {
  afterEach(() => {
    mock.module("../src/cloudflare/deploy.js", () => require("../src/cloudflare/deploy.js"));
  });

  test("returns success envelope on deploy", async () => {
    const mockDeploy = mock().mockResolvedValue({
      success: true,
      url: "https://portfolio-widget.username.workers.dev/portfolio",
    });

    mock.module("../src/cloudflare/deploy.js", () => ({
      deployWorker: mockDeploy,
      parseDeployedUrl: require("../src/cloudflare/deploy.js").parseDeployedUrl,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "deploy"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cloudflare:deploy");
    expect(output.data.url).toBe("https://portfolio-widget.username.workers.dev/portfolio");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("returns error envelope when deploy fails", async () => {
    const mockDeploy = mock().mockResolvedValue({
      success: false,
      url: null,
      error: "wrangler deploy failed (exit code 1)",
    });

    mock.module("../src/cloudflare/deploy.js", () => ({
      deployWorker: mockDeploy,
      parseDeployedUrl: require("../src/cloudflare/deploy.js").parseDeployedUrl,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "deploy"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("cloudflare:deploy");
    expect(output.error.code).toBe("DEPLOY_FAILED");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ─── CLI integration — cloudflare url ────────────────────────────

describe("cloudflare url CLI — mocked url", () => {
  afterEach(() => {
    mock.module("../src/cloudflare/url.js", () => require("../src/cloudflare/url.js"));
  });

  test("returns success envelope with saved URL", async () => {
    const mockGetUrl = mock().mockReturnValue({
      ok: true,
      url: "https://test.user.workers.dev/portfolio",
    });

    mock.module("../src/cloudflare/url.js", () => ({
      getWidgetUrl: mockGetUrl,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "url"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cloudflare:url");
    expect(output.data.url).toBe("https://test.user.workers.dev/portfolio");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("returns error envelope when not deployed", async () => {
    const mockGetUrl = mock().mockReturnValue({
      ok: false,
      error: "Not deployed yet. Run `portfolio cloudflare deploy` first.",
    });

    mock.module("../src/cloudflare/url.js", () => ({
      getWidgetUrl: mockGetUrl,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "url"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("cloudflare:url");
    expect(output.error.code).toBe("NOT_DEPLOYED");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ─── CLI integration — cloudflare login / logout ─────────────────

describe("cloudflare login/logout CLI — mocked auth", () => {
  afterEach(() => {
    mock.module("../src/cloudflare/auth.js", () => require("../src/cloudflare/auth.js"));
  });

  test("cloudflare login returns success", async () => {
    const mockLogin = mock().mockReturnValue({ success: true });
    const mockLogout = () => ({ success: true });
    const mockWhoami = () => ({ authenticated: false });

    mock.module("../src/cloudflare/auth.js", () => ({
      ...require("../src/cloudflare/auth.js"),
      runWranglerLogin: mockLogin,
      runWranglerLogout: mockLogout,
      runWranglerWhoami: mockWhoami,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "login"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cloudflare:login");
    expect(output.data.authenticated).toBe(true);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("cloudflare login returns error on failure", async () => {
    const mockLogin = mock().mockReturnValue({
      success: false,
      error: "wrangler login failed",
    });
    const mockLogout = () => ({ success: true });
    const mockWhoami = () => ({ authenticated: false });

    mock.module("../src/cloudflare/auth.js", () => ({
      ...require("../src/cloudflare/auth.js"),
      runWranglerLogin: mockLogin,
      runWranglerLogout: mockLogout,
      runWranglerWhoami: mockWhoami,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "login"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.error.code).toBe("LOGIN_FAILED");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("cloudflare logout returns success", async () => {
    const mockLogout = mock().mockReturnValue({ success: true });
    const mockLogin = () => ({ success: false });
    const mockWhoami = () => ({ authenticated: false });

    mock.module("../src/cloudflare/auth.js", () => ({
      ...require("../src/cloudflare/auth.js"),
      runWranglerLogin: mockLogin,
      runWranglerLogout: mockLogout,
      runWranglerWhoami: mockWhoami,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "logout"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cloudflare:logout");
    expect(output.data.authenticated).toBe(false);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ─── CLI integration — cloudflare whoami ─────────────────────────

describe("cloudflare whoami CLI — mocked auth", () => {
  afterEach(() => {
    mock.module("../src/cloudflare/auth.js", () => require("../src/cloudflare/auth.js"));
  });

  test("returns whoami success envelope", async () => {
    const mockWhoami = mock().mockReturnValue({
      authenticated: true,
      accountName: "My Account",
      accountId: "abcdef1234567890abcdef1234567890",
      email: "user@example.com",
    });
    const mockLogin = () => ({ success: false });
    const mockLogout = () => ({ success: false });

    mock.module("../src/cloudflare/auth.js", () => ({
      ...require("../src/cloudflare/auth.js"),
      runWranglerLogin: mockLogin,
      runWranglerLogout: mockLogout,
      runWranglerWhoami: mockWhoami,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "whoami"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cloudflare:whoami");
    expect(output.data.authenticated).toBe(true);
    expect(output.data.account_name).toBe("My Account");
    expect(output.data.account_id).toBe("abcdef1234567890abcdef1234567890");
    expect(output.data.email).toBe("user@example.com");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("returns whoami not-authenticated error", async () => {
    const mockWhoami = mock().mockReturnValue({
      authenticated: false,
      error: "Not authenticated. Run `wrangler login` first.",
    });
    const mockLogin = () => ({ success: false });
    const mockLogout = () => ({ success: false });

    mock.module("../src/cloudflare/auth.js", () => ({
      ...require("../src/cloudflare/auth.js"),
      runWranglerLogin: mockLogin,
      runWranglerLogout: mockLogout,
      runWranglerWhoami: mockWhoami,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "whoami"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("cloudflare:whoami");
    expect(output.error.code).toBe("NOT_AUTHENTICATED");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ─── cloudflare unknown subcommand (updated message) ────────────

describe("cloudflare unknown subcommand after #106", () => {
  test("lists updated subcommands with publish in error message", async () => {
    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "fake"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.error.message).toContain("publish");

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ─── validateSnapshot ──────────────────────────────────────────────

describe("validateSnapshot", () => {
  function validSnapshot() {
    return {
      portfolio_value_usd: 15424.58,
      today: { abs: -174.83, pct: -1.12 },
      total: { abs: 369.03, pct: 2.91 },
      history: [{ date: "2026-05-30", value: 15123.40 }],
      prices_as_of: "2026-05-30",
      as_of_date: "2026-05-31",
      updatedAt: "2026-05-31T12:00:00.000Z",
    };
  }

  test("accepts valid snapshot", async () => {
    const { validateSnapshot } = await import("../src/cloudflare/publish.js");
    expect(validateSnapshot(validSnapshot())).toBeNull();
  });

  test("rejects NaN portfolio_value_usd", async () => {
    const { validateSnapshot } = await import("../src/cloudflare/publish.js");
    const s = validSnapshot();
    s.portfolio_value_usd = NaN;
    expect(validateSnapshot(s)).toContain("portfolio_value_usd");
  });

  test("rejects NaN today.abs", async () => {
    const { validateSnapshot } = await import("../src/cloudflare/publish.js");
    const s = validSnapshot();
    s.today.abs = NaN;
    expect(validateSnapshot(s)).toContain("today.abs");
  });

  test("rejects NaN today.pct", async () => {
    const { validateSnapshot } = await import("../src/cloudflare/publish.js");
    const s = validSnapshot();
    s.today.pct = NaN;
    expect(validateSnapshot(s)).toContain("today.pct");
  });

  test("rejects NaN total.abs", async () => {
    const { validateSnapshot } = await import("../src/cloudflare/publish.js");
    const s = validSnapshot();
    s.total.abs = NaN;
    expect(validateSnapshot(s)).toContain("total.abs");
  });

  test("rejects NaN total.pct", async () => {
    const { validateSnapshot } = await import("../src/cloudflare/publish.js");
    const s = validSnapshot();
    s.total.pct = NaN;
    expect(validateSnapshot(s)).toContain("total.pct");
  });

  test("rejects missing history", async () => {
    const { validateSnapshot } = await import("../src/cloudflare/publish.js");
    const s = validSnapshot();
    (s as Record<string, unknown>).history = null;
    expect(validateSnapshot(s as unknown as ReturnType<typeof validSnapshot>)).toContain("history");
  });

  test("rejects missing as_of_date", async () => {
    const { validateSnapshot } = await import("../src/cloudflare/publish.js");
    const s = validSnapshot();
    s.as_of_date = "";
    expect(validateSnapshot(s)).toContain("as_of_date");
  });

  test("rejects missing updatedAt", async () => {
    const { validateSnapshot } = await import("../src/cloudflare/publish.js");
    const s = validSnapshot();
    s.updatedAt = "";
    expect(validateSnapshot(s)).toContain("updatedAt");
  });
});

// ─── publishToKv — mocked services + spawn + config ─────────────────

describe("publishToKv — mocked services + spawn + config", () => {
  const TMP = join(import.meta.dir, "__publish_test_tmp__");

  let mockSpawn: ReturnType<typeof mock>;

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
    mkdirSync(TMP, { recursive: true });

    mockSpawn = mock();
    mock.module("../src/cloudflare/spawn.js", () => ({
      spawnWrangler: mockSpawn,
    }));
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
    mock.module("../src/cloudflare/spawn.js", () => require("../src/cloudflare/spawn.js"));
  });

  function writeConfig(kvNamespaceId?: string) {
    const { saveLocalConfig } = require("../src/cloudflare/config.js");
    saveLocalConfig(
      {
        account_id: "abcdef1234567890abcdef1234567890",
        kv_namespace_id: kvNamespaceId,
        wrangler_project_name: "portfolio-widget",
        initialized_at: "2026-05-31T00:00:00.000Z",
      },
      TMP,
    );
  }

  test("builds snapshot from mocked services, publishes via wrangler kv", async () => {
    writeConfig("kv-namespace-12345");

    mockSpawn.mockReturnValue({ stdout: "OK", stderr: "", exitCode: 0 });

    const mockQuerySingle = mock();
    const mockQuery = mock();

    mockQuerySingle.mockResolvedValue({
      holding_count: 5,
      total_cash_usd: 500,
      portfolio_value_usd: 15424.58,
      last_transaction_date: "2026-05-30",
      transaction_count: 42,
      as_of_date: "2026-05-31",
    });

    mockQuery.mockResolvedValue([
      { date: "2026-05-30", portfolio_value: 15424.58, investment_return: -1.12 },
      { date: "2026-05-29", portfolio_value: 15599.41, investment_return: 0.80 },
      { date: "2026-05-28", portfolio_value: 15475.10, investment_return: 0.35 },
    ]);

    mock.module("../src/db.js", () => ({
      query: mockQuery,
      querySingle: mockQuerySingle,
      connect: () => {},
      close: () => {},
    }));

    mock.module("../src/tx.js", () => ({
      runTx: async <T>(fn: (tx: { unsafe: (...args: unknown[]) => unknown }) => Promise<T>): Promise<T> =>
        fn({ unsafe: async () => [] }),
    }));

    const { publishToKv } = await import("../src/cloudflare/publish.js");
    const result = await publishToKv(TMP);

    expect(result.success).toBe(true);
    expect(result.key).toBe("portfolio");
    expect(result.namespaceId).toBe("kv-namespace-12345");
    expect(result.snapshot).not.toBeNull();

    const snap = result.snapshot!;
    expect(snap.portfolio_value_usd).toBe(15424.58);
    expect(Math.abs(snap.today.abs - (-174.83))).toBeLessThan(0.01);
    expect(snap.today.pct).toBe(-1.12);
    expect(snap.total).toBeDefined();
    expect(snap.history.length).toBe(3);
    expect(snap.history[0].date).toBe("2026-05-28");
    expect(snap.history[2].date).toBe("2026-05-30");
    expect(snap.prices_as_of).toBeDefined();
    expect(snap.as_of_date).toBe("2026-05-31");
    expect(snap.updatedAt).toBeDefined();
    expect(new Date(snap.updatedAt).getTime()).toBeGreaterThan(0);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const callArgs = mockSpawn.mock.calls[0] as [string[], { cwd?: string }?];
    expect(callArgs[0][0]).toBe("kv");
    expect(callArgs[0][1]).toBe("key");
    expect(callArgs[0][2]).toBe("put");
    expect(callArgs[0][3]).toBe("portfolio");
    expect(JSON.parse(callArgs[0][4])).toEqual(snap);
    expect(callArgs[0][5]).toBe("--namespace-id");
    expect(callArgs[0][6]).toBe("kv-namespace-12345");
    expect(callArgs[0][7]).toBe("--remote");

    mock.module("../src/db.js", () => require("../src/db.js"));
    mock.module("../src/tx.js", () => require("../src/tx.js"));
  });

  test("returns error when config is missing", async () => {
    const { publishToKv } = await import("../src/cloudflare/publish.js");
    const result = await publishToKv(TMP);

    expect(result.success).toBe(false);
    expect(result.namespaceId).toBeNull();
    expect(result.snapshot).toBeNull();
    expect(result.error).toContain("Not initialized");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test("returns error when kv_namespace_id is missing", async () => {
    writeConfig(undefined);

    const { publishToKv } = await import("../src/cloudflare/publish.js");
    const result = await publishToKv(TMP);

    expect(result.success).toBe(false);
    expect(result.namespaceId).toBeNull();
    expect(result.snapshot).toBeNull();
    expect(result.error).toContain("KV namespace not configured");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test("returns error when wrangler kv put fails", async () => {
    writeConfig("kv-namespace-12345");

    mockSpawn.mockReturnValue({
      stdout: "",
      stderr: "Error: authentication failed",
      exitCode: 1,
    });

    const mockQuerySingle = mock();
    const mockQuery = mock();

    mockQuerySingle.mockResolvedValue({
      holding_count: 5,
      total_cash_usd: 500,
      portfolio_value_usd: 15424.58,
      last_transaction_date: null,
      transaction_count: 1,
      as_of_date: "2026-05-31",
    });

    mockQuery.mockResolvedValue([
      { date: "2026-05-30", portfolio_value: 15424.58, investment_return: -1.12 },
      { date: "2026-05-29", portfolio_value: 15599.41, investment_return: 0.80 },
    ]);

    mock.module("../src/db.js", () => ({
      query: mockQuery,
      querySingle: mockQuerySingle,
      connect: () => {},
      close: () => {},
    }));

    mock.module("../src/tx.js", () => ({
      runTx: async <T>(fn: (tx: { unsafe: (...args: unknown[]) => unknown }) => Promise<T>): Promise<T> =>
        fn({ unsafe: async () => [] }),
    }));

    const { publishToKv } = await import("../src/cloudflare/publish.js");
    const result = await publishToKv(TMP);

    expect(result.success).toBe(false);
    expect(result.namespaceId).toBe("kv-namespace-12345");
    expect(result.snapshot).not.toBeNull();
    expect(result.error).toContain("wrangler kv key put failed");

    mock.module("../src/db.js", () => require("../src/db.js"));
    mock.module("../src/tx.js", () => require("../src/tx.js"));
  });
});

// ─── CLI integration — cloudflare publish ──────────────────────────

describe("cloudflare publish CLI — mocked publishToKv", () => {
  let mockPublish: ReturnType<typeof mock>;

  afterEach(() => {
    mock.module("../src/cloudflare/publish.js", () => require("../src/cloudflare/publish.js"));
  });

  test("returns success envelope on publish", async () => {
    const snapshot = {
      portfolio_value_usd: 15424.58,
      today: { abs: -174.83, pct: -1.12 },
      total: { abs: 369.03, pct: 2.91 },
      history: [{ date: "2026-05-30", value: 15123.40 }],
      prices_as_of: "2026-05-30",
      as_of_date: "2026-05-31",
      updatedAt: "2026-05-31T12:00:00.000Z",
    };

    mockPublish = mock().mockResolvedValue({
      success: true,
      key: "portfolio",
      namespaceId: "kv-namespace-12345",
      snapshot,
    });

    mock.module("../src/cloudflare/publish.js", () => ({
      publishToKv: mockPublish,
      buildSnapshot: require("../src/cloudflare/publish.js").buildSnapshot,
      validateSnapshot: require("../src/cloudflare/publish.js").validateSnapshot,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "publish"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(true);
    expect(output.command).toBe("cloudflare:publish");
    expect(output.data.key).toBe("portfolio");
    expect(output.data.namespace_id).toBe("kv-namespace-12345");
    expect(output.data.snapshot).toEqual(snapshot);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("returns KV_NOT_CONFIGURED error when namespace missing", async () => {
    mockPublish = mock().mockResolvedValue({
      success: false,
      key: "portfolio",
      namespaceId: null,
      snapshot: null,
      error: "KV namespace not configured. Run `portfolio cloudflare init` or set kv_namespace_id in .portfolio/config.json.",
    });

    mock.module("../src/cloudflare/publish.js", () => ({
      publishToKv: mockPublish,
      buildSnapshot: require("../src/cloudflare/publish.js").buildSnapshot,
      validateSnapshot: require("../src/cloudflare/publish.js").validateSnapshot,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "publish"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("cloudflare:publish");
    expect(output.error.code).toBe("KV_NOT_CONFIGURED");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  test("returns KV_PUBLISH_FAILED error when wrangler fails", async () => {
    mockPublish = mock().mockResolvedValue({
      success: false,
      key: "portfolio",
      namespaceId: "kv-namespace-12345",
      snapshot: null,
      error: "wrangler kv key put failed (exit code 1): auth error",
    });

    mock.module("../src/cloudflare/publish.js", () => ({
      publishToKv: mockPublish,
      buildSnapshot: require("../src/cloudflare/publish.js").buildSnapshot,
      validateSnapshot: require("../src/cloudflare/publish.js").validateSnapshot,
    }));

    const mod = await import("../src/cli.js");
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "publish"]);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.ok).toBe(false);
    expect(output.command).toBe("cloudflare:publish");
    expect(output.error.code).toBe("KV_PUBLISH_FAILED");
    expect(exitSpy).toHaveBeenCalledWith(1);

    logSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("cloudflare init — preserves and wires kv_namespace_id (#107 live fix)", () => {
  const TMP = join(import.meta.dir, "__init_kv_test_tmp__");

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  });

  test("loadLocalConfig preserves kv_namespace_id across init-style round-trip", async () => {
    const { saveLocalConfig, loadLocalConfig } = await import("../src/cloudflare/config.js");
    const { generateWranglerJsonc } = await import("../src/cloudflare/templates.js");

    saveLocalConfig(
      {
        account_id: "abcdef1234567890abcdef1234567890",
        kv_namespace_id: "real-kv-9999",
        wrangler_project_name: "portfolio-widget",
        initialized_at: "2026-05-31T00:00:00.000Z",
      },
      TMP,
    );

    const existing = loadLocalConfig(TMP);
    expect(existing).not.toBeNull();
    expect(existing!.kv_namespace_id).toBe("real-kv-9999");

    const newConfig = {
      account_id: existing!.account_id,
      kv_namespace_id: existing!.kv_namespace_id,
      wrangler_project_name: "portfolio-widget",
      initialized_at: "2026-05-31T00:00:00.000Z",
    } as const;

    const wrangler = generateWranglerJsonc(newConfig);
    expect(wrangler).toContain("real-kv-9999");
    expect(wrangler).not.toContain("REPLACE_WITH_YOUR_KV_NAMESPACE_ID");

    saveLocalConfig(newConfig, TMP);
    const afterSave = loadLocalConfig(TMP);
    expect(afterSave!.kv_namespace_id).toBe("real-kv-9999");

    const cfg = JSON.parse(readFileSync(join(TMP, ".portfolio", "config.json"), "utf-8"));
    expect(cfg.kv_namespace_id).toBe("real-kv-9999");
  });
});
