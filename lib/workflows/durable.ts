import { getWritable } from "workflow";
import type { DurableChunk } from "@/lib/chunks";
import { MAX_PIPELINE_STEPS } from "@/lib/limits";

/**
 * Tab 01 — durable execution.
 *
 * A pipeline of steps that each do a visible amount of work. The point of the
 * demo is that progress is recorded in the run, not in the HTTP request that
 * started it: a client can disconnect halfway through, the steps keep
 * executing, and reconnecting replays what was missed.
 */

/** Stage labels, so the step log reads like a real pipeline. */
const STAGES = [
  "validateInput",
  "enrichRecord",
  "scoreRisk",
  "reconcileLedger",
  "notifyDownstream",
] as const;

/** Enough per step that a human can hit "Disconnect" mid-run. */
const STEP_WORK_MS = 900;

/**
 * Plain helper, not a step: it is only ever called from inside a step, which is
 * the context where interacting with the run's writable stream is allowed.
 *
 * Takes the stream rather than calling `getWritable()` itself so a caller that
 * also needs to close it operates on the same instance — writing through one
 * instance and closing another loses the buffered chunk.
 */
async function emit(
  writable: WritableStream<DurableChunk>,
  chunk: DurableChunk,
): Promise<void> {
  const writer = writable.getWriter();
  try {
    await writer.write(chunk);
  } finally {
    writer.releaseLock();
  }
}

/** Timestamps come from inside steps — `Date.now()` in a workflow would diverge on replay. */
async function markStart(): Promise<number> {
  "use step";
  return Date.now();
}

async function runStage(
  index: number,
  total: number,
  name: string,
): Promise<{ name: string; durationMs: number }> {
  "use step";

  const writable = getWritable<DurableChunk>();
  const startedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "running",
    index,
    total,
    name,
    at: startedAt,
  });

  await new Promise((resolve) => setTimeout(resolve, STEP_WORK_MS));

  const completedAt = Date.now();
  const durationMs = completedAt - startedAt;
  await emit(writable, {
    kind: "step",
    phase: "completed",
    index,
    total,
    name,
    at: completedAt,
    durationMs,
  });

  return { name, durationMs };
}

async function finishRun(
  stages: Array<{ name: string; durationMs: number }>,
  startedAt: number,
): Promise<number> {
  "use step";

  const writable = getWritable<DurableChunk>();
  const completedAt = Date.now();
  await emit(writable, {
    kind: "run",
    phase: "completed",
    at: completedAt,
    totalMs: completedAt - startedAt,
    stages,
  });

  // Closing signals end-of-stream to every reader, including one that attached
  // after a disconnect. Without it a reader would wait forever. Must be the
  // same instance the chunk above was written through.
  await writable.close();

  return completedAt;
}

export async function durablePipeline(stepCount: number): Promise<{
  stages: Array<{ name: string; durationMs: number }>;
  totalMs: number;
}> {
  "use workflow";

  const total = Math.min(Math.max(stepCount, 1), MAX_PIPELINE_STEPS);
  const startedAt = await markStart();

  const stages: Array<{ name: string; durationMs: number }> = [];
  for (let index = 0; index < total; index++) {
    stages.push(await runStage(index, total, STAGES[index]));
  }

  const completedAt = await finishRun(stages, startedAt);

  return { stages, totalMs: completedAt - startedAt };
}
