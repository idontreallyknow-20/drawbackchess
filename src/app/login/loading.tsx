// Route skeleton for /login: the heading, the Sign in / Register pair, and the
// form plate with two labelled fields and the submit button.
//
// The default tab is Sign in, which is the two-field form, so the skeleton is
// sized to that rather than to the taller Register form. Guessing the larger
// one would leave a gap under the button on the far commoner path.

import { SkeletonHeader } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen">
      <SkeletonHeader />
      <section className="mx-auto max-w-md px-6 py-8">
        <div className="skeleton h-8 w-48" />
        <div className="plate mt-6 grid grid-cols-2 gap-1 p-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="skeleton h-9" />
          ))}
        </div>
        <div className="plate mt-4 space-y-4 p-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton mb-1.5 h-3.5 w-32" />
              <div className="skeleton h-12 w-full" />
            </div>
          ))}
          <div className="skeleton h-11 w-full" />
        </div>
      </section>
    </main>
  );
}
