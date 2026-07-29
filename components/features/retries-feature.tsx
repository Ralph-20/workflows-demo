"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StepLog, type StepRow } from "@/components/step-log";
import { Waterfall, type WaterfallBar } from "@/components/waterfall";
import {
  Badge,
  CodeBox,
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
import type { RetryChunk } from "@/lib/chunks";
import type { Feature } from "@/lib/features";
import { MAX_FORCED_FAILURES } from "@/lib/limits";
import type { RelayEvent } from "@/lib/relay";
import { isAbortError, readNdjson } from "@/lib/stream";

type Attempt = {
  attempt: number;
  phase: "running" | "completed" | "failed";
  startedAt: number;
  durationMs?: number;
  retryAfterMs?: number;
  error?: string;
};

const FAILURE_OPTIONS = [0, 1, 2, 3] as const;

function snippet(failures: number): string {
  const neverFires = failures === 0 ? "   // never true at 0 failures" : "";

  return `async function chargeCard(order) {
  'use step';

  const { attempt } = getStepMetadata();

  // Manufactured for the demo — nothing is actually broken.
  if (attempt <= ${failures}) {${neverFires}
    throw new RetryableError('Payment gateway timed out', {
      retryAfter: 700,
    });
  }

  // A FatalError instead would end the run here with no retry,
  // which is how you mark a failure as permanent:
  //   throw new FatalError('Card declined');

  return charge(order);
}

// ${MAX_FORCED_FAILURES} retries = up to ${MAX_FORCED_FAILURES + 1} attempts.
chargeCard.maxRetries = ${MAX_FORCED_FAILURES};

export async function payment(order) {
  'use workflow';
  // No try/catch, no attempt counter, no backoff loop.
  await chargeCard(order);
}`;
}

export function RetriesFeature({ feature }: { feature: Feature }) {
  const [failures, setFailures] = useState<number>(2);
  const [pending, setPending] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    totalMs: number;
    attempts: number;
  } | null>(null);

  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const upsert = useCallback((next: Attempt) => {
    setAttempts((prev) => {
      const rows = [...prev];
      const at = rows.findIndex((r) => r.attempt === next.attempt);
      if (at === -1) rows.push(next);
      else rows[at] = { ...rows[at], ...next };
      return rows.sort((a, b) => a.attempt - b.attempt);
    });
  }, []);

  async function run() {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;

    setPending(true);
    setError(null);
    setAttempts([]);
    setSummary(null);
    setRunId(null);

    try {
      await readNdjson<RelayEvent<RetryChunk>>(
        "/api/demo",
        { feature: "retries", failures },
        (event) => {
          if (event.type === "started") setRunId(event.runId);
          if (event.type === "error") setError(event.message);
          if (event.type !== "chunk") return;

          const chunk = event.chunk;

          if (chunk.kind === "attempt") {
            upsert({
              attempt: chunk.attempt,
              phase: chunk.phase,
              startedAt: chunk.at,
              durationMs: "durationMs" in chunk ? chunk.durationMs : undefined,
              retryAfterMs:
                "retryAfterMs" in chunk ? chunk.retryAfterMs : undefined,
              error: "error" in chunk ? chunk.error : undefined,
            });
          }

          if (chunk.kind === "run") {
            setSummary({ totalMs: chunk.totalMs, attempts: chunk.attempts });
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

  const stepRows: StepRow[] = attempts.map((a) => ({
    key: String(a.attempt),
    name: "chargeCard",
    phase: a.phase,
    attempt: a.attempt,
    detail: a.durationMs !== undefined ? `${a.durationMs} ms` : undefined,
    note:
      a.phase === "failed" && a.retryAfterMs !== undefined
        ? `${a.error} — retrying after ${a.retryAfterMs} ms`
        : undefined,
  }));

  // The waterfall axis starts at the first attempt, so the gaps between bars
  // are the backoff waits.
  const t0 = attempts[0]?.startedAt ?? 0;
  const finished = attempts.filter((a) => a.durationMs !== undefined);
  const spanMs =
    finished.length > 0
      ? Math.max(
          ...finished.map(
            (a) => a.startedAt - t0 + (a.durationMs ?? 0),
          ),
        )
      : 0;

  const bars: WaterfallBar[] = finished.map((a) => ({
    key: String(a.attempt),
    label: `attempt ${a.attempt}`,
    startMs: a.startedAt - t0,
    durationMs: a.durationMs ?? 0,
    tone: a.phase === "failed" ? "danger" : "success",
    badge: a.phase === "failed" ? "failed" : "ok",
  }));

  const retries = summary ? summary.attempts - 1 : Math.max(attempts.length - 1, 0);

  const metrics: Metric[] = [
    {
      label: "Attempts",
      value: summary ? String(summary.attempts) : String(attempts.length),
    },
    {
      label: "Retries",
      value: String(retries),
      tone: retries > 0 ? "amber" : "default",
    },
    { label: "Backoff each", value: failures > 0 ? "700 ms" : "—" },
    {
      label: "Total duration",
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
          <Field label="Fail this step N times" htmlFor="retries-failures">
            <Select
              id="retries-failures"
              value={failures}
              disabled={pending}
              onChange={(e) => setFailures(Number(e.target.value))}
            >
              {FAILURE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "0 — succeed first try" : `${n} deliberate failure${n > 1 ? "s" : ""}`}
                </option>
              ))}
            </Select>
          </Field>

          <p className="text-[13px] leading-relaxed text-fg-secondary">
            The step reads{" "}
            <code className="font-mono text-fg">getStepMetadata().attempt</code>{" "}
            and throws a{" "}
            <code className="font-mono text-fg">RetryableError</code> until it
            has failed that many times. The failure is{" "}
            <span className="text-amber">manufactured on purpose</span> —
            nothing here is actually broken.
          </p>

          <RunButton pending={pending} pendingLabel="Retrying…" onClick={run}>
            Run the step
          </RunButton>

          <CodeBox code={snippet(failures)} label="workflow" />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label="Result">
          {summary ? (
            <Badge tone="success">Recovered</Badge>
          ) : pending ? (
            <Badge tone="blue">Running</Badge>
          ) : null}
        </PanelHeader>
        <PanelBody className="flex-1">
          {error ? <ErrorBox message={error} /> : null}

          {!error && attempts.length === 0 ? (
            <EmptyState>
              Run the step and watch it fail, back off, and retry itself until it
              succeeds — with no error handling in the workflow.
            </EmptyState>
          ) : null}

          {attempts.length > 0 ? (
            <>
              <MetricGrid metrics={metrics} />

              {summary ? (
                <WhatThisShows>
                  {summary.attempts === 1
                    ? "One attempt, one success — the retry machinery costs nothing when nothing fails. Set the select above to 1–3 to watch a transient failure self-heal."
                    : `The step failed ${retries} time${retries > 1 ? "s" : ""} and recovered on attempt ${summary.attempts}. Transient failures self-heal with zero try/catch plumbing: the workflow just awaits the step, and the runtime owns the attempt counting and the backoff.`}
                </WhatThisShows>
              ) : null}

              <SubSection label="Attempts">
                <StepLog rows={stepRows} />
              </SubSection>

              {bars.length > 1 ? (
                <SubSection
                  label="Attempt timeline"
                  aside={
                    <span className="font-mono text-[10px] text-fg-tertiary">
                      gaps are the backoff waits
                    </span>
                  }
                >
                  <Waterfall bars={bars} totalMs={spanMs} />
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
                      forcedFailures: failures,
                      attempts: summary.attempts,
                      retries,
                      totalMs: summary.totalMs,
                      timeline: attempts.map((a) => ({
                        attempt: a.attempt,
                        phase: a.phase,
                        durationMs: a.durationMs,
                        retryAfterMs: a.retryAfterMs,
                      })),
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
