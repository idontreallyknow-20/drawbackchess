"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Maximize2, Radio, X } from "lucide-react";
// TV is a read-only browsing/preview surface (the full interactive + card-VFX
// experience lives on the spectate page /game/[id]). Rendering the lightweight
// HeroBoard here instead of the full Board keeps the ENTIRE effects/animation
// stack and card database (~26k lines + framer-motion + the VFX engine) out of
// the /tv route bundle, the dominant cause of slow TV load (~1.6MB to a fraction).
import { ClockPill } from "@/components/ClockPill";
import { useZenHotkey } from "@/lib/useZenMode";
import { HeroBoard } from "@/components/HeroBoard";
import { ModeBadge } from "@/components/ModeBadge";
import { Piece } from "@/components/Pieces";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ProvisionalMark } from "@/components/ratings/ProvisionalMark";
import { SiteHeader } from "@/components/SiteHeader";
import { useLobbySnapshotStatus } from "@/lib/lobbyClient";
import { MPLobbyGame } from "@/lib/multiplayer";
import { featuredBoard } from "@/lib/spectate/featuredBoard";
import { useArchiveReplay } from "@/lib/spectate/useArchiveReplay";
import { useFeaturedTune } from "@/lib/spectate/useFeaturedTune";
import type { DraftMode } from "@/engine/buff";
import type { Color } from "@/engine/types";
import { LinkButton } from "@/components/ui/Button";

// Lichess-TV-style watch page: the top live game streams full-size, with the
// other running games listed alongside. Picking a game pins it; otherwise the
// page follows whatever the lobby ranks first. With nothing live the channel
// keeps running: a RANDOM archived game reruns move by move (then the next
// one), clearly badged as a replay, until a live game appears and takes the
// board back. `?mode=nerf|buff` (the nav's Nerf TV and Buff TV entries)
// narrows everything shown to that pool's games.

function clockLabel(timeSec: number, incrementSec: number): string {
  if (timeSec <= 0) return "No clock";
  if (timeSec < 60) return `${timeSec}s+${incrementSec}`;
  const minutes = timeSec % 60 === 0 ? String(timeSec / 60) : (timeSec / 60).toFixed(1);
  return `${minutes}+${incrementSec}`;
}

// Live-game list ordering: one fixed default, most watched first (ties broken
// by the stronger board). The first game is the featured board (unless the
// viewer pinned one).
// How many live games the rail shows before folding behind "Show all". Eight
// rows sit about level with the featured board; the list scrolls inside its
// box past that instead of running the page on down.
const TV_LIST_FOLD = 8;

function orderLiveGames(games: MPLobbyGame[]): MPLobbyGame[] {
  const best = (g: MPLobbyGame) =>
    Math.max(g.players.w.rating ?? 0, g.players.b.rating ?? 0);
  return [...games].sort((a, b) => b.watchers - a.watchers || best(b) - best(a));
}

// The shared player-identity unit (design system 7): avatar + linked name +
// rating (+ provisional "?"). Every name on this surface links to the profile.
function PlayerIdentity({
  name,
  rating,
  avatar,
  provisional,
  size = 28,
  strong = false,
}: {
  name: string;
  rating: number | null;
  avatar?: string | null;
  provisional?: boolean;
  size?: number;
  strong?: boolean;
}) {
  return (
    <Link
      href={`/u/${encodeURIComponent(name)}`}
      className="group flex min-h-[44px] min-w-0 items-center gap-2 sm:min-h-0"
      title={`View ${name}'s profile`}
    >
      <PlayerAvatar name={name} avatar={avatar} size={size} />
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={
            "truncate font-display font-semibold text-parchment-100 transition-colors group-hover:text-gold-leaf " +
            (strong ? "text-[15px]" : "text-[13px]")
          }
        >
          {name}
        </span>
        {rating != null && (
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] tabular-nums text-parchment-400">
            {rating}
            {provisional && <ProvisionalMark />}
          </span>
        )}
      </span>
    </Link>
  );
}

// A checkered board-shaped skeleton with a shimmer sweep, so a tuning/failover
// transition holds the board's exact footprint instead of a spinner page.
function TvBoardSkeleton({ status }: { status: string }) {
  return (
    <div className="relative aspect-square w-full overflow-hidden border border-[color:var(--edge)]">
      <div className="grid h-full w-full grid-cols-8 grid-rows-8" aria-hidden>
        {Array.from({ length: 64 }).map((_, i) => {
          const isLight = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
          return <div key={i} className={isLight ? "sq-light" : "sq-dark"} />;
        })}
      </div>
      <div className="skeleton absolute inset-0" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-[color:var(--bg-base)] px-3 py-2">
        <Radio size={14} className="animate-flicker text-gold-leaf" aria-hidden />
        <p role="status" aria-live="polite" className="text-[12px] text-parchment-200">
          {status}
        </p>
      </div>
    </div>
  );
}

