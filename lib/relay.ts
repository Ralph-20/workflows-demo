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
      /**
       * `failed` is a crash and always arrives after an `error` event (see the
       * bug #9 contract). `cancelled` is somebody pressing Stop: also terminal,
       * but not a fault, so it carries no `error` event and the UI must not
       * render it as one.
       */
      reason: "closed" | "terminal" | "failed" | "cancelled";
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

type ReadResult<C> = {
  kind: "read";
  result: ReadableStreamReadResult<C>;
};

type EndedStatus = "failed" | "cancelled";

type FailureResult =
  | { kind: "failed"; status: EndedStatus }
  | { kind: "stopped" };

/** How often the run's status is checked while waiting on its stream. */
const STATUS_POLL_MS = 400;

/**
 * A cancelled run is terminal but not broken, so it gets its own reason rather
 * than being reported as a failure.
 */
function reasonFor(status: EndedStatus): "failed" | "cancelled" {
  return status === "cancelled" ? "cancelled" : "failed";
}

/**
 * Resolves when the run reaches a terminal FAILURE state, or when `stopped()`
 * goes true because the relay finished on its own.
 *
 * Deliberately silent on `completed`: a run can be marked completed while its
 * last chunks are still in flight, so the happy path must stay driven by the
 * stream to avoid truncating the tail.
 *
 * `cancelled` counts here too, and it is how a Stop button reaches this relay:
 * the browser cancels the run through a separate request, and this poll is what
 * notices and closes the stream out cleanly.
 */
async function watchForFailure(
  run: Run<unknown>,
  stopped: () => boolean,
): Promise<FailureResult> {
  for (;;) {
    if (stopped()) return { kind: "stopped" };

    const status = await run.status.catch(() => null);
    if (status === "failed" || status === "cancelled") {
      return { kind: "failed", status };
    }

    await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
  }
}

/**
 * The run's recorded failure message, so the UI can say what actually broke
 * rather than "something went wrong". First line only, length-capped, and never
 * the stack — this page is public.
 */
async function runFailureMessage(runId: string): Promise<string | null> {
  try {
    const record = await getWorld().runs.get(runId, { resolveData: "none" });
    const message = record.error?.message?.trim();
    if (!message) return null;
    return message.split("\n")[0].slice(0, 300);
  } catch {
    return null;
  }
}

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
      let reason: "closed" | "terminal" | "failed" | "cancelled" = "closed";
      let sawTerminalChunk = false;

      // A workflow that THROWS never writes a terminal chunk and never closes
      // its stream, so reading alone would block here forever — the client
      // would sit on a spinner with no way to know the run died. The run's own
      // status is the authoritative signal, so watch it alongside the stream.
      let stopWatching = false;
      const failureWatch = watchForFailure(run, () => stopWatching);

      try {
        // Held across iterations so a chunk is never dropped by losing a race.
        let pendingRead: Promise<ReadResult<C>> | null = null;

        for (;;) {
          if (signal?.aborted) return;

          if (!pendingRead) {
            pendingRead = reader
              .read()
              .then((result) => ({ kind: "read" as const, result }));
          }

          const winner = await Promise.race([pendingRead, failureWatch]);

          if (winner.kind !== "read") {
            if (winner.kind === "failed") reason = reasonFor(winner.status);
            break;
          }

          pendingRead = null;
          const { done, value } = winner.result;
          if (done) break;

          emit({ type: "chunk", index, chunk: value });
          index += 1;

          if (isTerminal?.(value)) {
            sawTerminalChunk = true;
            reason = "terminal";
            break;
          }
        }
      } finally {
        stopWatching = true;
        // Releases the underlying stream so an early exit does not leave the
        // run's reader hanging around.
        await reader.cancel().catch(() => {});
      }

      // The stream can also just close on a failed run. Either way, if the run
      // ended without a terminal chunk, say so instead of reporting success.
      if (!sawTerminalChunk) {
        const status = await run.status.catch(() => null);
        if (status === "failed" || status === "cancelled") {
          reason = reasonFor(status);
          // Only a genuine failure gets an error event. Cancellation is a thing
          // the user asked for, so it travels as a terminal reason alone —
          // emitting an error here would render Stop as a crash.
          if (status === "failed") {
            emit({
              type: "error",
              message:
                (await runFailureMessage(runId)) ??
                "The workflow run failed before it finished.",
            });
          }
        }
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
