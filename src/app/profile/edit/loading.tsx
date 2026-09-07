// Route skeleton for /profile/edit: the back control beside the title, then
// the four labelled sections (profile picture, flair, bio, privacy) as the
// plates they settle into.
//
// The page's own in-flight state is a one-line "Loading…" plate, which is a
// third geometry; this skeleton is the shape of the finished form, so the
// route lands on the layout it keeps.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen">
      <SkeletonHeader />
      <section className="mx-auto max-w-3xl px-6 py-8">
        <div className="flex items-center gap-3">
          <div className="skeleton h-11 w-11 shrink-0" />
          <div className="skeleton h-8 w-44" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="mt-8">
            <div className="skeleton mb-4 h-5 w-40" />
            <div className="plate p-4 sm:p-5">
              <div className="skeleton h-24 w-full" />
            </div>
          </div>
        ))}
        <div className="mt-8">
          <div className="skeleton mb-4 h-5 w-24" />
          <div className="plate divide-y divide-[color:var(--edge)] p-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-3">
                <div className="skeleton h-4 w-40 max-w-full" />
                <div className="skeleton h-11 w-[72px] shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
