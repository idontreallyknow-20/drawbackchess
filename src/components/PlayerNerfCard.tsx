"use client";

import { useState, type ReactNode } from "react";
import { Nerf, Tier } from "@/engine/nerf";
import { BoardState, Color } from "@/engine/types";
import { Piece } from "@/components/Pieces";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { capturedPiecesFor, capturedValue, opponentOf } from "@/lib/material";
import { GlossaryText } from "@/components/GlossaryText";
import { NERF_TURN_COST, TurnCost } from "@/engine/buff";
import { TurnCostBadge } from "@/components/TurnCostBadge";

import { TIER_LABEL, TIER_ROMAN } from "@/lib/tiers";
// Supplies .nerf-heartbeat (also loaded by the board's FruitionLayer; the
// bundler dedupes, and standalone hosts like galleries get it from here).
import "@/components/effects/fruition/fruition.css";

/** Compact row for a held boon shown in the corner card (nerf mode). */
export interface HeldBoon {
  name: string;
  tier: Tier;
  status: string | null;
  cost: TurnCost;
}

interface Props {
  board: BoardState;
  playerColor: Color;
  myColor: Color;
  name: string;
  elo?: number | null;
  /** Rating deviation still wide (provisional): the rating renders as "1500?". */
  provisional?: boolean;
  avatar?: string | null;
  nerf: Nerf;
  revealed?: boolean;
  // Nerf-and-Buff-mode games: render only the player header (name, rating,
  // captures) with no rule section at all. Rules reveal at game end via the
  // end screen, so there is no "hidden rule" placeholder to show mid-game.
  hideNerf?: boolean;
  ownerLabel: string;
  progress?: { value: number; max: number; label: string } | null;
  /** Nerf mode: the player's active boons, listed in the same corner card
   * as the nerf so the handicap and its reliefs read together. */
  boons?: HeldBoon[];
  action?: ReactNode;
  // Tighter paddings/typography for the in-game rail, so the whole rail fits
  // beside the board without scrolling.
  compact?: boolean;
  // Live socket state for this seat, when the caller knows it: a small dot
  // beside the name (green = connected, red = disconnected). Omitted = no dot.
  connected?: boolean | null;
  /** Bumped (to the current ply) whenever this seat's nerf onTurnStart hook
   * advanced its state — the handicap's per-turn heartbeat. Each new value
   * replays one soft edge breath on the card; the first observation seeds
   * silently so a reload never pulses. Fed from the engine's fx-event log. */
  heartbeatKey?: number | null;
}

