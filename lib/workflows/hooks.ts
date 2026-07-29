import { createHook, getWritable } from "workflow";
import type { HookChunk } from "@/lib/chunks";

/**
 * Tab 03 — human-in-the-loop.
 *
 * A transfer is screened by a step, then the run SUSPENDS at a hook until a
 * person approves or rejects it. While suspended there is no process, no
 * polling loop and no held-open request — the run is a row waiting for an
 * event, and resuming it continues from exactly this line.
 */

const WORK_MS = 700;

async function emit(
  writable: WritableStream<HookChunk>,
  chunk: HookChunk,
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

async function screenTransfer(
  amountUsd: number,
): Promise<{ risk: string; durationMs: number }> {
  "use step";

  const writable = getWritable<HookChunk>();
  const startedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "running",
    name: "screenTransfer",
    at: startedAt,
  });

  await new Promise((resolve) => setTimeout(resolve, WORK_MS));

  const risk = amountUsd >= 25_000 ? "elevated" : "standard";
  const completedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "completed",
    name: "screenTransfer",
    at: completedAt,
    durationMs: completedAt - startedAt,
    detail: `risk: ${risk}`,
  });

  return { risk, durationMs: completedAt - startedAt };
}

/** Hands the hook token to whoever is watching the run's stream. */
async function announceHook(token: string, summary: string): Promise<number> {
  "use step";

  const writable = getWritable<HookChunk>();
  const at = Date.now();
  await emit(writable, { kind: "awaiting", token, at, summary });
  return at;
}

async function settleTransfer(
  amountUsd: number,
  approved: boolean,
  reviewer: string,
  suspendedAt: number,
): Promise<{ durationMs: number }> {
  "use step";

  const writable = getWritable<HookChunk>();
  const decidedAt = Date.now();

  await emit(writable, {
    kind: "decision",
    approved,
    reviewer,
    at: decidedAt,
    waitedMs: decidedAt - suspendedAt,
  });

  const name = approved ? "releaseTransfer" : "voidTransfer";
  await emit(writable, {
    kind: "step",
    phase: "running",
    name,
    at: Date.now(),
  });

  await new Promise((resolve) => setTimeout(resolve, WORK_MS));

  const completedAt = Date.now();
  await emit(writable, {
    kind: "step",
    phase: "completed",
    name,
    at: completedAt,
    durationMs: WORK_MS,
    detail: approved
      ? `released $${amountUsd.toLocaleString("en-US")}`
      : "voided — funds never left the account",
  });

  return { durationMs: completedAt - decidedAt };
}

async function finishRun(
  startedAt: number,
  outcome: "approved" | "rejected",
): Promise<number> {
  "use step";

  const writable = getWritable<HookChunk>();
  const completedAt = Date.now();

  await emit(writable, {
    kind: "run",
    phase: "completed",
    outcome,
    at: completedAt,
    totalMs: completedAt - startedAt,
  });

  await writable.close();
  return completedAt;
}

export async function approvalRun(amountUsd: number): Promise<{
  outcome: "approved" | "rejected";
  totalMs: number;
}> {
  "use workflow";

  const startedAt = await markStart();
  const { risk } = await screenTransfer(amountUsd);

  const hook = createHook<{ approved: boolean; reviewer: string }>();

  // createHook() alone does not register the token — registration commits when
  // the workflow suspends. Awaiting getConflict() suspends just far enough to
  // claim the token, so the browser cannot post a resume before the hook is
  // ready to receive it.
  await hook.getConflict();

  const suspendedAt = await announceHook(
    hook.token,
    `$${amountUsd.toLocaleString("en-US")} transfer · ${risk} risk`,
  );

  // Suspended here. No compute is billed while this line waits.
  const decision = await hook;

  await settleTransfer(
    amountUsd,
    decision.approved,
    decision.reviewer,
    suspendedAt,
  );

  const outcome = decision.approved ? "approved" : "rejected";
  const completedAt = await finishRun(startedAt, outcome);

  return { outcome, totalMs: completedAt - startedAt };
}
