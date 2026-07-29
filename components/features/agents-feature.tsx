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
  JsonBlock,
  MetricGrid,
  Panel,
  PanelBody,
  PanelHeader,
  RunButton,
  SubSection,
  Textarea,
  WhatThisShows,
  type Metric,
} from "@/components/ui";
import { errorMessage } from "@/lib/api-types";
import type { AgentChunk, RunStep } from "@/lib/chunks";
import type { Feature } from "@/lib/features";
import type { RelayEvent } from "@/lib/relay";
import { isAbortError, readNdjson } from "@/lib/stream";

type Row = {
  name: string;
  role: "model" | "tool";
  phase: "running" | "completed";
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
}`;
}

export function AgentsFeature({ feature }: { feature: Feature }) {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [pending, setPending] = useState(false);
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
  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;

    setPending(true);
    setError(null);
    setRows([]);
    setAnswer(null);
    setSteps([]);
    setSummary(null);
    setRunId(null);

    try {
      await readNdjson<RelayEvent<AgentChunk>>(
        "/api/demo",
        { feature: "agents", question },
        (event) => {
          if (event.type === "started") setRunId(event.runId);
          if (event.type === "error") setError(event.message);
          if (event.type === "steps") setSteps(event.steps);
          if (event.type !== "chunk") return;

          const chunk = event.chunk;

          if (chunk.kind === "step") {
            setRows((prev) => {
              const next = [...prev];
              const at = next.findIndex((r) => r.name === chunk.name);
              const row: Row = {
                name: chunk.name,
                role: chunk.role,
                phase: chunk.phase,
                durationMs: chunk.durationMs,
                detail: chunk.detail,
              };
              if (at === -1) next.push(row);
              else next[at] = row;
              return next;
            });
          }

          if (chunk.kind === "answer") setAnswer(chunk.text);

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
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  const stepRows: StepRow[] = rows.map((row, index) => ({
    key: `${row.name}-${index}`,
    name: `${row.name}  ·  ${row.role}`,
    phase: row.phase,
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

  const metrics: Metric[] = [
    { label: "Model", value: summary?.mock ? "mock" : "claude-sonnet-4.6" },
    { label: "Named steps", value: steps.length > 0 ? String(steps.length) : "—" },
    { label: "City resolved", value: summary?.city ?? "—", tone: "blue" },
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

          <CodeBox code={snippet(question)} label="workflow" />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label="Result">
          {summary?.mock ? <Badge tone="mock">Mock model</Badge> : null}
          {summary && !summary.mock ? (
            <Badge tone="success">Live model</Badge>
          ) : null}
        </PanelHeader>
        <PanelBody className="flex-1">
          {error ? <ErrorBox message={error} /> : null}

          {!error && rows.length === 0 ? (
            <EmptyState>
              Run one agent turn and watch it execute as a workflow — named
              steps, real timings, one durable run.
            </EmptyState>
          ) : null}

          {rows.length > 0 ? (
            <>
              <MetricGrid metrics={metrics} />

              {summary?.mock ? (
                <div className="rounded-[8px] border border-amber/40 bg-amber/8 px-4 py-3.5">
                  <span className="label-mono text-amber">Mock model</span>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-amber">
                    No <code className="font-mono">AI_GATEWAY_API_KEY</code> is
                    set, so the two model calls returned canned text. Everything
                    else on this tab is real: the run, the steps, the event log
                    and the trace below all came from the workflow runtime.
                  </p>
                </div>
              ) : null}

              {summary ? (
                <WhatThisShows>
                  Durable agents: every agent turn is a workflow, and every
                  model call and tool call is a named, retryable step. A flaky
                  model call retries on its own without re-running the tool, and
                  a crash mid-turn resumes from the last completed step instead
                  of starting the conversation over. It is the pattern behind{" "}
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

              {steps.length > 0 && runId ? (
                <SubSection label="Raw run">
                  <JsonBlock value={{ runId, mock: summary?.mock, steps }} />
                </SubSection>
              ) : null}
            </>
          ) : null}
        </PanelBody>
      </Panel>
    </>
  );
}
