// Route skeleton for /inbox: the conversation list in its final geometry, a
// plate of 44px rows on hairline dividers under the title and player search.
//
// This covers /inbox only; the thread view at /inbox/[username] is a different
// shape and carries its own skeleton.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen">
      <SkeletonHeader />
      <section className="mx-auto max-w-2xl px-5 py-8 sm:px-6">
        <div className="skeleton h-8 w-28" />
        <div className="mt-5">
          <div className="skeleton h-10 w-full max-w-sm" />
          <div className="skeleton mt-1.5 h-3.5 w-64 max-w-full" />
        </div>
        <ul className="plate mt-6 divide-y divide-[color:var(--edge)]">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex min-h-[44px] items-center gap-3 px-4 py-3">
              <div className="skeleton h-9 w-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="skeleton h-3.5 w-28" />
                <div className="skeleton mt-1.5 h-3.5 w-44 max-w-full" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
