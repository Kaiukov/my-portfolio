#!/usr/bin/env bun
import { loadEnv } from "./env.js";
import { createApiServer } from "./api/server.js";
import { initDb } from "./commands/init.js";
import { refreshPortfolio } from "./commands/refresh.js";
import { publishToKv } from "./cloudflare/publish.js";
import { DEFAULT_SYNC_INTERVAL_MS, parseInterval } from "./cloudflare/sync.js";
import { close } from "./db.js";

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

export async function runRefreshJob(
  deps: RefreshJobDeps = {},
): Promise<ServiceJobResult<unknown>> {
  const startedAt = (deps.now ?? (() => new Date()))();
  try {
    const refresh = deps.refreshPortfolio ?? refreshPortfolio;
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
    const publish = deps.publishToKv ?? publishToKv;
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
  initOnBoot: boolean;
  projectRoot: string;
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
    ? parseInterval(env.PORTFOLIO_REFRESH_INTERVAL)
    : DEFAULT_SYNC_INTERVAL_MS;
  const publishEnabled = parseBooleanEnv(env.PORTFOLIO_CLOUDFLARE_PUBLISH, false);
  const publishIntervalMs = env.PORTFOLIO_PUBLISH_INTERVAL
    ? parseInterval(env.PORTFOLIO_PUBLISH_INTERVAL)
    : refreshIntervalMs;
  const initOnBoot = parseBooleanEnv(env.PORTFOLIO_INIT_ON_BOOT, false);

  if (refreshIntervalMs <= 0) {
    throw new Error("PORTFOLIO_REFRESH_INTERVAL must be greater than zero");
  }
  if (publishIntervalMs <= 0) {
    throw new Error("PORTFOLIO_PUBLISH_INTERVAL must be greater than zero");
  }

  return {
    port,
    refreshIntervalMs,
    publishEnabled,
    publishIntervalMs,
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
    await initDb();
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
    ready: () => ({
      ready: true,
      started_at: startedAt.toISOString(),
      port: config.port,
      refresh_interval_ms: config.refreshIntervalMs,
      cloudflare_publish: config.publishEnabled,
      publish_interval_ms: config.publishEnabled ? config.publishIntervalMs : null,
      init_on_boot: config.initOnBoot,
    }),
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
      await close();
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
