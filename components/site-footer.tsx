/** This site's own source, which is what the "Source" link promises. */
export const SOURCE_URL = "https://github.com/Ralph-20/workflows-demo";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-line">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-5 py-8 text-[13px] text-fg-tertiary sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          Every run on this page is a real workflow run. Nothing here is
          simulated.
        </p>
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded-[6px] transition-colors hover:text-fg"
        >
          Source on GitHub →
        </a>
      </div>
    </footer>
  );
}
