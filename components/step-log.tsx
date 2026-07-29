import { cn } from "@/lib/cn";

export type StepPhase = "running" | "completed" | "failed" | "cancelled";

export type StepRow = {
  /** Stable identity for the row (usually the step index). */
  key: string;
  name: string;
  phase: StepPhase;
  /** Right-aligned mono detail, e.g. a duration. */
  detail?: string;
  /** Small annotation under the name, e.g. "completed while disconnected". */
  note?: string;
  /** Attempt number, rendered as a badge when a step ran more than once. */
  attempt?: number;
};

const PHASE_DOT: Record<StepPhase, string> = {
  running: "bg-blue animate-pulse",
  completed: "bg-success",
  failed: "bg-danger",
  cancelled: "bg-amber",
};

const PHASE_LABEL: Record<StepPhase, string> = {
  running: "running",
  completed: "done",
  failed: "failed",
  cancelled: "stopped",
};

const PHASE_TEXT: Record<StepPhase, string> = {
  running: "text-blue",
  completed: "text-success",
  failed: "text-danger",
  cancelled: "text-amber",
};

/**
 * Ordered list of steps as they execute. Shared by every tab that streams step
 * progress, so "blue means running, green means done, red means a failed
 * attempt, amber means somebody stopped it" reads the same everywhere.
 */
export function StepLog({ rows }: { rows: StepRow[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex items-start justify-between gap-3 rounded-[8px] border border-line bg-bg-soft px-3 py-2.5"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              aria-hidden
              className={cn(
                "mt-[6px] size-1.5 shrink-0 rounded-full",
                PHASE_DOT[row.phase],
              )}
            />
            <div className="min-w-0">
              <span className="mono-13 block truncate text-fg">{row.name}</span>
              {row.note ? (
                <span className="mt-0.5 block font-mono text-[10px] text-amber">
                  {row.note}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {row.attempt !== undefined ? (
              <span className="font-mono text-[10px] text-fg-tertiary">
                attempt {row.attempt}
              </span>
            ) : null}
            {row.detail ? (
              <span className="mono-13 text-fg-secondary">{row.detail}</span>
            ) : null}
            <span
              className={cn(
                "font-mono text-[10px] tracking-[0.09em] uppercase",
                PHASE_TEXT[row.phase],
              )}
            >
              {PHASE_LABEL[row.phase]}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
