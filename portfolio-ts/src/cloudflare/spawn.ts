export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SpawnOptions {
  cwd?: string;
  inherit?: boolean;
}

export function spawnWrangler(args: string[], options?: SpawnOptions): SpawnResult {
  const { cwd, inherit = false } = options ?? {};
  const proc = Bun.spawnSync(["wrangler", ...args], {
    stdout: inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
    stdin: inherit ? "inherit" : "pipe",
    cwd,
    env: { ...process.env, PATH: process.env.PATH },
  });
  return {
    stdout: inherit ? "" : new TextDecoder().decode(proc.stdout),
    stderr: inherit ? "" : new TextDecoder().decode(proc.stderr),
    exitCode: proc.exitCode,
  };
}
