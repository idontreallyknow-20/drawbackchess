// The portrait-tablet band of the match surfaces, in one place.
//
// Why this band exists at all. The match page had exactly two shapes: Lichess's
// single column below `sm` (640) and a board-beside-a-rail layout from `sm`
// upward, with a third rail joining at `lg` (1024). Nothing adapted between
// 640 and 1024, so a portrait tablet was handed the 640px shape on a screen
// two to three times its height. Measured on the local bot game, board width
// against the vertical space left unused underneath it:
//
//     768x1024   board 424px   540px of empty column below the board
//     834x1112   board 490px   562px
//     900x1200   board 556px   584px
//    1024x1366   board 324px   (the `lg` rail lands and takes another 320px)
//
// The board was width-bound by a 252px move rail every time, while half the
// screen went unpainted. A portrait tablet is a phone's proportions at a
// larger scale, so it wants the phone's answer: the board across the column
// and everything else stacked under it (`MobileMatchStack`), which is also
// what design-system.md section 9 already describes for that column.
//
// The band is deliberately BOTH width and orientation:
//   - orientation, because in landscape the height is the scarce axis and a
//     stacked column would push the actions below the fold. 768..1279
//     landscape keeps the board-beside-rail shape.
//   - an upper bound of 1279, because from `xl` the three-column desktop
//     layout has the width it needs and should win.
//
// The strings are written out IN FULL and never assembled from parts:
// Tailwind's JIT scans source text for literal class names, so an interpolated
// arbitrary variant would simply never be generated. They are also verified to
// out-rank the `sm:`/`lg:` utilities they override, because Tailwind emits
// arbitrary variants after the built-in breakpoints.

/** Laid out as a single column: the board across the width, everything else
 *  stacked beneath it. Shown only inside the band. */
export const TABLET_STACK_SHOW =
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:flex";

/** Belongs to the board-beside-rail shape, so it stands down inside the band. */
export const TABLET_STACK_HIDE =
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:hidden";

/** The board/rail row stacks instead of running side by side. */
export const TABLET_STACK_COL =
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:flex-col";

/** The board centres in the column again, as it does on a phone. */
export const TABLET_STACK_CENTER =
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:mx-auto";

/**
 * The match column scrolls in the band.
 *
 * From `sm` the column is `h-dvh` + `overflow-hidden`, which is right when
 * everything sits beside the board and nothing may leave the viewport. Once
 * the page is a single column that clip would swallow the whole stack, so the
 * band restores the phone's scrolling page.
 */
export const TABLET_STACK_SCROLL =
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:h-auto " +
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:min-h-dvh " +
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:overflow-visible";

/** Same, for the inner container that only ever clipped, never sized. */
export const TABLET_STACK_UNCLIP =
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:overflow-visible";

/** One column, so the three-column desktop grid stands down. */
export const TABLET_STACK_ONE_COL =
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:grid-cols-[minmax(0,1fr)]";

/** Floating controls sit clear of the buff drawer from `sm`; the band has no
 *  drawer, so they drop back to the page edge. */
export const TABLET_STACK_FAB =
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:bottom-4";

/** Ordinary page padding in the band, in place of the drawer bar's height. */
export const TABLET_STACK_PAD =
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:pb-6";

/**
 * Board width inside the band.
 *
 * The board is no longer racing a rail for the width, so it takes the column
 * up to the player's own board-size cap. The 16rem height reserve keeps the
 * compact header and both player strips (with their clocks) on screen above
 * the fold; everything under the board is reached by scrolling, exactly as on
 * a phone.
 */
export const TABLET_STACK_BOARD =
  "[@media(min-width:768px)_and_(max-width:1279.98px)_and_(orientation:portrait)]:w-[min(var(--board-cap,720px),calc(100dvh-16rem),calc(100vw-1rem))]";
