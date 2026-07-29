"use client";

import { FEATURES, type FeatureSlug } from "@/lib/features";
import { cn } from "@/lib/cn";

export function CapabilityCards({
  active,
  onSelect,
}: {
  active: FeatureSlug;
  onSelect: (slug: FeatureSlug) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Workflow capabilities"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {FEATURES.map((feature) => {
        const isActive = feature.slug === active;
        return (
          <button
            key={feature.slug}
            type="button"
            role="tab"
            id={`tab-${feature.slug}`}
            aria-selected={isActive}
            aria-controls="workspace-panels"
            onClick={() => onSelect(feature.slug)}
            className={cn(
              "flex flex-col items-start gap-1.5 rounded-[12px] border p-4 text-left transition-colors",
              isActive
                ? "border-blue bg-blue/8"
                : "border-line bg-surface hover:border-line-hover hover:bg-surface-2",
            )}
          >
            <span
              className={cn(
                "font-mono text-[11px] font-medium tracking-[0.08em]",
                isActive ? "text-blue" : "text-fg-tertiary",
              )}
            >
              {feature.number}
            </span>
            <span className="text-[14px] font-medium tracking-[-0.01em]">
              {feature.title}
            </span>
            <span className="text-[13px] leading-relaxed text-fg-secondary">
              {feature.teaser}
            </span>
          </button>
        );
      })}
    </div>
  );
}
