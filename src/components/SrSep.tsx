"use client";

/**
 * A screen-reader-only separator between two adjacent pieces of card text.
 *
 * WHY THIS EXISTS
 *
 * A card face is a stack of tight little spans: name, category chip, turn-cost
 * badge, tier numeral, tier label, rule text. Visually they are separated by
 * layout. To the accessibility tree they are adjacent text nodes, and the
 * accessible-name algorithm concatenates adjacent inline content with NO
 * separator at all, so a draft card announced as one run-on word:
 *
 *   "Walking Pace, PleaseMovementPassiveITrivialOnce, your a-file or b-file
 *    pawn may..."
 *
 * Chrome does not insert the space the spec hints at for block boundaries
 * either, so wrapping the name in a <div> buys nothing. The only reliable fix
 * is real punctuation in the DOM, hidden from sight.
 *
 * It is deliberately a component and not a per-file literal: the same badges
 * are rendered by every surface that shows a card (draft overlay, compact
 * pending panel, codex, dock rows, the opponent's draft viewer), so fixing it
 * at the badge level fixes all of them at once.
 *
 * `sr-only` (not `hidden`, not `display:none`) is load-bearing: the text has to
 * stay in the accessibility tree to be read.
 */
export function SrSep({ text = ", " }: { text?: string }) {
  return <span className="sr-only">{text}</span>;
}
