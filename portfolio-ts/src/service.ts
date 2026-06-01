#!/usr/bin/env bun
import { loadEnv } from "./env.js";
import { createApiServer, type ReadyRouteResult } from "./api/server.js";
import * as backupS3Module from "./commands/backup_s3.js";
import * as initModule from "./commands/init.js";
import * as refreshModule from "./commands/refresh.js";
import * as publishModule from "./cloudflare/publish.js";
import * as syncModule from "./cloudflare/sync.js";
import * as db from "./db.js";

export interface ServiceJobSuccess<T> {
  ok: true;
  job: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  data: T;
}

export interface ServiceJobFailure {
  ok: false;
  job: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  error: string;
}

export type ServiceJobResult<T> = ServiceJobSuccess<T> | ServiceJobFailure;

export interface RefreshJobDeps {
  refreshPortfolio?: () => Promise<unknown>;
  now?: () => Date;
}

export interface PublishJobDeps {
  publishToKv?: (projectRoot?: string) => Promise<unknown>;
  projectRoot?: string;
  now?: () => Date;
}

export interface BackupJobDeps {
  loadS3Config?: typeof backupS3Module.loadS3Config;
  createS3Client?: (config: Parameters<typeof backupS3Module.createS3Client>[0]) => {
    destroy: () => void;
  };
  pushBackupToS3?: (
    client: { destroy: () => void },
    bucket: string,
    dbUrl: string,
  ) => Promise<unknown>;
  now?: () => Date;
}

