// The top bar every route skeleton opens with.
//
// Eight route skeletons had each hand-copied this block, and they had drifted:
// three different `borderRadius` inline styles (1, 2, and none) that all lose
// to the `!important` geometry rule in globals.css anyway, and one copy still
// wearing a `border-white/5` alpha hairline that the colour table (design
// system section 2) retired in favour of `--edge`. One component, one bar.
//
// It is deliberately NOT the real SiteHeader: that one fetches the session,
// challenges, and notifications on mount, and rendering it inside a loading
// fallback would fire all three a second time only to throw the result away.
// A skeleton stands in for the header at the same height (48px on phones,
// 60px from `sm`, matching SiteHeader's `min-h`) so nothing shifts when the
// real one swaps in.
export function SkeletonHeader() {
  return (
    <div className="flex min-h-[48px] items-center justify-between border-b border-[color:var(--edge)] px-5 py-3 sm:min-h-[60px] sm:px-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="Loading" width={26} height={26} className="animate-pulse" />
      <div className="skeleton h-8 w-28" />
    </div>
  );
}
