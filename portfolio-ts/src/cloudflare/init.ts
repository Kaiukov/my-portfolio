import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectAuth, validateAccountId } from "./auth.js";
import { generateWranglerJsonc, generateWorkerJs } from "./templates.js";
import { saveLocalConfig } from "./config.js";
import type { AuthResult, CloudflareConfig, InitOptions, InitResult } from "./types.js";

const CLOUDFLARE_DIR = "cloudflare";

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
      warnings,
    };
  }

  const result = validateAccountId(authResult.accountId, options.accountId);
  if (!result.ok) {
    return {
      auth: { ...authResult, accountId: null, error: result.error },
      config: null,
      files: { wranglerJsonc: "", workerJs: "" },
      warnings,
    };
  }

  const config: CloudflareConfig = {
    account_id: result.id,
    wrangler_project_name: options.projectName ?? "portfolio-widget",
    initialized_at: new Date().toISOString(),
  };

  const cloudflareDir = join(root, CLOUDFLARE_DIR);
  if (!existsSync(cloudflareDir)) {
    mkdirSync(cloudflareDir, { recursive: true });
  }

  const wranglerJsoncContent = generateWranglerJsonc(config);
  const workerJsContent = generateWorkerJs();

  writeFileSync(join(cloudflareDir, "wrangler.jsonc"), wranglerJsoncContent, "utf-8");
  writeFileSync(join(cloudflareDir, "worker.js"), workerJsContent, "utf-8");

  const configPath = saveLocalConfig(config, root);

  if (!config.kv_namespace_id) {
    warnings.push(
      "KV namespace ID not configured. Update cloudflare/wrangler.jsonc with your KV namespace ID before deploying.",
    );
  }

  return {
    auth: { authenticated: true, method: authResult.method, accountId: result.id },
    config,
    files: {
      wranglerJsonc: join(cloudflareDir, "wrangler.jsonc"),
      workerJs: join(cloudflareDir, "worker.js"),
    },
    warnings,
  };
}