export async function runRefreshJob(
  deps: RefreshJobDeps = {},
): Promise<ServiceJobResult<unknown>> {
  const startedAt = (deps.now ?? (() => new Date()))();
  try {
    const refresh = deps.refreshPortfolio ?? refreshModule.refreshPortfolio;
    const data = await refresh();
    const finishedAt = (deps.now ?? (() => new Date()))();
    return {
      ok: true,
      job: "refresh",
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      data,
    };
  } catch (err) {
    const finishedAt = (deps.now ?? (() => new Date()))();
    return {
      ok: false,
      job: "refresh",
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runCloudflarePublishJob(
  deps: PublishJobDeps = {},
): Promise<ServiceJobResult<unknown>> {
  const startedAt = (deps.now ?? (() => new Date()))();
  try {
    const publish = deps.publishToKv ?? publishModule.publishToKv;
    const data = await publish(deps.projectRoot);
    const finishedAt = (deps.now ?? (() => new Date()))();
    return {
      ok: true,
      job: "cloudflare_publish",
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      data,
    };
  } catch (err) {
    const finishedAt = (deps.now ?? (() => new Date()))();
    return {
      ok: false,
      job: "cloudflare_publish",
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runBackupJob(
  deps: BackupJobDeps = {},
): Promise<ServiceJobResult<unknown>> {
  const startedAt = (deps.now ?? (() => new Date()))();
  try {
    const loadS3Config = deps.loadS3Config ?? backupS3Module.loadS3Config;
    const createS3Client: NonNullable<BackupJobDeps["createS3Client"]> =
      deps.createS3Client ??
      (backupS3Module.createS3Client as NonNullable<BackupJobDeps["createS3Client"]>);
    const pushBackupToS3: NonNullable<BackupJobDeps["pushBackupToS3"]> =
      deps.pushBackupToS3 ??
      (backupS3Module.pushBackupToS3 as NonNullable<BackupJobDeps["pushBackupToS3"]>);
    const cfg = loadS3Config();
    if (!cfg.ok) {
      const finishedAt = (deps.now ?? (() => new Date()))();
      return {
        ok: false,
        job: "backup",
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        error: cfg.error,
      };
    }

    const dbUrl = process.env.PORTFOLIO_DB_URL;
    if (!dbUrl) {
      const finishedAt = (deps.now ?? (() => new Date()))();
      return {
        ok: false,
        job: "backup",
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        error: "PORTFOLIO_DB_URL is not set",
      };
    }

    const client = createS3Client(cfg.config);
    try {
      const data = await pushBackupToS3(client, cfg.config.bucket, dbUrl);
      const finishedAt = (deps.now ?? (() => new Date()))();
      return {
        ok: true,
        job: "backup",
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        data,
      };
    } catch (err) {
      const finishedAt = (deps.now ?? (() => new Date()))();
      return {
        ok: false,
        job: "backup",
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      try {
        client.destroy();
      } catch {
        // Ignore destroy errors so the job still reports its original result.
      }
    }
  } catch (err) {
    const finishedAt = (deps.now ?? (() => new Date()))();
    return {
      ok: false,
      job: "backup",
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type SchedulerEvent =
  | {
      type: "started";
      job: string;
      at: string;
    }
  | {
      type: "completed";
      job: string;
      at: string;
      duration_ms: number;
    }
  | {
      type: "failed";
      job: string;
      at: string;
      error: string;
    }
  | {
      type: "skipped";
      job: string;
      at: string;
      reason: "running";
    };

export interface ScheduledJob {
  name: string;
  enabled: boolean;
  intervalMs: number;
  run: () => Promise<ServiceJobResult<unknown>> | ServiceJobResult<unknown>;
}

export interface SchedulerOptions {
  jobs: ScheduledJob[];
  onEvent?: (event: SchedulerEvent) => void;
  setIntervalImpl?: (cb: () => void, ms: number) => unknown;
  clearIntervalImpl?: (handle: unknown) => void;
  now?: () => Date;
}

export interface SchedulerHandle {
  stop: () => void;
  jobs: Array<{ name: string; enabled: boolean; intervalMs: number; running: boolean }>;
}

export function createServiceScheduler(opts: SchedulerOptions): SchedulerHandle {
  const now = opts.now ?? (() => new Date());
  const setIntervalImpl =
    opts.setIntervalImpl ??
    ((cb: () => void, ms: number): unknown => setInterval(cb, ms));
  const clearIntervalImpl =
    opts.clearIntervalImpl ??
    ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));

  type ActiveJob = {
    job: ScheduledJob;
    handle: unknown;
    running: boolean;
  };

  const activeJobs: ActiveJob[] = [];
  let stopped = false;

  const emit = (event: SchedulerEvent) => {
    opts.onEvent?.(event);
  };

  const runJob = async (active: ActiveJob) => {
    if (stopped) return;
    if (active.running) {
      emit({
        type: "skipped",
        job: active.job.name,
        at: now().toISOString(),
        reason: "running",
      });
      return;
    }

    active.running = true;
    const startedAt = now();
    emit({
      type: "started",
      job: active.job.name,
      at: startedAt.toISOString(),
    });

    try {
      const result = await active.job.run();
      const finishedAt = now();
      if (result.ok) {
        emit({
          type: "completed",
          job: active.job.name,
          at: finishedAt.toISOString(),
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
        });
      } else {
        emit({
          type: "failed",
          job: active.job.name,
          at: finishedAt.toISOString(),
          error: result.error,
        });
      }
    } catch (err) {
      const finishedAt = now();
      emit({
        type: "failed",
        job: active.job.name,
        at: finishedAt.toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      active.running = false;
    }
  };

  for (const job of opts.jobs) {
    if (!job.enabled) continue;
    const active: ActiveJob = {
      job,
      handle: setIntervalImpl(() => {
        void runJob(active);
      }, job.intervalMs),
      running: false,
    };
    activeJobs.push(active);
  }

  return {
    stop: () => {
      stopped = true;
      for (const active of activeJobs) {
        clearIntervalImpl(active.handle);
      }
    },
    jobs: activeJobs.map((active) => ({
      name: active.job.name,
      enabled: active.job.enabled,
      intervalMs: active.job.intervalMs,
      running: active.running,
    })),
  };
}

export interface ServiceConfig {
  port: number;
  refreshIntervalMs: number;
  publishEnabled: boolean;
  publishIntervalMs: number;
  backupEnabled: boolean;
  backupIntervalMs: number;
  initOnBoot: boolean;
  projectRoot: string;
}

function serviceStatusBody(config: ServiceConfig, startedAt: Date, ready: boolean, error?: string) {
  return {
    ready,
    started_at: startedAt.toISOString(),
    port: config.port,
    refresh_interval_ms: config.refreshIntervalMs,
    cloudflare_publish: config.publishEnabled,
    publish_interval_ms: config.publishEnabled ? config.publishIntervalMs : null,
    backup_enabled: config.backupEnabled,
    backup_interval_ms: config.backupEnabled ? config.backupIntervalMs : null,
    init_on_boot: config.initOnBoot,
    ...(error ? { error } : {}),
  };
}

export function createReadyProbe(
  config: ServiceConfig,
  startedAt: Date,
): () => Promise<ReadyRouteResult> {
  return async () => {
    try {
      await db.getSql().unsafe("SELECT 1");
      return {
        status: 200,
        body: serviceStatusBody(config, startedAt, true),
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        status: 503,
        body: serviceStatusBody(config, startedAt, false, error),
      };
    }
  };
}

function parseBooleanEnv(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`Invalid boolean value: ${raw}`);
  }
}

function parsePortEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port value: ${raw}`);
  }
  return parsed;
}

export function readServiceConfig(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot: string = process.cwd(),
): ServiceConfig {
  const port = parsePortEnv(env.PORT ?? env.PORTFOLIO_API_PORT, 8787);
  const refreshIntervalMs = env.PORTFOLIO_REFRESH_INTERVAL
    ? syncModule.parseInterval(env.PORTFOLIO_REFRESH_INTERVAL)
    : syncModule.DEFAULT_SYNC_INTERVAL_MS;
  const publishEnabled = parseBooleanEnv(env.PORTFOLIO_CLOUDFLARE_PUBLISH, false);
  const publishIntervalMs = env.PORTFOLIO_PUBLISH_INTERVAL
    ? syncModule.parseInterval(env.PORTFOLIO_PUBLISH_INTERVAL)
    : refreshIntervalMs;
  const backupEnabled = parseBooleanEnv(env.PORTFOLIO_BACKUP_ENABLED, false);
  const backupIntervalMs = env.PORTFOLIO_BACKUP_INTERVAL
    ? syncModule.parseInterval(env.PORTFOLIO_BACKUP_INTERVAL)
    : 86_400_000;
  const initOnBoot = parseBooleanEnv(env.PORTFOLIO_INIT_ON_BOOT, false);

  if (refreshIntervalMs <= 0) {
    throw new Error("PORTFOLIO_REFRESH_INTERVAL must be greater than zero");
  }
  if (publishIntervalMs <= 0) {
    throw new Error("PORTFOLIO_PUBLISH_INTERVAL must be greater than zero");
  }
  if (backupIntervalMs <= 0) {
    throw new Error("PORTFOLIO_BACKUP_INTERVAL must be greater than zero");
  }

  return {
    port,
    refreshIntervalMs,
    publishEnabled,
    publishIntervalMs,
    backupEnabled,
    backupIntervalMs,
    initOnBoot,
    projectRoot,
  };
}

export interface PortfolioServiceHandle {
  config: ServiceConfig;
  scheduler: SchedulerHandle;
  server: ReturnType<typeof createApiServer>;
  stop: () => Promise<void>;
}

export async function startPortfolioService(
  config: ServiceConfig = readServiceConfig(),
): Promise<PortfolioServiceHandle> {
  if (config.initOnBoot) {
    await initModule.initDb();
  }

  const startedAt = new Date();
  const scheduler = createServiceScheduler({
    jobs: [
      {
        name: "refresh",
        enabled: true,
        intervalMs: config.refreshIntervalMs,
        run: () => runRefreshJob(),
      },
      {
        name: "backup",
        enabled: config.backupEnabled,
        intervalMs: config.backupIntervalMs,
        run: () => runBackupJob(),
      },
      {
        name: "cloudflare_publish",
        enabled: config.publishEnabled,
        intervalMs: config.publishIntervalMs,
        run: () =>
          runCloudflarePublishJob({
            projectRoot: config.projectRoot,
          }),
      },
    ],
    onEvent: (event) => {
      console.log(JSON.stringify({ source: "portfolio-service", ...event }));
    },
  });

  const server = createApiServer({
    port: config.port,
    ready: createReadyProbe(config, startedAt),
  });

  console.log(
    JSON.stringify({
      source: "portfolio-service",
      event: "service_started",
      started_at: startedAt.toISOString(),
      port: config.port,
      refresh_interval_ms: config.refreshIntervalMs,
      cloudflare_publish: config.publishEnabled,
      publish_interval_ms: config.publishEnabled ? config.publishIntervalMs : null,
      backup_enabled: config.backupEnabled,
      backup_interval_ms: config.backupEnabled ? config.backupIntervalMs : null,
      init_on_boot: config.initOnBoot,
      project_root: config.projectRoot,
    }),
  );

  return {
    config,
    scheduler,
    server,
    stop: async () => {
      scheduler.stop();
      server.stop();
      await db.close();
      console.log(
        JSON.stringify({
          source: "portfolio-service",
          event: "service_stopped",
          stopped_at: new Date().toISOString(),
        }),
      );
    },
  };
}

async function main(): Promise<void> {
  loadEnv();
  const config = readServiceConfig();
  const service = await startPortfolioService(config);

  const shutdown = async () => {
    await service.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ source: "portfolio-service", event: "startup_failed", error: msg }));
    process.exit(1);
  });
}