// useSearchParams needs a Suspense boundary during prerender, so the page is
// a thin wrapper around the real component.
export default function TvPage() {
  return (
    <Suspense fallback={null}>
      <TvView />
    </Suspense>
  );
}

function TvView() {
  // Watching is the surface zen suits best: there is nothing to click, so the
  // chrome is pure overhead. The site header and footer stand down globally
  // under html[data-zen], and the exit control is rendered by the header, so
  // this is only the key binding.
  useZenHotkey();
  const searchParams = useSearchParams();
  const rawMode = searchParams.get("mode");
  const modeFilter: DraftMode | null =
    rawMode === "nerf" || rawMode === "buff" ? rawMode : null;

  const { lobby, failed: lobbyFailed, reload: reloadLobby } = useLobbySnapshotStatus(5000);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // The live-game rail folds after a screenful: playtest feedback was that a
  // busy night made the page scroll "like 100 pages". Show-all is per-visit
  // and resets on a channel switch along with the pin.
  const [showAllGames, setShowAllGames] = useState(false);

  // Switching channels (All / Nerf / Buff) clears the pin so nothing from the
  // other pool lingers. The featured-tune hook resets its own selection + retry
  // state off the same `resetKey`, and the archive rerun resets itself off the
  // mode filter. Done on the change during render.
  const channelKey = modeFilter ?? "all";
  const [prevMode, setPrevMode] = useState(modeFilter);
  if (prevMode !== modeFilter) {
    setPrevMode(modeFilter);
    setPinnedId(null);
    setShowAllGames(false);
  }

  const liveGames = useMemo(() => {
    const games = lobby?.games ?? [];
    const filtered = modeFilter ? games.filter((g) => g.mode === modeFilter) : games;
    return orderLiveGames(filtered);
  }, [lobby, modeFilter]);
  // Eligible candidate ids in ranked order. A lobby game is listed only once it
  // is a watchable started game with both seats, so mode + rank is all the
  // directory-level filtering needed; the deeper "snapshot available + supported
  // version + subscribable" check happens as a real health check inside the tune.
  const candidateIds = useMemo(() => liveGames.map((g) => g.id), [liveGames]);

  // Featured selection + health-checked failover (shared with HeroTv). A pinned
  // pick is honored while eligible + healthy; anything that fails its health
  // check is retried with bounded backoff and then skipped in favor of the next
  // healthy game. `channelKey` fully resets it on a channel switch.
  const tune = useFeaturedTune(candidateIds, pinnedId, channelKey, {
    surface: "tv",
    filter: channelKey,
  });
  const { streamId, live, tuneState, slowTune } = tune;
  const pinnedStillLive = pinnedId != null && liveGames.some((g) => g.id === pinnedId);

  // The archive rerun channel: a random recently finished game (of this
  // channel's mode, if one is set) replayed move by move, then the next one.
  // It advances only while it actually holds the board (`replayOnAir`) — a
  // live tune pauses every rerun timer — but the pool fetch itself runs
  // regardless of the lobby snapshot so the fallback board is ready fast and
  // the empty state never blocks on the lobby. Falls back once a live tune has
  // genuinely failed OR is taking too long (past the short slow-tune
  // threshold) -- not during the first healthy second of connecting, so a good
  // tune-in doesn't flash the archive.
  const replayOnAir = !live && (tuneState !== "tuning" || slowTune);
  const replay = useArchiveReplay(replayOnAir, modeFilter);
  const showRecentFallback = replayOnAir && !!replay.game;

  const shownMoves = useMemo(
    () => (live ? tune.moves : showRecentFallback ? replay.moves : []),
    [live, tune.moves, showRecentFallback, replay.moves],
  );
  const { board, history } = useMemo(
    () => featuredBoard(live, shownMoves, tune.draft),
    [live, shownMoves, tune.draft],
  );
  const lastMove = history[history.length - 1] ?? null;

  const shownId = live ? streamId : showRecentFallback ? replay.game?.id ?? null : null;
  const shownPlayers = live ? tune.players : showRecentFallback ? replay.players : null;
  const shownLobbyGame = liveGames.find((g) => g.id === shownId);
  const over = tune.over;
  const isFinal = !live || over || showRecentFallback;
  const moveNumber = Math.max(1, Math.ceil(shownMoves.length / 2));
  // Live clocks beside each player, only once the stream has delivered an
  // authoritative value (clocks stays null until then; never a fake 0:00) and
  // only for the live stream, never the recent-replay fallback.
  const headerClocks = live ? tune.clocks : null;
  const clockTurn: Color | null = live && !over ? board.turn : null;
  // Show a small, nonblocking failover notice: the current candidate failed its
  // health check but the directory is still updating and we are moving on.
  const failoverNotice = tuneState === "failed" || (tuneState === "tuning" && slowTune && !shownPlayers);

  const title = modeFilter === "nerf" ? "Nerf TV" : modeFilter === "buff" ? "Buff TV" : "Nerf Chess TV";
  const channels: { href: string; label: string; active: boolean }[] = [
    { href: "/tv", label: "All", active: modeFilter === null },
    { href: "/tv?mode=nerf", label: "Nerf", active: modeFilter === "nerf" },
    { href: "/tv?mode=buff", label: "Buff", active: modeFilter === "buff" },
  ];

  // Prev / next healthy game: navigate the ranked live list, skipping any
  // candidate currently marked unhealthy, wrapping around. A manual pick clears
  // that game's stale "unhealthy" mark so it gets a fresh set of health-check
  // retries (identical to a list click).
  const healthyIds = useMemo(
    () => candidateIds.filter((id) => !tune.failedIds.has(id)),
    [candidateIds, tune.failedIds],
  );
  const canNavigate = healthyIds.length > 1;
  const pickGame = (id: string) => {
    tune.clearFailed(id);
    setPinnedId(id);
  };
  const stepGame = (dir: 1 | -1) => {
    if (healthyIds.length === 0) return;
    const cur = shownId && healthyIds.includes(shownId) ? healthyIds.indexOf(shownId) : -1;
    const next = healthyIds[(cur + dir + healthyIds.length) % healthyIds.length];
    if (next) pickGame(next);
  };

  // Escape / disappearance exits fullscreen. Clamped during render so the
  // overlay never lingers over an absent board.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);
  const hasBoard = !!(shownId && shownPlayers);
  if (fullscreen && !hasBoard) setFullscreen(false);

  const liveBadge = (
    <span className="inline-flex items-center gap-1.5 rounded-none border border-[rgb(var(--pos-rgb)/0.4)] bg-[rgb(var(--pos-rgb)/0.12)] px-2 py-0.5 text-[12px] font-semibold text-[rgb(var(--pos-rgb))]">
      <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--pos-rgb))] animate-flicker" aria-hidden />
      Live
    </span>
  );
  const finalBadge = (
    <span className="inline-flex items-center rounded-none border border-[color:var(--edge-strong)] bg-[color:var(--bg-zebra)] px-2 py-0.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-parchment-300">
      Final
    </span>
  );
  // The rerun marker: the LIVE badge's shape in the ember tint, so an archived
  // replay can never be mistaken for a running game.
  const replayBadge = (
    <span className="inline-flex items-center gap-1.5 rounded-none border border-[rgb(var(--energy-ember-rgb)/0.4)] bg-[rgb(var(--energy-ember-rgb)/0.12)] px-2 py-0.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--energy-ember-rgb))]">
      <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--energy-ember-rgb))]" aria-hidden />
      Replay
    </span>
  );

  const metaChips = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-parchment-400">
      {hasBoard && (showRecentFallback ? replayBadge : isFinal ? finalBadge : liveBadge)}
      <ModeBadge mode={shownLobbyGame?.mode ?? (showRecentFallback ? replay.mode ?? undefined : undefined)} />
      {showRecentFallback && <span>from the archive</span>}
      {shownLobbyGame && (
        <span className="tabular-nums">{clockLabel(shownLobbyGame.timeSec, shownLobbyGame.incrementSec)}</span>
      )}
      {shownLobbyGame && <span>{shownLobbyGame.rated ? "Rated" : "Casual"}</span>}
      {hasBoard && <span className="tabular-nums">Move {moveNumber}</span>}
      {shownLobbyGame && shownLobbyGame.watchers > 0 && (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Eye size={13} aria-hidden /> {shownLobbyGame.watchers}
        </span>
      )}
    </div>
  );

  // One player row per color, placed to match the board's orientation
  // (white plays up from the bottom): black hugs the top edge, white the
  // bottom — the same convention as playing a game, instead of both players
  // sharing one header line.
  const seatRow = (color: "w" | "b") =>
    shownPlayers ? (
      <div className="flex items-center justify-between gap-2 py-1">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span
            className={
              "h-2.5 w-2.5 shrink-0 rounded-full " +
              (color === "w"
                ? "border border-black/40 bg-[#e8e6e1]"
                : "border border-[color:var(--edge-strong)] bg-[#1a1a22]")
            }
            aria-hidden
          />
          <PlayerIdentity
            name={shownPlayers[color].name}
            rating={shownPlayers[color].rating}
            avatar={shownPlayers[color].avatar}
            provisional={shownPlayers[color].provisional}
            strong
          />
        </span>
        {headerClocks && (
          <ClockPill ms={headerClocks[color]} active={clockTurn === color} compact />
        )}
      </div>
    ) : null;

  // The board region, always in the same aspect-square footprint: the live/replay
  // board, the designed empty state, or a board-shaped skeleton with a status
  // line (never a spinner page).
  let boardRegion: React.ReactNode;
  if (hasBoard) {
    boardRegion = (
      <div className="relative">
        <HeroBoard board={board} lastMove={lastMove} />
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label="Watch fullscreen"
          className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-none border border-[color:var(--edge-strong)] bg-[color:var(--bg-base)] text-parchment-200 transition-colors hover:border-[color:var(--edge-strong)] hover:text-gold-leaf"
        >
          <Maximize2 size={16} aria-hidden />
        </button>
        {failoverNotice && (
          <p
            role="status"
            aria-live="polite"
            className="absolute inset-x-0 top-0 bg-ink-900/75 px-3 py-1.5 text-center text-[12px] text-parchment-200"
          >
            Couldn&apos;t tune in to that game. Showing another; the list keeps updating.
          </p>
        )}
      </div>
    );
  } else if (lobbyFailed) {
    // The lobby poller is in its failed state: the featured panel shows the
    // SAME unreachable-error framing as the rail (never a false "no games are
    // live" claim), with a Retry that reuses the rail's reload. The empty state
    // below is reserved for a HEALTHY poller that returned zero games.
    boardRegion = (
      <div role="alert" className="grid aspect-square w-full place-items-center plate p-6">
        <div className="flex max-w-sm flex-col items-center text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-[color:var(--edge-strong)] bg-[color:var(--bg-zebra)]">
            <Radio size={40} className="text-parchment-400" aria-hidden />
          </div>
          <p className="mt-4 text-[15px] font-display font-semibold text-parchment-100">
            Can&apos;t reach the game server, so the live game can&apos;t load.
          </p>
          <button
            type="button"
            onClick={reloadLobby}
            className="mt-5 inline-flex min-h-[44px] items-center rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] px-4 py-2 font-display text-[13px] font-medium text-parchment-200 transition-colors hover:bg-[color:var(--bg-raised)] hover:text-parchment-100 sm:min-h-[36px]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  } else if (tuneState === "empty" && replay.checked && !replay.game) {
    boardRegion = (
      <div className="grid aspect-square w-full place-items-center plate p-6">
        <div className="flex max-w-sm flex-col items-center text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-[color:var(--edge-strong)] bg-[color:var(--bg-zebra)]">
            <Piece type="n" color="w" size={44} />
          </div>
          <p className="mt-4 text-[15px] font-display font-semibold text-parchment-100">
            No {modeFilter ? (modeFilter === "nerf" ? "Nerf " : "Buff ") : ""}games are live right now.
          </p>
          <p className="mt-1 text-[13px] text-parchment-400">
            Start one and it shows up here for everyone to watch.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <LinkButton tone="leaf"
              href="/lobby"
              className="px-4 py-2 text-[13px] font-semibold sm:min-h-[36px]">
              Find a match
            </LinkButton>
            <LinkButton tone="ghost"
              href="/play"
              className="px-4 py-2 text-[13px] sm:min-h-[36px]">
              Play a bot
            </LinkButton>
          </div>
        </div>
      </div>
    );
  } else if (failoverNotice || (tuneState === "tuning" && slowTune)) {
    boardRegion = (
      <TvBoardSkeleton status="Couldn't tune in. Trying the next healthy game automatically…" />
    );
  } else {
    boardRegion = <TvBoardSkeleton status="Tuning in…" />;
  }

  return (
    <main className="min-h-screen">
      <SiteHeader active="/tv" />
      <section className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,592px)_320px] lg:justify-center">
          {/* Featured game */}
          <div className="min-w-0">
            <div className="plate p-3 sm:p-4">
              {/* Header row: identity units + controls */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-2">
                  {/* Identities moved to per-color rows hugging the board
                      (black above, white below, matching the board's
                      orientation) — the header keeps only the meta chips. */}
                  {!shownPlayers && (
                    <h1 className="flex items-center gap-2 font-display text-[15px] font-semibold text-parchment-50">
                      <Radio size={16} className="text-gold-leaf" aria-hidden /> {title}
                    </h1>
                  )}
                  {metaChips}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => stepGame(-1)}
                    disabled={!canNavigate}
                    aria-label="Previous live game"
                    className="grid h-9 w-9 place-items-center rounded-none border border-[color:var(--edge)] text-parchment-200 transition-colors hover:border-[color:var(--edge-strong)] hover:text-gold-leaf disabled:opacity-35 disabled:hover:border-[color:var(--edge)] disabled:hover:text-parchment-200"
                  >
                    <ChevronLeft size={18} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepGame(1)}
                    disabled={!canNavigate}
                    aria-label="Next live game"
                    className="grid h-9 w-9 place-items-center rounded-none border border-[color:var(--edge)] text-parchment-200 transition-colors hover:border-[color:var(--edge-strong)] hover:text-gold-leaf disabled:opacity-35 disabled:hover:border-[color:var(--edge)] disabled:hover:text-parchment-200"
                  >
                    <ChevronRight size={18} aria-hidden />
                  </button>
                </div>
              </div>

              {/* Board, framed by the per-color player rows */}
              <div className="mx-auto mt-3 w-full max-w-[560px]">
                {seatRow("b")}
                {boardRegion}
                {seatRow("w")}
              </div>

              {/* Below-board bar: only rendered when a board is actually
                  showing. The "Featuring the most-watched live game" caption
                  must never sit under an empty or error state (it would make a
                  false "there is a game" claim). */}
              {hasBoard && (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-[12px] text-parchment-400">
                    {pinnedStillLive && streamId === pinnedId
                      ? "You pinned this game."
                      : live
                        ? "Featuring the most-watched live game."
                        : "Rerun from the archive. A live game takes over when one starts."}
                  </span>
                  {shownId && (
                    <Link
                      href={`/game/${shownId}`}
                      className="shrink-0 font-display text-[13px] text-gold-leaf transition hover:underline"
                    >
                      {live && !over ? "Open with chat →" : "Open replay →"}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Rail */}
          <aside className="flex flex-col gap-4">
            {/* Channel segmented control */}
            <div
              role="group"
              aria-label="TV channel"
              className="flex items-stretch gap-1 rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-base)] p-1"
            >
              {channels.map((channel) => (
                <Link
                  key={channel.href}
                  href={channel.href}
                  aria-current={channel.active ? "page" : undefined}
                  className={
                    "flex-1 rounded-none px-3 py-1.5 text-center font-display text-[13px] font-semibold transition-colors " +
                    (channel.active
                      ? "bg-[rgb(var(--accent-rgb)/0.16)] text-gold-leaf"
                      : "text-parchment-400 hover:bg-[color:var(--bg-raised)] hover:text-parchment-100")
                  }
                >
                  {channel.label}
                </Link>
              ))}
            </div>

            {/* Live game list */}
            <div className="plate">
              <div className="flex items-center justify-between border-b border-[color:var(--edge)] px-3 py-2.5">
                <span className="text-parchment-400">Live games</span>
                {liveGames.length > 0 && (
                  <span className="font-mono text-[12px] tabular-nums text-parchment-400">
                    {liveGames.length}
                  </span>
                )}
              </div>
              {!lobby ? (
                lobbyFailed ? (
                  /* Server unreachable and nothing cached: a plain error with a
                     Retry, never a skeleton that spins forever. */
                  <div role="alert" className="space-y-2 p-3">
                    <p className="text-[13px] text-parchment-300">
                      Can&apos;t reach the game server, so the live list isn&apos;t available.
                    </p>
                    <button
                      type="button"
                      onClick={reloadLobby}
                      className="rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] px-3 py-1.5 text-[12px] font-medium text-parchment-200 transition-colors hover:bg-[color:var(--bg-raised)] hover:text-parchment-100"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  /* First snapshot still loading: shimmer instead of a premature
                     "nothing live" that flashes and then fills in. */
                  <div className="space-y-2 p-3" aria-label="Loading live games">
                    <div className="skeleton h-12 w-full" />
                    <div className="skeleton h-12 w-full" />
                    <div className="skeleton h-12 w-3/4" />
                  </div>
                )
              ) : liveGames.length === 0 ? (
                <div className="px-3 py-4 text-[13px] text-parchment-400">
                  <p>Nothing live in this channel right now.</p>
                  {/* A filtered channel can be empty while the other pool is
                      busy; say so, so "no live games" never reads as "the site
                      is dead" when it is only the filter. */}
                  {modeFilter && (lobby?.games.length ?? 0) > 0 && (
                    <Link href="/tv" className="mt-1 inline-block text-gold-leaf hover:underline">
                      {lobby!.games.length} live in all channels →
                    </Link>
                  )}
                </div>
              ) : (
                <ul className="max-h-[34rem] divide-y divide-[color:var(--edge)] overflow-y-auto">
                  {(showAllGames ? liveGames : liveGames.slice(0, TV_LIST_FOLD)).map((g: MPLobbyGame) => {
                    const selected = g.id === shownId;
                    return (
                      <li key={g.id} className="relative">
                        {selected && (
                          <span
                            className="absolute inset-y-0 left-0 w-0.5 bg-gold-leaf"
                            aria-hidden
                          />
                        )}
                        <button
                          onClick={() => pickGame(g.id)}
                          aria-current={selected ? "true" : undefined}
                          className={
                            "block w-full px-3 py-2.5 text-left transition-colors " +
                            (selected
                              ? "bg-[var(--surface-raise)]"
                              : "hover:bg-[var(--surface-hover)]")
                          }
                        >
                          <div className="flex items-center gap-2">
                            <PlayerIdentity
                              name={g.players.w.name}
                              rating={g.players.w.rating}
                              avatar={g.players.w.avatar}
                              provisional={g.players.w.provisional}
                              size={22}
                            />
                            <span className="shrink-0 text-[12px] text-parchment-500">vs</span>
                            <PlayerIdentity
                              name={g.players.b.name}
                              rating={g.players.b.rating}
                              avatar={g.players.b.avatar}
                              provisional={g.players.b.provisional}
                              size={22}
                            />
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-[30px] text-[12px] text-parchment-400">
                            <ModeBadge mode={g.mode} />
                            <span className="tabular-nums">{clockLabel(g.timeSec, g.incrementSec)}</span>
                            <span className="tabular-nums">move {Math.max(1, Math.ceil(g.moves / 2))}</span>
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Eye size={12} aria-hidden /> {g.watchers}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {lobby && !showAllGames && liveGames.length > TV_LIST_FOLD && (
                <button
                  type="button"
                  onClick={() => setShowAllGames(true)}
                  className="block w-full border-t border-[color:var(--edge)] px-3 py-2.5 text-center text-[13px] font-medium text-parchment-300 transition-colors hover:bg-[var(--surface-hover)] hover:text-parchment-100"
                >
                  Show all {liveGames.length} games
                </button>
              )}
            </div>
          </aside>
        </div>
      </section>

      {/* Fullscreen overlay: the board scaled to the viewport. Escape or the
          button exits. A CSS fixed overlay (no, per the system). */}
      {fullscreen && hasBoard && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto overscroll-contain bg-ink-900/95 p-4">
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            aria-label="Exit fullscreen"
            className="absolute right-4 top-4 grid h-[44px] w-[44px] place-items-center rounded-none border border-[color:var(--edge-strong)] bg-[color:var(--bg-base)] text-parchment-100 transition-colors hover:border-[color:var(--edge-strong)] hover:text-gold-leaf"
          >
            <X size={20} aria-hidden />
          </button>
          {/* dvh so the board is capped against the SMALL viewport, the same box
              the `fixed inset-0` parent occupies. With vh (the large viewport)
              the board plus both seat rows overflowed a portrait phone showing
              its URL bar, and the parent is a `grid place-items-center` with no
              overflow, so the bottom seat row was simply clipped away. */}
          <div className="flex w-full max-w-[min(92vw,82dvh)] flex-col gap-1">
            {seatRow("b")}
            <div className="w-full">
              <HeroBoard board={board} lastMove={lastMove} />
            </div>
            {seatRow("w")}
          </div>
        </div>
      )}
    </main>
  );
}
