/**
 * Chunk shapes written to a run's durable stream by `getWritable()`, and read
 * back out by the relay route. Shared by the workflow (writer) and the feature
 * component (reader), so the two cannot drift.
 *
 * Keep these small. Billing counts events plus data retained, and every chunk
 * is persisted stream data.
 */

/** Tab 01 — durable execution. */
export type DurableChunk =
  | {
      kind: "step";
      phase: "running" | "completed";
      index: number;
      total: number;
      name: string;
      /** Wall-clock ms, measured inside the step (never in workflow context). */
      at: number;
      durationMs?: number;
    }
  | {
      kind: "run";
      phase: "completed";
      at: number;
      totalMs: number;
      stages: Array<{ name: string; durationMs: number }>;
    };

export function isTerminalDurableChunk(chunk: DurableChunk): boolean {
  return chunk.kind === "run";
}

/** Tab 02 — automatic retries. One `attempt` chunk pair per execution of the step. */
export type RetryChunk =
  | { kind: "attempt"; phase: "running"; attempt: number; at: number }
  | {
      kind: "attempt";
      phase: "failed";
      attempt: number;
      at: number;
      durationMs: number;
      /** Backoff the step asked for via RetryableError({ retryAfter }). */
      retryAfterMs: number;
      error: string;
    }
  | {
      kind: "attempt";
      phase: "completed";
      attempt: number;
      at: number;
      durationMs: number;
    }
  | {
      kind: "run";
      phase: "completed";
      at: number;
      totalMs: number;
      /** Attempt number that finally succeeded. */
      attempts: number;
    };

export function isTerminalRetryChunk(chunk: RetryChunk): boolean {
  return chunk.kind === "run";
}
