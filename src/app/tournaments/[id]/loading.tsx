// Route skeleton for /tournaments/[id]: breadcrumb, event name and its chip
// row, then standings beside the info rail.
//
// The page's own in-flight state was a centred "Loading..." line inside a
// py-16 block, which is the wrong height and the wrong shape for the two
// columns that replace it. This is the layout the event settles into.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      {/* A skeleton with no h1 leaves the route headingless for the whole
          load, which is when someone arriving by screen reader most needs to
          know where they are. Generic because the real name has not arrived
          yet; the loaded page replaces it with the actual one. */}
      <h1 className="sr-only">Tournament</h1>
      <SkeletonHeader />
      <section className="mx-auto max-w-6xl px-5 pt-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="skeleton h-3.5 w-28" />
            <div className="skeleton mt-1 h-8 w-64 max-w-full" />
            {/* Mode, clock, format, rated: the chip row under the name. */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-6 w-16" />
              ))}
            </div>
          </div>
          <div className="skeleton h-11 w-32 shrink-0 sm:h-10" />
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <div className="plate overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-[color:var(--edge)] px-5 py-3">
                <div className="skeleton h-3.5 w-20" />
                <div className="skeleton h-3.5 w-12" />
              </div>
              <div className="divide-y divide-[color:var(--edge)]">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="skeleton h-4 w-5 shrink-0" />
                    <div className="skeleton h-4 w-40 max-w-full" />
                    <div className="skeleton ml-auto h-4 w-10 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="plate px-5 py-4">
              <div className="skeleton h-4 w-24" />
              <div className="mt-3 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton h-5" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
