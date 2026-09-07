"use client";

import { createElement } from "react";
import { Nerf } from "@/engine/nerf";
import { DraftPreview } from "@/components/DraftPreview";
import { GlossaryText } from "@/components/GlossaryText";
import { NERF_TURN_COST } from "@/engine/buff";
import { TurnCostBadge } from "@/components/TurnCostBadge";
import { type LucideIcon, Unlink } from "lucide-react";
import { nerfFaceIcon } from "@/lib/cardIcon";

interface Props {
  nerf: Nerf;
  revealed?: boolean;
  compact?: boolean;
  /** Codex grid: match BuffCard's proportions (p-4, text-lg name, equal-height
   * flex column) so nerf and buff cards read the same size side by side. The
   * in-game full card keeps its larger type. */
  dense?: boolean;
  ownerLabel?: string;
  progress?: { value: number; max: number; label: string } | null;
  /** Draft surfaces only (the opening nerf pick): wear the small looping
   * animation-preview medallion (DraftPreview) keyed off the card's passive
   * composition, so its effect style reads before its name. Off by default;
   * codex / in-game surfaces stay unchanged. */
  preview?: boolean;
}

import { TIER_LABEL, TIER_ROMAN } from "@/lib/tiers";

// Mirror of globals.css .tier-bg-N --tier-rgb, for the wax seal outside the card.
const TIER_RGB: Record<number, string> = {
  1: "126 181 154", 2: "139 169 196", 3: "216 181 110", 4: "199 148 104", 5: "198 104 96",
  6: "198 95 143", 7: "168 119 216", 8: "224 82 82", 9: "244 196 48", 10: "34 211 238",
};

export function NerfCard({ nerf, revealed = true, compact = false, dense = false, ownerLabel, progress, preview }: Props) {
  if (!revealed) {
    return (
      <div className="relative plate p-5 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full border border-gold/40 bg-gold/10 flex items-center justify-center font-display text-2xl text-gold font-bold">?</div>
          <div>
            <div className="text-[12px] text-parchment-400">{ownerLabel ?? "Opponent"}</div>
            <div className="font-display text-xl text-parchment">Hidden rule</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-parchment-300 leading-relaxed">
          You&apos;ll see their rule when the game ends.
        </p>
      </div>
    );
  }

  // Per-card face icon from the shared globally-unique assignment (see
  // src/lib/cardIcon.ts): every nerf in the library wears a face no other
  // card in the game uses. Unlink survives only as the truly-last-resort
  // fallback for an id outside the shipped library, so nothing can crash.
  const faceIcon: LucideIcon = nerfFaceIcon(nerf.id, nerf.icon) ?? Unlink;

  return (
    <div className="nerf-enter" style={{ ["--tier-rgb" as string]: TIER_RGB[nerf.tier] ?? TIER_RGB[3] }}>
    {/* The seal: a wax disc that stamps the card, then cracks in two as the
        rule unfolds beneath it. Pure CSS, transform/opacity only. */}
    <span aria-hidden className="nerf-enter__seal">
      <b className="nerf-enter__seal-half nerf-enter__seal-half--l" />
      <b className="nerf-enter__seal-half nerf-enter__seal-half--r" />
    </span>
    <div
      className={`nerf-enter__card group/card relative plate draft-face overflow-hidden tier-bg-${nerf.tier} border ${
        dense ? "flex h-full flex-col p-4" : "p-5"
      }`}
    >
      {/* Watermark: faint by default; hovering the card brightens it in the
          card's tier (severity) color and nudges the scale. Transitions only
          (no keyframes), so with animations off in Settings users just see the
          state change; the scale nudge is additionally gated behind motion-safe
          (OS reduced-motion). */}
      {createElement(faceIcon, {
        "aria-hidden": true,
        className: `pointer-events-none absolute -bottom-3 -right-2 tier-${nerf.tier} opacity-[0.08] transition-all duration-200 group-hover/card:opacity-[0.18] motion-safe:group-hover/card:scale-105`,
        size: dense ? 84 : 92,
        strokeWidth: 1.2,
      })}
      {/* Animation preview (nerf draft pick only): a small looping medallion
          in the card's passive-family motif, anchored over the watermark
          corner so nothing in the existing layout moves. Static tinted
          medallion under reduced motion / animations-off (see DraftPreview). */}
      {preview && (
        <DraftPreview kind="nerf" id={nerf.id} icon={faceIcon} className="bottom-2.5 right-2.5" />
      )}
      <div className="nerf-enter__line relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-parchment-400">
              {ownerLabel ?? "Your nerf"}
            </span>
            <TurnCostBadge cost={NERF_TURN_COST} />
          </div>
          <div className={`font-display leading-tight tier-${nerf.tier} ${dense ? "text-lg" : "text-2xl"}`}>
            {nerf.name}
          </div>
        </div>
        <span
          className={`font-display font-bold text-sm px-2.5 py-0.5 rounded-[1px] border tier-bg-${nerf.tier} tier-${nerf.tier}`}
          title={`Nerf difficulty ${TIER_ROMAN[nerf.tier]} (${nerf.tier} of 8): ${TIER_LABEL[nerf.tier]}`}
        >
          {TIER_ROMAN[nerf.tier]}
        </span>
      </div>
      <div className={`nerf-enter__line rule-ornament text-[12px] ${dense ? "my-2.5" : "my-3"}`}>
        <span className="font-display">{TIER_LABEL[nerf.tier]}</span>
      </div>
      <p className={"nerf-enter__line " + (dense ? "flex-1 text-[13px] leading-snug text-parchment" : "text-[15px] leading-relaxed text-parchment")}>
        <GlossaryText text={nerf.description} />
      </p>
      {progress && progress.max > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[12px] text-parchment-400">Progress</span>
            <span className="font-mono text-[12px] text-parchment-300">{progress.label}</span>
          </div>
          <div className="h-1.5 bg-white/5 overflow-hidden">
            <div
              className={`h-full tier-bg-${nerf.tier}`}
              style={{ width: `${Math.min(100, (progress.value / progress.max) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {/* How to live with the handicap. Advice, never a rule. */}
      {!compact && nerf.tip && (
        <p className="mt-2 text-[10.5px] leading-snug text-parchment-400">
          <span className="text-parchment-300">Tip</span>{" "}
          <GlossaryText text={nerf.tip} />
        </p>
      )}
      {!compact && nerf.flavor && (
        <p className={`font-display border-l-2 border-white/15 pl-3 text-parchment-300 ${dense ? "mt-2 text-[12px] italic" : "mt-3 text-[13px]"}`}>
          &ldquo;{nerf.flavor}&rdquo;
        </p>
      )}
      {!nerf.implemented && (
        <div className="mt-3 text-[12px] text-gold">
          Engine implementation pending
        </div>
      )}
    </div>
    </div>
  );
}
