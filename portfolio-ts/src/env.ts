import * as fs from "node:fs";
import * as path from "node:path";

export interface LoadEnvOptions {
  cwd?: string;
  filename?: string;
}

export interface LoadEnvResult {
  loaded: boolean;
  path: string | null;
  keysLoaded: number;
}

const DEFAULT_FILENAME = ".env";
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXPORT_PREFIX = "export ";

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const stripped = trimmed.startsWith(EXPORT_PREFIX)
      ? trimmed.slice(EXPORT_PREFIX.length).trimStart()
      : trimmed;
    const eq = stripped.indexOf("=");
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    if (!KEY_PATTERN.test(key)) continue;
    const value = unquote(stripped.slice(eq + 1).trim());
    result[key] = value;
  }
  return result;
}

function findUp(startDir: string, filename: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, filename);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // not found or not accessible
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadEnv(options: LoadEnvOptions = {}): LoadEnvResult {
  const cwd = options.cwd ?? process.cwd();
  const filename = options.filename ?? DEFAULT_FILENAME;
  const filePath = findUp(cwd, filename);
  if (!filePath) {
    return { loaded: false, path: null, keysLoaded: 0 };
  }
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseEnv(content);
  let keysLoaded = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      keysLoaded++;
    }
  }
  return { loaded: true, path: filePath, keysLoaded };
}
