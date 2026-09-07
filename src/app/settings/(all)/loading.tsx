// Route skeleton for /settings, in the geometry the page settles into: the
// title block, the filter field, the section rail and a column of rows.
//
// It lives in the (all) route group, not at src/app/settings/, and that is
// load-bearing rather than tidiness. A loading.tsx wraps its whole subtree in
// Suspense, and a Suspense boundary above /settings/[section] means the shell
// has already begun streaming by the time that page calls notFound() — which
// caps the response at 200 forever, because a status cannot be changed once
// bytes are out (next/docs 01-app/.../not-found.md, "Status Codes"). Measured
// both ways on /settings/nope: 200 with this file one level up, 404 with it
// scoped to the index here. The group keeps the skeleton for the page that
// wants it and keeps the boundary off the page that must 404.
//
// No h1 here, deliberately, and for the same reason /u/[username]/loading.tsx
// has none: the screen renders its own heading in the same frame (only the
// ROWS wait on the storage read), so a heading here would put two h1 elements
// in one streamed document.

import { SkeletonHeader } from "@/components/ui/Skeleton";
import { SettingsSkeleton } from "../_components/SettingsSkeleton";

export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <SkeletonHeader />
      <div className="mx-auto max-w-5xl px-5 py-6 sm:px-6 sm:py-8">
        <div className="text-[12px] text-parchment-400">Preferences</div>
        <div className="skeleton mt-1 h-[26px] w-40" style={{ borderRadius: 2 }} />
        <div className="skeleton mt-3 h-4 w-80 max-w-full" style={{ borderRadius: 2 }} />
        <div className="skeleton mt-4 h-[44px] w-full max-w-sm" style={{ borderRadius: 2 }} />
        <SettingsSkeleton />
      </div>
    </main>
  );
}
