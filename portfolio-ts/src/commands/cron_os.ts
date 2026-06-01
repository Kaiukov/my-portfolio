import { spawnSync } from "bun";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";

const BLOCK_START = "### portfolio-cron-os-start (managed — do not edit)";
const BLOCK_END = "### portfolio-cron-os-end";

export interface CronOsJob {
  name: string;
  command: string;
  schedule: string;
  enabled: boolean;
  log_path: string;
  order: number;
  args?: string[];
}

export interface CronOsConfig {
  jobs: CronOsJob[];
}

export interface CronOsEmitResult {
  project_dir: string;
  block: string;
  job_count: number;
}

export interface CronOsInstallResult {
  installed: boolean;
  already_installed: boolean;
  message: string;
  job_count: number;
}

export interface CronOsRemoveResult {
  removed: boolean;
  message: string;
}

export interface CronOsListItem {
  name: string;
  command: string;
  schedule: string;
  enabled: boolean;
  log_path: string;
  order: number;
  installed: boolean;
}

export interface CronOsListResult {
  block_installed: boolean;
  jobs: CronOsListItem[];
}

const DEFAULT_CONFIG: CronOsConfig = {
  jobs: [
    {
      name: "refresh-weekday",
      command: "refresh",
      schedule: "30 18 * * 1-5",
      enabled: true,
      log_path: "logs/refresh.log",
      order: 10,
    },
    {
      name: "refresh-saturday",
      command: "refresh",
      schedule: "0 10 * * 6",
      enabled: true,
      log_path: "logs/refresh.log",
      order: 20,
    },
    {
      name: "refresh-sunday",
      command: "refresh",
      schedule: "0 3 * * 0",
      enabled: true,
      log_path: "logs/refresh.log",
      order: 30,
    },
    {
      name: "health-daily",
      command: "health",
      schedule: "5 7 * * *",
      enabled: true,
      log_path: "logs/health.log",
      order: 40,
    },
    {
      name: "performance-monthly",
      command: "performance",
      schedule: "0 6 1 * *",
      enabled: true,
      log_path: "logs/performance-$(date +\\%Y-\\%m).log",
      order: 50,
    },
    {
      name: "cloudflare-sync",
      command: "cloudflare sync",
      schedule: "15 6 1 * *",
      enabled: true,
      log_path: "logs/cloudflare-sync.log",
      order: 60,
    },
  ],
};