export function PlayerNerfCard({
  board,
  playerColor,
  myColor,
  name,
  elo,
  provisional = false,
  avatar,
  nerf,
  revealed = true,
  hideNerf = false,
  ownerLabel,
  progress,
  boons,
  action,
  compact = false,
  connected = null,
  heartbeatKey = null,
}: Props) {
  // Heartbeat replay: each NEW key plays one breath; the first observed key
  // seeds silently (a reload or rebuild must not pulse). Transition handled
  // during render so the pulse mounts in the same frame its ply arrives.
  const [hb, setHb] = useState<{ prev: number | null; fire: number }>({ prev: null, fire: 0 });
  if (heartbeatKey != null && heartbeatKey !== hb.prev) {
    setHb((s) => ({ prev: heartbeatKey, fire: s.prev === null ? 0 : s.fire + 1 }));
  }
  const pieces = capturedPiecesFor(board, playerColor);
  const mineValue = capturedValue(capturedPiecesFor(board, myColor));
  const opponentValue = capturedValue(capturedPiecesFor(board, opponentOf(myColor)));
  const playerValue = playerColor === myColor ? mineValue : opponentValue;
  const otherValue = playerColor === myColor ? opponentValue : mineValue;
  const delta = playerValue - otherValue;
  const isMe = playerColor === myColor;
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  const showAvatar = name !== "Anonymous" && name !== "You";

  return (
    <section
      className={
        "relative plate overflow-hidden border " +
        (compact ? "p-3 " : "p-4 ") +
        // Lichess's game side is flat: the seat card stays on the plain
        // panel surface and the nerf's tier shows in its name, not a wash.
        "border-[color:var(--edge)]"
      }
    >
      {/* One breath per heartbeat tick; keyed so each tick replays from zero. */}
      {hb.fire > 0 && (
        <span
          key={hb.fire}
          aria-hidden
          className="nerf-heartbeat pointer-events-none absolute inset-0"
        />
      )}
      <div className="flex items-start gap-3">
        {showAvatar ? (
          <PlayerAvatar name={name} avatar={avatar} size={compact ? 32 : 36} />
        ) : (
          <div
            className={
              "grid shrink-0 place-items-center rounded-md border font-display text-xs font-semibold " +
              (compact ? "h-8 w-8 " : "h-9 w-9 ") +
              (isMe
                ? "border-[color:var(--edge-strong)] bg-[color:var(--bg-raised)] text-parchment-50"
                : "border-[color:var(--edge)] bg-[color:var(--bg-raised)] text-parchment-300")
            }
            aria-hidden="true"
          >
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-base font-semibold leading-tight text-parchment">
            {showAvatar ? (
              // Opens in a new tab so checking a profile never abandons a
              // live board.
              <a
                href={`/u/${encodeURIComponent(name)}`}
                target="_blank"
                rel="noopener"
                className="hover:text-gold-leaf hover:underline transition-colors"
              >
                {name}
              </a>
            ) : (
              name
            )}
            {typeof elo === "number" && (
              <span className="text-parchment-400">
                {" "}
                ({Math.round(elo)}
                {provisional ? "?" : ""})
              </span>
            )}
            {connected !== null && (
              <span
                aria-label={connected ? "Connected" : "Disconnected"}
                title={connected ? "Connected" : "Disconnected"}
                className={
                  "ml-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full align-middle " +
                  (connected ? "bg-[rgb(var(--pos-rgb))]" : "bg-oxblood-glow")
                }
              />
            )}
          </div>
          <div className="mt-1 flex min-h-[1.4rem] min-w-0 items-center gap-1">
            <div className="flex min-w-0 flex-wrap items-center">
              {pieces.map((piece, index) => (
                <div
                  key={`${piece}-${index}`}
                  className={index > 0 && pieces[index - 1] === piece ? "-ml-[15px]" : ""}
                >
                  <Piece
                    type={piece}
                    color={opponentOf(playerColor)}
                    size={22}
                    className="opacity-90"
                  />
                </div>
              ))}
            </div>
            {delta > 0 && (
              <span className="shrink-0 font-mono text-sm font-semibold text-white">
                +{delta}
              </span>
            )}
          </div>
        </div>
      </div>

      {!hideNerf && <div className={(compact ? "my-2.5" : "my-4") + " h-px bg-white/10"} />}

      {hideNerf ? null : revealed ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                {ownerLabel && (
                  <span className="text-[12px] text-parchment-400">{ownerLabel}</span>
                )}
                <TurnCostBadge cost={NERF_TURN_COST} />
              </div>
              <div className={`font-display ${compact ? "text-lg" : "text-2xl"} leading-tight tier-${nerf.tier}`}>
                {nerf.name}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-[1px] border px-2.5 py-0.5 font-display text-sm font-bold tier-bg-${nerf.tier} tier-${nerf.tier}`}
              title={`Tier ${nerf.tier}: ${TIER_LABEL[nerf.tier]}`}
            >
              {TIER_ROMAN[nerf.tier]}
            </span>
          </div>
          {!compact && (
            <div className="rule-ornament my-3 text-[12px]">
              <span className="font-display">{TIER_LABEL[nerf.tier]}</span>
            </div>
          )}
          <p
            className={
              compact
                ? "mt-2 text-[13px] leading-snug text-parchment"
                : "text-[15px] leading-relaxed text-parchment"
            }
          >
            <GlossaryText text={nerf.description} />
          </p>
          {progress && progress.max > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[12px] text-parchment-400">Progress</span>
                <span className="font-mono text-[12px] text-parchment-300">{progress.label}</span>
              </div>
              <div className="h-1.5 overflow-hidden bg-white/5">
                <div
                  className={`h-full tier-bg-${nerf.tier}`}
                  style={{ width: `${Math.min(100, (progress.value / progress.max) * 100)}%` }}
                />
              </div>
            </div>
          )}
          {nerf.flavor && !compact && (
            <p className="mt-3 border-l-2 border-white/15 pl-3 font-display text-[13px] text-parchment-300">
              &ldquo;{nerf.flavor}&rdquo;
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gold/40 bg-gold/10 font-display text-2xl font-bold text-gold">
              ?
            </div>
            <div className="min-w-0">
              <div className="text-[12px] text-parchment-400">{ownerLabel}</div>
              <div className="font-display text-xl text-parchment">Hidden rule</div>
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-parchment-300">
            You&apos;ll see their rule when the game ends.
          </p>
        </>
      )}

      {boons && boons.length > 0 && (
        <div className={(compact ? "mt-2.5" : "mt-4") + " border-t border-white/10 pt-2"}>
          <div className="text-[12px] text-parchment-400">Your cards</div>
          {/* Cap + scroll the held-cards list so a full late-game hand never grows
              this card tall enough to squeeze the interactive card dock (with its
              Use buttons) out of the rail. */}
          <ul className={"mt-1 space-y-1 overflow-y-auto overscroll-contain pr-0.5 " + (compact ? "max-h-32" : "max-h-56")}>
            {boons.map((b, i) => (
              <li key={`${b.name}-${i}`} className="flex items-baseline gap-1.5">
                <span
                  // The card name is what identifies the row, so it keeps a
                  // floor: with three siblings now carrying 12px type instead
                  // of 8-9px, a bare `min-w-0` would let the name shrink away
                  // before the status text did.
                  className={`min-w-[4.5rem] truncate font-display text-[12px] font-semibold leading-tight tier-${b.tier}`}
                >
                  {b.name}
                </span>
                <TurnCostBadge cost={b.cost} short className="self-center" />
                {b.status && (
                  <span className="min-w-0 flex-1 truncate text-[12px] text-gold" title={b.status}>
                    {b.status}
                  </span>
                )}
                <span
                  className={`ml-auto shrink-0 rounded-[1px] border px-1.5 py-px font-display text-[12px] font-bold tier-bg-${b.tier} tier-${b.tier}`}
                >
                  {TIER_ROMAN[b.tier]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {action && <div className="mt-4">{action}</div>}
    </section>
  );
}
