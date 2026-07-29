import {
  DocsLink,
  EmptyState,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/ui";
import type { Feature } from "@/lib/features";

/**
 * Stand-in for a capability whose live demo has not landed yet. Keeps the
 * two-panel workspace shape (and the tab's docs link) intact so the shell is
 * verifiable before the workflow behind it exists.
 */
export function PlaceholderFeature({ feature }: { feature: Feature }) {
  return (
    <>
      <Panel>
        <PanelHeader label={`${feature.number} · ${feature.title}`}>
          <DocsLink href={feature.docsUrl} />
        </PanelHeader>
        <PanelBody className="flex-1">
          <EmptyState>{feature.teaser}</EmptyState>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label="Result" />
        <PanelBody className="flex-1">
          <EmptyState>
            This capability&rsquo;s live demo is not wired up yet. The docs link
            above covers it in full.
          </EmptyState>
        </PanelBody>
      </Panel>
    </>
  );
}
