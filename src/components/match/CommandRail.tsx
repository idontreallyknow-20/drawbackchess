"use client";

// The command rail: the framed left column of a game screen (mode header,
// opponent, the dock and chat, you), as one component instead of two.
//
// It existed twice — once in OnlineMatch and once in the bot game — as ~100
// lines of near-identical JSX that had drifted: the online copy grew a collapse
// control, a luxe material, a rating-stakes footer and a breathing halo on the
// charged player's card, and the bot copy grew a "Plain chess" mode the online
// one cannot have. Two copies is a maintenance cost at the best of times; it is
// a worse one now, because a theme that restyles the rail has to be checked in
// two places and a drift between them reads as a bug in the theme.
//
// The API is SLOTS, NOT DATA. This component never receives `game`, `myColor`
// or `start` — the caller passes rendered cards in. That is what lets one
// component absorb both callers without becoming a union of two prop sets, and
// it keeps the rail a layout surface rather than a second place that knows the
// rules of the game.
//
// Rail WIDTH deliberately stays with the callers. --match-rail-w is not only
// this column's width: it feeds the board-sizing min() math in both parents, so
// owning it here would split one calculation across two files.

import type { ReactNode } from "react";
import { BoardKeyDetails } from "@/components/board/BoardKey";
import { TABLET_STACK_HIDE, TABLET_STACK_ONE_COL } from "@/components/matchLayout";
import { Button } from "@/components/ui/Button";

/** Which game this rail is fronting. `plain` is the bot game's no-cards mode;
 *  the online rail can never be plain, which is why this is a mode rather than
 *  a pair of booleans. */
export type RailMode = "nerf" | "buff" | "plain";

const MODE_LABEL: Record<RailMode, string> = {
  nerf: "Nerf mode",
  buff: "Buff mode",
  plain: "Plain chess",
};

// Mode hues brand mode surfaces and nothing else (design-system.md §2), so
// plain chess — which has no mode — gets neutral ink rather than a third hue.
const MODE_INK: Record<RailMode, string> = {
  nerf: "text-mode-nerfGlow",
  buff: "text-mode-buffGlow",
  plain: "text-parchment-300",
};

/** The grid that holds rail, resize handle and board. Both parents inlined the
 *  same literal; it lives here so the rail and its column cannot disagree. */
export function railGridClass(collapsed: boolean): string {
  return (
    "match-grid grid min-h-0 flex-1 gap-y-2 lg:justify-center lg:gap-x-1.5 " +
    // A portrait tablet is one column, so the three-column desktop template
    // stands down there even above `lg` (an iPad Pro is 1024 wide in portrait).
    TABLET_STACK_ONE_COL +
    " " +
    (collapsed ? "lg:grid-cols-[auto]" : "lg:grid-cols-[var(--match-rail-w,320px)_0.25rem_auto]")
  );
}

export interface CommandRailProps {
  mode: RailMode;
  /** Right of the mode label: time control, "Casual · vs bot". */
  subtitle?: ReactNode;
  /** The luxe rail material (filigree, sheen, halo). Online-only today. */
  lux?: boolean;
  /** Omit `onToggleCollapse` and no collapse control renders — the bot game has
   *  no collapsed state, so it opts out by not passing a handler rather than by
   *  passing a flag saying it cannot. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  opponent: ReactNode;
  /** Their clock is running: their card wears the breathing halo. */
  opponentCharged?: boolean;
  /** The dock and chat. Absent in a game with no cards. */
  center?: ReactNode;
  self: ReactNode;
  selfCharged?: boolean;
  /** Under your card: reveal control, rating stakes. */
  footer?: ReactNode;
}

// The seat whose clock is running gets a hairline in the accent, nothing more.
function GlowWrap({ charged, children }: { charged?: boolean; children: ReactNode }) {
  return (
    <div className={"rail-glow-wrap" + (charged ? " rail-glow-wrap--active" : "")}>{children}</div>
  );
}

export function CommandRail({
  mode,
  subtitle,
  lux = true,
  collapsed = false,
  onToggleCollapse,
  opponent,
  opponentCharged,
  center,
  self,
  selfCharged,
  footer,
}: CommandRailProps) {
  return (
    <aside
      className={
        "rail-panel hidden min-h-0 gap-2 overflow-y-auto p-2.5 " +
        "lg:min-h-[var(--board-height)] lg:max-h-full " +
        "lg:grid-rows-[auto_auto_minmax(8rem,1fr)_auto] lg:self-start " +
        // Portrait tablets are one column and carry this rail's contents in
        // the stack under the board instead, so it stays down past `lg` there.
        TABLET_STACK_HIDE +
        " " +
        (lux ? "rail-lux " : "") +
        (collapsed ? "" : "lg:grid")
      }
    >
      <div className="relative flex items-center justify-between gap-2 border-b border-[color:var(--edge)] px-1 pb-2">
        <span className={"text-[12px] uppercase tracking-[0.06em] " + MODE_INK[mode]}>{MODE_LABEL[mode]}</span>
        {subtitle && (
          <span className="min-w-0 truncate text-[12px] text-parchment-400">
            {subtitle}
          </span>
        )}
        {/* Collapse the rail for a bigger board; a matching expand control
            rides the opponent bar while collapsed. */}
        {onToggleCollapse && (
          <Button tone="ghost"
           
            onClick={onToggleCollapse}
            aria-label="Collapse side panel"
            title="Collapse side panel for a bigger board"
            size="xs"
            iconOnly
            className="shrink-0 text-parchment-300 hover:text-parchment-100">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="11 17 6 12 11 7" />
              <polyline points="18 17 13 12 18 7" />
            </svg>
          </Button>
        )}
      </div>

      <GlowWrap charged={opponentCharged}>{opponent}</GlowWrap>

      {/* The flexible middle. An empty slot still holds its row so the four-row
          grid keeps its shape and your card stays pinned to the foot. */}
      {center ?? <div className="hidden lg:block" />}

      <div className="space-y-2">
        <GlowWrap charged={selfCharged}>{self}</GlowWrap>
        {footer}
        <BoardKeyDetails />
      </div>
    </aside>
  );
}
