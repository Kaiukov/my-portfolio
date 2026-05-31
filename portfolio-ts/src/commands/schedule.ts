import { spawnSync } from "bun";

const BLOCK_START = "### portfolio-refresh-start (managed — do not edit)";
const BLOCK_END = "### portfolio-refresh-end";

export interface ScheduleEmitResult {
  project_dir: string;
  block: string;
}

export interface ScheduleInstallResult {
  installed: boolean;
  already_present: boolean;
  message: string;
}

export interface ScheduleRemoveResult {
  removed: boolean;
  message: string;
}

function buildCronBlock(projectDir: string): string {
  const logDir = `${projectDir}/logs`;
  return [
    `${BLOCK_START}`,
    `# Portfolio refresh: fetch prices via HTTPS + recalculate`,
    `SHELL=/bin/bash`,
    `PROJECT=${projectDir}`,
    `LOG=${logDir}`,
    `export PORTFOLIO_DB_URL`,
    ``,
    `# Daily price refresh after US market close (Mon–Fri 18:30)`,
    `30 18 * * 1-5  cd $PROJECT && bun run portfolio-ts/src/cli.ts refresh >> $LOG/refresh.log 2>&1`,
    ``,
    `# Saturday late Friday settlement catch (10:00)`,
    `0 10 * * 6    cd $PROJECT && bun run portfolio-ts/src/cli.ts refresh >> $LOG/refresh.log 2>&1`,
    ``,
    `# Sunday full refresh with repair (03:00)`,
    `0 3  * * 0    cd $PROJECT && bun run portfolio-ts/src/cli.ts refresh >> $LOG/refresh.log 2>&1`,
    ``,
    `# Daily health check (07:05)`,
    `5 7  * * *    cd $PROJECT && bun run portfolio-ts/src/cli.ts health >> $LOG/health.log 2>&1`,
    ``,
    `# Monthly performance snapshot (1st of month 06:00)`,
    `0 6  1 * *    cd $PROJECT && bun run portfolio-ts/src/cli.ts performance > $LOG/performance-$(date +\\%Y-\\%m).log 2>&1`,
    `${BLOCK_END}`,
    "",
  ].join("\n");
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

export function scheduleEmit(projectDir?: string): ScheduleEmitResult {
  const dir = projectDir ?? process.cwd();
  return { project_dir: dir, block: buildCronBlock(dir) };
}

export function scheduleInstall(projectDir?: string): ScheduleInstallResult {
  const dir = projectDir ?? process.cwd();

  let current: string;
  try {
    current = readCrontab();
  } catch (err) {
    return { installed: false, already_present: false, message: (err as Error).message };
  }

  if (hasManagedBlock(current)) {
    return {
      installed: false,
      already_present: true,
      message: "Portfolio refresh block is already present in crontab. Remove it first with 'schedule remove'.",
    };
  }

  const block = buildCronBlock(dir);
  const newContent = current ? `${current}\n\n${block}` : block;

  try {
    writeCrontab(newContent);
  } catch (err) {
    return { installed: false, already_present: false, message: (err as Error).message };
  }

  return {
    installed: true,
    already_present: false,
    message: `Portfolio refresh crontab entries installed for project at ${dir}.`,
  };
}

export function scheduleRemove(projectDir?: string): ScheduleRemoveResult {
  let current: string;
  try {
    current = readCrontab();
  } catch (err) {
    return { removed: false, message: (err as Error).message };
  }

  if (!hasManagedBlock(current)) {
    return {
      removed: false,
      message: "No portfolio refresh managed block found in crontab.",
    };
  }

  const cleaned = stripManagedBlock(current);

  try {
    writeCrontab(cleaned);
  } catch (err) {
    return { removed: false, message: (err as Error).message };
  }

  return {
    removed: true,
    message: "Portfolio refresh crontab entries removed.",
  };
}
