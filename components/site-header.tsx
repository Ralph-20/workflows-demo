const NAV = [
  { label: "Docs", href: "https://vercel.com/docs/workflows" },
  { label: "SDK", href: "https://workflow-sdk.dev" },
  { label: "useworkflow.dev", href: "https://useworkflow.dev" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-4 px-5 sm:px-6">
        <a
          href="https://vercel.com/docs/workflows"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-[6px]"
        >
          <svg
            aria-hidden
            viewBox="0 0 20 18"
            className="h-[15px] w-[17px] fill-fg"
          >
            <path d="M10 0 20 18H0Z" />
          </svg>
          <span className="text-[15px] font-medium tracking-[-0.01em]">
            Workflows
          </span>
        </a>

        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-[6px] px-2.5 py-1.5 text-[13px] text-fg-secondary transition-colors hover:text-fg"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
