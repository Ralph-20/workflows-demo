/**
 * Run-hygiene caps for the demo. This site is public and every run costs events
 * plus retained data, so each capability is bounded: nothing here can be
 * driven into an unbounded or non-terminating run.
 */

/** Tab 01 — pipeline length options. */
export const PIPELINE_STEP_OPTIONS = [3, 5] as const;
export const MAX_PIPELINE_STEPS = 5;

/** Tab 02 — deliberate failures before the step is allowed to succeed. */
export const MAX_FORCED_FAILURES = 3;

/** Tab 05 — fan-out width. */
export const FANOUT_OPTIONS = [3, 5, 8] as const;
export const MAX_FANOUT = 8;

/** Tab 04 — a demo sleeper older than this is woken or cancelled on the next request. */
export const SLEEPER_MAX_AGE_MS = 60 * 60 * 1000;

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
