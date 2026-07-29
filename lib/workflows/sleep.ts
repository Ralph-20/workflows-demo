import { getWritable, sleep } from "workflow";
import type { SleepChunk } from "@/lib/chunks";

/**
 * Tab 04 — sleep without compute.
 *
 * The sleep here is real: a 30-day `sleep()` with nothing running for the
 * duration. There is no process parked on a timer, no cron row, no queue
 * message being redelivered — the run is durable state with a wake time, and
 * the platform re-enters it when that time arrives.
 *
 * Because a run is pinned to the deployment that started it, a genuinely
 * month-long sleep would not survive a redeploy. That is why the demo pairs it
 * with `run.wakeUp()` instead of asking anyone to wait.
 */

const SLEEP_FOR = "30 days";
const SLEEP_MS = 30 * 24 * 60 * 60 * 1000;
const WORK_MS = 700;

async function emit(
  writable: WritableStream<SleepChunk>,
  chunk: SleepChunk,
): Promise<void> {
  const writer = writable.getWriter();
  try {
    await writer.write(chunk);
  } finally {
    writer.releaseLock();
  }
}

async function markStart(): Promise<number> {
  "use step";
  return Date.now();
}

async function scheduleRetention(): Promise<void> {
  "use step";

  const writable = getWritable<SleepChunk>();
  const startedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "running",
    name: "scheduleRetention",
    at: startedAt,
  });

  await new Promise((resolve) => setTimeout(resolve, WORK_MS));

  const completedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "completed",
    name: "scheduleRetention",
    at: completedAt,
    durationMs: completedAt - startedAt,
    detail: "record flagged for deletion in 30 days",
  });
}

/** Announces the sleep so the client can render a wake-at date and a counter. */
async function announceSleep(): Promise<number> {
  "use step";

  const writable = getWritable<SleepChunk>();
  const at = Date.now();
  await emit(writable, {
    kind: "sleeping",
    at,
    wakeAt: at + SLEEP_MS,
    duration: SLEEP_FOR,
  });
  return at;
}

async function purgeRecord(sleepStartedAt: number): Promise<number> {
  "use step";

  const writable = getWritable<SleepChunk>();
  const wokeAt = Date.now();

  // Measured, not assumed: this is how long the run was actually asleep.
  await emit(writable, {
    kind: "woke",
    at: wokeAt,
    sleptMs: wokeAt - sleepStartedAt,
  });

  await emit(writable, {
    kind: "step",
    phase: "running",
    name: "purgeRecord",
    at: wokeAt,
  });

  await new Promise((resolve) => setTimeout(resolve, WORK_MS));

  const completedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "completed",
    name: "purgeRecord",
    at: completedAt,
    durationMs: completedAt - wokeAt,
    detail: "record deleted, retention window closed",
  });

  return wokeAt - sleepStartedAt;
}

async function finishRun(startedAt: number): Promise<void> {
  "use step";

  const writable = getWritable<SleepChunk>();
  const completedAt = Date.now();

  await emit(writable, {
    kind: "run",
    phase: "completed",
    at: completedAt,
    totalMs: completedAt - startedAt,
  });

  await writable.close();
}

export async function retentionRun(): Promise<{ sleptMs: number }> {
  "use workflow";

  const startedAt = await markStart();
  await scheduleRetention();

  const sleepStartedAt = await announceSleep();

  // A month of wall-clock time, and not one millisecond of compute.
  await sleep(SLEEP_FOR);

  const sleptMs = await purgeRecord(sleepStartedAt);
  await finishRun(startedAt);

  return { sleptMs };
}
