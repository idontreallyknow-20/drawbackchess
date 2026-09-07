// Route skeleton for the moderation console: the ModShell frame (the 210px
// section rail beside the content column) that /mod, /mod/cards, /mod/house
// and /mod/stats/* all render inside.
//
// One skeleton for the whole section is right here because the frame is the
// part that is identical on every mod screen, and the content it wraps is
// gated behind a moderator check anyway, so a section-specific body skeleton
// would be guessing at something the visitor may never be shown.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen">
      <SkeletonHeader />
      <section className="mx-auto w-full max-w-[1300px] px-3 pb-12 pt-4 sm:px-5 lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-5">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between lg:block">
            <div className="skeleton h-8 w-40" />
            <div className="skeleton h-8 w-28 lg:mt-3 lg:w-full" />
          </div>
          {/* Desktop: five labelled groups of section links. */}
          <div className="mt-3 hidden lg:block">
            {Array.from({ length: 5 }).map((_, g) => (
              <div key={g} className="mb-4">
                <div className="skeleton mx-2 h-3 w-16" />
                <div className="mt-1 space-y-1">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton h-8" />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {/* Phones: the same entries as one scrolling row. */}
          <div className="-mx-3 mt-3 flex gap-1 overflow-hidden border-b border-[color:var(--edge)] px-3 pb-2 lg:hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-8 w-24 shrink-0" />
            ))}
          </div>
        </aside>
        <div className="mt-4 min-w-0 lg:mt-0">
          <div className="mb-3 border-b border-[color:var(--edge)] pb-2">
            <div className="skeleton h-4 w-36" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-16" />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
