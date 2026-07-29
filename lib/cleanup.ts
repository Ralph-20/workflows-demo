import { getRun } from "workflow/api";
import { getWorld } from "workflow/runtime";
import { SLEEPER_MAX_AGE_MS } from "@/lib/limits";

export type CleanupResult = {
  /** Runs cancelled by this pass. */
  cleaned: number;
  runIds: string[];
  /** How many non-terminal runs were considered. */
  scanned: number;
};

const EMPTY: CleanupResult = { cleaned: 0, runIds: [], scanned: 0 };

/**
 * Lazy garbage collection for abandoned demo runs, called on every tab-04
 * request. No cron needed.
 *
 * Tab 04 starts runs that sleep for 30 days. If a visitor starts one and never
 * clicks "Skip the wait", it would sit there for a month. Anything still
 * non-terminal after an hour is abandoned by definition — this demo has no run
 * that legitimately takes that long — so it gets cancelled.
 *
 * This deliberately does not filter by workflow name: a tab-03 run left
 * suspended at an approval hook is equally abandoned, and reports `running`
 * too, since the run status enum has no "suspended" value.
 *
 * Cancel rather than wake: waking would resume the run and pay for its
 * remaining steps, which is the opposite of what cleanup is for.
 */
export async function cleanupStaleRuns(): Promise<CleanupResult> {
  try {
    const world = getWorld();
    const cutoff = Date.now() - SLEEPER_MAX_AGE_MS;
    const runIds: string[] = [];
    let scanned = 0;

    for (const status of ["running", "pending"] as const) {
      const { data } = await world.runs.list({
        status,
        pagination: { limit: 50 },
        resolveData: "none",
      });
      scanned += data.length;

      for (const run of data) {
        if (new Date(run.createdAt).getTime() >= cutoff) continue;
        try {
          await getRun(run.runId).cancel();
          runIds.push(run.runId);
        } catch {
          // A run that completed or was cancelled between the list and here is
          // not a problem — it is already gone.
        }
      }
    }

    return { cleaned: runIds.length, runIds, scanned };
  } catch {
    // Cleanup is best-effort housekeeping. It must never fail the request that
    // triggered it.
    return EMPTY;
  }
}
