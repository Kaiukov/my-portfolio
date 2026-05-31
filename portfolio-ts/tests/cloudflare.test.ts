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
    const result = await mod.detectAuth({ PATH: "" });
    expect(result.authenticated).toBe(false);
    expect(result.method).toBeNull();
    expect(result.error).toBeDefined();
  });

  test("error contains wrangler login suggestion", async () => {
    const mod = require("../src/cloudflare/auth.js");
    const result = await mod.detectAuth({});
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

    await mod.dispatch(["bun", "src/cli.ts", "cloudflare", "deploy"]);

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
