type MoreCard = {
  title: string;
  description: string;
  href: string;
  /** Version marker for anything not in the 4.x line. */
  tag?: string;
};

const MORE: MoreCard[] = [
  {
    title: "Versioning & replays",
    description:
      "In-flight runs keep executing the code they started on, so a deploy mid-run cannot rewrite history. Replay a past run against new code to see what would change.",
    href: "https://workflow-sdk.dev/docs/foundations/versioning",
  },
  {
    title: "Observability dashboard",
    description:
      "Every run, step, attempt, and payload is inspectable after the fact — the same event log the runtime replays from, rendered as a timeline.",
    href: "https://workflow-sdk.dev/docs/observability",
  },
  {
    title: "Python runtime",
    description:
      "Write workflows and steps in Python with the same durable semantics, and call them from the same project as your TypeScript ones.",
    href: "https://vercel.com/docs/workflows/python",
  },
  {
    title: "Queues under the hood",
    description:
      "Each step is a queue message with its own delivery guarantees and backoff. The queue is part of the platform, so there is nothing for you to run.",
    href: "https://workflow-sdk.dev/docs/api-reference/workflow-runtime/world/queue",
  },
  {
    title: "Private-by-default handlers",
    description:
      "Generated workflow endpoints are registered as queue consumers, not public routes — they are not reachable from the internet even though they live in your app.",
    href: "https://workflow-sdk.dev/worlds/vercel",
  },
  {
    title: "Multi-region data",
    description:
      "Pin run data to the region that created it instead of a single home region. The 4.x line this demo runs on keeps all workflow data in one region.",
    href: "https://workflow-sdk.dev/v5/worlds/vercel",
    tag: "5.0 beta",
  },
  {
    title: "Streaming namespaces",
    description:
      "Open several independent durable streams from one run with getWritable({ namespace }) — logs on one channel, metrics on another, progress on a third.",
    href: "https://workflow-sdk.dev/docs/foundations/streaming",
  },
  {
    title: "vercel workflow CLI",
    description:
      "Inspect runs, list steps, and resume or cancel from your terminal, against local state or a deployment.",
    href: "https://workflow-sdk.dev/docs/configuration/cli-and-web-ui",
  },
];

export function MoreGrid() {
  return (
    <section className="mt-20">
      <h2 className="text-[22px] font-medium tracking-[-0.02em]">
        More of what Workflows includes
      </h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-fg-secondary">
        These ship in the product today and are covered in the docs — they are
        not wired up as live demos on this page.
      </p>

      {/* 8 cards, so 4-up on wide screens leaves no half-empty final row. */}
      <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {MORE.map((item) => (
          <li key={item.title}>
            <a
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className="group flex h-full flex-col gap-2 rounded-[12px] border border-line bg-surface p-5 transition-colors hover:border-line-hover hover:bg-surface-2"
            >
              <span className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium">
                {item.title}
                <span className="text-fg-tertiary transition-colors group-hover:text-blue">
                  →
                </span>
                {item.tag ? (
                  <span className="rounded-full border border-amber/40 bg-amber/10 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] text-amber uppercase">
                    {item.tag}
                  </span>
                ) : null}
              </span>
              <span className="text-[13px] leading-relaxed text-fg-secondary">
                {item.description}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
