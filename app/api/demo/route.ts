import { getRun, resumeHook, start } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";
import {
  isTerminalAgentChunk,
  isTerminalDurableChunk,
  isTerminalFanoutChunk,
  isTerminalHookChunk,
  isTerminalRetryChunk,
  isTerminalSleepChunk,
  type AgentChunk,
  type DurableChunk,
  type FanoutChunk,
  type HookChunk,
  type RetryChunk,
  type SleepChunk,
} from "@/lib/chunks";
import { cleanupStaleRuns } from "@/lib/cleanup";
import {
  clampInt,
  MAX_FANOUT,
  MAX_FORCED_FAILURES,
  MAX_PIPELINE_STEPS,
} from "@/lib/limits";
import { isMockMode } from "@/lib/mock";
import {
  listRunSteps,
  relayRun,
  tailIndexOf,
  type RelayEvent,
} from "@/lib/relay";
import { agentTurn } from "@/lib/workflows/agent";
import { durablePipeline } from "@/lib/workflows/durable";
import { fanoutRun } from "@/lib/workflows/fanout";
import { approvalRun } from "@/lib/workflows/hooks";
import { retryingStep } from "@/lib/workflows/retries";
import { retentionRun } from "@/lib/workflows/sleep";

/**
 * One entry point for every capability, discriminated by `feature`. Each
 * feature either starts a real workflow run and relays its durable stream, or
 * reattaches to a run that is already executing.
 *
 * Long-lived relay responses need `supportsCancellation` in vercel.json (set
 * for app/api/**) so a closed browser tab tears the function down instead of
 * billing to maxDuration.
 */
export const maxDuration = 60;

type Body = {
  feature?: unknown;
  action?: unknown;
  steps?: unknown;
  items?: unknown;
  failures?: unknown;
  amountUsd?: unknown;
  question?: unknown;
  token?: unknown;
  approved?: unknown;
  runId?: unknown;
  startIndex?: unknown;
};

function bad(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Request body must be JSON.");
  }

  if (body.feature === "durable") return durable(body, request.signal);
  if (body.feature === "retries") return retries(body, request.signal);
  if (body.feature === "hooks") return hooks(body, request.signal);
  if (body.feature === "sleep") return sleeper(body, request.signal);
  if (body.feature === "parallel") return parallel(body, request.signal);
  if (body.feature === "agents") return agents(body, request.signal);

  return bad(`Unknown feature: ${String(body.feature)}`);
}

/**
 * Tab 06 — one agent turn, run as a workflow.
 *
 * Only the MODEL CALLS fall back to a deterministic mock, and only when no
 * gateway key is present. The workflow itself always runs for real.
 */
async function agents(body: Body, signal: AbortSignal): Promise<Response> {
  if (body.action === "cancel") return cancelAgentRun(body);

  const question =
    typeof body.question === "string" && body.question.trim().length > 0
      ? body.question.trim().slice(0, 280)
      : "Do I need a coat in Reykjavik today?";

  try {
    const run = await start(agentTurn, [question, isMockMode()]);

    return relayRun<AgentChunk>({
      runId: run.runId,
      head: { type: "started", runId: run.runId },
      isTerminal: isTerminalAgentChunk,
      // Read the real step records once the run is done, so the trace comes
      // from the event log rather than from what the workflow chose to stream.
      epilogue: async () => [
        { type: "steps", steps: await listRunSteps(run.runId) },
      ],
      signal,
    });
  } catch (error) {
    return bad(`Could not start the workflow: ${message(error)}`, 500);
  }
}

/**
 * Tab 06, Stop button — hard-cancel a run that is still in flight.
 *
 * A short JSON request, deliberately NOT a relay: the run's own stream is still
 * being relayed by the request that started it, and that relay polls the run's
 * status, so it is the one that notices the cancellation and closes the stream
 * out with `reason: "cancelled"`. Cancelling here and reporting there keeps a
 * single source of truth for the run's terminal state.
 *
 * This is the documented hard-cancellation path: the step that is mid-flight
 * right now still finishes in the background, but no LATER step is dispatched,
 * which is the part a runaway agent needs.
 */
