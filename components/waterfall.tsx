import { cn } from "@/lib/cn";

export type WaterfallBar = {
  key: string;
  label: string;
  /** Offset from the start of the time axis, in ms. */
  startMs: number;
  durationMs: number;
  tone: "blue" | "success" | "danger" | "amber";
  /** Small mono annotation on the right, e.g. "attempt 2". */
  badge?: string;
};

const BAR_TONE: Record<WaterfallBar["tone"], string> = {
  blue: "bg-blue",
  success: "bg-success",
  danger: "bg-danger",
  amber: "bg-amber",
};

/**
 * Per-step horizontal bars on a shared time axis. Overlapping bars are the
 * whole point on the fan-out tab (they prove concurrency); on the retry tab the
 * gaps between bars are the point (they are the backoff waits).
 */
export function Waterfall({
  bars,
  totalMs,
}: {
  bars: WaterfallBar[];
  totalMs: number;
}) {
  // Guard against a zero span: a single instant step would divide by zero.
  const span = Math.max(totalMs, 1);

  return (
    <div className="flex flex-col gap-1.5">
      {bars.map((bar) => {
        const left = Math.min((bar.startMs / span) * 100, 100);
        // Floor the width so a very fast step is still visible as a bar.
        const width = Math.max(
          Math.min((bar.durationMs / span) * 100, 100 - left),
          1.5,
        );

        return (
          <div key={bar.key} className="flex items-center gap-3">
            <span className="w-[116px] shrink-0 truncate font-mono text-[11px] text-fg-secondary">
              {bar.label}
            </span>

            <div className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-[4px] bg-bg-soft">
              <div
                className={cn("absolute inset-y-[3px] rounded-[3px]", BAR_TONE[bar.tone])}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>

            <span className="w-[112px] shrink-0 text-right font-mono text-[11px] text-fg-tertiary">
              {bar.badge ? `${bar.badge} · ` : ""}
              {bar.durationMs} ms
            </span>
          </div>
        );
      })}

      <div className="mt-1 flex items-center gap-3">
        <span className="w-[116px] shrink-0" />
        <div className="flex min-w-0 flex-1 justify-between border-t border-line pt-1 font-mono text-[10px] text-fg-tertiary">
          <span>0 ms</span>
          <span>{totalMs} ms</span>
        </div>
        <span className="w-[112px] shrink-0" />
      </div>
    </div>
  );
}
