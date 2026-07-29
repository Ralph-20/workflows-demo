"use client";

import { useEffect, useRef, useState } from "react";
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
  Spinner,
  SubSection,
  WhatThisShows,
  type Metric,
} from "@/components/ui";
import { errorMessage } from "@/lib/api-types";
import type { HookChunk } from "@/lib/chunks";
import type { Feature } from "@/lib/features";
import type { RelayEvent } from "@/lib/relay";
import { isAbortError, readNdjson } from "@/lib/stream";

type Row = { name: string; phase: "running" | "completed"; durationMs?: number; detail?: string };

type Awaiting = { token: string; summary: string };

type Decision = { approved: boolean; reviewer: string; waitedMs: number };

const AMOUNTS = [8_000, 42_000, 120_000] as const;

function usd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

function snippet(amountUsd: number): string {
  return `export async function approvalRun(transfer) {
  'use workflow';

  await screenTransfer(transfer);     // 'use step'

  const hook = createHook();
  // createHook() alone does not register the token —
  // this suspends just far enough to claim it.
  await hook.getConflict();
  await announceHook(hook.token);     // 'use step'

  // Suspended here. $0 compute while it waits, for
  // as long as it takes someone to decide.
  const decision = await hook;

  if (!decision.approved) {
    await voidTransfer(transfer);
    return { outcome: 'rejected' };
  }

  await releaseTransfer(transfer);    // ${usd(amountUsd)}
  return { outcome: 'approved' };
}

// Resumed from a plain route handler, by token:
//   await resumeHook(token, { approved: true });`;
}