async function cancelAgentRun(body: Body): Promise<Response> {
  if (typeof body.runId !== "string" || body.runId.length === 0) {
    return bad("Cancelling a run requires its run id.");
  }

  try {
    const run = getRun(body.runId);
    if (!(await run.exists)) {
      return bad(`Run ${body.runId} no longer exists.`, 404);
    }

    // Racing the run to its own finish line is normal here — the answer can
    // land between the click and this request. Report it rather than treating a
    // cancel that arrived too late as a failure.
    const status = await run.status;
    if (status !== "running" && status !== "pending") {
      return Response.json({ runId: body.runId, status, cancelled: false });
    }

    await run.cancel();
    return Response.json({ runId: body.runId, status: "cancelled", cancelled: true });
  } catch (error) {
    return bad(`Could not cancel the run: ${message(error)}`, 500);
  }
}

/** Tab 05 — fan N steps out at once. Capped at MAX_FANOUT (G5). */
async function parallel(body: Body, signal: AbortSignal): Promise<Response> {
  const items = clampInt(body.items, 1, MAX_FANOUT, 5);

  try {
    const run = await start(fanoutRun, [items]);
    return relayRun<FanoutChunk>({
      runId: run.runId,
      head: { type: "started", runId: run.runId },
      isTerminal: isTerminalFanoutChunk,
      signal,
    });
  } catch (error) {
    return bad(`Could not start the workflow: ${message(error)}`, 500);
  }
}

/**
 * Tab 04 — start a run that sleeps for 30 days, or wake one early.
 *
 * Every request through here first cancels abandoned runs older than an hour,
 * so a visitor who starts a sleeper and walks away cannot leave it parked for a
 * month. The report is relayed to the client as evidence that it ran.
 */
async function sleeper(body: Body, signal: AbortSignal): Promise<Response> {
  const cleanup = await cleanupStaleRuns();
  const prelude: RelayEvent<SleepChunk>[] = [
    {
      type: "cleanup",
      cleaned: cleanup.cleaned,
      scanned: cleanup.scanned,
      runIds: cleanup.runIds,
    },
  ];

  if (body.action === "wake") {
    if (typeof body.runId !== "string" || body.runId.length === 0) {
      return bad("Waking a run requires its run id.");
    }

    const startIndex = clampInt(body.startIndex, 0, Number.MAX_SAFE_INTEGER, 0);

    try {
      const run = getRun(body.runId);
      if (!(await run.exists)) {
        return bad(
          `Run ${body.runId} no longer exists. Start a new one.`,
          404,
        );
      }

      // A stale tab can try to wake a run the cleanup pass already cancelled.
      // The run still exists, so `exists` is true — only the status shows it.
      // Waking it anyway fails deep in the runtime with an opaque message, so
      // catch it here and say what actually happened.
      const status = await run.status;
      if (status !== "running" && status !== "pending") {
        return bad(
          `This run is already ${status} — an abandoned sleeper is cancelled after an hour. Start a new one.`,
          409,
        );
      }

      // Interrupts the pending sleep() and lets the run continue.
      await run.wakeUp();

      return relayRun<SleepChunk>({
        runId: body.runId,
        startIndex,
        head: { type: "started", runId: body.runId },
        prelude,
        isTerminal: isTerminalSleepChunk,
        signal,
      });
    } catch (error) {
      return bad(`Could not wake the run: ${message(error)}`, 500);
    }
  }

  try {
    const run = await start(retentionRun);
    return relayRun<SleepChunk>({
      runId: run.runId,
      head: { type: "started", runId: run.runId },
      prelude,
      isTerminal: isTerminalSleepChunk,
      signal,
    });
  } catch (error) {
    return bad(`Could not start the workflow: ${message(error)}`, 500);
  }
}

