import type { Feature, FeatureSlug } from "@/lib/features";
import { DurableFeature } from "@/components/features/durable-feature";
import { PlaceholderFeature } from "@/components/features/placeholder";

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
  retries: PlaceholderFeature,
  hooks: PlaceholderFeature,
  sleep: PlaceholderFeature,
  parallel: PlaceholderFeature,
  agents: PlaceholderFeature,
};

export function FeaturePanels({ feature }: FeaturePanelProps) {
  const Panels = PANELS[feature.slug];
  return <Panels feature={feature} />;
}
