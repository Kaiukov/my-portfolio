import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectAuth, validateAccountId } from "./auth.js";
import { generateWranglerJsonc, generateWorkerJs } from "./templates.js";
import { loadLocalConfig, saveLocalConfig } from "./config.js";
import type { CloudflareConfig, InitOptions, InitResult } from "./types.js";

const CLOUDFLARE_DIR = "cloudflare";

const emptyFileActions = { wranglerJsonc: "none" as const, workerJs: "none" as const };

export async function cloudflareInit(
  options: InitOptions = {},
  projectRoot?: string,
): Promise<InitResult> {
  const root = projectRoot ?? process.cwd();
  const warnings: string[] = [];

  const authResult = await detectAuth();
  if (!authResult.authenticated) {
    return {
      auth: authResult,
      config: null,
      files: { wranglerJsonc: "", workerJs: "" },
      fileActions: emptyFileActions,
      warnings,
    };
  }

  const result = validateAccountId(authResult.accountId, options.accountId);
  if (!result.ok) {
    return {
      auth: { ...authResult, accountId: null, error: result.error },
      config: null,
      files: { wranglerJsonc: "", workerJs: "" },
      fileActions: emptyFileActions,
      warnings,
    };
  }

  const existing = loadLocalConfig(root);
  const config: CloudflareConfig = {
    account_id: options.accountId ?? existing?.account_id ?? result.id,
    kv_namespace_id: options.kvNamespaceId ?? existing?.kv_namespace_id,
    wrangler_project_name: options.projectName ?? "portfolio-widget",
    initialized_at: new Date().toISOString(),
  };

  const cloudflareDir = join(root, CLOUDFLARE_DIR);
  if (!existsSync(cloudflareDir)) {
    mkdirSync(cloudflareDir, { recursive: true });
  }

  const wranglerPath = join(cloudflareDir, "wrangler.jsonc");
  const workerPath = join(cloudflareDir, "worker.js");

  const wranglerExists = existsSync(wranglerPath);
  const workerExists = existsSync(workerPath);

  let wranglerAction: "written" | "skipped" | "none" = "none";
  let workerAction: "written" | "skipped" | "none" = "none";

  if (!wranglerExists || options.force) {
    const wranglerJsoncContent = generateWranglerJsonc(config);
    writeFileSync(wranglerPath, wranglerJsoncContent, "utf-8");
    wranglerAction = "written";
  } else {
    warnings.push(
      "cloudflare/wrangler.jsonc already exists. Use --force to overwrite. Keeping existing file.",
    );
    wranglerAction = "skipped";
  }

  if (!workerExists || options.force) {
    const workerJsContent = generateWorkerJs();
    writeFileSync(workerPath, workerJsContent, "utf-8");
    workerAction = "written";
  } else {
    warnings.push(
      "cloudflare/worker.js already exists. Use --force to overwrite. Keeping existing file.",
    );
    workerAction = "skipped";
  }

  saveLocalConfig(config, root);

  if (!config.kv_namespace_id) {
    warnings.push(
      "KV namespace ID not configured. Update cloudflare/wrangler.jsonc with your KV namespace ID before deploying.",
    );
  }

  return {
    auth: { authenticated: true, method: authResult.method, accountId: result.id },
    config,
    files: {
      wranglerJsonc: wranglerPath,
      workerJs: workerPath,
    },
    fileActions: {
      wranglerJsonc: wranglerAction,
      workerJs: workerAction,
    },
    warnings,
  };
}
