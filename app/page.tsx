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

        <div className="mt-12">
          <DemoWorkspace initialTab={initialTab} />
        </div>

        <MoreGrid />
      </main>

      <SiteFooter />
    </>
  );
}
