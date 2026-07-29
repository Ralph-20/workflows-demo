"use client";

import { useEffect, useRef, useState } from "react";
import { StepLog, type StepRow } from "@/components/step-log";
import {
  Badge,
  CodeBox,
  CostNote,
  DocsLink,
  EmptyState,
  ErrorBox,
  InspectRun,
  JsonBlock,
  MetricGrid,
  Panel,
  PanelBody,
  PanelHeader,
  RunButton,
  Spinner,
  SubSection,
  WhatThisShows,
  type Metric,
} from "@/components/ui";
import { errorMessage } from "@/lib/api-types";
import type { SleepChunk } from "@/lib/chunks";
import type { Feature } from "@/lib/features";
import type { RelayEvent } from "@/lib/relay";
import { isAbortError, readNdjson } from "@/lib/stream";

type Row = {
  name: string;
  phase: "running" | "completed";
  durationMs?: number;
  detail?: string;
};

type Sleeping = { since: number; wakeAt: number; duration: string };

const SNIPPET = `export async function retentionRun(record) {
  'use workflow';

  await scheduleRetention(record);   // 'use step'

  // A month of wall-clock time, and not one
  // millisecond of compute. No cron, no queue,
  // no scheduler row to maintain.
  await sleep('30 days');

  await purgeRecord(record);         // 'use step'
}

// Nobody waits 30 days to see a demo, so the page
// interrupts the sleep from a route handler:
//   const { stoppedCount } = await getRun(runId).wakeUp();`;

