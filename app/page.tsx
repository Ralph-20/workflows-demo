import { DemoWorkspace } from "@/components/demo-workspace";
import { MoreGrid } from "@/components/more-grid";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { resolveSlug } from "@/lib/features";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab = resolveSlug(tab);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-[1120px] px-5 pt-14 sm:px-6 sm:pt-20">
        <h1 className="max-w-3xl text-[34px] leading-[1.1] font-medium tracking-[-0.03em] sm:text-[44px]">
          Functions that survive anything
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-fg-secondary">
          Workflows turn ordinary async functions into durable ones: they resume
          after a crash, retry themselves, wait a month on a human for $0 of
          compute, and record every step. Try the capabilities below live.
        </p>

        {/*
          Every number here is quoted from the public GA post and nothing is
          rounded up. It says "over 100 million runs and over 500 million steps
          ... across more than 1,500 customers" for the beta period that ended
          at GA on 16 April 2026.
        */}
        <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tracking-[0.02em] text-fg-tertiary">
          <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-medium tracking-[0.09em] text-success uppercase">
            GA
          </span>
          <span>
            Generally available 16 April 2026 · 100M+ runs and 500M+ steps
            across 1,500+ customers in beta
          </span>
          <a
            href="https://vercel.com/blog/a-new-programming-model-for-durable-execution"
            target="_blank"
            rel="noreferrer"
            className="text-fg-tertiary underline decoration-line underline-offset-2 transition-colors hover:text-blue hover:decoration-blue/40"
          >
            Announcement →
          </a>
        </p>

        <div className="mt-12">
          <DemoWorkspace initialTab={initialTab} />
        </div>

        <MoreGrid />
      </main>

      <SiteFooter />
    </>
  );
}
