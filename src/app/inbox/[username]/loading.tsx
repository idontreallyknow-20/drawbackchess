// Route skeleton for /inbox/[username]: the breadcrumb and peer name, the
// 50dvh message pane, and the composer row.
//
// The pane is sized in `dvh` exactly as the real one is, so the composer sits
// at the same place on the screen before and after the swap. Bubbles alternate
// sides because the thread does.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen">
      <SkeletonHeader />
      <section className="mx-auto max-w-2xl px-5 py-6 sm:px-6">
        <div className="mb-4 flex min-h-[44px] min-w-0 items-center gap-3">
          <div className="skeleton h-4 w-14" />
          <div className="skeleton h-4 w-1" />
          <div className="skeleton h-6 w-6 rounded-full" />
          <div className="skeleton h-5 w-32" />
        </div>
        {/* overflow-hidden, not auto: the real pane scrolls, but a skeleton
            that could scroll would put a scrollbar on a box with nothing in
            it, and the bubbles must not spill past 50dvh on a short screen. */}
        <div className="plate h-[50dvh] overflow-hidden p-4">
          <ul className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className={i % 2 === 1 ? "flex justify-end" : "flex"}>
                <div className={"skeleton h-10 " + (i % 2 === 1 ? "w-3/5" : "w-2/3")} />
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-3 flex gap-2">
          <div className="skeleton h-11 min-w-0 flex-1" />
          <div className="skeleton h-11 w-20 shrink-0" />
        </div>
      </section>
    </main>
  );
}
