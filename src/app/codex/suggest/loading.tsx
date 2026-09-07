// Route skeleton for /codex/suggest.
//
// This route sits under /codex, so without its own file it inherited the codex
// library skeleton: a search bar over a nine-card grid, for a page that is a
// narrow single-column form. That is the layout-shift case the design system
// warns about, where a mismatched skeleton is worse than none.
//
// It also does not use SiteHeader. The page opens with its own wordmark-and-
// back-link bar at py-6 (py-7 from `sm`), so the skeleton draws that bar
// rather than the standard one.

export default function Loading() {
  return (
    <main className="min-h-screen pb-20">
      <div className="flex items-center justify-between px-6 py-6 sm:px-10 sm:py-7">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Loading" width={26} height={26} className="animate-pulse" />
        <div className="skeleton h-8 w-28" />
      </div>
      <section className="mx-auto max-w-2xl px-6">
        <div className="skeleton h-8 w-52" />
        <div className="skeleton mt-3 h-4 w-full max-w-md" />
        {/* The four rule types, as a wrapping row of toggles. */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-11 w-24" />
          ))}
        </div>
        <div className="skeleton mt-2 h-4 w-3/4" />
        <div className="plate mt-7 space-y-5 p-5 sm:p-6">
          <div>
            <div className="skeleton mb-1 h-3.5 w-28" />
            <div className="skeleton h-11 w-full" />
          </div>
          <div>
            <div className="skeleton mb-1 h-3.5 w-32" />
            <div className="skeleton h-[7.5rem] w-full" />
          </div>
          <div>
            <div className="skeleton mb-1 h-3.5 w-44" />
            <div className="skeleton h-10 w-full" />
          </div>
          <div className="skeleton h-12 w-full" />
        </div>
      </section>
    </main>
  );
}
