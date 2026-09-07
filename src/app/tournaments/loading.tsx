// Route skeleton for /tournaments: the title row with its two header controls,
// then the directory as a plate of event rows on hairline dividers.
//
// Row shape matches the page's own in-flight list (a 44x56 date block, the
// event name, and its one-line detail), so the two skeletons are the same
// picture and only the header above them fills in first.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <SkeletonHeader />
      <section className="mx-auto max-w-4xl px-5 pt-6 sm:px-6 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="skeleton h-8 w-44" />
            <div className="skeleton mt-2 h-4 w-64 max-w-full" />
          </div>
          {/* Both header controls are Button/LinkButton at the default size:
              44px on a phone, 40px once there is a pointer. */}
          <div className="flex items-center gap-2">
            <div className="skeleton h-11 w-20 sm:h-10" />
            <div className="skeleton h-11 w-40 sm:h-10" />
          </div>
        </div>
        <div className="mt-6 min-w-0 space-y-4">
          <div className="plate overflow-hidden">
            <div className="border-b border-[color:var(--edge)] px-5 py-3">
              <div className="skeleton h-4 w-28" />
            </div>
            <ul className="divide-y divide-[color:var(--edge)]">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="skeleton h-11 w-14 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="skeleton h-3.5 w-44 max-w-full" />
                    <div className="skeleton mt-2 h-3 w-32" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
