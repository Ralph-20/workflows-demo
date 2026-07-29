"use client";

import { useEffect, useRef, useState } from "react";
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
  Spinner,
  SubSection,
  Textarea,
  WhatThisShows,
  type Metric,
} from "@/components/ui";
import { errorMessage, postJson } from "@/lib/api-types";
import type { AgentChunk, RunStep } from "@/lib/chunks";
import type { Feature } from "@/lib/features";
import type { RelayEvent } from "@/lib/relay";
import { isAbortError, readNdjson } from "@/lib/stream";

type Row = {
  name: string;
  role: "model" | "tool";
  phase: "running" | "completed" | "failed" | "cancelled";
  attempt: number;
  durationMs?: number;
  detail?: string;
};

const DEFAULT_QUESTION = "Do I need a coat in Reykjavik today?";

function snippet(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  const shown = oneLine.length > 46 ? `${oneLine.slice(0, 43)}...` : oneLine;

  return `export async function agentTurn(question) {
  'use workflow';

  // Every model call and every tool call is its own
  // named step. Descriptive names are what make the
  // observability dashboard readable — a trace of
  // step1/step2/step3 tells you nothing at 3am.
  const plan = await planForecastLookup(question);
  const data = await fetchForecast(plan.city);
  return composeAnswer(question, data);
}

async function planForecastLookup(question) {
  'use step';
  const { text } = await generateText({
    model: 'anthropic/claude-sonnet-4.6',
    prompt: \`${shown}\`,
  });
  // Validated against a zod tool schema before the
  // tool is allowed to run.
  return coerceCity(text);
}

async function fetchForecast(city) {
  'use step';
  // Its own retryable unit: a flaky model call
  // retries without re-running this.
  return lookup(city);
}

// The Stop button on this page. A route handler holding
// only the run id can end the run from anywhere — no
// shared process, no in-memory handle to find:
//
//   import { getRun } from 'workflow/api';
//   await getRun(runId).cancel();
//
// The step already in flight finishes in the background;
// nothing after it is ever dispatched.`;
}

