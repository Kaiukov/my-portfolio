import type { CloudflareConfig } from "./types.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_DIR = ".portfolio";
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function loadLocalConfig(projectRoot?: string): CloudflareConfig | null {
  const root = projectRoot ?? process.cwd();
  const configPath = join(root, CONFIG_FILE);
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as CloudflareConfig;
  } catch {
    return null;
  }
}

export function saveLocalConfig(config: CloudflareConfig, projectRoot?: string): string {
  const root = projectRoot ?? process.cwd();
  const dir = join(root, CONFIG_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const configPath = join(root, CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return configPath;
}