function resolveConfigPath(projectDir: string, configPath?: string): string | null {
  if (configPath) {
    const resolved = resolve(configPath);
    if (existsSync(resolved)) return resolved;
    return null;
  }

  let dir = resolve(projectDir);
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "portfolio.cron.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadConfig(projectDir?: string, configPath?: string): { config: CronOsConfig; path: string | null } {
  const dir = projectDir ?? process.cwd();
  const resolvedPath = resolveConfigPath(dir, configPath);

  if (resolvedPath) {
    try {
      const raw = readFileSync(resolvedPath, "utf-8");
      const parsed = JSON.parse(raw) as CronOsConfig;
      if (!Array.isArray(parsed.jobs)) {
        throw new Error("Config must have a 'jobs' array");
      }
      return { config: parsed, path: resolvedPath };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load config from ${resolvedPath}: ${msg}`);
    }
  }

  return { config: DEFAULT_CONFIG, path: null };
}

function buildCronBlock(projectDir: string, config: CronOsConfig): string {
  const logDir = `${projectDir}/logs`;
  const sortedJobs = [...config.jobs]
    .filter((j) => j.enabled)
    .sort((a, b) => a.order - b.order);

  const lines: string[] = [
    `${BLOCK_START}`,
    `SHELL=/bin/bash`,
    `PROJECT=${projectDir}`,
    `LOG=${logDir}`,
    ``,
  ];

  for (const job of sortedJobs) {
    const argsStr = job.args && job.args.length > 0 ? ` ${job.args.join(" ")}` : "";
    lines.push(`# ${job.name}`);
    lines.push(
      `${job.schedule}  cd $PROJECT && bun run portfolio-ts/src/cli.ts ${job.command}${argsStr} >> $LOG/${job.log_path} 2>&1`,
    );
    lines.push("");
  }

  lines.push(`${BLOCK_END}`);
  return lines.join("\n");
}

function readCrontab(): string {
  const result = spawnSync(["crontab", "-l"]);
  if (result.exitCode !== 0) {
    const err = new TextDecoder().decode(result.stderr);
    if (err.includes("no crontab for")) return "";
    throw new Error(`crontab -l failed: ${err.trim()}`);
  }
  return new TextDecoder().decode(result.stdout).trimEnd();
}

function writeCrontab(content: string): void {
  const encoder = new TextEncoder();
  const proc = spawnSync({
    cmd: ["crontab", "-"],
    stdin: encoder.encode(content + "\n"),
  });
  if (proc.exitCode !== 0) {
    const err = new TextDecoder().decode(proc.stderr);
    throw new Error(`crontab write failed: ${err.trim()}`);
  }
}

function hasManagedBlock(content: string): boolean {
  return content.includes(BLOCK_START) && content.includes(BLOCK_END);
}

function stripManagedBlock(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inside = false;

  for (const line of lines) {
    if (line.trim() === BLOCK_START) {
      inside = true;
      continue;
    }
    if (line.trim() === BLOCK_END) {
      inside = false;
      continue;
    }
    if (!inside) result.push(line);
  }

  return result.join("\n").trim();
}

export interface CronOsOptions {
  projectDir?: string;
  configPath?: string;
}

export function cronOsEmit(opts: CronOsOptions = {}): CronOsEmitResult {
  const dir = opts.projectDir ?? process.cwd();
  const { config } = loadConfig(dir, opts.configPath);
  const block = buildCronBlock(dir, config);
  const enabledCount = config.jobs.filter((j) => j.enabled).length;
  return { project_dir: dir, block, job_count: enabledCount };
}

export function cronOsInstall(opts: CronOsOptions = {}): CronOsInstallResult {
  const dir = opts.projectDir ?? process.cwd();
  const { config } = loadConfig(dir, opts.configPath);

  try {
    mkdirSync(`${dir}/logs`, { recursive: true });
  } catch {
    // logs dir may already exist
  }

  const enabledCount = config.jobs.filter((j) => j.enabled).length;

  let current: string;
  try {
    current = readCrontab();
  } catch (err) {
    return { installed: false, already_installed: false, message: (err as Error).message, job_count: enabledCount };
  }

  const block = buildCronBlock(dir, config);
  const alreadyPresent = hasManagedBlock(current);
  const stripped = alreadyPresent ? stripManagedBlock(current) : current;
  const newContent = stripped ? `${stripped}\n\n${block}` : block;

  try {
    writeCrontab(newContent);
  } catch (err) {
    return { installed: false, already_installed: false, message: (err as Error).message, job_count: enabledCount };
  }

  return {
    installed: true,
    already_installed: alreadyPresent,
    message: alreadyPresent
      ? `Replaced existing cron-os managed block with ${enabledCount} job(s) for project at ${dir}.`
      : `Installed ${enabledCount} cron-os job(s) for project at ${dir}.`,
    job_count: enabledCount,
  };
}

export function cronOsRemove(opts: CronOsOptions = {}): CronOsRemoveResult {
  let current: string;
  try {
    current = readCrontab();
  } catch (err) {
    return { removed: false, message: (err as Error).message };
  }

  if (!hasManagedBlock(current)) {
    return { removed: false, message: "No cron-os managed block found in crontab." };
  }

  const cleaned = stripManagedBlock(current);

  try {
    writeCrontab(cleaned);
  } catch (err) {
    return { removed: false, message: (err as Error).message };
  }

  return { removed: true, message: "Cron-os managed block removed from crontab." };
}

export function cronOsList(opts: CronOsOptions = {}): CronOsListResult {
  const dir = opts.projectDir ?? process.cwd();
  const { config } = loadConfig(dir, opts.configPath);

  let current = "";
  try {
    current = readCrontab();
  } catch {
    // no crontab — treat as not installed
  }

  const blockInstalled = hasManagedBlock(current);

  const jobs = config.jobs
    .map((j) => ({
      name: j.name,
      command: j.command,
      schedule: j.schedule,
      enabled: j.enabled,
      log_path: j.log_path,
      order: j.order,
      installed: blockInstalled && j.enabled,
    }))
    .sort((a, b) => a.order - b.order);

  return { block_installed: blockInstalled, jobs };
}
