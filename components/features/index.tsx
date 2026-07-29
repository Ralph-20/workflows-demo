import type { Feature, FeatureSlug } from "@/lib/features";
import { AgentsFeature } from "@/components/features/agents-feature";
import { DurableFeature } from "@/components/features/durable-feature";
import { HooksFeature } from "@/components/features/hooks-feature";
import { ParallelFeature } from "@/components/features/parallel-feature";
import { RetriesFeature } from "@/components/features/retries-feature";
import { SleepFeature } from "@/components/features/sleep-feature";

export type FeaturePanelProps = { feature: Feature };

/**
 * Slug → the two-panel workspace renderer for that capability. Explicit
 * registry rather than config-driven rendering: each capability owns its own
 * controls, snippet, and result shape.
 */
const PANELS: Record<
  FeatureSlug,
  (props: FeaturePanelProps) => React.ReactNode
> = {
  durable: DurableFeature,
  retries: RetriesFeature,
  hooks: HooksFeature,
  sleep: SleepFeature,
  parallel: ParallelFeature,
  agents: AgentsFeature,
};

export function FeaturePanels({ feature }: FeaturePanelProps) {
  const Panels = PANELS[feature.slug];
  return <Panels feature={feature} />;
}
