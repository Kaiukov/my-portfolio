import { spawnWrangler } from "./spawn.js";
import type { SpawnResult } from "./spawn.js";
import { loadLocalConfig, saveLocalConfig } from "./config.js";
import { join } from "node:path";
import type { DeployResult, CloudflareConfig } from "./types.js";

const WORKERS_DEV_RE = /https:\/\/[\w-]+(\.[\w-]+)*\.workers\.dev(?:\/[\w.-]*)?/;

export function parseDeployedUrl(output: string): string | null {
  const match = output.match(WORKERS_DEV_RE);
  return match ? match[0].replace(/\/+$/, "") : null;
}

export async function deployWorker(projectRoot?: string): Promise<DeployResult> {
  const root = projectRoot ?? process.cwd();
  const cloudflareDir = join(root, "cloudflare");

  const proc = spawnWrangler(["deploy"], { cwd: cloudflareDir });
  if (proc.exitCode !== 0) {
    return {
      success: false,
      url: null,
      error: `wrangler deploy failed (exit code ${proc.exitCode})`,
      stderr: proc.stderr,
    };
  }

  const combined = proc.stdout + "\n" + proc.stderr;
  const url = parseDeployedUrl(combined);
  if (!url) {
    return {
      success: false,
      url: null,
      error: "Could not parse workers.dev URL from wrangler deploy output",
      stdout: proc.stdout,
      stderr: proc.stderr,
    };
  }

  const widgetUrl = url + "/portfolio";
  let config: CloudflareConfig;
  const existing = loadLocalConfig(root);
  if (existing) {
    config = { ...existing, widget_url: widgetUrl };
  } else {
    config = {
      account_id: "",
      wrangler_project_name: "portfolio-widget",
      initialized_at: new Date().toISOString(),
      widget_url: widgetUrl,
    };
  }
  saveLocalConfig(config, root);

  return { success: true, url: widgetUrl };
}
