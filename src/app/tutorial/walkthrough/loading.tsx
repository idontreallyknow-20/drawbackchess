// Route skeleton for /tutorial/walkthrough: the step counter, lesson title and
// goal chip above the board, with the hint rail beside it.
//
// This route ships the Board component, so the chunk is not small and the page
// previously opened on nothing. Like /codex/suggest it uses its own wordmark
// bar rather than SiteHeader, so the skeleton draws that bar.

export default function Loading() {
  return (
    <main className="min-h-screen pb-20">
      <div className="flex items-center justify-between gap-3 px-5 py-6 sm:px-10 sm:py-7">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Loading" width={26} height={26} className="animate-pulse" />
        <div className="skeleton h-8 w-40 shrink-0" />
      </div>
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="skeleton h-3.5 w-56 max-w-full" />
        <div className="skeleton mt-1 h-8 w-64 max-w-full" />
        <div className="skeleton mt-3 h-5 w-full max-w-2xl" />
        <div className="skeleton mt-4 h-11 w-56 max-w-full" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="skeleton aspect-square w-full" />
          <div className="space-y-3">
            <div className="plate p-5">
              <div className="skeleton h-3.5 w-12" />
              <div className="mt-2 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton h-4" />
                ))}
              </div>
              <div className="skeleton mt-4 h-10 w-full" />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
