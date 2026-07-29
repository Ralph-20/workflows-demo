import { getRun, start } from "workflow/api";
import { isTerminalDurableChunk, type DurableChunk } from "@/lib/chunks";
import { clampInt, MAX_PIPELINE_STEPS } from "@/lib/limits";
import { relayRun, tailIndexOf } from "@/lib/relay";
import { durablePipeline } from "@/lib/workflows/durable";

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

  return bad(`Unknown feature: ${String(body.feature)}`);
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
