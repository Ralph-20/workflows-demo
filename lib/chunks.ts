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

/** Tab 03 — human-in-the-loop hooks. */
export type HookChunk =
  | {
      kind: "step";
      phase: "running" | "completed";
      name: string;
      at: number;
      durationMs?: number;
      detail?: string;
    }
  | {
      kind: "awaiting";
      /** Hook token the browser posts back to resume this exact run. */
      token: string;
      at: number;
      summary: string;
    }
  | {
      kind: "decision";
      approved: boolean;
      reviewer: string;
      at: number;
      /** How long the run sat suspended, measured across the hook. */
      waitedMs: number;
    }
  | {
      kind: "run";
      phase: "completed";
      outcome: "approved" | "rejected";
      at: number;
      totalMs: number;
    };

/**
 * The start leg ends at `awaiting`: the run is suspended, and a run's stream
 * does NOT close on suspension, so relaying past this point would hold the
 * response open for nothing.
 */
export function isTerminalHookChunk(chunk: HookChunk): boolean {
  return chunk.kind === "awaiting" || chunk.kind === "run";
}

/** Tab 04 — sleep without compute. */
export type SleepChunk =
  | {
      kind: "step";
      phase: "running" | "completed";
      name: string;
      at: number;
      durationMs?: number;
      detail?: string;
    }
  | {
      kind: "sleeping";
      at: number;
      /** Scheduled wake time, ~30 days out. */
      wakeAt: number;
      duration: string;
    }
  | { kind: "woke"; at: number; sleptMs: number }
  | { kind: "run"; phase: "completed"; at: number; totalMs: number };

/** Same reasoning as hooks: the stream stays open while the run sleeps. */
export function isTerminalSleepChunk(chunk: SleepChunk): boolean {
  return chunk.kind === "sleeping" || chunk.kind === "run";
}

/** Tab 05 — parallel fan-out. */
export type FanoutItem = {
  index: number;
  name: string;
  /** Start, measured from the moment the fan-out began. */
  startOffsetMs: number;
  durationMs: number;
};

export type FanoutChunk =
  | {
      kind: "item";
      phase: "running" | "completed";
      index: number;
      name: string;
      at: number;
      startOffsetMs: number;
      durationMs?: number;
    }
  | {
      kind: "run";
      phase: "completed";
      at: number;
      /** Elapsed time across the whole fan-out. */
      wallMs: number;
      /** Sum of every step's own duration — what it would cost sequentially. */
      sumMs: number;
      items: FanoutItem[];
    };

export function isTerminalFanoutChunk(chunk: FanoutChunk): boolean {
  return chunk.kind === "run";
}

/** Tab 06 — agents on workflows. */
export type AgentChunk =
  | {
      kind: "step";
      phase: "running" | "completed";
      name: string;
      /** Whether this step wraps a model call or a tool call. */
      role: "model" | "tool";
      at: number;
      durationMs?: number;
      detail?: string;
    }
  | { kind: "answer"; at: number; text: string }
  | {
      kind: "run";
      phase: "completed";
      at: number;
      totalMs: number;
      mock: boolean;
      city: string;
    };

export function isTerminalAgentChunk(chunk: AgentChunk): boolean {
  return chunk.kind === "run";
}

/** Real step records read back from the run's event log after it finishes. */
export type RunStep = {
  stepName: string;
  attempt: number;
  status: string;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
};
