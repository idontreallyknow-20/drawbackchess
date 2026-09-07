"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { HeroBoard } from "./HeroBoard";
import { PlayerAvatar } from "./PlayerAvatar";
import { useLobbySnapshot } from "@/lib/lobbyClient";
import { featuredBoard } from "@/lib/spectate/featuredBoard";
import { useArchiveReplay } from "@/lib/spectate/useArchiveReplay";
import { useFeaturedTune } from "@/lib/spectate/useFeaturedTune";
import { clockLabel } from "@/lib/tournaments";
import type { Color } from "@/engine/types";

// Lichess-TV-style hero: when a real game is being played, the landing board
// streams it live (top game = most watched, then longest running). With no
// live games the channel keeps running: a random archived game reruns move by
// move (badged REPLAY), then the next one; the static demo position only
// appears before anything has ever been played.
export function HeroTv() {
  const router = useRouter();
  const lobby = useLobbySnapshot(10000);

  // Featured selection + health-checked failover, shared with /tv. The hero has
  // no channel filter and no manual pin, so it simply follows the first HEALTHY
  // live game: a broken candidate is retried with bounded backoff and then
  // skipped in favor of the next one, instead of the old silent infinite
  // re-watch of games[0].
  const candidateIds = useMemo(() => lobby?.games.map((g) => g.id) ?? [], [lobby]);
  const tune = useFeaturedTune(candidateIds, null, "hero", { surface: "hero", filter: "hero" });
  const { streamId, moves, players, over, draft } = tune;

  const live = tune.live;
  // The archive rerun: a random recently finished game replayed move by move,
  // then another. The hook fetches its pool IMMEDIATELY on mount, in parallel
  // with the lobby poll, so the hero board shows real play right away instead
  // of waiting for the (single global Durable Object, sometimes slow) lobby
  // snapshot. A live game, when one is being played, takes over below (which
  // also pauses every rerun timer); until it does, the rerun keeps the board
  // alive so a visitor never sees a loading gap or a frozen position.
  const replay = useArchiveReplay(!live, null);
  const shownMoves = useMemo(
    () => (live ? moves : replay.moves),
    [live, moves, replay.moves],
  );
  const { board, history } = useMemo(
    () => featuredBoard(live, shownMoves, draft),
    [live, shownMoves, draft],
  );
  const lastMove = history[history.length - 1] ?? null;

  const shownId = live ? streamId : replay.game?.id ?? null;
  const shownPlayers = live ? players : replay.players;
  // The lobby entry for the streaming game, when live: carries the time
  // control and live move count for the overlay header.
  const liveGame = live ? lobby?.games.find((g) => g.id === streamId) ?? null : null;
  // The shown game's mode (nerf/buff), when known: labels the seat ratings
  // and feeds the caption below the board.
  const shownMode = live
    ? liveGame?.mode === "nerf" || liveGame?.mode === "buff"
      ? liveGame.mode
      : null
    : replay.mode;
  // Move number for the header: the streamed move count when live, otherwise
  // the length of the replayed line.
  const moveNumber = shownMoves.length;
  const timeControl = liveGame ? clockLabel(liveGame.timeSec, liveGame.incrementSec) : null;

  // Warm the route the hero links to so tapping "Watch"/"Replay" navigates
  // instantly instead of paying to load the /game/[id] chunk on click. Kept
  // above the early return so hook order stays stable across renders.
  useEffect(() => {
    if (shownId) router.prefetch(`/game/${shownId}`);
  }, [shownId, router]);

  if (!shownId || !shownPlayers) {
    // Nothing live and nothing archived yet: the built-in demo position stands
    // in, with a quiet caption so the board still reads as "this is where the
    // action shows up".
    return (
      <div className="w-full max-w-[600px] mx-auto">
        <div className="flex items-center justify-between gap-2 pb-2">
          <span className="text-[12px] text-parchment-400">Live games appear here</span>
          <Link
            href="/tv"
            className="text-[12px] text-parchment-400 no-underline transition hover:text-gold-leaf"
          >
            Watch TV &rarr;
          </Link>
        </div>
        <div className="tv-frame">
          <HeroBoard />
        </div>
      </div>
    );
  }

  // Each seat is its own link into the player's profile — the board link and
  // the name links sit side by side, never nested.
  const seat = (color: Color) => {
    const p = shownPlayers[color];
    return (
      <Link
        href={`/u/${encodeURIComponent(p.name)}`}
        className="group/seat flex min-w-0 items-center gap-2 no-underline"
        title={`${p.name}'s profile`}
      >
        <PlayerAvatar name={p.name} avatar={p.avatar} size={24} />
        <span className="truncate font-display text-[15px] text-parchment-100 underline-offset-4 transition-colors group-hover/seat:text-gold-leaf group-hover/seat:underline group-hover/seat:decoration-gold/50">
          {p.name}
          {/* The rating wears the mode's color (warm rose for Nerf, sky for
              Buff) instead of spelling the mode out next to the number. */}
          {p.rating != null && (
            <span
              className={
                "no-underline " +
                (shownMode === "nerf"
                  ? "text-mode-nerfGlow"
                  : shownMode === "buff"
                    ? "text-mode-buffGlow"
                    : "text-parchment-400")
              }
            >
              {" "}({p.rating})
            </span>
          )}
        </span>
      </Link>
    );
  };

  // The archive rerun wears ONE clean attribution line under the board —
  // "Featured replay · white vs black · Mode" plus a single Watch link —
  // instead of scattering a REPLAY badge, mode chip, and archive labels
  // around the frame. Live games keep their full seat-row broadcast header.
  if (!live) {
    const modeLabel = shownMode === "nerf" ? "Nerf" : shownMode === "buff" ? "Buff" : null;
    return (
      <div className="w-full max-w-[600px] mx-auto">
        <Link href={`/game/${shownId}`} className="tv-frame group block no-underline" title="Replay this game">
          <div className="overflow-hidden">
            <HeroBoard board={board} lastMove={lastMove} />
          </div>
        </Link>
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="min-w-0 truncate text-[13px] text-parchment-300">
            Featured replay
            <span className="mx-1.5 text-parchment-500">·</span>
            <span className="text-parchment-100">{shownPlayers.w.name}</span>{" "}
            <span className="text-parchment-400">vs</span>{" "}
            <span className="text-parchment-100">{shownPlayers.b.name}</span>
            {modeLabel && (
              <>
                <span className="mx-1.5 text-parchment-500">·</span>
                <span className={shownMode === "nerf" ? "text-mode-nerfGlow" : "text-mode-buffGlow"}>
                  {modeLabel}
                </span>
              </>
            )}
          </span>
          <Link
            href={`/game/${shownId}`}
            className="shrink-0 text-[13px] font-medium text-gold-leaf no-underline transition hover:text-parchment-50"
          >
            Watch replay →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[600px] mx-auto">
      {/* Compact header framing the board: black seat on the left, then the
          live status (LIVE badge when running, mode chip, time control) on the
          right. Kept out of the board squares so pieces never get covered. */}
      <div className="flex items-center justify-between gap-2 pb-2">
        {seat("b")}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* LIVE while streaming, "Just finished" while the result lingers. */}
          <span
            className={
              "flex items-center gap-1.5 border px-2 py-1 text-[12px] " +
              (!over
                ? "border-[rgb(var(--accent-positive-rgb)_/_0.4)] bg-[rgb(var(--accent-positive-rgb)_/_0.1)] text-[rgb(var(--accent-positive-rgb))]"
                : "border-[color:var(--edge)] bg-[color:var(--bg-zebra)] text-parchment-300")
            }
          >
            {!over ? <span className="dot-live h-2 w-2 bg-[rgb(var(--accent-positive-rgb))]" /> : null}
            {over ? "Just finished" : "LIVE"}
          </span>
          {shownMode ? (
            <span
              className={
                "border px-2 py-1 text-[12px] " +
                (shownMode === "nerf"
                  ? "border-mode-nerf/40 bg-mode-nerf/10 text-mode-nerfGlow"
                  : "border-mode-buff/40 bg-mode-buff/10 text-mode-buffGlow")
              }
            >
              {shownMode === "nerf" ? "Nerf" : "Buff"}
            </span>
          ) : null}
          {timeControl ? (
            <span className="hidden border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] px-2 py-1 font-mono text-[12px] tabular-nums text-parchment-300 sm:inline">
              {timeControl}
            </span>
          ) : null}
        </div>
      </div>
      <Link href={`/game/${shownId}`} className="tv-frame group block no-underline" title="Watch this game">
        <div className="overflow-hidden">
          <HeroBoard board={board} lastMove={lastMove} />
        </div>
      </Link>
      <div className="flex items-center justify-between gap-2 pt-2">
        {seat("w")}
        <div className="flex shrink-0 items-center gap-3">
          {moveNumber > 0 ? (
            <span className="font-mono text-[12px] tabular-nums text-parchment-400">
              Move {moveNumber}
            </span>
          ) : null}
          <Link
            href={`/game/${shownId}`}
            className="text-[12px] font-medium text-gold-leaf no-underline transition hover:text-parchment-50"
          >
            Watch live →
          </Link>
        </div>
      </div>
    </div>
  );
}
