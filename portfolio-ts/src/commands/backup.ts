import { spawnSync } from "bun";

export interface BackupResult {
  source: string;
  backup: string;
  size_bytes: number;
}

export async function backupDb(params: {
  dbUrl: string;
  outPath?: string;
}): Promise<BackupResult> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dst = params.outPath ?? `portfolio.backup-${ts}.sql`;

  const result = spawnSync(["pg_dump", params.dbUrl, "-f", dst]);

  if (result.exitCode !== 0) {
    const msg = new TextDecoder().decode(result.stderr);
    throw new Error(`pg_dump failed (exit ${result.exitCode}): ${msg.trim()}`);
  }

  const stat = Bun.file(dst);
  const sizeBytes = stat.size;

  return { source: "postgresql", backup: dst, size_bytes: sizeBytes };
}
