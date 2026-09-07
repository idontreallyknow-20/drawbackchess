// Route skeleton for /history/[id]: the replay board with a player row above
// and below it, and the move list to its right.
//
// Without this the route inherited /history/loading.tsx, which is the ten-row
// archive list. Landing a board where a list was drawn is the layout shift the
// skeleton contract exists to prevent. This page also uses its own wordmark
// bar (Logo plus a back link) rather than SiteHeader, so the skeleton draws
// that bar at its py-5 height.

export default function Loading() {
  return (
    <main className="min-h-screen">
      <div className="flex items-center justify-between px-5 py-5 sm:px-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Loading" width={26} height={26} className="animate-pulse" />
        <div className="skeleton h-8 w-32" />
      </div>
      <div className="mx-auto w-full max-w-[1100px] px-3 pb-10 sm:px-6">
        <div className="skeleton mb-2 h-4 w-72 max-w-full" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 py-1">
              <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
              <div className="skeleton h-4 w-32" />
            </div>
            <div className="skeleton aspect-square w-full max-w-[720px]" />
            <div className="flex items-center gap-2.5 py-1">
              <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
              <div className="skeleton h-4 w-32" />
            </div>
            <div className="mt-2 space-y-1.5">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="plate p-2 px-3">
                  <div className="skeleton h-4 w-48 max-w-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="sm:w-56 sm:shrink-0">
            <div className="plate p-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="skeleton mt-1.5 h-5 first:mt-0" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
