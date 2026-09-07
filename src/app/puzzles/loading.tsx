// Branded route skeleton for /puzzles: the title, the day strip, and the board
// beside its rule panel, held in their exact final geometry while the route
// chunk loads. Never a spinner page (design-system section 8.1).

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <SkeletonHeader />
      <section className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
        <div className="skeleton h-8 w-44" style={{ borderRadius: 1 }} />
        <div className="skeleton mt-2 h-4 w-full max-w-2xl" style={{ borderRadius: 1 }} />
        <div className="mt-4 flex gap-2">
          <div className="skeleton h-9 w-28" style={{ borderRadius: 1 }} />
          <div className="skeleton h-9 w-24" style={{ borderRadius: 1 }} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="mx-auto w-full max-w-[560px]">
            <div className="grid aspect-square w-full grid-cols-8 grid-rows-8" aria-hidden>
              {Array.from({ length: 64 }).map((_, i) => {
                const isLight = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
                return <div key={i} className={isLight ? "sq-light" : "sq-dark"} />;
              })}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="plate p-3">
                <div className="skeleton h-4 w-24" style={{ borderRadius: 1 }} />
                <div className="skeleton mt-2 h-3 w-full" style={{ borderRadius: 1 }} />
                <div className="skeleton mt-1.5 h-3 w-2/3" style={{ borderRadius: 1 }} />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
