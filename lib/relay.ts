import { getRun, type Run } from "workflow/api";
import { parseStepName } from "workflow/observability";
import { getWorld } from "workflow/runtime";
import type { RunStep } from "@/lib/chunks";
import { ndjsonResponse } from "@/lib/stream";

/**
 * Server-side relay of a workflow run's durable stream out to the browser as
 * NDJSON.
 *
 * Two things make this more than a `pipeThrough`:
 *
 * 1. Every chunk is tagged with its ABSOLUTE index in the run's stream, so a
 *    client that drops off can reattach at exactly the right position with
 *    `getReadable({ startIndex })`. No dedupe-filtering on the client — that
 *    would hide a genuine double-execution bug.
 * 2. The relay can stop early on a terminal chunk. A run's stream does not
 *    close when the run suspends at a hook or a sleep, so a naive pipe would
 *    hold the HTTP response (and, on Vercel, the function) open for nothing.
 */

export type RelayEvent<C> =
  | { type: "started"; runId: string }
  | { type: "attached"; runId: string; startIndex: number; tailIndex: number }
  | { type: "chunk"; index: number; chunk: C }
  | {
      /** Evidence that the lazy sleeper cleanup ran on this request. */
      type: "cleanup";
      cleaned: number;
      scanned: number;
      runIds: string[];
    }
  | {
      /** Real step records read from the run's event log once it finished. */
      type: "steps";
      steps: RunStep[];
    }
  | {
      type: "done";
      runId: string;
      /** The startIndex a client should use to reattach from here. */
      nextIndex: number;
      reason: "closed" | "terminal";
    }
  | { type: "error"; message: string };

type RelayOptions<C> = {
  runId: string;
  /** Absolute chunk index to start reading from. 0 for a fresh run. */
  startIndex?: number;
  /**
   * Emitted before any chunk. Used to hand the client the run id (and, when
   * reattaching, the tail index that separates backfill from live chunks).
   */
  head?: RelayEvent<C>;
  /** Emitted before `head`, for out-of-band facts like a cleanup report. */
  prelude?: RelayEvent<C>[];
  /**
   * Emitted after the last chunk. Used to attach data that only exists once the
   * run has finished, such as its materialized step records.
   */
  epilogue?: () => Promise<RelayEvent<C>[]>;
  /** Return true to end the relay after this chunk (suspension or completion). */
  isTerminal?: (chunk: C) => boolean;
  /** Client abort, forwarded by Vercel when supportsCancellation is set. */
  signal?: AbortSignal;
};

export function relayRun<C>({
  runId,
  startIndex = 0,
  head,
  prelude,
  epilogue,
  isTerminal,
  signal,
}: RelayOptions<C>): Response {
  return ndjsonResponse<RelayEvent<C>>(
    async (emit) => {
      for (const event of prelude ?? []) emit(event);
      if (head) emit(head);

      const run = getRun(runId);
      const readable = run.getReadable<C>({ startIndex });
      const reader = readable.getReader();

      let index = startIndex;
      let reason: "closed" | "terminal" = "closed";

      try {
        for (;;) {
          if (signal?.aborted) return;

          const { done, value } = await reader.read();
          if (done) break;

          emit({ type: "chunk", index, chunk: value });
          index += 1;

          if (isTerminal?.(value)) {
            reason = "terminal";
            break;
          }
        }
      } finally {
        // Releases the underlying stream so an early exit does not leave the
        // run's reader hanging around.
        await reader.cancel().catch(() => {});
      }

      if (epilogue) {
        for (const event of await epilogue()) emit(event);
      }

      emit({ type: "done", runId, nextIndex: index, reason });
    },
    (error) =>
      error instanceof Error
        ? error.message
        : `Could not read run ${runId}: ${String(error)}`,
  );
}

/**
 * Index of the last chunk already in the run's stream, or -1 when empty. Used
 * on reattach to tell the client which incoming chunks are backfill (work that
 * completed while it was disconnected) versus live.
 */
export async function tailIndexOf(run: Run<unknown>): Promise<number> {
  try {
    return await run.getReadable().getTailIndex();
  } catch {
    return -1;
  }
}

/**
 * The run's own step records, straight from the event log — not a replay of
 * what the workflow chose to stream. This is where real step names, attempt
 * counts and materialized timings come from.
 */
export async function listRunSteps(runId: string): Promise<RunStep[]> {
  try {
    const { data } = await getWorld().steps.list({
      runId,
      pagination: { limit: 100 },
      resolveData: "none",
    });

    return data
      .map((step) => {
        const startedAt = step.startedAt ? new Date(step.startedAt) : null;
        const completedAt = step.completedAt ? new Date(step.completedAt) : null;

        // Stored step names are fully qualified, e.g.
        // "step//./lib/workflows/agent//fetchForecast". parseStepName is the
        // supported way to get the readable function name back out.
        const parsed = parseStepName(step.stepName);

        return {
          stepName: parsed?.functionName ?? step.stepName,
          attempt: step.attempt,
          status: step.status,
          startedAt: startedAt?.toISOString() ?? null,
          completedAt: completedAt?.toISOString() ?? null,
          durationMs:
            startedAt && completedAt
              ? completedAt.getTime() - startedAt.getTime()
              : null,
        };
      })
      .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  } catch {
    // The trace is a bonus view; failing to read it must not fail the run.
    return [];
  }
}
