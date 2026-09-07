import Link from "next/link";

// The one breadcrumb trail.
//
// The visible trail was hand-rolled markup living next to the page that used
// it, and every link in it measured 19.5px tall: the text box and nothing else.
// A breadcrumb link is navigation, not prose, so docs/design-system.md §10's
// 44px hit area applies to it exactly as it applies to a nav link.
//
// The height comes from a min-height plus a negative block margin, not from
// padding. Padding would push the separators off the text baseline and make the
// row visibly taller; -my-2 gives the pixels back to the layout so the trail
// keeps the density it had while the hit area grows around it.
//
// It steps back down behind `(pointer: fine)` and NEVER behind `sm:`/`md:`.
// A 1024px tablet is a coarse pointer: using a width breakpoint here would hand
// every tablet the 19.5px target again while the audit at 360 looked clean.

export type Crumb = {
  label: string;
  /** Omit on the final crumb: it renders as the current page, not a link. */
  href?: string;
};

/** The shared hit-area shape for one crumb link. Exported so a call site that
 *  cannot use the component yet (a skeleton, a bespoke trail) can still wear
 *  the same geometry instead of inventing a third one. */
// min-w matters as much as min-h here: a crumb is one short word ("Home",
// "Buffs"), so the box was 31 to 38px WIDE as well as 19.5px tall. min-w with
// justify-center only bites on the crumbs that are actually too narrow, and
// leaves the gap-1.5 between a crumb and its separator intact, so no two hit
// areas overlap.
export const CRUMB_LINK_CLASS =
  "-my-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-parchment-400 transition-colors hover:text-parchment-100 " +
  "[@media(pointer:fine)]:my-0 [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:min-w-0";

export function Breadcrumbs({ items, className = "" }: { items: Crumb[]; className?: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex flex-wrap items-center gap-1.5 text-[13px] ${className}`.trim()}
    >
      {items.map((item, i) => (
        <span key={`${item.href ?? "current"}-${item.label}`} className="flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden className="text-parchment-500">
              /
            </span>
          )}
          {item.href ? (
            <Link href={item.href} className={CRUMB_LINK_CLASS}>
              {item.label}
            </Link>
          ) : (
            <span aria-current="page" className="text-parchment-200">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
