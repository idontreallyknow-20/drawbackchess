"use client";

// A small styled explanation card the Board raises for any active-effect
// square: piece-bound buffs (Duelist and friends) and the persistent zone
// effects (walnut, freeze, shield, wall, peel, motifs). One clean UI in place
// of the old browser `title=` tooltip. Positioned in board-percent coordinates
// so it always sits next to its square and stays inside the board bounds
// (anchored to the near edge when the square is close to one), flips below the
// square for the top two ranks, and is purely presentational (pointer-events
// none): the Board owns open/close on hover, focus, tap, and tap-away.

import React from "react";
import { Color, FILE, RANK } from "@/engine/types";
import { BOARD_STATUS, type BoardStatus } from "@/lib/boardStatus";
import { StatusGlyph } from "@/components/board/StatusGlyph";

// Mirror of globals.css's .tier-N palette (same values BoardEffects uses for
// SVG strokes), so the card can tint its accent per card tier.
const TIER_ACCENT: Record<number, string> = {
  1: "#7eb59a",
  2: "#8ba9c4",
  3: "#d8b56e",
  4: "#c79468",
  5: "#c66860",
  6: "#c65f8f",
  7: "#a877d8",
  8: "#e05252",
  9: "#f4c430",
};

export interface EffectPopoverContent {
  /** Card / effect name, the card header. */
  title: string;
  /** Full rule text. */
  body: string;
  /** Optional live status line ("dueling on e4", "2 turns left"). */
  status?: string | null;
  /** Optional one-line flavor, shown quoted. */
  flavor?: string | null;
  /** Card tier: tints the accent. Absent for the generic zone effects. */
  tier?: number;
  /** buff = a boon on this side, hex = a curse, neutral = a plain zone effect.
   * Drives the small kicker label and a fallback accent when no tier. */
  tone?: "buff" | "hex" | "neutral";
  /** Plain headline from the board-status vocabulary ("Can't move · 2 turns left"). */
  plain?: string;
  /** The board-status class: tints the card and draws its glyph. */
  kind?: BoardStatus;
}

const TONE_LABEL: Record<NonNullable<EffectPopoverContent["tone"]>, string> = {
  buff: "Buff",
  hex: "Hex",
  neutral: "Effect",
};

const TONE_ACCENT: Record<NonNullable<EffectPopoverContent["tone"]>, string> = {
  buff: "var(--accent-buff)",
  hex: "var(--accent-nerf)",
  neutral: "var(--text-secondary)",
};

export function EffectPopover({
  sq,
  orientation,
  content,
}: {
  sq: number;
  orientation: Color;
  content: EffectPopoverContent;
}) {
  // The square's on-screen cell (0 = viewer's left / top).
  const col = orientation === "w" ? FILE(sq) : 7 - FILE(sq);
  const row = orientation === "w" ? 7 - RANK(sq) : RANK(sq);
  // Flip below for the top two ranks so the card never leaves the top edge;
  // anchor the card's near edge to the square when it hugs a side, otherwise
  // centre it over the square. Both keep it inside the board bounds without
  // needing a live measurement.
  const place: "above" | "below" = row <= 1 ? "below" : "above";
  const align: "left" | "center" | "right" = col <= 1 ? "left" : col >= 6 ? "right" : "center";

  const tx: string[] = [];
  const style: React.CSSProperties = { position: "absolute", zIndex: 40 };
  if (align === "center") {
    style.left = `${((col + 0.5) / 8) * 100}%`;
    tx.push("translateX(-50%)");
  } else if (align === "left") {
    style.left = `${(col / 8) * 100}%`;
  } else {
    style.left = `${((col + 1) / 8) * 100}%`;
    tx.push("translateX(-100%)");
  }
  if (place === "above") {
    style.top = `${(row / 8) * 100}%`;
    tx.push("translateY(calc(-100% - 6px))");
  } else {
    style.top = `${((row + 1) / 8) * 100}%`;
    tx.push("translateY(6px)");
  }
  style.transform = tx.join(" ");

  const tone = content.tone ?? "neutral";
  const accent =
    (content.kind ? BOARD_STATUS[content.kind].color : undefined) ??
    (content.tier != null ? TIER_ACCENT[content.tier] : undefined) ??
    TONE_ACCENT[tone];

  return (
    <div
      style={style}
      className="pointer-events-none w-[min(240px,72vw)]"
      role="tooltip"
      data-effect-popover
    >
      <div
        className="fx-effect-popover-anim rounded-[1px] border px-3 py-2"
        style={{
          background: "rgba(18,22,30,0.97)",
          borderColor: accent,
          boxShadow: "0 6px 20px -6px rgba(0,0,0,0.7)",
        }}
      >
        {content.plain && (
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: accent }}>
            {content.kind && (
              <span className="inline-grid h-4 w-4 place-items-center" style={{ background: accent, color: "#14120f" }}>
                <StatusGlyph status={content.kind} size={11} />
              </span>
            )}
            {content.plain}
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display text-sm font-semibold leading-tight" style={{ color: accent }}>
            {content.title}
          </span>
          <span
            className="shrink-0 text-[12px] font-bold uppercase tracking-wide"
            style={{ color: accent, opacity: 0.75 }}
          >
            {TONE_LABEL[tone]}
          </span>
        </div>
        <p className="mt-1 text-xs leading-snug text-parchment-300">{content.body}</p>
        {content.status && (
          <p className="mt-1 text-[12px] leading-snug" style={{ color: accent, opacity: 0.9 }}>
            {content.status}
          </p>
        )}
        {content.flavor && (
          <p className="mt-1 text-[12px] italic leading-snug text-parchment-400">
            &ldquo;{content.flavor}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}