/**
 * Tab 03 — start a run that suspends at a hook, or resume it with a decision.
 *
 * The start leg ends as soon as the run suspends (see isTerminalHookChunk), so
 * nothing is held open while a human thinks about it.
 */
async function hooks(body: Body, signal: AbortSignal): Promise<Response> {
  if (body.action === "resume") {
    if (typeof body.token !== "string" || typeof body.runId !== "string") {
      return bad("Resuming requires the hook token and the run id.");
    }

    const approved = body.approved === true;

    try {
      await resumeHook(body.token, { approved, reviewer: "demo-reviewer" });
    } catch (error) {
      // A token that was already used, or belongs to a run that has since gone
      // away, is a normal outcome here (double click, stale tab) — not a crash.
      if (HookNotFoundError.is(error)) {
        return bad(
          "That approval hook no longer exists — it was already decided, or the run has expired. Start a new run to try again.",
          409,
        );
      }
      return bad(`Could not resume the run: ${message(error)}`, 500);
    }

    const startIndex = clampInt(body.startIndex, 0, Number.MAX_SAFE_INTEGER, 0);

    return relayRun<HookChunk>({
      runId: body.runId,
      startIndex,
      head: { type: "started", runId: body.runId },
      isTerminal: isTerminalHookChunk,
      signal,
    });
  }

  const amountUsd = clampInt(body.amountUsd, 1, 1_000_000, 42_000);

  try {
    const run = await start(approvalRun, [amountUsd]);
    return relayRun<HookChunk>({
      runId: run.runId,
      head: { type: "started", runId: run.runId },
      isTerminal: isTerminalHookChunk,
      signal,
    });
  } catch (error) {
    return bad(`Could not start the workflow: ${message(error)}`, 500);
  }
}

/** Tab 02 — run a step that fails on purpose N times, then succeeds. */
async function retries(body: Body, signal: AbortSignal): Promise<Response> {
  const failures = clampInt(body.failures, 0, MAX_FORCED_FAILURES, 2);

  try {
    const run = await start(retryingStep, [failures]);
    return relayRun<RetryChunk>({
      runId: run.runId,
      head: { type: "started", runId: run.runId },
      isTerminal: isTerminalRetryChunk,
      signal,
    });
  } catch (error) {
    return bad(`Could not start the workflow: ${message(error)}`, 500);
  }
}

/** Tab 01 — start a pipeline run, or reattach to one already in flight. */
async function durable(body: Body, signal: AbortSignal): Promise<Response> {
  if (body.action === "attach") {
    if (typeof body.runId !== "string" || body.runId.length === 0) {
      return bad("Reattaching requires the run id.");
    }

    const startIndex = clampInt(body.startIndex, 0, Number.MAX_SAFE_INTEGER, 0);

    try {
      const run = getRun(body.runId);
      if (!(await run.exists)) return bad(`Run ${body.runId} no longer exists.`, 404);

      // Chunks up to and including the tail landed while the client was gone;
      // anything after it is live. Read before opening the relay so the split
      // point is accurate.
      const tailIndex = await tailIndexOf(run);

      return relayRun<DurableChunk>({
        runId: body.runId,
        startIndex,
        head: { type: "attached", runId: body.runId, startIndex, tailIndex },
        isTerminal: isTerminalDurableChunk,
        signal,
      });
    } catch (error) {
      return bad(`Could not reattach to the run: ${message(error)}`, 500);
    }
  }

  const steps = clampInt(body.steps, 1, MAX_PIPELINE_STEPS, 3);

  try {
    const run = await start(durablePipeline, [steps]);
    return relayRun<DurableChunk>({
      runId: run.runId,
      head: { type: "started", runId: run.runId },
      isTerminal: isTerminalDurableChunk,
      signal,
    });
  } catch (error) {
    return bad(`Could not start the workflow: ${message(error)}`, 500);
  }
}
