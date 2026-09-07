// Geometry of the fixed bottom chrome on the match surfaces, in one place.
//
// Both match views (OnlineMatch and the local /game page) render one
// position:fixed drawer bar below the board on tablet widths only:
//
//   MobileBuffDrawer   `sm:block lg:hidden` — bottom: 0, bar 46px + safe area
//
// Below sm there is no fixed chrome at all: the page scrolls and everything
// stacks under the board (MobileMatchStack). A portrait tablet is on that same
// column now (matchLayout.ts) and so has no fixed chrome either; the drawer is
// left to the sm..lg LANDSCAPE range that still puts a rail beside the board.
//
// The match column is `h-dvh` + `overflow-hidden`, so anything it fails to
// reserve room for is not scrollable-to — it is simply hidden behind the bars.
// It used to hardcode `pb-14` (56px) against as much as 88px of chrome, which
// buried the bottom player row, the rating strip, and the game-actions
// trigger — the only route to Draw/Resign/Takeback on a phone.
//
// The class strings below are written out IN FULL, never assembled from parts:
// Tailwind's JIT scans source text for literal class names, so an interpolated
// arbitrary value would simply never be generated.

import { TABLET_STACK_PAD } from "./matchLayout";

/**
 * Bottom padding for the match column.
 *
 * @param hasBuffDrawer whether MobileBuffDrawer is mounted (draft games only).
 *
 * Breakpoints mirror the drawers' own visibility:
 *   <sm  move bar (2.75rem) + inset, plus a second bar when the buff drawer is up
 *   sm   move bar hidden; buff bar (if present) sits on the edge and takes the inset
 *   lg   both hidden — ordinary page padding
 */
export function bottomChromePadClass(hasBuffDrawer: boolean): string {
  // Phones have no fixed bars any more (the move strip, cards and chat stack
  // inline under the board and the page scrolls), so only the home-indicator
  // inset is reserved there. The landscape tablet drawer (sm..lg) still needs
  // its bar's height, measured at 46px: a 44px toggle (the hit floor, spelled
  // in pixels because 2.75rem is 38.5px at this interface's 14px root) plus
  // its top border. The old 2.75rem reserve was derived from the same mistaken
  // 44px and came up ~7px short of the bar it was hiding behind.
  //
  // A portrait tablet is on the phone's column now (matchLayout.ts) and drops
  // the drawer with it, so it reserves ordinary page padding instead of a bar
  // that is not there.
  return hasBuffDrawer
    ? "pb-[env(safe-area-inset-bottom)] sm:pb-[calc(46px+env(safe-area-inset-bottom))] lg:pb-6 " +
        TABLET_STACK_PAD
    : "pb-[env(safe-area-inset-bottom)] sm:pb-6 lg:pb-6";
}
