"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StepLog, type StepRow } from "@/components/step-log";
import {
  Badge,
  CodeBox,
  DocsLink,
  EmptyState,
  ErrorBox,
  Field,
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
import type { DurableChunk } from "@/lib/chunks";
import type { Feature } from "@/lib/features";
import { PIPELINE_STEP_OPTIONS } from "@/lib/limits";
import type { RelayEvent } from "@/lib/relay";
import { isAbortError, readNdjson } from "@/lib/stream";
import { errorMessage } from "@/lib/api-types";

type Status = "idle" | "running" | "disconnected" | "completed";

type Row = {
  index: number;
  name: string;
  phase: "running" | "completed";
  durationMs?: number;
  /** Landed on a reattach leg, i.e. it ran while the client was disconnected. */
  backfilled?: boolean;
};

const STAGE_NAMES = [
  "validateInput",
  "enrichRecord",
  "scoreRisk",
  "reconcileLedger",
  "notifyDownstream",
];

function snippet(stepCount: number): string {
  const calls = STAGE_NAMES.slice(0, stepCount)
    .map((name) => `  await ${name}(record);`)
    .join("\n");

  return `export async function durablePipeline(record) {
  'use workflow';

${calls}
}

async function ${STAGE_NAMES[0]}(record) {
  'use step';
  // Each step's result is persisted before the next one starts,
  // so the run resumes here — not from the top — after a crash.
  return check(record);
}`;
}

export function DurableFeature({ feature }: { feature: Feature }) {
  const [stepCount, setStepCount] = useState<number>(PIPELINE_STEP_OPTIONS[0]);
  const [status, setStatus] = useState<Status>("idle");
  const [pending, setPending] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [whileGone, setWhileGone] = useState(0);
  const [summary, setSummary] = useState<{
    totalMs: number;
    stages: Array<{ name: string; durationMs: number }>;
  } | null>(null);

  const controller = useRef<AbortController | null>(null);
  const nextIndex = useRef(0);

  // A run keeps executing server-side after this component unmounts, which is
  // the point of the demo — but the reader should not outlive the tab switch.
  useEffect(() => () => controller.current?.abort(), []);

  const consume = useCallback(
    async (body: unknown) => {
      const ac = new AbortController();
      controller.current = ac;

      // Chunks at or below the tail index of a reattach leg completed while the
      // client was away. -1 on a fresh run: nothing is backfill.
      let tail = -1;

      await readNdjson<RelayEvent<DurableChunk>>(
        "/api/demo",
        body,
        (event) => {
          switch (event.type) {
            case "started":
              setRunId(event.runId);
              break;

            case "attached":
              setRunId(event.runId);
              tail = event.tailIndex;
              break;

            case "chunk": {
              const backfilled = event.index <= tail;
              const chunk = event.chunk;
              nextIndex.current = event.index + 1;

              if (chunk.kind === "step") {
                setRows((prev) => {
                  const next = [...prev];
                  const at = next.findIndex((r) => r.index === chunk.index);
                  const row: Row = {
                    index: chunk.index,
                    name: chunk.name,
                    phase: chunk.phase,
                    durationMs: chunk.durationMs,
                    backfilled: backfilled || next[at]?.backfilled,
                  };
                  if (at === -1) next.push(row);
                  else next[at] = row;
                  return next.sort((a, b) => a.index - b.index);
                });

                if (backfilled && chunk.phase === "completed") {
                  setWhileGone((n) => n + 1);
                }
              }

              if (chunk.kind === "run") {
                setSummary({ totalMs: chunk.totalMs, stages: chunk.stages });
                setStatus("completed");
              }
              break;
            }

            case "done":
              nextIndex.current = event.nextIndex;
              break;

            case "error":
              setError(event.message);
              break;
          }
        },
        ac.signal,
      );
    },
    [],
  );

  async function startRun() {
    controller.current?.abort();
    setPending(true);
    setError(null);
    setRows([]);
    setSummary(null);
    setWhileGone(0);
    setRunId(null);
    nextIndex.current = 0;
    setStatus("running");

    try {
      await consume({ feature: "durable", action: "start", steps: stepCount });
    } catch (cause) {
      if (isAbortError(cause)) return; // Disconnect button, or unmount.
      setError(errorMessage(cause));
      setStatus("idle");
    } finally {
      setPending(false);
    }
  }

  function disconnect() {
    controller.current?.abort();
    controller.current = null;
    setStatus("disconnected");
  }

  async function reconnect() {
    if (!runId) return;
    setPending(true);
    setError(null);
    setStatus("running");

    try {
      await consume({
        feature: "durable",
        action: "attach",
        runId,
        startIndex: nextIndex.current,
      });
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(errorMessage(cause));
      setStatus("disconnected");
    } finally {
      setPending(false);
    }
  }

  const stepRows: StepRow[] = rows.map((row) => ({
    key: String(row.index),
    name: row.name,
    phase: row.phase,
    detail: row.durationMs !== undefined ? `${row.durationMs} ms` : undefined,
    note: row.backfilled ? "completed while disconnected" : undefined,
  }));

  const done = rows.filter((r) => r.phase === "completed").length;

  const metrics: Metric[] = [
    { label: "Run id", value: runId ? runId.slice(0, 14) : "—" },
    { label: "Steps", value: `${done} / ${stepCount}` },
    {
      label: "Steps while disconnected",
      value: String(whileGone),
      tone: whileGone > 0 ? "amber" : "default",
    },
    {
      label: "Duration",
      value: summary ? `${summary.totalMs} ms` : "—",
      tone: summary ? "success" : "default",
    },
  ];

  return (
    <>
      <Panel>
        <PanelHeader label={`${feature.number} · ${feature.title}`}>
          <DocsLink href={feature.docsUrl} />
        </PanelHeader>
        <PanelBody>
          <Field label="Pipeline size" htmlFor="durable-steps">
            <Select
              id="durable-steps"
              value={stepCount}
              disabled={status === "running" || status === "disconnected"}
              onChange={(e) => setStepCount(Number(e.target.value))}
            >
              {PIPELINE_STEP_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} steps
                </option>
              ))}
            </Select>
          </Field>

          {/* Still enabled while disconnected: abandoning a run and starting a
              fresh one should never be a dead end. */}
          <RunButton
            pending={pending && status === "running"}
            pendingLabel="Running…"
            disabled={status === "running"}
            onClick={startRun}
          >
            {status === "disconnected" ? "Start a new run" : "Start run"}
          </RunButton>

          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton
              onClick={disconnect}
              disabled={status !== "running"}
            >
              Disconnect
            </SecondaryButton>
            <SecondaryButton
              onClick={reconnect}
              disabled={status !== "disconnected"}
            >
              Reconnect
            </SecondaryButton>
          </div>

          <CodeBox code={snippet(stepCount)} label="workflow" />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label="Result">
          {status === "disconnected" ? (
            <Badge tone="amber">Disconnected</Badge>
          ) : null}
          {status === "running" ? <Badge tone="blue">Running</Badge> : null}
          {status === "completed" ? (
            <Badge tone="success">Completed</Badge>
          ) : null}
        </PanelHeader>
        <PanelBody className="flex-1">
          {error ? <ErrorBox message={error} /> : null}

          {!error && rows.length === 0 ? (
            <EmptyState>
              Start a run, then hit Disconnect while it is still going. The run
              keeps executing without you.
            </EmptyState>
          ) : null}

          {status === "disconnected" ? (
            <div className="rounded-[8px] border border-amber/40 bg-amber/8 px-4 py-3.5">
              <span className="label-mono text-amber">Disconnected</span>
              <p className="mt-1.5 text-[13px] leading-relaxed text-amber">
                Nothing is listening any more — the run continues on the server.
                Wait a few seconds, then Reconnect to see what you missed.
              </p>
            </div>
          ) : null}

          {rows.length > 0 ? (
            <>
              <MetricGrid metrics={metrics} />

              {summary ? (
                <WhatThisShows>
                  Progress lives in the durable run, not in the HTTP request
                  that started it. Dropping the connection did not pause a
                  thing; reattaching by run id replayed every step that landed
                  while nobody was watching.
                </WhatThisShows>
              ) : null}

              <SubSection label="Steps">
                <StepLog rows={stepRows} />
              </SubSection>

              {summary && runId ? (
                <SubSection label="Raw run">
                  <JsonBlock
                    value={{
                      runId,
                      totalMs: summary.totalMs,
                      stepsWhileDisconnected: whileGone,
                      stages: summary.stages,
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

function SecondaryButton({
  children,
  ...rest
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...rest}
      className="rounded-[8px] border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-fg transition-colors hover:border-line-hover disabled:cursor-not-allowed disabled:border-line disabled:text-fg-tertiary"
    >
      {children}
    </button>
  );
}