function wakeAtLabel(wakeAt: number): string {
  return new Date(wakeAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function SleepFeature({ feature }: { feature: Feature }) {
  const [pending, setPending] = useState(false);
  const [waking, setWaking] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [sleeping, setSleeping] = useState<Sleeping | null>(null);
  const [sleptMs, setSleptMs] = useState<number | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [cleaned, setCleaned] = useState<{ cleaned: number; scanned: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const controller = useRef<AbortController | null>(null);
  const nextIndex = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);

  // "sleeping for: Xs and counting" — ticks only while the run is asleep.
  useEffect(() => {
    if (!sleeping) return;
    const tick = () => setElapsed(Date.now() - sleeping.since);
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [sleeping]);

  function apply(chunk: SleepChunk) {
    if (chunk.kind === "step") {
      setRows((prev) => {
        const next = [...prev];
        const at = next.findIndex((r) => r.name === chunk.name);
        const row: Row = {
          name: chunk.name,
          phase: chunk.phase,
          durationMs: chunk.durationMs,
          detail: chunk.detail,
        };
        if (at === -1) next.push(row);
        else next[at] = row;
        return next;
      });
    }

    if (chunk.kind === "sleeping") {
      setSleeping({
        since: chunk.at,
        wakeAt: chunk.wakeAt,
        duration: chunk.duration,
      });
    }

    if (chunk.kind === "woke") {
      setSleeping(null);
      setSleptMs(chunk.sleptMs);
    }

    if (chunk.kind === "run") setTotalMs(chunk.totalMs);
  }

  async function consume(body: unknown): Promise<void> {
    const ac = new AbortController();
    controller.current = ac;

    await readNdjson<RelayEvent<SleepChunk>>(
      "/api/demo",
      body,
      (event) => {
        if (event.type === "cleanup") {
          setCleaned({ cleaned: event.cleaned, scanned: event.scanned });
        }
        if (event.type === "started") setRunId(event.runId);
        if (event.type === "error") setError(event.message);
        if (event.type === "done") {
          nextIndex.current = event.nextIndex;
          // A cancelled run is terminal but carries no error event, so without
          // this the relay would just stop and the panel would sit there
          // looking like it was still working. The realistic cause is the
          // hygiene pass reaping this sleeper as abandoned.
          if (event.reason === "cancelled") {
            setSleeping(null);
            setError(
              "This run was cancelled before it finished — abandoned sleepers are reaped after an hour. Start a new one.",
            );
          }
        }
        if (event.type === "chunk") {
          nextIndex.current = event.index + 1;
          apply(event.chunk);
        }
      },
      ac.signal,
    );
  }

  async function startSleep() {
    controller.current?.abort();
    setPending(true);
    setError(null);
    setRows([]);
    setSleeping(null);
    setSleptMs(null);
    setTotalMs(null);
    setRunId(null);
    nextIndex.current = 0;

    try {
      await consume({ feature: "sleep" });
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function skipTheWait() {
    if (!runId) return;
    setWaking(true);
    setError(null);

    try {
      await consume({
        feature: "sleep",
        action: "wake",
        runId,
        startIndex: nextIndex.current,
      });
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(errorMessage(cause));
    } finally {
      setWaking(false);
    }
  }

  const stepRows: StepRow[] = rows.map((row, index) => ({
    key: `${row.name}-${index}`,
    name: row.name,
    phase: row.phase,
    detail: row.durationMs !== undefined ? `${row.durationMs} ms` : undefined,
    note: row.detail,
  }));

  const metrics: Metric[] = [
    { label: "Sleep scheduled", value: "30 days", tone: "amber" },
    {
      label: "Actually slept",
      value:
        sleptMs !== null
          ? `${(sleptMs / 1000).toFixed(1)} s`
          : sleeping
            ? `${(elapsed / 1000).toFixed(1)} s…`
            : "—",
      tone: sleptMs !== null ? "success" : "amber",
    },
    { label: "Compute while sleeping", value: "$0.00", tone: "success" },
    {
      label: "Abandoned runs cleaned",
      value: cleaned ? String(cleaned.cleaned) : "—",
    },
  ];

  return (
    <>
      <Panel>
        <PanelHeader label={`${feature.number} · ${feature.title}`}>
          <DocsLink href={feature.docsUrl} />
        </PanelHeader>
        <PanelBody>
          <p className="text-[13px] leading-relaxed text-fg-secondary">
            This starts a real run that sleeps for a real 30 days. The HTTP
            request finishes in under a second — the sleep outlives it. Thirty
            days is just this demo&rsquo;s choice:{" "}
            <code className="font-mono text-fg">sleep()</code> suspends a
            workflow for any amount of time you specify, from minutes to days or
            months, so a long wait does not have to be chopped into a chain of
            shorter ones.
          </p>

          <RunButton
            pending={pending}
            pendingLabel="Starting…"
            disabled={sleeping !== null || waking}
            onClick={startSleep}
          >
            Start 30-day sleep
          </RunButton>

          <button
            type="button"
            disabled={sleeping === null || waking}
            onClick={skipTheWait}
            className="flex items-center justify-center gap-2 rounded-[8px] border border-amber/45 bg-amber/10 px-3 py-2.5 text-[13px] font-medium text-amber transition-colors hover:bg-amber/15 disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-fg-tertiary"
          >
            {waking ? <Spinner /> : null}
            Skip the wait
          </button>

          <CodeBox code={SNIPPET} label="workflow" />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label="Result">
          {sleeping ? <Badge tone="amber">Sleeping</Badge> : null}
          {totalMs !== null ? <Badge tone="success">Completed</Badge> : null}
        </PanelHeader>
        <PanelBody className="flex-1">
          {error ? <ErrorBox message={error} /> : null}

          {!error && rows.length === 0 ? (
            <EmptyState>
              Start the run. It does a little work, then goes to sleep for a
              month — and you can cut that short whenever you like.
            </EmptyState>
          ) : null}

          {rows.length > 0 ? (
            <>
              <MetricGrid metrics={metrics} />

              <CostNote>
                {rows.length} step{rows.length === 1 ? "" : "s"} executed
                {sleptMs !== null
                  ? ` · ${(sleptMs / 1000).toFixed(1)} s suspended, billed $0 of compute`
                  : sleeping
                    ? " · suspended right now, billed $0 of compute"
                    : ""}
              </CostNote>

              {sleeping ? (
                <div className="rounded-[8px] border border-amber/40 bg-amber/8 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="label-mono text-amber">Sleeping</span>
                    <span className="font-mono text-[10px] text-amber">
                      $0.00 compute
                    </span>
                  </div>

                  <p className="mono-13 mt-2 text-amber">
                    sleeping for: {(elapsed / 1000).toFixed(1)}s and counting
                  </p>

                  <dl className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <dt className="label-mono">Scheduled to wake</dt>
                      <dd className="mono-13 mt-0.5 text-fg">
                        {wakeAtLabel(sleeping.wakeAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="label-mono">Sleep duration</dt>
                      <dd className="mono-13 mt-0.5 text-fg">
                        {sleeping.duration}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-3 text-[13px] leading-relaxed text-fg-secondary">
                    The request that started this run has already finished.
                    Nothing is polling and nothing is parked on a timer.
                  </p>
                </div>
              ) : null}

              {totalMs !== null && sleptMs !== null ? (
                <WhatThisShows>
                  A month-long wait with zero compute cost and no cron or queue
                  glue to maintain. A suspended workflow is not a process
                  waiting — there is nothing running to bill, and you pay only
                  for the compute the steps themselves use, so the wait costs
                  the same whether it is ten minutes or a full month. The sleep
                  was real: waking it early is what cut{" "}
                  {(sleptMs / 1000).toFixed(1)} seconds short of 30 days, and
                  the run picked up on the very next line.
                </WhatThisShows>
              ) : null}

              <SubSection label="Steps">
                <StepLog rows={stepRows} />
              </SubSection>

              {cleaned ? (
                <SubSection
                  label="Run hygiene"
                  aside={
                    <span className="font-mono text-[10px] text-fg-tertiary">
                      lazy, no cron
                    </span>
                  }
                >
                  <p className="text-[13px] leading-relaxed text-fg-secondary">
                    This request scanned {cleaned.scanned} unfinished run
                    {cleaned.scanned === 1 ? "" : "s"} and cancelled{" "}
                    <span className="text-fg">{cleaned.cleaned}</span> that had
                    been abandoned for over an hour, so sleepers nobody came
                    back for do not pile up.
                  </p>
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

              {totalMs !== null && runId ? (
                <SubSection label="Raw run">
                  <JsonBlock
                    value={{
                      runId,
                      sleepScheduled: "30 days",
                      actuallySleptMs: sleptMs,
                      totalMs,
                      cleanup: cleaned,
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
