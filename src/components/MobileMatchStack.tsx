"use client";

import { type ReactNode } from "react";
import { Move } from "@/engine/types";
import { TABLET_STACK_SHOW } from "./matchLayout";
import { MoveStrip } from "./MoveStrip";

/**
 * Everything that sits UNDER the board on a phone, in Lichess's column-one
 * order: the game actions, the horizontal move strip, then the sections that
 * used to hide behind two fixed drawers and a dropdown (your cards, your rule,
 * chat, stakes). The page scrolls; nothing is clipped and nothing floats over
 * the board.
 *
 * A portrait tablet gets the same column (see matchLayout.ts): it has a
 * phone's proportions at a larger scale, and the side-rail shape was leaving
 * 540-584px of the screen empty there while squeezing the board. Landscape and
 * `xl` keep the side rails and never render this.
 */
export function MobileMatchStack({
  actions,
  moves,
  currentPly,
  onPlyChange,
  minPly = 0,
  cards,
  rule,
  chat,
  extra,
}: {
  /** Draw / resign / takeback and their confirm flows. */
  actions?: ReactNode;
  moves: Move[];
  currentPly: number;
  onPlyChange: (ply: number) => void;
  minPly?: number;
  /** The buff/boon dock, with its heading and a live count line. */
  cards?: { label: string; summary: string; content: ReactNode } | null;
  /** The player's own rule card strip (nerf mode). */
  rule?: ReactNode;
  chat?: ReactNode;
  /** Rating stakes, clip button, anything else that belongs at the bottom. */
  extra?: ReactNode;
}) {
  return (
    <div className={"mt-2 flex flex-col gap-3 pb-4 sm:hidden " + TABLET_STACK_SHOW}>
      {actions && <div className="plate p-2 px-3">{actions}</div>}
      <MoveStrip moves={moves} currentPly={currentPly} onPlyChange={onPlyChange} minPly={minPly} />
      {rule && <div className="px-2">{rule}</div>}
      {cards && (
        <section className="px-2" aria-label={cards.label}>
          <div className="flex items-baseline justify-between px-1 pb-1.5">
            <h2 className="font-display text-[14px] font-bold text-parchment">{cards.label}</h2>
            <span className="font-mono text-[12px] tabular-nums text-parchment-400">{cards.summary}</span>
          </div>
          {cards.content}
        </section>
      )}
      {chat && <div className="px-2">{chat}</div>}
      {extra && <div className="px-2">{extra}</div>}
    </div>
  );
}
