import { getWritable } from "workflow";
import type { FanoutChunk, FanoutItem } from "@/lib/chunks";
import { MAX_FANOUT } from "@/lib/limits";

/**
 * Tab 05 — parallel fan-out.
 *
 * `Promise.all` over step calls. That is the whole API: no worker pool, no
 * queue to provision, no concurrency library. Each branch is still its own
 * durable, independently retryable step — if one of them fails, only that one
 * retries, and the others keep their results.
 */

/**
 * Deliberately uneven so the waterfall is worth looking at. Indexed by item, so
 * a replay produces the same durations.
 */
const WORK_MS = [2600, 900, 1800, 500, 3000, 1200, 2200, 700];

const SHARDS = [
  "shard-alpha",
  "shard-bravo",
  "shard-charlie",
  "shard-delta",
  "shard-echo",
  "shard-foxtrot",
  "shard-golf",
  "shard-hotel",
];

async function emit(
  writable: WritableStream<FanoutChunk>,
  chunk: FanoutChunk,
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

async function reprocessShard(
  index: number,
  fanoutStartedAt: number,
): Promise<FanoutItem> {
  "use step";

  const writable = getWritable<FanoutChunk>();
  const name = SHARDS[index];
  const startedAt = Date.now();
  const startOffsetMs = startedAt - fanoutStartedAt;

  await emit(writable, {
    kind: "item",
    phase: "running",
    index,
    name,
    at: startedAt,
    startOffsetMs,
  });

  await new Promise((resolve) => setTimeout(resolve, WORK_MS[index]));

  const completedAt = Date.now();
  const durationMs = completedAt - startedAt;

  await emit(writable, {
    kind: "item",
    phase: "completed",
    index,
    name,
    at: completedAt,
    startOffsetMs,
    durationMs,
  });

  return { index, name, startOffsetMs, durationMs };
}

async function finishRun(
  items: FanoutItem[],
  fanoutStartedAt: number,
): Promise<{ wallMs: number; sumMs: number }> {
  "use step";

  const writable = getWritable<FanoutChunk>();
  const completedAt = Date.now();

  const wallMs = completedAt - fanoutStartedAt;
  const sumMs = items.reduce((total, item) => total + item.durationMs, 0);

  await emit(writable, {
    kind: "run",
    phase: "completed",
    at: completedAt,
    wallMs,
    sumMs,
    items: [...items].sort((a, b) => a.index - b.index),
  });

  await writable.close();
  return { wallMs, sumMs };
}

export async function fanoutRun(itemCount: number): Promise<{
  wallMs: number;
  sumMs: number;
}> {
  "use workflow";

  const count = Math.min(Math.max(itemCount, 1), MAX_FANOUT);
  const fanoutStartedAt = await markStart();

  // Every branch starts at once and this resolves when the slowest one lands.
  const items = await Promise.all(
    Array.from({ length: count }, (_unused, index) =>
      reprocessShard(index, fanoutStartedAt),
    ),
  );

  return finishRun(items, fanoutStartedAt);
}
