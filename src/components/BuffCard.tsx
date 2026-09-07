"use client";

import { createElement } from "react";
import { Buff, turnCost } from "@/engine/buff";
import { COMBO_TAGS, COMBO_TAG_LABELS } from "@/engine/comboTags";
import { Tier } from "@/engine/nerf";
import { cardFaceIcon } from "@/lib/cardIcon";
import { TIER_LABEL, TIER_ROMAN } from "@/lib/tiers";
import { DraftPreview } from "@/components/DraftPreview";
import { GlossaryText } from "@/components/GlossaryText";
import { TurnCostBadge } from "@/components/TurnCostBadge";
import {
  Castle,
  Eye,
  Layers,
  type LucideIcon,
  Package,
  Shield,
  Skull,
  Swords,
  Timer,
  Unlink,
  Wind,
} from "lucide-react";

const CATEGORY_LABEL: Record<Buff["category"], string> = {
  movement: "Movement",
  pieces: "Pieces",
  tempo: "Tempo",
  protection: "Protection",
  attack: "Attack",
  info: "Insight",
  draft: "Draft",
  nerf: "Nerf-breaker",
  hex: "Hex",
  item: "Item",
};

// One glyph per category: it labels the small chip AND repeats as a large,
// barely-there watermark on the card face, so a hand of cards can be told
// apart at a glance the way suits are.
const CATEGORY_ICON: Record<Buff["category"], LucideIcon> = {
  movement: Wind,
  pieces: Castle,
  tempo: Timer,
  protection: Shield,
  attack: Swords,
  info: Eye,
  draft: Layers,
  nerf: Unlink,
  hex: Skull,
  item: Package,
};

interface Props {
  buff: Buff;
  /** Tier the card rolled at (may differ from the library tier). */
  tier?: Tier;
  status?: string | null;
  spent?: boolean;
  nullified?: boolean;
  onClick?: () => void;
  compact?: boolean;
  /** Soft accent glow: this buff can be used right now. */
  glow?: boolean;
  /** Draft picker only: stagger this card's entrance by the given delay (ms).
   * Omit to skip the entrance animation (dock / modal contexts). */
  enterDelayMs?: number;
  /** Draft surfaces only: wear the small looping animation-preview medallion
   * (DraftPreview) so the card's effect style reads before its name. Off by
   * default; codex / dock / modal surfaces stay unchanged. Ignored on compact
   * rows, where the medallion would swamp the layout. */
  preview?: boolean;
}

