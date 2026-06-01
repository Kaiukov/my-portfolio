import { describe, expect, test } from "bun:test";
import { createServiceScheduler, type SchedulerEvent, type ScheduledJob } from "../src/service.js";

function makeTimerHarness() {
  type TimerRecord = {
    cb: () => void;
    ms: number;
    cleared: boolean;
  };

  const timers: TimerRecord[] = [];

  return {
    timers,
    setIntervalImpl(cb: () => void, ms: number) {
      const record: TimerRecord = { cb, ms, cleared: false };
      timers.push(record);
      return record;
    },
    clearIntervalImpl(handle: unknown) {
      (handle as TimerRecord).cleared = true;
    },
    fire(index: number) {
      const timer = timers[index];
      if (!timer || timer.cleared) return;
      timer.cb();
    },
    activeTimers() {
      return timers.filter((timer) => !timer.cleared);
    },
  };
}

function makeSuccessJob(name: string, calls: { count: number }): ScheduledJob {
  return {
    name,
    enabled: true,
    intervalMs: 5,
    run: async () => {
      calls.count++;
      return {
        ok: true as const,
        job: name,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: 0,
        data: { count: calls.count },
      };
    },
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createServiceScheduler", () => {
  test("jobs fire on interval when the timer callback runs", async () => {
    const harness = makeTimerHarness();
    const calls = { count: 0 };
    const events: SchedulerEvent[] = [];

    const scheduler = createServiceScheduler({
      jobs: [makeSuccessJob("refresh", calls)],
      onEvent: (event) => events.push(event),
      setIntervalImpl: harness.setIntervalImpl,
      clearIntervalImpl: harness.clearIntervalImpl,
    });

    expect(harness.timers.length).toBe(1);

    harness.fire(0);
    await flush();
    harness.fire(0);
    await flush();

    expect(calls.count).toBe(2);
    expect(events.some((event) => event.type === "started")).toBe(true);
    expect(events.some((event) => event.type === "completed")).toBe(true);

    scheduler.stop();
  });

  test("backup job fires on interval when the timer callback runs", async () => {
    const harness = makeTimerHarness();
    const calls = { count: 0 };
    const events: SchedulerEvent[] = [];

    const scheduler = createServiceScheduler({
      jobs: [makeSuccessJob("backup", calls)],
      onEvent: (event) => events.push(event),
      setIntervalImpl: harness.setIntervalImpl,
      clearIntervalImpl: harness.clearIntervalImpl,
    });

    expect(harness.timers.length).toBe(1);

    harness.fire(0);
    await flush();
    harness.fire(0);
    await flush();

    expect(calls.count).toBe(2);
    expect(events.some((event) => event.type === "started" && event.job === "backup")).toBe(true);
    expect(events.some((event) => event.type === "completed" && event.job === "backup")).toBe(
      true,
    );

    scheduler.stop();
  });

  test("overlap protection skips a tick while the job is still running", async () => {
    const harness = makeTimerHarness();
    const calls = { count: 0 };
    const events: SchedulerEvent[] = [];
    let resolveJob!: () => void;
    const blocked = new Promise<void>((resolve) => {
      resolveJob = resolve;
    });

    const scheduler = createServiceScheduler({
      jobs: [
        {
          name: "refresh",
          enabled: true,
          intervalMs: 5,
          run: async () => {
            calls.count++;
            await blocked;
            return {
              ok: true as const,
              job: "refresh",
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              duration_ms: 0,
              data: { count: calls.count },
            };
          },
        },
      ],
      onEvent: (event) => events.push(event),
      setIntervalImpl: harness.setIntervalImpl,
      clearIntervalImpl: harness.clearIntervalImpl,
    });

    harness.fire(0);
    harness.fire(0);
    await flush();

    expect(calls.count).toBe(1);
    expect(events.some((event) => event.type === "skipped")).toBe(true);

    resolveJob();
    await flush();

    scheduler.stop();
  });

  test("backup overlap protection skips a tick while the job is still running", async () => {
    const harness = makeTimerHarness();
    const calls = { count: 0 };
    const events: SchedulerEvent[] = [];
    let resolveJob!: () => void;
    const blocked = new Promise<void>((resolve) => {
      resolveJob = resolve;
    });

    const scheduler = createServiceScheduler({
      jobs: [
        {
          name: "backup",
          enabled: true,
          intervalMs: 5,
          run: async () => {
            calls.count++;
            await blocked;
            return {
              ok: true as const,
              job: "backup",
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              duration_ms: 0,
              data: { count: calls.count },
            };
          },
        },
      ],
      onEvent: (event) => events.push(event),
      setIntervalImpl: harness.setIntervalImpl,
      clearIntervalImpl: harness.clearIntervalImpl,
    });

    harness.fire(0);
    harness.fire(0);
    await flush();

    expect(calls.count).toBe(1);
    expect(events.some((event) => event.type === "skipped" && event.job === "backup")).toBe(true);

    resolveJob();
    await flush();

    scheduler.stop();
  });

  test("disabled job never fires", async () => {
    const harness = makeTimerHarness();
    let calls = 0;

    const scheduler = createServiceScheduler({
      jobs: [
        {
          name: "publish",
          enabled: false,
          intervalMs: 5,
          run: async () => {
            calls++;
            return {
              ok: true as const,
              job: "publish",
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              duration_ms: 0,
              data: null,
            };
          },
        },
      ],
      setIntervalImpl: harness.setIntervalImpl,
      clearIntervalImpl: harness.clearIntervalImpl,
    });

    expect(harness.timers.length).toBe(0);
    expect(calls).toBe(0);

    scheduler.stop();
  });

  test("disabled backup job never fires", async () => {
    const harness = makeTimerHarness();
    let calls = 0;

    const scheduler = createServiceScheduler({
      jobs: [
        {
          name: "backup",
          enabled: false,
          intervalMs: 5,
          run: async () => {
            calls++;
            return {
              ok: true as const,
              job: "backup",
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              duration_ms: 0,
              data: null,
            };
          },
        },
      ],
      setIntervalImpl: harness.setIntervalImpl,
      clearIntervalImpl: harness.clearIntervalImpl,
    });

    expect(harness.timers.length).toBe(0);
    expect(calls).toBe(0);

    scheduler.stop();
  });

  test("stop clears intervals and prevents future ticks from running", async () => {
    const harness = makeTimerHarness();
    const calls = { count: 0 };

    const scheduler = createServiceScheduler({
      jobs: [
        makeSuccessJob("refresh", calls),
        makeSuccessJob("publish", calls),
      ],
      setIntervalImpl: harness.setIntervalImpl,
      clearIntervalImpl: harness.clearIntervalImpl,
    });

    expect(harness.activeTimers().length).toBe(2);
    scheduler.stop();
    expect(harness.activeTimers().length).toBe(0);

    harness.fire(0);
    harness.fire(1);
    await flush();

    expect(calls.count).toBe(0);
  });
});