export function AgentsFeature({ feature }: { feature: Feature }) {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [summary, setSummary] = useState<{
    totalMs: number;
    mock: boolean;
    city: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const controller = useRef<AbortController | null>(null);
  // Read inside the stream callback, where `runId` state would be stale.
  const liveRunId = useRef<string | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  /**
   * Ends the run on the server. Deliberately does NOT abort the fetch: killing
   * the stream client-side would only stop the browser watching, and the agent
   * would carry on burning steps. The run's own terminal state comes back down
   * the still-open stream as `done reason: "cancelled"`.
   */
  async function stop() {
    const id = liveRunId.current;
    if (!id) return;

    setStopping(true);
    try {
      await postJson<{ status: string; cancelled: boolean }>("/api/demo", {
        feature: "agents",
        action: "cancel",
        runId: id,
      });
      // Stays in the "Stopping…" state on purpose. The run is not terminal
      // until the relay says so, and `run()` clears this in its finally — so
      // the button cannot invite a second click into that gap.
    } catch (cause) {
      setError(errorMessage(cause));
      setStopping(false);
    }
  }

  async function run() {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;

    setPending(true);
    setStopping(false);
    setCancelled(false);
    setError(null);
    setRows([]);
    setAnswer(null);
    setSteps([]);
    setSummary(null);
    setRunId(null);
    liveRunId.current = null;

    // Tracked locally rather than from state, which would be stale inside this
    // closure. `failed` means the relay already explained the failure.
    let failed = false;
    let gotAnswer = false;
    let stopped = false;

    try {
      await readNdjson<RelayEvent<AgentChunk>>(
        "/api/demo",
        { feature: "agents", question },
        (event) => {
          if (event.type === "started") {
            liveRunId.current = event.runId;
            setRunId(event.runId);
          }
          if (event.type === "error") {
            failed = true;
            setError(event.message);
          }
          if (event.type === "steps") setSteps(event.steps);
          if (event.type === "done" && event.reason === "failed") failed = true;
          if (event.type === "done" && event.reason === "cancelled") {
            stopped = true;
            setCancelled(true);
          }
          if (event.type !== "chunk") return;

          const chunk = event.chunk;

          if (chunk.kind === "step") {
            setRows((prev) => {
              const next = [...prev];
              // Keyed by name, so a retried step updates its own row and shows
              // an attempt count instead of appearing as a duplicate step.
              const at = next.findIndex((r) => r.name === chunk.name);
              const row: Row = {
                name: chunk.name,
                role: chunk.role,
                phase: chunk.phase,
                attempt: chunk.attempt,
                durationMs: chunk.durationMs,
                detail: chunk.detail,
              };
              if (at === -1) next.push(row);
              else next[at] = row;
              return next;
            });
          }

          if (chunk.kind === "answer") {
            gotAnswer = true;
            setAnswer(chunk.text);
          }

          if (chunk.kind === "run") {
            setSummary({
              totalMs: chunk.totalMs,
              mock: chunk.mock,
              city: chunk.city,
            });
          }
        },
        ac.signal,
      );

      // Belt to the relay's braces. Once the stream has ended, any step still
      // showing "running" never finished — stopped on purpose if the run was
      // cancelled, failed otherwise. Either way it must not keep spinning.
      const unfinished: Row["phase"] = stopped ? "cancelled" : "failed";
      setRows((prev) =>
        prev.map((row) =>
          row.phase === "running" ? { ...row, phase: unfinished } : row,
        ),
      );
      // A cancelled run has no answer BY DESIGN, so that is not an error.
      if (!failed && !stopped && !gotAnswer) {
        setError(
          "The run ended before it produced an answer. Check the server logs for the workflow error.",
        );
      }
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(errorMessage(cause));
    } finally {
      setPending(false);
      setStopping(false);
    }
  }

  const stepRows: StepRow[] = rows.map((row, index) => ({
    key: `${row.name}-${index}`,
    name: `${row.name}  ·  ${row.role}`,
    phase: row.phase,
    attempt: row.attempt > 1 ? row.attempt : undefined,
    detail: row.durationMs !== undefined ? `${row.durationMs} ms` : undefined,
    note: row.detail,
  }));

  // Waterfall from the REAL step records, not from the streamed chunks.
  const traced = steps.filter((s) => s.durationMs !== null && s.startedAt);
  const t0 =
    traced.length > 0
      ? Math.min(...traced.map((s) => new Date(s.startedAt as string).getTime()))
      : 0;
  const traceSpan =
    traced.length > 0
      ? Math.max(
          ...traced.map(
            (s) =>
              new Date(s.startedAt as string).getTime() -
              t0 +
              (s.durationMs ?? 0),
          ),
        )
      : 0;

  const bars: WaterfallBar[] = traced.map((step, index) => ({
    key: `${step.stepName}-${index}`,
    label: step.stepName,
    startMs: new Date(step.startedAt as string).getTime() - t0,
    durationMs: step.durationMs ?? 0,
    tone: step.status === "completed" ? "success" : "danger",
    badge: step.attempt > 1 ? `attempt ${step.attempt}` : undefined,
  }));

  const completedSteps = rows.filter((r) => r.phase === "completed").length;

  const metrics: Metric[] = [
    {
      label: "Run status",
      value: cancelled
        ? "cancelled"
        : summary
          ? "completed"
          : pending
            ? "running"
            : error
              ? "failed"
              : "—",
      tone: cancelled
        ? "amber"
        : summary
          ? "success"
          : error
            ? "danger"
            : "default",
    },
    { label: "Model", value: summary?.mock ? "mock" : "claude-sonnet-4.6" },
    {
      label: "Named steps",
      value:
        steps.length > 0
          ? String(steps.length)
          : cancelled
            ? String(completedSteps)
            : "—",
    },
    {
      label: cancelled ? "Done before Stop" : "Total duration",
      value: summary
        ? `${summary.totalMs} ms`
        : cancelled
          ? `${completedSteps} step${completedSteps === 1 ? "" : "s"}`
          : "—",
      tone: cancelled ? "amber" : summary ? "success" : "default",
    },
  ];

  return (
    <>
      <Panel>
        <PanelHeader label={`${feature.number} · ${feature.title}`}>
          <DocsLink href={feature.docsUrl} />
        </PanelHeader>
        <PanelBody>
          <Field label="Question" htmlFor="agents-question">
            <Textarea
              id="agents-question"
              rows={3}
              value={question}
              disabled={pending}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </Field>

          <p className="text-[13px] leading-relaxed text-fg-secondary">
            The agent plans, calls a tool, then answers — three steps, each
            named and each independently retryable. The tool is a fixed forecast
            table for Lisbon, Reykjavik, Singapore and Denver, so the demo never
            depends on a third-party API.
          </p>

          <RunButton pending={pending} pendingLabel="Thinking…" onClick={run}>
            Run the agent
          </RunButton>

          {/* Only reachable while a run is actually in flight and has an id —
              there is nothing to cancel before or after that. */}
          <button
            type="button"
            disabled={!pending || runId === null || stopping || cancelled}
            onClick={stop}
            className="flex items-center justify-center gap-2 rounded-[8px] border border-amber/45 bg-amber/10 px-3 py-2.5 text-[13px] font-medium text-amber transition-colors hover:bg-amber/15 disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-fg-tertiary"
          >
            {stopping ? <Spinner /> : null}
            {stopping ? "Stopping…" : "Stop this run"}
          </button>

          <CodeBox code={snippet(question)} label="workflow" />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label="Result">
          {cancelled ? <Badge tone="amber">Cancelled</Badge> : null}
          {summary?.mock ? <Badge tone="mock">Mock model</Badge> : null}
          {summary && !summary.mock ? (
            <Badge tone="success">Live model</Badge>
          ) : null}
        </PanelHeader>
        <PanelBody className="flex-1">
          {error ? <ErrorBox message={error} /> : null}

          {!error && rows.length === 0 && !cancelled ? (
            <EmptyState>
              Run one agent turn and watch it execute as a workflow — named
              steps, real timings, one durable run. Hit Stop while it is
              thinking to end the run mid-flight.
            </EmptyState>
          ) : null}

          {rows.length > 0 || cancelled ? (
            <>
              <MetricGrid metrics={metrics} />

              {cancelled ? (
                <div className="rounded-[8px] border border-amber/40 bg-amber/8 px-4 py-3.5">
                  <span className="label-mono text-amber">
                    Cancelled server-side
                  </span>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-amber">
                    The run is terminal with status{" "}
                    <code className="font-mono">cancelled</code> — not failed,
                    and not just un-watched. The step log below stops where the
                    agent stopped, and the step records under it come from the
                    run&rsquo;s own event log, so you can check for yourself
                    that nothing after the cancel ever executed.
                  </p>
                </div>
              ) : null}

              {summary?.mock ? (
                <div className="rounded-[8px] border border-amber/40 bg-amber/8 px-4 py-3.5">
                  <span className="label-mono text-amber">Mock model</span>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-amber">
                    No <code className="font-mono">AI_GATEWAY_API_KEY</code> is
                    set, so the two model calls returned canned text after a
                    pause about as long as a real call. Everything else on this
                    tab is real: the run, the steps, the event log and the trace
                    below all came from the workflow runtime.
                  </p>
                </div>
              ) : null}

              {summary || cancelled ? (
                <WhatThisShows>
                  Durable agents: every agent turn is a workflow, and every
                  model call and tool call is a named, retryable step. A flaky
                  model call retries on its own without re-running the tool, and
                  a crash mid-turn resumes from the last completed step instead
                  of starting the conversation over. Because the run is a
                  durable object rather than a process, an agent that has gone
                  off the rails can be stopped from anywhere with nothing but
                  its run id — <code className="font-mono text-fg">Stop</code>{" "}
                  above is one{" "}
                  <code className="font-mono text-fg">
                    getRun(runId).cancel()
                  </code>{" "}
                  in a route handler, and no further step is dispatched. It is
                  the pattern behind{" "}
                  <a
                    href="https://github.com/vercel/eve"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue underline decoration-blue/30 underline-offset-2 transition-colors hover:decoration-blue"
                  >
                    Eve
                  </a>
                  , Vercel&rsquo;s open-source agent framework.
                </WhatThisShows>
              ) : null}

              {answer ? (
                <SubSection label="Final answer">
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-fg">
                    {answer}
                  </p>
                </SubSection>
              ) : null}

              <SubSection label="Steps as they executed">
                <StepLog rows={stepRows} />
              </SubSection>

              {bars.length > 0 ? (
                <SubSection
                  label="Step trace"
                  aside={
                    <span className="font-mono text-[10px] text-fg-tertiary">
                      from the run&rsquo;s event log
                    </span>
                  }
                >
                  <Waterfall bars={bars} totalMs={traceSpan} />
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

              {runId && (steps.length > 0 || cancelled) ? (
                <SubSection label="Raw run">
                  <JsonBlock
                    value={{
                      runId,
                      status: cancelled
                        ? "cancelled"
                        : summary
                          ? "completed"
                          : error
                            ? "failed"
                            : "running",
                      mock: summary?.mock,
                      steps,
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
