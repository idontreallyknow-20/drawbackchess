// The shape /settings settles into: the title block, the search field, the
// section rail and a column of setting rows. Shared by route-level `loading.tsx`
// and by the screen's own first-paint gate, so the two hand over to each other
// without the layout jumping.
//
// It carries no <h1>: the screen's own heading is live in the same frame (the
// screen renders its header eagerly and only defers the rows), and two headings
// at once breaks the one-h1 rule the route sweep checks.

export function SettingsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="mt-5 grid gap-5 sm:grid-cols-[13rem_minmax(0,1fr)]">
      <div className="hidden flex-col gap-1 sm:flex" aria-hidden>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="skeleton h-9 w-full" style={{ borderRadius: 2 }} />
        ))}
      </div>
      <div className="plate min-w-0 p-4 sm:p-5">
        <div className="skeleton h-5 w-32" style={{ borderRadius: 2 }} />
        <div className="mt-4 space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="skeleton h-4 w-40 max-w-full" style={{ borderRadius: 2 }} />
                <div className="skeleton mt-1.5 h-3 w-64 max-w-full" style={{ borderRadius: 2 }} />
              </div>
              <div className="skeleton h-6 w-11 shrink-0" style={{ borderRadius: 2 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
