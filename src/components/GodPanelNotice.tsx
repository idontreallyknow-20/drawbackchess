"use client";

// Floating "God panel used" banner. Unlike the old design, god-panel tools
// (summon a card, -15s clock, peek at hidden cards) are no longer silent: the
// server broadcasts a `godUsed` frame to the whole table whenever one fires,
// and this surfaces it as a prominent, unmissable notice to everyone in the
// game — the opponent, spectators, and the owner alike. Transient (fades after
// a few seconds), so it is driven by an ephemeral notice list, not stored.
//
// Rendered inside the relatively-positioned board wrapper, just above the top
// edge (like DraftNotice) so it never covers the board.

export interface GodPanelNoticeItem {
  key: number;
  /** The owner's seat name. */
  by: string;
  /** Short phrase, e.g. "summoned a card". */
  action: string;
  leaving: boolean;
}

export function GodPanelNotice({ notices }: { notices: GodPanelNoticeItem[] }) {
  if (notices.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      // Sits above the board's top edge, never over the squares.
      className="pointer-events-none absolute inset-x-0 bottom-full z-30 mb-1.5 flex flex-col items-center gap-1"
    >
      {notices.map((n) => (
        <div
          key={n.key}
          className={
            "glass-chip flex max-w-[min(22rem,calc(100vw-1.5rem))] items-center gap-2 border border-coral/60 " +
            "bg-coral/15 px-4 py-2 transition-opacity duration-300 " +
            (n.leaving ? "opacity-0" : "opacity-100")
          }
        >
          {/* No glyph/emoji per the design law; a small coral tick marks it. */}
          <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 bg-coral-glow" />
          <span className="font-display text-xs font-semibold text-coral-glow">
            <span className="mr-1 text-[12px] tracking-wide text-coral-glow">God panel used</span>
            <span className="text-parchment">
              {n.by} {n.action}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