export function BuffCard({ buff, tier, status, spent, nullified, onClick, compact, glow, enterDelayMs, preview }: Props) {
  const t = tier ?? buff.tier;
  const dead = spent || nullified;
  // Per-card icon: every buff in the library gets a GLOBALLY UNIQUE lucide
  // glyph via cardFaceIcon (see src/lib/cardIcon.ts) — no two cards in the
  // whole game wear the same face. The category glyph survives only as the
  // truly-last-resort fallback for an unknown id, so nothing can crash.
  // Selected (not defined) at render time, so render via createElement rather
  // than binding a capitalized local and using it as a JSX component.
  const catIcon = cardFaceIcon(buff.id, buff.category, buff.icon) ?? CATEGORY_ICON[buff.category];
  const body = (
    <div
      style={enterDelayMs != null ? { animationDelay: `${enterDelayMs}ms` } : undefined}
      className={
        // group/card (a NAMED group, so ancestor `group` wrappers in docks /
        // overlays can't leak in) lets the face icons color up on card hover.
        `group/card relative plate draft-face overflow-hidden border tier-bg-${t} ` +
        (enterDelayMs != null ? "draft-in " : "") +
        // Full-size cards fill their grid cell as a column so every card in
        // one draft offer lands the same height (description stretches, tier
        // rows and bottoms align). Compact rows keep their natural height.
        (compact ? "p-3 " : "flex h-full flex-col p-4 ") +
        (dead ? "opacity-45 " : "") +
        (glow && !dead ? "ring-1 ring-gold/40 " : "") +
        (onClick && !dead
          ? compact
            ? "cursor-pointer transition-colors duration-200 hover:border-gold/60"
            : // Pickable full-size cards are candy: pop on hover, squash on
              // press, tier-colored ring (all from .card-juicy, 14px corners).
              "card-juicy"
          : "")
      }
    >
      {/* Face watermark: a large glyph anchored bottom-right, behind the
          text. Faint by default; hovering the card brightens it in the tier
          (severity) color and nudges the scale. Transitions only (no
          keyframes), so the base fade is cut by the global animations-off
          setting; the scale nudge is additionally gated behind motion-safe
          (OS reduced-motion). Skipped on compact rows where it would just
          smear. */}
      {!compact &&
        createElement(catIcon, {
          "aria-hidden": true,
          className: `pointer-events-none absolute -bottom-3 -right-2 tier-${t} opacity-[0.08] transition-all duration-200 group-hover/card:opacity-[0.18] motion-safe:group-hover/card:scale-105`,
          size: 84,
          strokeWidth: 1.2,
        })}
      {/* Animation preview (draft picker only): a small looping medallion in
          the card's own effect-family motif, anchored over the watermark
          corner so nothing in the existing layout moves. Static tinted
          medallion under reduced motion / animations-off (see DraftPreview). */}
      {preview && !compact && (
        <DraftPreview
          kind="buff"
          id={buff.id}
          category={buff.category}
          tier={t}
          icon={catIcon}
          className="bottom-2 right-2"
        />
      )}
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`font-display leading-tight tier-${t} ${compact ? "text-sm" : "text-lg"}`}>
            {buff.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[12px] text-parchment-400">
              {/* Chip icon: parchment tone at rest; card hover tints it in the
                  tier color via --tier-rgb (set by the root's tier-bg class). */}
              {createElement(catIcon, {
                "aria-hidden": true,
                size: compact ? 11 : 12,
                strokeWidth: compact ? 2 : 2.5,
                className: `transition-colors duration-200 group-hover/card:text-[rgb(var(--tier-rgb))] ${compact ? "opacity-70" : "opacity-95"}`,
              })}
              {CATEGORY_LABEL[buff.category]}
            </span>
            <TurnCostBadge cost={turnCost(buff)} />
          </div>
        </div>
        <span
          className={`shrink-0 font-display font-bold px-2 py-0.5 rounded-[1px] tier-bg-${t} tier-${t} ${compact ? "border text-[12px]" : "border-[1.5px] text-[13px]"}`}
          title={`Buff power tier ${TIER_ROMAN[t]} (${t} of 8): ${TIER_LABEL[t]}`}
        >
          {TIER_ROMAN[t]}
        </span>
      </div>
      {/* Difficulty ornament: the tier label between hairline rules, the same
          severity treatment nerf cards wear, so both libraries read alike.
          Dropped in the compact draft/dock cards where space is tight. */}
      {!compact && (
        <div className="rule-ornament my-2.5 text-[12px]">
          <span className="font-display">{TIER_LABEL[t]}</span>
        </div>
      )}
      {/* flex-1 on full cards: the description absorbs the height difference,
          so flavor/status footers pin to the aligned card bottoms. */}
      {/* Full-contrast rule text: the effect is the decision, so it never
          renders dimmer than body parchment (2026-07 draft readability pass). */}
      <p className={`leading-snug text-parchment-100 ${compact ? "mt-1.5 text-[12px]" : "flex-1 text-[13px]"}`}>
        <GlossaryText text={buff.description} />
      </p>
      {/* How to play it / play against it. Advice, never a rule, so it sits
          below the rule text in the same quiet register as the footnotes. Full
          cards only: a dock row or a compact pick shows the rule and nothing
          else. */}
      {!compact && buff.tip && (
        <p className="mt-2 text-[12px] leading-snug text-parchment-400">
          <span className="text-parchment-300">Tip</span>{" "}
          <GlossaryText text={buff.tip} />
        </p>
      )}
      {/* Rules footnote, auto-attached to every card that grants
          uncapturability (owner request): the engine never lets a piece that
          cannot be captured deliver the king capture itself (you must expose
          a piece to win), and players should learn that from the card face,
          not from a rejected move. Keyed off the description so future shield
          cards inherit the note with zero per-card work. */}
      {!compact && /uncapturable|cannot be captured|can't be captured|shield|sanctuary|warded/i.test(buff.description) && (
        <p className="mt-2 text-[12px] leading-snug text-parchment-400">
          Note: a piece that cannot be captured may not capture the king while its
          protection lasts. You must expose a piece to win.
        </p>
      )}
      {/* Exclusive-family note (combination guard): the draft never offers a
          card from these families while you hold another unspent one, and the
          rule must be readable on the card face, never silent. */}
      {!compact && (COMBO_TAGS[buff.id]?.length ?? 0) > 0 && (
        <p className="mt-2 text-[12px] leading-snug text-parchment-400">
          Exclusive: {COMBO_TAGS[buff.id]!.map((t) => COMBO_TAG_LABELS[t] ?? t).join(", ")}. While
          you hold this unspent, no other card of the same family is offered to you.
        </p>
      )}
      {/* Flavor line: the card's voice, quoted and dim, TCG-style. Full cards
          only; dock rows and compact picks stay all-business. */}
      {!compact && buff.flavor && (
        <p className="relative mt-2 text-[12px] italic leading-snug text-parchment-400">
          &ldquo;{buff.flavor}&rdquo;
        </p>
      )}
      {status && !dead && (
        <div className="mt-1.5 text-[12px] text-gold">{status}</div>
      )}
      {nullified && (
        <div className="mt-1.5 text-[12px] text-oxblood-glow">Nullified</div>
      )}
      {spent && !nullified && (
        <div className="mt-1.5 text-[12px] text-parchment-400">Used</div>
      )}
    </div>
  );

  if (!onClick || dead) return body;
  return (
    <button type="button" onClick={onClick} className="block h-full w-full touch-manipulation text-left">
      {body}
    </button>
  );
}
