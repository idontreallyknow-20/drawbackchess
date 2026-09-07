"use client";

// Compact opponent-draft preview shown at the bottom of the draft overlay.
//
// Replaces the old single-line text summary ("Opponent's draft: Name (T3) ...")
// with small dungeon-styled cards that echo the player's own draft cards but
// are deliberately smaller and visually distinct, so the player's own choices
// stay the visual priority.
//
// Information permissions are unchanged: this component renders ONLY what the
// caller already decided is legitimately visible (showCards / showTier /
// reveal / lastPick), and shows a face-down "hidden" state otherwise. It never
// derives anything the caller did not pass, so it cannot leak hidden info.

import { createElement, useState } from "react";
import { BUFF_BY_ID } from "@/engine/buffs/library";
import { cardFaceIcon } from "@/lib/cardIcon";
import { TIER_ROMAN } from "@/lib/tiers";
import { GlossaryText } from "@/components/GlossaryText";

export interface OpponentDraftState {
  offer: { cards: { id: string; tier: number }[] } | null;
  showCards: boolean;
  showTier: boolean;
  reveal?: { index: number; cards?: { id: string; tier: number }[]; tier?: number } | null;
  lastPick?: { id: string; tier: number } | null;
}

function prettyCategory(cat: string | undefined): string {
  if (!cat) return "";
  return cat
    .split(/[_\s-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** A revealed/visible opponent card: compact tile with icon, name, tier and a
 * tap-to-expand short description. Tapping only toggles local detail state, so
 * it never touches the draft (satisfies "close details without affecting the
 * draft"). */
function MiniCard({ id, tier }: { id: string; tier: number }) {
  const [open, setOpen] = useState(false);
  const def = BUFF_BY_ID[id];
  const roman = TIER_ROMAN[tier] ?? String(tier);
  if (!def) {
    // Unknown id: fall back to a face-down back so nothing breaks.
    return <HiddenCard tier={tier} />;
  }
  // cardFaceIcon returns a stable component reference from a fixed registry
  // (never a freshly-defined component), so rendering it via createElement into
  // a plain node is safe and keeps the static-components lint satisfied.
  const iconComp = cardFaceIcon(id, def.category, def.icon);
  const iconNode = iconComp
    ? createElement(iconComp, {
        "aria-hidden": true,
        className: "h-3.5 w-3.5 shrink-0 tier-" + tier,
        strokeWidth: 1.75,
      })
    : null;
  const cat = prettyCategory(def.category);
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      title={def.description}
      className={
        "group relative flex min-w-0 max-w-[9.5rem] flex-col gap-0.5 rounded-[2px] border px-1.5 py-1 text-left " +
        "transition-[filter] tier-bg-" +
        tier +
        " hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/60"
      }
    >
      <span className="flex items-center gap-1">
        {iconNode}
        <span className={"min-w-0 flex-1 truncate font-display text-[12px] font-semibold leading-tight tier-" + tier}>
          {def.name}
        </span>
        <span
          className={
            "shrink-0 rounded-[1px] border px-1 py-px font-display text-[12px] font-bold leading-none tier-bg-" +
            tier +
            " tier-" +
            tier
          }
        >
          {roman}
        </span>
      </span>
      {cat ? <span className="text-[12px] leading-none text-parchment-400">{cat}</span> : null}
      <span
        className={
          "text-[12px] leading-snug text-parchment-300 " + (open ? "" : "line-clamp-2")
        }
      >
        <GlossaryText text={def.description} />
      </span>
    </button>
  );
}

/** Face-down back with a tier numeral: the same ink-mini treatment the dock
 * gives hidden cards. Used for tier-only and fully hidden states. */
function HiddenCard({ tier }: { tier?: number }) {
  const roman = tier != null ? TIER_ROMAN[tier] ?? String(tier) : "";
  return (
    <span
      aria-hidden
      className="relative flex h-9 w-7 shrink-0 items-center justify-center rounded-[2px] border border-gold/30 bg-ink-950"
    >
      <span aria-hidden className="absolute inset-[2px] rounded-[1px] border border-gold/15" />
      {roman ? <span className={"font-display text-[12px] font-bold tier-" + tier}>{roman}</span> : (
        <span className="text-[13px] text-parchment-500">?</span>
      )}
    </span>
  );
}

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-[color:var(--edge)] pt-3">
      {/* A left ember accent + smallcaps label marks these as the OPPONENT's,
          distinct from your own cards above. */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-0.5 rounded-full bg-oxblood-glow/70" />
        <span className="text-[12px] tracking-wide text-parchment-400">{label}</span>
      </div>
      <div className="flex flex-wrap items-start justify-center gap-1.5">{children}</div>
    </div>
  );
}

export function OpponentDraftPanel({ opponent }: { opponent: OpponentDraftState }) {
  const offer = opponent.offer;

  // 1) Full visible cards (Draft Insight / open information).
  if (offer && opponent.showCards) {
    return (
      <Frame label="Opponent is drafting">
        {offer.cards.map((c, i) => (
          <MiniCard key={i} id={c.id} tier={c.tier} />
        ))}
      </Frame>
    );
  }

  // 2) Tier only (partial info): face-down backs with tier numerals.
  if (offer && opponent.showTier) {
    return (
      <Frame label={`Opponent is drafting at tier ${Math.max(...offer.cards.map((c) => c.tier))}`}>
        {offer.cards.map((c, i) => (
          <HiddenCard key={i} tier={c.tier} />
        ))}
      </Frame>
    );
  }

  // 3) One-shot reveal snapshot (Peek / Quick Glance).
  if (opponent.reveal?.cards && opponent.reveal.cards.length > 0) {
    return (
      <Frame label={`Revealed draft #${opponent.reveal.index}`}>
        {opponent.reveal.cards.map((c, i) => (
          <MiniCard key={i} id={c.id} tier={c.tier} />
        ))}
      </Frame>
    );
  }
  if (opponent.reveal?.tier != null) {
    return (
      <Frame label={`Revealed draft #${opponent.reveal.index} rolled tier ${opponent.reveal.tier}`}>
        <HiddenCard tier={opponent.reveal.tier} />
      </Frame>
    );
  }

  // 4) Last resolved pick (public identity).
  if (opponent.lastPick && BUFF_BY_ID[opponent.lastPick.id]) {
    return (
      <Frame label="Opponent last drafted">
        <MiniCard id={opponent.lastPick.id} tier={opponent.lastPick.tier} />
      </Frame>
    );
  }

  // 5) Nothing legitimately visible.
  return (
    <Frame label="Opponent's draft is hidden">
      <HiddenCard />
    </Frame>
  );
}
