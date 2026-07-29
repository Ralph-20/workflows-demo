"use client";

import { useEffect, useRef, useState } from "react";
import { StepLog, type StepRow } from "@/components/step-log";
import { Waterfall, type WaterfallBar } from "@/components/waterfall";
import {
  Badge,
  CodeBox,
  CostNote,
  DocsLink,
  EmptyState,
  ErrorBox,
  Field,
  InspectRun,
  JsonBlock,
  MetricGrid,
  Panel,
  PanelBody,
  PanelHeader,
  RunButton,
  Select,
  SubSection,
  WhatThisShows,
  type Metric,
} from "@/components/ui";
import { errorMessage } from "@/lib/api-types";
import type { FanoutChunk, FanoutItem } from "@/lib/chunks";
import type { Feature } from "@/lib/features";
import { FANOUT_OPTIONS } from "@/lib/limits";
import type { RelayEvent } from "@/lib/relay";
import { isAbortError, readNdjson } from "@/lib/stream";

type Row = {
  index: number;
  name: string;
  phase: "running" | "completed";
  startOffsetMs: number;
  durationMs?: number;
  /** 1 for the first item to land, 2 for the next, and so on. */
  landed?: number;
};

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

function snippet(count: number): string {
  return `export async function fanoutRun(shards) {
  'use workflow';

  // ${count} shards, all at once. No worker pool,
  // no queue to provision, no concurrency library.
  const results = await Promise.all(
    shards.map((shard) => reprocessShard(shard)),
  );

  return summarise(results);
}

async function reprocessShard(shard) {
  'use step';
  // Each branch is its own durable, retryable unit:
  // if this one fails it retries on its own, and the
  // other ${count - 1} keep the results they already have.
  return rebuild(shard);
}

// ${count} is small. For thousands of items, bound the
// concurrency instead of opening every branch at once —
// chunk, then pace between chunks so a rate-limited
// downstream is not the thing that breaks:
//
//   for (const batch of chunk(shards, 20)) {
//     await Promise.allSettled(batch.map(reprocessShard));
//     await sleep('1s');   // pace the next batch
//   }
//
// allSettled keeps one bad item from hiding the rest.`;
}