export function HooksFeature({ feature }: { feature: Feature }) {
  const [amountUsd, setAmountUsd] = useState<number>(AMOUNTS[1]);
  const [pending, setPending] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "rejected" | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const controller = useRef<AbortController | null>(null);
  const nextIndex = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);

  function apply(chunk: HookChunk) {
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

    if (chunk.kind === "awaiting") {
      setAwaiting({ token: chunk.token, summary: chunk.summary });
    }

    if (chunk.kind === "decision") {
      setAwaiting(null);
      setDecision({
        approved: chunk.approved,
        reviewer: chunk.reviewer,
        waitedMs: chunk.waitedMs,
      });
    }

    if (chunk.kind === "run") {
      setOutcome(chunk.outcome);
      setTotalMs(chunk.totalMs);
    }
  }

  async function consume(body: unknown): Promise<void> {
    const ac = new AbortController();
    controller.current = ac;

    await readNdjson<RelayEvent<HookChunk>>(
      "/api/demo",
      body,
      (event) => {
        if (event.type === "started") setRunId(event.runId);
        if (event.type === "error") setError(event.message);
        if (event.type === "done") nextIndex.current = event.nextIndex;
        if (event.type === "chunk") {
          nextIndex.current = event.index + 1;
          apply(event.chunk);
        }
      },
      ac.signal,
    );
  }

  async function startRun() {
    controller.current?.abort();
    setPending(true);
    setError(null);
    setRows([]);
    setAwaiting(null);
    setDecision(null);
    setOutcome(null);
    setTotalMs(null);
    setRunId(null);
    nextIndex.current = 0;

    try {
      await consume({ feature: "hooks", amountUsd });
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function decide(approved: boolean) {
    if (!awaiting || !runId) return;
    setDeciding(true);
    setError(null);

    try {
      await consume({
        feature: "hooks",
        action: "resume",
        token: awaiting.token,
        runId,
        startIndex: nextIndex.current,
        approved,
      });
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(errorMessage(cause));
    } finally {
      setDeciding(false);
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
    {
      label: "Outcome",
      value: outcome ?? (awaiting ? "awaiting human" : "—"),
      tone: outcome === "approved" ? "success" : outcome === "rejected" ? "danger" : "amber",
    },
    {
      label: "Waited on human",
      value: decision ? `${(decision.waitedMs / 1000).toFixed(1)} s` : "—",
      tone: "amber",
    },
    { label: "Compute while waiting", value: "$0.00", tone: "success" },
    {
      label: "Total duration",
      value: totalMs !== null ? `${totalMs} ms` : "—",
    },
  ];

  return (
    <>
      <Panel>
        <PanelHeader label={`${feature.number} · ${feature.title}`}>
          <DocsLink href={feature.docsUrl} />
        </PanelHeader>
        <PanelBody>
          <Field label="Transfer to review" htmlFor="hooks-amount">
            <Select
              id="hooks-amount"
              value={amountUsd}
              disabled={pending || deciding || awaiting !== null}
              onChange={(e) => setAmountUsd(Number(e.target.value))}
            >
              {AMOUNTS.map((amount) => (
                <option key={amount} value={amount}>
                  {usd(amount)} — {amount >= 25_000 ? "elevated" : "standard"} risk
                </option>
              ))}
            </Select>
          </Field>

          <RunButton
            pending={pending}
            pendingLabel="Screening…"
            disabled={awaiting !== null || deciding}
            onClick={startRun}
          >
            Start review run
          </RunButton>

          <CodeBox code={snippet(amountUsd)} label="workflow" />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label="Result">
          {awaiting ? <Badge tone="amber">Awaiting approval</Badge> : null}
          {outcome === "approved" ? <Badge tone="success">Approved</Badge> : null}
          {outcome === "rejected" ? <Badge tone="danger">Rejected</Badge> : null}
        </PanelHeader>
        <PanelBody className="flex-1">
          {error ? <ErrorBox message={error} /> : null}

          {!error && rows.length === 0 ? (
            <EmptyState>
              Start a run. It screens the transfer, then suspends until you
              approve or reject it — the request that started it is already
              finished by then.
            </EmptyState>
          ) : null}

          {rows.length > 0 ? (
            <>
              <MetricGrid metrics={metrics} />

              {awaiting ? (
                <div className="rounded-[8px] border border-amber/40 bg-amber/8 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="label-mono text-amber">
                      Pending approval
                    </span>
                    <span className="font-mono text-[10px] text-amber">
                      run suspended
                    </span>
                  </div>

                  <p className="mt-2 text-[13px] leading-relaxed text-fg">
                    {awaiting.summary}
                  </p>

                  <dl className="mt-3 flex flex-col gap-1">
                    <dt className="label-mono">Hook token</dt>
                    <dd className="mono-13 break-all text-amber">
                      {awaiting.token}
                    </dd>
                  </dl>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={deciding}
                      onClick={() => decide(true)}
                      className="flex items-center justify-center gap-2 rounded-[8px] border border-success/45 bg-success/10 px-3 py-2.5 text-[13px] font-medium text-success transition-colors hover:bg-success/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deciding ? <Spinner /> : null}
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={deciding}
                      onClick={() => decide(false)}
                      className="flex items-center justify-center gap-2 rounded-[8px] border border-danger/45 bg-danger/10 px-3 py-2.5 text-[13px] font-medium text-danger transition-colors hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deciding ? <Spinner /> : null}
                      Reject
                    </button>
                  </div>
                </div>
              ) : null}

              {outcome ? (
                <WhatThisShows>
                  A sensitive action gated on a human decision, without a queue,
                  a cron job or a held-open request anywhere. The run sat
                  suspended for{" "}
                  {decision ? (decision.waitedMs / 1000).toFixed(1) : "—"}{" "}
                  seconds and resumed on the same line it stopped at — and a
                  suspended run costs nothing to keep waiting, whether that is
                  ten seconds or ten days.
                </WhatThisShows>
              ) : null}

              <SubSection label="Steps">
                <StepLog rows={stepRows} />
              </SubSection>

              {outcome && runId ? (
                <SubSection label="Raw run">
                  <JsonBlock
                    value={{
                      runId,
                      amountUsd,
                      outcome,
                      totalMs,
                      decision,
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
