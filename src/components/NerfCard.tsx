"use client";

import { createElement, useId } from "react";
import { Nerf } from "@/engine/nerf";
import { DraftPreview } from "@/components/DraftPreview";
import { GlossaryText } from "@/components/GlossaryText";
import { SrSep } from "@/components/SrSep";
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
  /** Picker surfaces only (the opening nerf draft): make the whole card face
   * one control. The card grows its own stretched <button> instead of being
   * wrapped in one by the caller — see the target below for why that is not
   * the same thing. Omit everywhere else and the card stays inert markup. */
  onClick?: () => void;
  /** Picker surfaces only: this card is the current selection. Emitted as
   * `aria-pressed` on the pick target, so the choice is announced as a toggle
   * state instead of being inferable only from a Confirm button appearing
   * elsewhere on the page. Leave undefined on cards that are not a choice, so
   * a plain card is never announced as an unpressed toggle. */
  selected?: boolean;
}

import { TIER_LABEL, TIER_ROMAN } from "@/lib/tiers";

// Mirror of globals.css .tier-bg-N --tier-rgb, for the wax seal outside the card.
const TIER_RGB: Record<number, string> = {
  1: "126 181 154", 2: "139 169 196", 3: "216 181 110", 4: "199 148 104", 5: "198 104 96",
  6: "198 95 143", 7: "168 119 216", 8: "224 82 82", 9: "244 196 48", 10: "34 211 238",
};

export function NerfCard({ nerf, revealed = true, compact = false, dense = false, ownerLabel, progress, preview, onClick, selected }: Props) {
  // Labels the pick target with the whole card face (see the target below).
  // Declared before the hidden-card early return so the hook order is stable.
  const faceId = useId();
  const pickable = !!onClick && revealed;
  if (!revealed) {
    return (
      <div className="relative plate p-5 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full border border-gold/40 bg-gold/10 flex items-center justify-center font-display text-2xl text-gold font-bold">?</div>
          <div>
            <div className="text-[12px] text-parchment-400">{ownerLabel ?? "Opponent"}</div>
            <SrSep text=". " />
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
      id={pickable ? faceId : undefined}
      className={`nerf-enter__card group/card relative plate draft-face overflow-hidden tier-bg-${nerf.tier} border ${
        dense ? "flex h-full flex-col p-4" : "p-5"
      }${pickable ? " touch-manipulation" : ""}`}
    >
      {/* THE PICK TARGET (same shape as BuffCard's).
          The nerf draft used to wrap this whole card in a <button>, and the
          rule text inside it is rendered by GlossaryText, which turns one to
          five words per card into `span[role="button"] tabIndex=0` chips. A
          control inside a control is invalid HTML and invalid ARIA (a button's
          children are presentational), and it had a measured cost: the term's
          click handler stops propagation so that a tap meaning "explain this"
          does not also press the card underneath, which meant a click on a
          glossary word -- the rule text, the part you read while deciding --
          reached NOTHING. The card stayed unselected and Confirm never
          appeared. The buff draft papers over that with a capture-phase pick;
          the nerf draft had no such workaround at all.

          The face is now a plain container and the control is this stretched
          target: a real <button> absolutely filling the face, so the whole
          card is still one 44px+ hit area and still keyboard operable with
          Enter / Space. It takes its accessible name from the face via
          aria-labelledby, so the announcement is unchanged, SrSep punctuation
          and all.

          It is FIRST in the face on purpose, so the tab order is the one the
          wrapping button had: this card, then the glossary chips in its rule
          text, then the next card. Being first is only safe because the target
          carries a z-index (see .card-pick-target): the nerf-enter__line rows
          below are `relative` and would otherwise paint over it and eat the
          click. The chips carry the same rung and come later in the DOM, so
          they stay above it and keep their own hover, long press, click and
          tab stop. The watermark, the preview medallion and the wax seal are
          all pointer-events: none, so none of them can swallow a pick. */}
      {pickable && (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={selected}
          aria-labelledby={faceId}
          className="card-pick-target"
        />
      )}
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
            {/* Owner label, cost chip, name, tier numeral and tier label are
                adjacent text to the accessibility tree and were announced as
                one run-on word. See SrSep. */}
            <SrSep />
            <TurnCostBadge cost={NERF_TURN_COST} />
          </div>
          <SrSep text=". " />
          <div className={`font-display leading-tight tier-${nerf.tier} ${dense ? "text-lg" : "text-2xl"}`}>
            {nerf.name}
          </div>
        </div>
        <SrSep text=". " />
        <span
          className={`font-display font-bold text-sm px-2.5 py-0.5 rounded-[1px] border tier-bg-${nerf.tier} tier-${nerf.tier}`}
          title={`Nerf difficulty ${TIER_ROMAN[nerf.tier]} (${nerf.tier} of 8): ${TIER_LABEL[nerf.tier]}`}
        >
          <span className="sr-only">Tier </span>
          {TIER_ROMAN[nerf.tier]}
        </span>
      </div>
      <div className={`nerf-enter__line rule-ornament text-[12px] ${dense ? "my-2.5" : "my-3"}`}>
        <SrSep />
        <span className="font-display">{TIER_LABEL[nerf.tier]}</span>
        <SrSep text=". " />
      </div>
      {/* The rule text, and the one line on the card that has to be lifted back
          over the pick target. `nerf-enter__line` animates a transform, and a
          transform makes a STACKING CONTEXT: everything inside this paragraph
          then paints as a single layer at the z-index-0 rung, so the target's
          one rung above it covered the glossary chips (their own z-[1] cannot
          escape their parent's context). Measured with the target painted on
          top: elementFromPoint over a term returned .card-pick-target, the
          definition popover never opened, and a SECOND click on a word started
          the game -- exactly the hazard GlossaryTerm's click handler exists to
          prevent. So the whole line goes one rung ABOVE the target, and the
          prose is made click-through so the target still gets every click that
          is not on a term. The spans in here are the GlossaryTerm wrappers and
          nothing else (GlossaryText emits bare text between them), so this
          hands the chips back their hover, long press, click and tab stop
          without giving the plain words a hit area of their own. */}
      <p
        className={
          "nerf-enter__line " +
          (pickable ? "relative z-[2] pointer-events-none [&_span]:pointer-events-auto " : "") +
          (dense ? "flex-1 text-[13px] leading-snug text-parchment" : "text-[15px] leading-relaxed text-parchment")
        }
      >
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
      {/* How to live with the handicap. Advice, never a rule -- but still whole
          sentences, so 13px like the rest of the prose on the face. A 12px face
          here is for bare tokens only (the owner label, the tier word in the
          ornament, the progress readout). Colour keeps it quieter than the
          rule; size no longer does. */}
      {!compact && nerf.tip && (
        <p className="mt-2 text-[13px] leading-snug text-parchment-400">
          <span className="text-parchment-300">Tip</span>{" "}
          <GlossaryText text={nerf.tip} />
        </p>
      )}
      {/* Dense (codex) cards used to shrink the flavour line to 12px while the
          in-game card kept it at 13. It is a sentence either way, and the codex
          shows nerf and buff cards side by side, so both now read at 13. */}
      {!compact && nerf.flavor && (
        <p className={`font-display border-l-2 border-white/15 pl-3 text-parchment-300 ${dense ? "mt-2 text-[13px] italic" : "mt-3 text-[13px]"}`}>
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