export function ParallelFeature({ feature }: { feature: Feature }) {
  const [itemCount, setItemCount] = useState<number>(FANOUT_OPTIONS[1]);
  const [pending, setPending] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<{
    wallMs: number;
    sumMs: number;
    items: FanoutItem[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const controller = useRef<AbortController | null>(null);
  const landedCount = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;

    setPending(true);
    setError(null);
    setRows([]);
    setSummary(null);
    setRunId(null);
    landedCount.current = 0;

    try {
      await readNdjson<RelayEvent<FanoutChunk>>(
        "/api/demo",
        { feature: "parallel", items: itemCount },
        (event) => {
          if (event.type === "started") setRunId(event.runId);
          if (event.type === "error") setError(event.message);
          if (event.type !== "chunk") return;

          const chunk = event.chunk;

          if (chunk.kind === "item") {
            const landed =
              chunk.phase === "completed" ? ++landedCount.current : undefined;

            setRows((prev) => {
              const next = [...prev];
              const at = next.findIndex((r) => r.index === chunk.index);
              const row: Row = {
                index: chunk.index,
                name: chunk.name,
                phase: chunk.phase,
                startOffsetMs: chunk.startOffsetMs,
                durationMs: chunk.durationMs,
                landed: landed ?? next[at]?.landed,
              };
              if (at === -1) next.push(row);
              else next[at] = row;
              return next.sort((a, b) => a.index - b.index);
            });
          }

          if (chunk.kind === "run") {
            setSummary({
              wallMs: chunk.wallMs,
              sumMs: chunk.sumMs,
              items: chunk.items,
            });
          }
        },
        ac.signal,
      );
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  const stepRows: StepRow[] = rows.map((row) => ({
    key: String(row.index),
    name: row.name,
    phase: row.phase,
    detail: row.durationMs !== undefined ? `${row.durationMs} ms` : undefined,
    note:
      row.landed !== undefined
        ? `landed ${ORDINALS[row.landed - 1] ?? `${row.landed}th`}`
        : undefined,
  }));

  const bars: WaterfallBar[] = (summary?.items ?? []).map((item) => ({
    key: String(item.index),
    label: item.name,
    startMs: item.startOffsetMs,
    durationMs: item.durationMs,
    tone: "success",
  }));

  const speedup = summary ? summary.sumMs / summary.wallMs : 0;

  const metrics: Metric[] = [
    { label: "Items", value: String(itemCount) },
    {
      label: "Total wall time",
      value: summary ? `${summary.wallMs} ms` : "—",
      tone: summary ? "success" : "default",
    },
    {
      label: "Sum of step time",
      value: summary ? `${summary.sumMs} ms` : "—",
    },
    {
      label: "Effective speedup",
      value: summary ? `${speedup.toFixed(1)}×` : "—",
      tone: summary ? "blue" : "default",
    },
  ];

  return (
    <>
      <Panel>
        <PanelHeader label={`${feature.number} · ${feature.title}`}>
          <DocsLink href={feature.docsUrl} />
        </PanelHeader>
        <PanelBody>
          <Field label="Items to process" htmlFor="parallel-items">
            <Select
              id="parallel-items"
              value={itemCount}
              disabled={pending}
              onChange={(e) => setItemCount(Number(e.target.value))}
            >
              {FANOUT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} items
                </option>
              ))}
            </Select>
          </Field>

          <p className="text-[13px] leading-relaxed text-fg-secondary">
            Each item takes a different amount of work, between 0.5 and 3
            seconds, so they finish out of order — which is exactly what you
            want to see.
          </p>

          <RunButton pending={pending} pendingLabel="Fanning out…" onClick={run}>
            Run
          </RunButton>

          <CodeBox code={snippet(itemCount)} label="workflow" />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label="Result">
          {summary ? (
            <Badge tone="success">{speedup.toFixed(1)}× faster</Badge>
          ) : pending ? (
            <Badge tone="blue">Running</Badge>
          ) : null}
        </PanelHeader>
        <PanelBody className="flex-1">
          {error ? <ErrorBox message={error} /> : null}

          {!error && rows.length === 0 ? (
            <EmptyState>
              Fan work out across steps and watch the results land as they
              finish, shortest job first.
            </EmptyState>
          ) : null}

          {rows.length > 0 ? (
            <>
              <MetricGrid metrics={metrics} />

              {summary ? (
                <CostNote>
                  {summary.items.length} steps · {summary.sumMs} ms of step
                  compute either way — running them in parallel bought{" "}
                  {speedup.toFixed(1)}× the wall time, not cheaper steps
                </CostNote>
              ) : null}

              {summary ? (
                <>
                  <WhatThisShows>
                    Fan out without managing queues or workers — one{" "}
                    <code className="font-mono text-fg">Promise.all</code> did
                    it. {summary.sumMs} ms of work finished in {summary.wallMs}{" "}
                    ms, and each branch stayed its own retryable, durable unit
                    rather than one big job that restarts from the top.
                  </WhatThisShows>

                  <div className="rounded-[8px] border border-line bg-bg-soft px-4 py-3.5">
                    <span className="label-mono">Bound it in production</span>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-fg-secondary">
                      {itemCount} branches at once is fine. Thousands is a
                      different question — not because the runtime cannot take
                      it, but because whatever those steps call usually cannot.
                      The pattern is to chunk the work into fixed-size batches,
                      run each batch with{" "}
                      <code className="font-mono text-fg">
                        Promise.allSettled
                      </code>{" "}
                      so one bad item does not hide the rest, and{" "}
                      <code className="font-mono text-fg">sleep()</code> between
                      batches to pace the next one. See{" "}
                      <a
                        href="https://workflow-sdk.dev/cookbook/common-patterns/batching"
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue underline decoration-blue/30 underline-offset-2 transition-colors hover:decoration-blue"
                      >
                        batching &amp; parallel processing
                      </a>
                      .
                    </p>
                  </div>
                </>
              ) : null}

              <SubSection
                label="Items"
                aside={
                  <span className="font-mono text-[10px] text-fg-tertiary">
                    note the order they landed in
                  </span>
                }
              >
                <StepLog rows={stepRows} />
              </SubSection>

              {bars.length > 0 ? (
                <SubSection
                  label="Waterfall"
                  aside={
                    <span className="font-mono text-[10px] text-fg-tertiary">
                      overlapping bars = real concurrency
                    </span>
                  }
                >
                  <Waterfall bars={bars} totalMs={summary?.wallMs ?? 0} />
                </SubSection>
              ) : null}

              {runId ? (
                <SubSection
                  label="Inspect this run"
                  aside={
                    <span className="font-mono text-[10px] text-fg-tertiary">
                      real run id
                    </span>
                  }
                >
                  <InspectRun runId={runId} />
                </SubSection>
              ) : null}

              {summary && runId ? (
                <SubSection label="Raw run">
                  <JsonBlock
                    value={{
                      runId,
                      items: itemCount,
                      wallMs: summary.wallMs,
                      sumMs: summary.sumMs,
                      speedup: Number(speedup.toFixed(2)),
                      steps: summary.items,
                    }}
                  />
                </SubSection>
              ) : null}
            </>
          ) : null}
        </PanelBody>
      </Panel>
    </>
  );
}
