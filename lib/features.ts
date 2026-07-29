export type FeatureSlug =
  | "durable"
  | "retries"
  | "hooks"
  | "sleep"
  | "parallel"
  | "agents";

export type Feature = {
  slug: FeatureSlug;
  /** Two-digit card number, e.g. "01". */
  number: string;
  title: string;
  /** One-line card teaser. */
  teaser: string;
  /** Matching docs page for this capability. */
  docsUrl: string;
};

export const FEATURES: readonly Feature[] = [
  {
    slug: "durable",
    number: "01",
    title: "Durable execution",
    teaser:
      "Progress lives in the run, not the HTTP request — close the tab and the work keeps going.",
    docsUrl: "https://workflow-sdk.dev/docs/foundations/workflows-and-steps",
  },
  {
    slug: "retries",
    number: "02",
    title: "Automatic retries",
    teaser:
      "A failing step retries itself with backoff. No try/catch, no retry queue, no plumbing.",
    docsUrl: "https://workflow-sdk.dev/docs/foundations/errors-and-retries",
  },
  {
    slug: "hooks",
    number: "03",
    title: "Human-in-the-loop hooks",
    teaser:
      "Suspend mid-run until a person approves, then resume the same run where it left off.",
    docsUrl: "https://workflow-sdk.dev/docs/foundations/hooks",
  },
  {
    slug: "sleep",
    number: "04",
    title: "Sleep without compute",
    teaser:
      "Wait 30 days inside a function for $0 of compute — no cron, no queue, no scheduler.",
    docsUrl: "https://workflow-sdk.dev/docs/api-reference/workflow/sleep",
  },
  {
    slug: "parallel",
    number: "05",
    title: "Parallel fan-out",
    teaser:
      "Promise.all over steps fans work out wide, and every branch stays its own durable unit.",
    docsUrl:
      "https://workflow-sdk.dev/docs/cookbook/common-patterns/sequential-and-parallel",
  },
  {
    slug: "agents",
    number: "06",
    title: "Agents on workflows",
    teaser:
      "Every model call and tool call becomes a named, retryable step you can read in a trace.",
    docsUrl: "https://workflow-sdk.dev/docs/cookbook/agent-patterns/durable-agent",
  },
] as const;

export const DEFAULT_SLUG: FeatureSlug = "durable";

export function resolveSlug(value: string | undefined | null): FeatureSlug {
  const match = FEATURES.find((f) => f.slug === value);
  return match ? match.slug : DEFAULT_SLUG;
}

export function getFeature(slug: FeatureSlug): Feature {
  const match = FEATURES.find((f) => f.slug === slug);
  if (!match) throw new Error(`Unknown feature slug: ${slug}`);
  return match;
}
