"use client";

import { useCallback, useState } from "react";
import { CapabilityCards } from "@/components/capability-cards";
import { FeaturePanels } from "@/components/features";
import { getFeature, type FeatureSlug } from "@/lib/features";

export function DemoWorkspace({ initialTab }: { initialTab: FeatureSlug }) {
  const [active, setActive] = useState<FeatureSlug>(initialTab);

  const select = useCallback((slug: FeatureSlug) => {
    setActive(slug);
    // Keep the URL shareable without a server round trip or scroll jump.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", slug);
    window.history.replaceState(null, "", url);
  }, []);

  const feature = getFeature(active);

  return (
    <>
      <CapabilityCards active={active} onSelect={select} />

      <section
        id="workspace-panels"
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
        className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2"
      >
        <FeaturePanels key={active} feature={feature} />
      </section>
    </>
  );
}
