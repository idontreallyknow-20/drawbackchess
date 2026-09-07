// Route skeleton for /profile: sign-in banner, identity header, the two mode
// rating cards, and the game module.
//
// Same bones as the page's own GuestProfileSkeleton, so the route skeleton and
// the in-page one are the same picture and the handover is invisible. The
// avatar is 72px from `sm` and 56px below it, matching the two PlayerAvatar
// sizes the header swaps between.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <SkeletonHeader />
      <section className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
        <div className="plate p-4">
          <div className="skeleton h-5 w-2/3" />
        </div>
        <div className="mt-6 flex items-start gap-4">
          <div className="skeleton h-14 w-14 shrink-0 rounded-full sm:h-[72px] sm:w-[72px]" />
          <div className="min-w-0">
            <div className="skeleton h-8 w-48 max-w-full" />
            <div className="skeleton mt-2 h-4 w-40 max-w-full" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="plate p-4">
              <div className="skeleton h-4 w-16" />
              <div className="skeleton mt-3 h-7 w-20" />
            </div>
          ))}
        </div>
        <div className="plate mt-4 p-4">
          <div className="skeleton h-24 w-full" />
        </div>
      </section>
    </main>
  );
}
