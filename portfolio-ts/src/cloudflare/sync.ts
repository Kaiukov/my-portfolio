import type { PublishResult } from "./types.js";

export const DEFAULT_SYNC_INTERVAL_MS = 3600 * 1000;

export function parseInterval(s: string): number {
  const trimmed = s.trim();
  const match = trimmed.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) {
    throw new Error(
      `Invalid interval: "${trimmed}". Expected format: <number><unit> where unit is ms, s, m, h, or d.`,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 3600 * 1000;
    case "d":
      return value * 86400 * 1000;
    default:
      throw new Error(`Unknown unit: ${unit}`);
  }
}

async function getPublishToKv(): Promise<
  (projectRoot?: string) => Promise<PublishResult>
> {
  const { publishToKv } = await import("./publish.js");
  return publishToKv;
}

export async function syncOnce(projectRoot?: string): Promise<PublishResult> {
  const publishToKv = await getPublishToKv();
  return publishToKv(projectRoot);
}

export interface TickEnvelope {
  event: "sync_tick";
  timestamp: string;
  success: boolean;
  key: string;
  namespace_id: string | null;
  error?: string;
  snapshot?: unknown;
}

export async function doTick(
  projectRoot?: string,
  now?: () => Date,
): Promise<TickEnvelope> {
  const ts = (now ?? (() => new Date()))().toISOString();
  const publishToKv = await getPublishToKv();
  const result = await publishToKv(projectRoot);
  return {
    event: "sync_tick",
    timestamp: ts,
    success: result.success,
    key: result.key,
    namespace_id: result.namespaceId,
    error: result.error,
    snapshot: result.snapshot,
  };
}

export interface TimerHandle {
  clear: () => void;
}

export interface SyncLoopOptions {
  intervalMs: number;
  projectRoot?: string;
  now?: () => Date;
  scheduleTick?: (cb: () => void, ms: number) => TimerHandle;
  tick?: () => Promise<void>;
}

export function syncLoop(opts: SyncLoopOptions): { stop: () => void } {
  const { intervalMs, projectRoot, now } = opts;
  const scheduleTick =
    opts.scheduleTick ??
    ((cb: () => void, ms: number): TimerHandle => {
      const id = setInterval(cb, ms);
      return { clear: () => clearInterval(id) };
    });

  const startTime = now?.() ?? new Date();
  let tickCount = 0;
  let timer: TimerHandle | null = null;

  const rawTick = opts.tick ?? (async () => {
    const envelope = await doTick(projectRoot, now);
    console.log(JSON.stringify(envelope));
  });

  const tick = async () => {
    tickCount++;
    await rawTick();
  };

  const cleanup = () => {
    if (timer) {
      timer.clear();
      timer = null;
    }
    const endTime = now?.() ?? new Date();
    const elapsed = endTime.getTime() - startTime.getTime();
    console.log(
      JSON.stringify({
        event: "sync_stopped",
        timestamp: endTime.toISOString(),
        ticks: tickCount,
        elapsed_ms: elapsed,
      }),
    );
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  tick();

  timer = scheduleTick(() => {
    tick().catch(() => {});
  }, intervalMs);

  return { stop: cleanup };
}
