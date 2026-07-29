import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-[12px] border border-line bg-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
      <span className="label-mono">{label}</span>
      {children}
    </div>
  );
}

export function PanelBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-5 p-5", className)}>
      {children}
    </div>
  );
}

export function DocsLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-[6px] font-mono text-[11px] text-fg-tertiary transition-colors hover:text-blue"
    >
      Docs →
    </a>
  );
}

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="label-mono">
        {label}
      </label>
      {children}
    </div>
  );
}

const controlBase =
  "w-full rounded-[8px] border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-fg transition-colors hover:border-line-hover focus:border-focus focus:outline-none";

export function Select(props: React.ComponentProps<"select">) {
  const { className, ...rest } = props;
  return (
    <select
      {...rest}
      className={cn(controlBase, "cursor-pointer font-mono", className)}
    />
  );
}

export function Textarea(props: React.ComponentProps<"textarea">) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={cn(controlBase, "resize-y leading-relaxed", className)}
    />
  );
}

export function RunButton({
  pending,
  pendingLabel = "Running…",
  children,
  className,
  ...rest
}: React.ComponentProps<"button"> & {
  pending?: boolean;
  pendingLabel?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || pending}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-[8px] border border-line-hover bg-fg px-4 py-2.5 text-[13px] font-medium text-bg transition-colors",
        "hover:bg-white disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-fg-tertiary",
        className,
      )}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60",
        className,
      )}
    />
  );
}

export function CodeBox({
  code,
  label = "AI SDK",
}: {
  code: string;
  label?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[8px] border border-line bg-bg-soft">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="label-mono">{label}</span>
        <span className="font-mono text-[10px] text-fg-tertiary">
          read-only
        </span>
      </div>
      <pre className="mono-13 overflow-x-auto px-3 py-3 text-fg-secondary">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export type Metric = {
  label: string;
  value: string;
  tone?: "default" | "success" | "blue" | "amber" | "danger";
};

const metricTone: Record<NonNullable<Metric["tone"]>, string> = {
  default: "text-fg",
  success: "text-success",
  blue: "text-blue",
  amber: "text-amber",
  danger: "text-danger",
};

export function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-line bg-line sm:grid-cols-4">
      {metrics.map((m) => (
        <div key={m.label} className="min-w-0 bg-surface-2 px-3 py-3">
          <dt className="label-mono">{m.label}</dt>
          <dd
            className={cn(
              "mono-13 mt-1.5 truncate",
              metricTone[m.tone ?? "default"],
            )}
            title={m.value}
          >
            {m.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function WhatThisShows({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[8px] border border-line bg-bg-soft px-4 py-3.5">
      <span className="label-mono">What this shows</span>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fg-secondary">
        {children}
      </p>
    </div>
  );
}

export function SubSection({
  label,
  children,
  aside,
}: {
  label: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="label-mono">{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mono-13 max-h-72 overflow-auto rounded-[8px] border border-line bg-bg-soft px-3 py-3 text-fg-secondary">
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}

export function Badge({
  tone = "default",
  children,
}: {
  tone?: "default" | "mock" | "success" | "amber" | "danger" | "blue";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    default: "border-line text-fg-tertiary",
    mock: "border-amber/40 bg-amber/10 text-amber",
    success: "border-success/40 bg-success/10 text-success",
    amber: "border-amber/40 bg-amber/10 text-amber",
    danger: "border-danger/40 bg-danger/10 text-danger",
    blue: "border-blue/40 bg-blue/10 text-blue",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium tracking-[0.09em] uppercase",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-[8px] border border-danger/40 bg-danger/8 px-4 py-3.5"
    >
      <span className="label-mono text-danger">Request failed</span>
      <p className="mono-13 mt-1.5 break-words text-danger">{message}</p>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-[8px] border border-dashed border-line px-6 py-14 text-center">
      <p className="max-w-xs text-[13px] leading-relaxed text-fg-tertiary">
        {children}
      </p>
    </div>
  );
}
