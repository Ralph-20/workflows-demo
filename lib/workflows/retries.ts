import { getStepMetadata, getWritable, RetryableError } from "workflow";
import type { RetryChunk } from "@/lib/chunks";
import { MAX_FORCED_FAILURES } from "@/lib/limits";

/**
 * Tab 02 — automatic retries.
 *
 * The failure here is MANUFACTURED: the step looks at how many times it has
 * been executed and throws until it has failed the requested number of times.
 * Nothing is actually broken — that is what makes the retry behaviour visible.
 *
 * Note what the workflow function below does NOT contain: no try/catch, no
 * attempt counter, no backoff loop. The runtime owns all of that.
 */

/** Work done per attempt, so each attempt is a visible bar rather than an instant. */
const ATTEMPT_WORK_MS = 260;

/** Backoff requested on each manufactured failure. */
const RETRY_AFTER_MS = 700;

async function emit(
  writable: WritableStream<RetryChunk>,
  chunk: RetryChunk,
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

async function chargeCard(failures: number): Promise<{ attempts: number }> {
  "use step";

  const { attempt } = getStepMetadata();
  const writable = getWritable<RetryChunk>();
  const startedAt = Date.now();

  await emit(writable, { kind: "attempt", phase: "running", attempt, at: startedAt });

  await new Promise((resolve) => setTimeout(resolve, ATTEMPT_WORK_MS));

  if (attempt <= failures) {
    const completedAt = Date.now();
    await emit(writable, {
      kind: "attempt",
      phase: "failed",
      attempt,
      at: completedAt,
      durationMs: completedAt - startedAt,
      retryAfterMs: RETRY_AFTER_MS,
      error: `Manufactured transient failure (attempt ${attempt} of ${failures + 1})`,
    });

    throw new RetryableError(
      `Manufactured transient failure on attempt ${attempt}`,
      { retryAfter: RETRY_AFTER_MS },
    );
  }

  // A FatalError here instead would end the run immediately with no retry —
  // that is how you mark a failure as permanent (bad input, 4xx, etc).

  const completedAt = Date.now();
  await emit(writable, {
    kind: "attempt",
    phase: "completed",
    attempt,
    at: completedAt,
    durationMs: completedAt - startedAt,
  });

  return { attempts: attempt };
}

// 3 retries = up to 4 attempts, which is exactly enough for the largest
// manufactured failure count the UI offers. Also the demo's hard ceiling.
chargeCard.maxRetries = MAX_FORCED_FAILURES;

async function finishRun(startedAt: number, attempts: number): Promise<number> {
  "use step";

  const writable = getWritable<RetryChunk>();
  const completedAt = Date.now();

  await emit(writable, {
    kind: "run",
    phase: "completed",
    at: completedAt,
    totalMs: completedAt - startedAt,
    attempts,
  });

  await writable.close();
  return completedAt;
}

export async function retryingStep(failures: number): Promise<{
  attempts: number;
  totalMs: number;
}> {
  "use workflow";

  const startedAt = await markStart();

  // No try/catch: a RetryableError thrown inside the step is retried by the
  // runtime, and this await only resolves once the step finally succeeds.
  const { attempts } = await chargeCard(failures);

  const completedAt = await finishRun(startedAt, attempts);

  return { attempts, totalMs: completedAt - startedAt };
}
