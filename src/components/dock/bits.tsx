"use client";

// Small shared pieces of the in-game dock: state chips, section headers, the
// draft progress ring, and the fine-pointer probe. Extracted verbatim from the
// old monolithic BuffDock so every dock surface reads on one visual language.

import { Clock, ChevronRight, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

/** True on hover-capable fine-pointer devices (mouse/trackpad). SSR-safe:
 * false until mounted. Used to gate the Use button's HTML5 draggable: on
 * touch browsers a draggable element inside the scrollable drawer swallows
 * taps (the touch is held as a potential drag and click never fires), which
 * blocked the Use button on mobile. */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setFine(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return fine;
}

export const sqName = (sq: number) => "abcdefgh"[sq % 8] + (Math.floor(sq / 8) + 1);

export const turnsLeft = (turns: number | null) =>
  turns == null ? "Until it ends" : `${turns} turn${turns === 1 ? "" : "s"} left`;

/** Hover detail for a "N turns left" chip: effect timers tick once per the
 *  affected side's move, so N turns ≈ 2N half-moves (plies) of game time. */
export const pliesTitle = (left: string): string | undefined => {
  const m = /(\d+)\s*turn/i.exec(left);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return `${left}, about ${n * 2} half-move${n * 2 === 1 ? "" : "s"} (plies) of game time`;
};

// Each dock section carries its own colour identity so the eye sorts them
// without reading: your arsenal (your buffs) is BLUE — the semantic power/boon
// colour — the opponent's is coral (theirs, a distinct non-reserved hue), and
// the "against you" constraints stay in the Nerf-red alert family. Class
// strings are literal (not built from variables) so Tailwind's JIT keeps them.
export type SectionAccent = "mine" | "opponent" | "against";

const SECTION_ACCENT: Record<SectionAccent, { chip: string; label: string }> = {
  mine: { chip: "border-mode-buff/45 bg-mode-buff/10 text-mode-buffGlow", label: "text-mode-buffGlow" },
  opponent: { chip: "border-coral/45 bg-coral/10 text-coral-glow", label: "text-coral-glow" },
  against: { chip: "border-oxblood-glow/45 bg-oxblood/15 text-oxblood-glow", label: "text-oxblood-glow" },
};

/** Dock section header: a small colored icon chip, the section label in that
 * section's accent, and a neutral count chip pushed to the right edge. One
 * shared shape so every section reads alike while each keeps its own hue. */
export function DockSectionHeader({
  icon: Icon,
  label,
  count,
  accent,
  open,
  onToggle,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  accent?: SectionAccent;
  /** When onToggle is given, the whole header becomes a toggle button for its
   * section body (chevron driven by `open`). Session-only state, upstream. */
  open?: boolean;
  onToggle?: () => void;
}) {
  const a = accent ? SECTION_ACCENT[accent] : null;
  const inner = (
    <>
      {onToggle && (
        <ChevronRight
          aria-hidden
          size={12}
          strokeWidth={2.4}
          className={"shrink-0 text-parchment-400 transition-transform duration-150 " + (open ? "rotate-90" : "")}
        />
      )}
      <span
        aria-hidden
        className={
          "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[1px] border " +
          (a ? a.chip : "border-[color:var(--edge)] bg-white/[0.05] text-parchment-400")
        }
      >
        <Icon size={11} strokeWidth={2.4} />
      </span>
      <span className={"min-w-0 truncate text-[12px] " + (a ? a.label : "text-parchment-400")}>
        {label}
      </span>
      <span className="ml-auto shrink-0 rounded-[1px] border border-[color:var(--edge)] bg-white/[0.05] px-1.5 py-px font-mono text-[12px] tabular-nums text-parchment-300">
        {count}
      </span>
    </>
  );
  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left"
      >
        {inner}
      </button>
    );
  }
  return <div className="flex items-center gap-1.5">{inner}</div>;
}

/** Unmistakable state stamp for a spent or nullified card, sized to read
 * without a hover. Nullified wears the oxblood alert colour; a plain "Used"
 * stays quiet but crisp. */
export function UsedBadge({ nullified }: { nullified: boolean }) {
  return nullified ? (
    <span className="shrink-0 rounded-[1px] border border-oxblood-glow/50 bg-oxblood/15 px-1 py-px text-[12px] font-semibold text-oxblood-glow">
      Nullified
    </span>
  ) : (
    <span className="shrink-0 rounded-[1px] border border-parchment-500/50 bg-white/[0.06] px-1 py-px text-[12px] font-semibold text-parchment-200">
      Used
    </span>
  );
}

/** Textual passive marker: names the state outright. Quiet gold family. */
export function PassiveChip() {
  return (
    <span
      title="Passive: always in effect"
      className="shrink-0 rounded-[1px] border border-gold/40 bg-gold/10 px-1 py-px text-[12px] font-semibold text-gold-leaf"
    >
      Passive
    </span>
  );
}

/** Compact status chip for a COLLAPSED row so remaining time reads without
 * expanding: a countdown status renders as "Temp · N turns" with the little
 * clock, any other live status (e.g. "bound to e4") shows its own text. */
export function StatusChip({ status }: { status: string }) {
  const m = /(\d+)\s*turn/i.exec(status);
  const text = m ? `Temp · ${m[1]} turn${m[1] === "1" ? "" : "s"}` : status;
  return (
    <span
      title={pliesTitle(status) ?? status}
      // Shrinkable (not shrink-0): a long status must squeeze itself, never
      // the card name sitting in the same row.
      className="inline-flex min-w-0 max-w-[8rem] shrink items-center gap-1 rounded-[1px] border border-gold/40 bg-gold/10 px-1 py-px text-[12px] font-semibold text-gold-leaf"
    >
      {m && <Clock aria-hidden size={11} strokeWidth={2.4} className="shrink-0" />}
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}

/** Thin rule that brackets the spent cards at the foot of an arsenal, so the
 * cards still in play read first and the used ones settle below their own
 * label. Rendered once per side, never merged across the two. */
export function UsedDivider() {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[12px] font-semibold text-parchment-500">Used</span>
      <span aria-hidden className="divider-gilt" />
    </div>
  );
}

/** Small elegant progress ring for the "next draft in N moves" chip: fills
 * gold toward the draft (oxblood while your draft is blocked). Decorative
 * twin of the countdown text next to it. */
export function DraftProgressRing({ fraction, blocked }: { fraction: number; blocked: boolean }) {
  const R = 7;
  const CIRC = 2 * Math.PI * R;
  return (
    <span aria-hidden className="ml-auto shrink-0">
      <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90 block">
        <circle cx="9" cy="9" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
        {/* Blocked stroke mirrors the --accent-nerf token (#e05252); the gilt gold is decorative draft progress. */}
        <circle
          cx="9"
          cy="9"
          r={R}
          fill="none"
          stroke={blocked ? "rgb(224 82 82 / 0.85)" : "rgb(216 181 110 / 0.9)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - Math.max(0, Math.min(1, fraction)))}
          style={{ transition: "stroke-dashoffset 300ms ease, stroke 300ms ease" }}
        />
      </svg>
    </span>
  );
}
