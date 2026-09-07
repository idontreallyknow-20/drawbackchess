// Route skeleton for /clubs/[slug]: the club identity (icon, name, owner and
// member line) above the members rail beside the activity column.
//
// Without this the route inherited /clubs/loading.tsx, which draws the
// create-club form next to the club directory: the wrong two columns, in the
// wrong order, at the wrong widths. The page's own in-flight state is a
// centred "Loading…" line, which is a third geometry again.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      {/* A skeleton with no h1 leaves the route headingless for the whole
          load, which is when someone arriving by screen reader most needs to
          know where they are. Generic because the real name has not arrived
          yet; the loaded page replaces it with the actual one. */}
      <h1 className="sr-only">Club</h1>
      <SkeletonHeader />
      <section className="mx-auto max-w-6xl px-5 pt-6 sm:px-6 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            <div className="skeleton h-16 w-16 shrink-0" />
            <div className="min-w-0">
              <div className="skeleton h-8 w-56 max-w-full" />
              <div className="skeleton mt-2 h-4 w-72 max-w-full" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="skeleton h-11 w-24 sm:h-10" />
            <div className="skeleton h-11 w-24 sm:h-10" />
          </div>
        </div>
        <div className="skeleton mt-4 h-5 w-full max-w-2xl" />
        <div className="mt-8 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div className="plate overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-[color:var(--edge)] px-5 py-3">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-4 w-16" />
              </div>
              <div className="divide-y divide-[color:var(--edge)]">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex min-h-[44px] items-center gap-3 px-5 py-2.5">
                    <div className="skeleton h-4 w-4 shrink-0" />
                    <div className="skeleton h-4 w-32 max-w-full" />
                    <div className="skeleton ml-auto h-4 w-10 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="plate overflow-hidden">
            <div className="border-b border-[color:var(--edge)] px-5 py-3">
              <div className="skeleton h-4 w-28" />
            </div>
            <div className="divide-y divide-[color:var(--edge)]">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="skeleton h-9 w-9 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="skeleton h-4 w-48 max-w-full" />
                    <div className="skeleton mt-2 h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
