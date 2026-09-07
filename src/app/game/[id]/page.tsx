"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { Board, NERF_REVEAL_SKIP, type NerfRevealInfo } from "@/components/Board";
import { computeFxVisual, fxVisualFields } from "@/components/effects/fxZones";
import { stashGamblingOutcome } from "@/components/effects/gamblingOutcome";
import { useSignatureQueue } from "@/components/effects/useSignatureQueue";
import { BoardPlayerRow } from "@/components/BoardPlayerRow";
import { ClockPill } from "@/components/ClockPill";
import { ModeBadge } from "@/components/ModeBadge";
import { ProvisionalMark } from "@/components/ratings/ProvisionalMark";
import { ConnectionBanner } from "@/components/ConnectionBanner";
// Code-split, matching OnlineMatch: the end screen is never part of first
// paint. Importing it statically here defeated that split entirely, because
// this page is the only place OnlineMatch is mounted, so GameOver (and the card
// library it pulls) landed in the eager chunk anyway. The type import stays
// static: types are erased at build time and cost nothing.
import type { TimelineCardEvent } from "@/components/GameOver";

const GameOver = dynamic(() => import("@/components/GameOver").then((m) => m.GameOver), {
  ssr: false,
});
import { MoveList } from "@/components/MoveList";
import { OnlineMatch } from "@/components/OnlineMatch";
import { CompactSiteHeader } from "@/components/SiteHeader";
import { useZenHotkey } from "@/lib/useZenMode";
import { moveFromUCI, moveToUCI } from "@/engine/board";
import { BUFF_BY_ID } from "@/engine/buffs/library";
import { NerfGame, legalMoves } from "@/engine/game";
import { Nerf } from "@/engine/nerf";
import { IMPLEMENTED_BY_ID } from "@/engine/nerfs/library";
import { Color } from "@/engine/types";
import { arenaSocketUrl, isArenaGameId, isArenaGameLive } from "@/lib/arenaLobby";
import {
  applyDraftAction,
  buildSpectatorDraftGame,
  buildSpectatorDraftGameAtPly,
  cardEventsFromDtActions,
  draftZones,
  mergeDraftState,
  playReplicaMove,
  revealHeldBuffs,
} from "@/lib/draftOnline";
import { TIER_ROMAN } from "@/lib/tiers";
import { boardAtPly, replayUci } from "@/lib/gameReview";
import { timeControlLabel } from "@/lib/gameHistory";
import { gameToPGN } from "@/lib/pgn";
import {
  clearActiveGame,
  clearOnlineSeat,
  loadOnlineSeat,
  loadSavedFriendSession,
  MPDraftAction,
  MPDraftCard,
  MPPlayers,
  MPSession,
  MPSpectatorChatMessage,
  MPStart,
  MPWatchStart,
  saveOnlineSeat,
  type MPEvent,
  type SpectatorEnvelope,
} from "@/lib/multiplayer";
import {
  beginWatch,
  createSpectatorSync,
  routeSpectatorBaseline,
  routeSpectatorLiveFrame,
  spectatorBaselineEnvelope,
  sweepSpectatorSync,
} from "@/lib/spectate/spectatorSync";
import type { DraftMode } from "@/engine/buff";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

type Mode =
  | { kind: "loading" }
  | { kind: "waiting" } // seated, opponent hasn't arrived yet
  | { kind: "player"; start: MPStart }
  | { kind: "spectator"; setup: MPWatchStart }
  | { kind: "replay"; game: ReplayGame }
  | { kind: "missing" }
  | { kind: "error"; message: string };

interface ReplayGame {
  id: string;
  white_name: string;
  black_name: string;
  white_nerf_id: string;
  black_nerf_id: string;
  time_sec: number;
  increment_sec: number;
  moves: string;
  winner: Color | "draw" | null;
  reason: string;
  rated: number;
  white_rating_before: number | null;
  white_rating_after: number | null;
  black_rating_before: number | null;
  black_rating_after: number | null;
  started_at: number;
  completed_at: number;
  // Draft games only: the spectator-safe public action stream from the archived
  // draft record, so the replay reconstructs board rewrites exactly like a live
  // spectator. Absent for classic games and legacy (recordless) rows, which keep
  // the moves-only replay + truncation notice.
  dtActions?: MPDraftAction[];
  mode?: DraftMode;
}

function withResponseTimeout<T>(promise: Promise<T>, message: string, ms = 10000): Promise<T> {
  let timeoutId = 0;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

// How long a viewer lingers on the "this game is over" screen before being
// eased back to the lobby automatically.
const REDIRECT_SECONDS = 6;

// Lichess-style game URL: the player who owns a seat token plays here; anyone
// else watches live, or gets the stored replay once the game has been archived.
export default function OnlineGamePage() {
  // Zen mode: `z` hides the social chrome (spectator list, chat, share extras)
  // and leaves the board, the clocks and the move list.
  useZenHotkey();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const gameId = String(params.id ?? "").toUpperCase();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  // Bumped whenever a reconnect replays the spectator state, so the viewer
  // remounts with the fresh payload.
  const [watchGen, setWatchGen] = useState(0);
  // Seconds left before a viewer stranded on a game that has ended / gone dark
  // is eased back to the lobby (see the `missing` effect + view below).
  const [redirectIn, setRedirectIn] = useState(REDIRECT_SECONDS);
  // Held as state (not a ref) because the render below chooses the view from
  // it; a ref cannot drive rendering. Set inside the effect once the session
  // exists, cleared on teardown.
  const [liveSession, setLiveSession] = useState<MPSession | null>(null);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    const session = new MPSession();
    session.persistFriendSession = false;
    // The session actually being rendered. The not_found fallback below may
    // swap in an arena-pointed session (Tier 3); teardown destroys whichever
    // one is current.
    let active: MPSession = session;
    queueMicrotask(() => {
      if (!cancelled) setLiveSession(session);
    });

    // Fetch the archived game once, returning it (or null if it is not stored).
    // Kept separate from rendering so the request can be kicked off in parallel
    // with the live-watch attempt and awaited later.
    const fetchReplay = async (): Promise<ReplayGame | null> => {
      try {
        const res = await fetch(`/api/games/${gameId}`);
        if (res.ok) return ((await res.json()) as { game: ReplayGame }).game ?? null;
      } catch {}
      return null;
    };

    // Render the stored replay, reusing a fetch already in flight when one was
    // started in parallel with the watch attempt.
    const showReplay = async (pending?: Promise<ReplayGame | null>) => {
      let game = await (pending ?? fetchReplay());
      if (cancelled) return;
      // A game that has only just ended (the common reason a live watch drops
      // to "not_found") may not be archived for a second or two. Rather than
      // flash "not found" at the viewer, give the write a brief beat and look
      // once more before deciding the game is truly gone.
      if (!game) {
        await new Promise((r) => window.setTimeout(r, 2500));
        if (cancelled) return;
        game = await fetchReplay();
        if (cancelled) return;
      }
      setMode(game ? { kind: "replay", game } : { kind: "missing" });
    };

    // Any watch payload (initial or after an automatic reconnect) refreshes
    // the spectator view with the server's replayed state.
    const onWatchEvent = (e: Parameters<Parameters<MPSession["on"]>[0]>[0]) => {
      if (cancelled) return;
      if (e.type === "watch-start") {
        setWatchGen((g) => g + 1);
        setMode({ kind: "spectator", setup: e.setup });
      }
    };
    const offWatch = session.on(onWatchEvent);

    const spectate = async (pendingReplay?: Promise<ReplayGame | null>, s: MPSession = session) => {
      try {
        await withResponseTimeout(s.watch(gameId), "watch_timeout", 15000);
      } catch (e) {
        if (e instanceof Error && e.message === "not_found") {
          // Tier 3: a live arena-hosted (OCI bot-vs-bot) game is unknown to the
          // game-server DO. Before treating not_found as "finished, show the
          // archive", ask the arena — a direct link to a live filler game then
          // watches it instead of flashing "not found". Fail-soft: an
          // unreachable arena answers false and the archive path runs as ever.
          if (!s.serverUrl && arenaSocketUrl() && (await isArenaGameLive(gameId))) {
            s.destroy();
            if (cancelled) return;
            const arenaSession = new MPSession();
            arenaSession.persistFriendSession = false;
            arenaSession.serverUrl = arenaSocketUrl();
            arenaSession.on(onWatchEvent);
            active = arenaSession;
            if (!cancelled) setLiveSession(arenaSession);
            await spectate(pendingReplay, arenaSession);
            return;
          }
          s.destroy();
          await showReplay(pendingReplay);
        } else if (e instanceof Error && e.message === "watch_timeout") {
          await showReplay(pendingReplay);
        } else if (!cancelled) {
          setMode({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        }
      }
    };

    // Friend games persist their credentials under the friend-session key;
    // accept those too so a seat holder always reclaims their seat here.
    const friendSaved = loadSavedFriendSession();
    const seat =
      loadOnlineSeat(gameId) ??
      (friendSaved?.id === gameId ? { color: friendSaved.color, token: friendSaved.token } : null);
    if (seat) {
      const off = session.on((e) => {
        if (cancelled) return;
        if (e.type === "start") {
          setMode({ kind: "player", start: e.setup });
        } else if (e.type === "open") {
          setMode({ kind: "waiting" });
        } else if (e.type === "rematched") {
          // The server re-delivers the rematch seat on resume (e.g. after a
          // refresh mid-rematch). Handle it here too: the frame can arrive
          // before OnlineMatch has mounted and subscribed.
          saveOnlineSeat(e.id, { color: e.color, token: e.token });
          window.location.href = `/game/${e.id}`;
        }
      });
      // Resume the seat; transient connection failures retry with backoff,
      // and only a server-side refusal downgrades us to spectating. We hold a
      // valid seat token, so keep retrying persistently: a downgrade to
      // spectating our OWN game strands us watching a board we should be
      // playing (and, in a bot game, leaves the bot guard-held/frozen because
      // our seat reads as disconnected). The game server can briefly reject or
      // time out a resume during a load spike / reset, so give it several
      // chances (capped backoff) before giving up; only an explicit
      // reconnect_failed (seat truly gone/archived) downgrades immediately.
      const MAX_RESUME_ATTEMPTS = 6;
      const tryResume = (attempt: number) => {
        withResponseTimeout(
          session.resume({ id: gameId, color: seat.color, token: seat.token }),
          "resume_timeout",
          9000,
        )
          .catch((err) => {
            if (cancelled) return;
            if (err instanceof Error && err.message === "reconnect_failed") {
              // Seat expired (game archived or gone) — fall back to watching.
              off();
              clearOnlineSeat(gameId);
              spectate();
              return;
            }
            if (attempt < MAX_RESUME_ATTEMPTS) {
              // Backoff ~1.2s, 2.4s, 3.6s… capped at 5s.
              const delay = Math.min(5000, 1200 * (attempt + 1));
              window.setTimeout(() => {
                if (!cancelled) tryResume(attempt + 1);
              }, delay);
            } else {
              off();
              spectate();
            }
          });
      };
      tryResume(0);
    } else {
      // Not our seat: watch the live game, but start the archived-replay fetch
      // in parallel. A finished game (the common case for links from history,
      // the hero "Replay", or a lobby row of a game that just ended) then
      // renders the moment the server answers "not_found", instead of waiting
      // for a second, serial HTTP round-trip afterward. For a live game the
      // extra request just resolves to null and is discarded.
      //
      // Tier 3: arena-hosted (OCI bot-vs-bot) games spectate on the arena's
      // socket, not the DO. Lobby/TV links tag them (?src=arena); the cached
      // arena snapshot covers untagged client-side navigations; and a cold
      // direct link is caught by the not_found fallback inside spectate.
      const taggedArena = new URLSearchParams(window.location.search).get("src") === "arena";
      if (arenaSocketUrl() && (taggedArena || isArenaGameId(gameId))) {
        session.serverUrl = arenaSocketUrl();
      }
      spectate(fetchReplay());
    }

    return () => {
      cancelled = true;
      offWatch();
      // `active` may have been swapped for an arena-pointed session by the
      // not_found fallback above — destroy whichever is current.
      active.destroy();
      setLiveSession(null);
    };
  }, [gameId]);

  // When a spectated game turns out to be over (or its live broadcast dropped
  // and it was never saved), don't leave the viewer staring at a dead end —
  // count down and gently send them to the lobby, with manual buttons meanwhile
  // for anyone who wants to go home or jump straight to another game.
  // Restart the countdown the moment a game is found missing; adjusted during
  // render so the effect below only owns the interval.
  const isMissing = mode.kind === "missing";
  const [prevMissing, setPrevMissing] = useState(isMissing);
  if (prevMissing !== isMissing) {
    setPrevMissing(isMissing);
    if (isMissing) setRedirectIn(REDIRECT_SECONDS);
  }

  // A connect/seat handshake that never resolves must not leave the viewer on
  // an endless "Connecting…" / "Waiting for your opponent…" skeleton. After
  // ~10s, surface a retry + back-to-lobby affordance so the wait is escapable.
  const [slowConnect, setSlowConnect] = useState(false);
  useEffect(() => {
    // queueMicrotask keeps the reset off the synchronous effect body (the same
    // pattern the redirect/countdown effects here use to avoid cascading renders).
    queueMicrotask(() => setSlowConnect(false));
    if (mode.kind !== "loading" && mode.kind !== "waiting") return;
    const id = window.setTimeout(() => setSlowConnect(true), 10000);
    return () => window.clearTimeout(id);
  }, [mode.kind]);

  useEffect(() => {
    if (mode.kind !== "missing") return;
    // The countdown state and the navigation are kept SEPARATE. Driving the
    // redirect from inside a setState updater made the updater impure — React
    // may invoke it twice (StrictMode, or a render discarded before commit),
    // which fires the navigation twice. The updater now only decrements; the
    // effect below owns the one-shot navigation.
    const tick = window.setInterval(() => {
      setRedirectIn((s) => (s <= 0 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [mode.kind]);

  useEffect(() => {
    if (mode.kind !== "missing" || redirectIn > 0) return;
    // router.replace, not window.location.href: this keeps the SPA alive (no
    // full document reload) and does not push a history entry the viewer would
    // have to click Back through twice.
    router.replace("/lobby");
  }, [mode.kind, redirectIn, router]);

  if (mode.kind === "player" && liveSession) {
    return (
      <OnlineMatch
        session={liveSession}
        start={mode.start}
        subtitle={
          mode.start.rated
            ? `rated ${timeControlLabel(mode.start.timeSec, mode.start.incrementSec)}`
            : `game ${gameId}`
        }
        onExit={() => {
          clearOnlineSeat(gameId);
          clearActiveGame(gameId);
          window.location.href = "/play";
        }}
      />
    );
  }

  if (mode.kind === "spectator" && liveSession) {
    return <SpectatorView key={watchGen} session={liveSession} setup={mode.setup} />;
  }

  if (mode.kind === "replay") {
    return <ReplayView game={mode.game} />;
  }

  if (mode.kind === "loading" || mode.kind === "waiting") {
    // Paint the real board frame straight away so connecting reads as "the
    // game is loading", not a frozen page. The skeleton mirrors GameShell's
    // layout so the swap to the live board when `start`/`watch-start` arrives
    // is a fill-in, not a jump.
    return (
      <main className="min-h-screen">
        <SiteNav />
        {/* Every terminal branch below has an h1; this one did not, so a game
            that is slow to resolve (or an id with no game behind it, which
            sits here until the socket gives up) served a page with no
            accessible name and no document outline. Same shape as C34 on
            /u/[username]. sr-only because the visible chrome here is a
            skeleton and a real heading would be a jump when the board fills
            in. */}
        <h1 className="sr-only">Game</h1>
        <div className="mx-auto w-full max-w-[1200px] px-3 pb-10 sm:px-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[12px] text-parchment-400">
              {mode.kind === "waiting" ? "Waiting for your opponent…" : "Connecting…"}
            </div>
            <div className="font-mono text-[12px] tracking-[0.2em] text-gold-leaf">{gameId}</div>
          </div>
          {slowConnect && (
            <div
              role="status"
              aria-live="polite"
              className="mb-3 plate flex flex-wrap items-center justify-between gap-3 border-gold/40 bg-gold/10 p-2 px-3"
            >
              <span className="text-xs text-parchment-200">
                {mode.kind === "waiting"
                  ? "Still waiting for your opponent to arrive."
                  : "This is taking longer than usual to connect."}
              </span>
              <div className="flex items-center gap-2">
                <Button tone="leaf"
                 
                  onClick={() => window.location.reload()}
                  className="px-3 py-1.5 text-xs font-semibold">
                  Retry
                </Button>
                <Link
                  href="/lobby"
                  className="min-h-[36px] inline-flex items-center rounded-sm border border-parchment-700 px-3 py-1.5 font-display text-[13px] text-parchment-200 hover:text-parchment-50"
                >
                  Back to lobby
                </Link>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 py-1">
                <span className="skeleton h-6 w-40" aria-hidden />
                <span className="skeleton h-6 w-14" aria-hidden />
              </div>
              <div className="w-full max-w-[720px]">
                <BoardSkeleton />
              </div>
              <div className="flex items-center justify-between gap-2 py-1">
                <span className="skeleton h-6 w-40" aria-hidden />
                <span className="skeleton h-6 w-14" aria-hidden />
              </div>
            </div>
            <div className="sm:w-64 sm:shrink-0">
              <div className="skeleton h-64 w-full xl:h-72" aria-hidden />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (mode.kind === "missing") {
    return (
      <main className="min-h-screen">
        <SiteNav />
        <section className="max-w-xl mx-auto px-6 py-16 text-center">
          <h1 className="page-title">That game has wrapped up</h1>
          <p className="mt-3 text-parchment-200">
            It&apos;s no longer live and we couldn&apos;t find a saved copy: the
            match likely just finished, or the broadcast ended. Taking you back
            to the lobby in {redirectIn}s&hellip;
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <LinkButton tone="leaf" href="/tv" className="inline-block px-5 py-2 font-body">
              Watch another game
            </LinkButton>
            <Link
              href="/"
              className="inline-block px-5 py-2 rounded-sm border border-parchment-700 font-body text-parchment-200 hover:text-parchment-50"
            >
              Home
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <SiteNav />
      <section className="max-w-xl mx-auto px-6 py-16 text-center">
        <h1 className="page-title">Something interrupted the game</h1>
        <p className="mt-3 text-parchment-200">
          {mode.kind === "error"
            ? mode.message
            : "This game doesn't exist, or it hasn't been played yet."}
        </p>
        <LinkButton tone="leaf" href="/lobby" className="inline-block mt-8 px-5 py-2 font-body">
          Back to the lobby
        </LinkButton>
      </section>
    </main>
  );
}

// A quiet checkered board frame with a shimmer sweep, shown while a game
// connects. Same 8x8 grid and square colors as the live board so it holds the
// exact footprint the real Board will fill.
function BoardSkeleton() {
  return (
    <div className="relative aspect-square w-full overflow-hidden border border-[color:var(--edge)]">
      <div className="grid h-full w-full grid-cols-8 grid-rows-8" aria-hidden>
        {Array.from({ length: 64 }).map((_, i) => {
          const isLight = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
          return <div key={i} className={isLight ? "sq-light" : "sq-dark"} />;
        })}
      </div>
      <div className="skeleton absolute inset-0" aria-hidden />
    </div>
  );
}

// ---------------- live spectator ----------------

function SpectatorView({ session, setup }: { session: MPSession; setup: MPWatchStart }) {
  const [uciMoves, setUciMoves] = useState<string[]>(setup.moves);
  const [whiteMs, setWhiteMs] = useState(setup.wc);
  const [blackMs, setBlackMs] = useState(setup.bc);
  const [result, setResult] = useState(setup.result);
  const [nerfs, setNerfs] = useState<Partial<Record<Color, string>> | null>(setup.nerfs ?? null);
  const [watchers, setWatchers] = useState(setup.watchers ?? 1);
  const [watcherNames, setWatcherNames] = useState<string[]>(setup.watcherNames ?? []);
  const [spectatorChat, setSpectatorChat] = useState<MPSpectatorChatMessage[]>(setup.spectatorChat ?? []);
  const [reconnecting, setReconnecting] = useState(false);
  const [historyPly, setHistoryPly] = useState<number | null>(null);
  // Once the game is over, watchers get the same result panel the players do
  // (in neutral spectator mode); dismissing it drops back to the live board,
  // with a "Show result" button to bring it back.
  const [showResult, setShowResult] = useState(true);
  // Draft games keep an engine replica so buff board mutations (summons,
  // removals) and zone effects render correctly. The wstart payload is
  // spectator-safe: held buffs and effects only, never pending offers.
  const isDraft = !!setup.draft;
  const [draftGame, setDraftGame] = useState<NerfGame | null>(() => {
    if (!isDraft) return null;
    return buildSpectatorDraftGame(setup.moves, setup.dtActions ?? [], setup.dtState, setup.mode);
  });
  // Mirrors draftGame as the mutable replica the event handlers advance in
  // place; seeded from the same initial object (useRef init, not a render write).
  const draftGameRef = useRef<NerfGame | null>(draftGame);
  // The public draft-action record, seeded from the wstart and appended as
  // events arrive. Kept so history review can reconstruct any PAST ply through
  // the engine (moves + actions interleaved), which reproduces board rewrites a
  // plain move-replay cannot — so review works past a divergence instead of
  // locking. State (not a ref) so the reviewed-board memo below recomputes.
  const [dtActions, setDtActions] = useState<MPDraftAction[]>(() =>
    setup.dtActions ? [...setup.dtActions] : [],
  );
  // Card-use animation for watchers: a monotonic key fires the Board's
  // board-wide flourish whenever a card is used (an activation, or a
  // held/passive card whose move-hook changed the board), so spectators see
  // the same effects the players do. Bespoke signatures get their choreography
  // and every other card gets the category cast spectacle.
  // Watchers get the same serialized play queue as the players: several cards
  // triggered by one move each step out their own spectacle (R9/R10).
  const { signatureCard, fire: fireSigQueued } = useSignatureQueue();
  // Deterministic spectator-sync reducer for this watch. Sequenced frames route
  // through it (ordering / dedupe / gap -> resync so one dropped frame can never
  // freeze the board); frames with no envelope (older server) bypass it.
  const syncRef = useRef(createSpectatorSync());
  const fireSignature = (id: string) => {
    if (!BUFF_BY_ID[id]) return;
    fireSigQueued(id);
  };
  // A hook-fired card (summon, transform, revive, fresh board effect) is
  // announced too: the replica sets lastHookMutations after a move.
  const fireHookSignatures = (g: NerfGame | null) => {
    const fired = g?.buffs?.lastHookMutations;
    if (!fired?.length) return;
    // Fire every hook-mutated card, not just fired[0] (docs/passive-effect-
    // audit.md R9/R10). The passive layer reads the full mutation list too, so
    // simultaneous hook activations each surface a visual for the watcher.
    for (const { color, index } of fired) {
      const inst = g?.buffs?.players[color].buffs[index];
      if (!inst?.id) continue;
      // Gambling cards: hand the rolled outcome (inst.state) to the play
      // animation so watchers see what actually happened too.
      if (inst.id.startsWith("gm_")) {
        stashGamblingOutcome(inst.id, { ...inst.state, __spent: inst.spent === true });
      }
      fireSignature(inst.id);
    }
  };

  useEffect(() => {
    // Adopt the wstart as the ordered-sync baseline when it carries the
    // ordered-protocol fields (seq / schemaVersion / replayVersion / publicHash).
    // The board was already built from `setup` above, so no frames drain here on
    // a fresh mount. A legacy wstart leaves the sync unbaselined so every frame
    // bypasses the reducer (behavior unchanged). This component remounts on every
    // fresh wstart (outer page's watchGen key), so the baseline is re-adopted per
    // authoritative snapshot.
    const baseEnv = spectatorBaselineEnvelope(setup);
    if (baseEnv) {
      beginWatch(syncRef.current, setup.id);
      routeSpectatorBaseline(syncRef.current, baseEnv);
    }
    // A gap/overflow/version-drift resync re-issues the watch; the server's fresh
    // wstart then remounts this view (watchGen) with wholesale-replaced state.
    let resyncing = false;
    const resyncSpectator = () => {
      if (resyncing) return;
      resyncing = true;
      session
        .watch(setup.id)
        .catch(() => {})
        .finally(() => {
          resyncing = false;
        });
    };

    const applyEvent = (e: MPEvent) => {
      if (e.type === "move") {
        setUciMoves((m) => (e.move.ply === m.length + 1 ? [...m, e.move.u] : m));
        setWhiteMs(e.move.wc);
        setBlackMs(e.move.bc);
        const g = draftGameRef.current;
        if (g && !g.result) {
          // Same fallback OnlineMatch uses: a server-accepted move this
          // replica cannot regenerate (a hidden nerf/buff effect) is applied
          // raw instead of silently dropped — a skipped move froze the
          // spectator's draft board for the rest of the game (dtState frames
          // never carry the board, so nothing else could repair it).
          const move =
            legalMoves(g).find((candidate) => moveToUCI(candidate) === e.move.u) ??
            moveFromUCI(g.board, e.move.u);
          if (move) {
            const next = playReplicaMove(g, move);
            draftGameRef.current = next;
            // A passive/held card whose move-hook changed the board plays
            // its flourish for watchers too.
            fireHookSignatures(next);
            setDraftGame({ ...next });
          }
        }
      } else if (e.type === "draft-resolved" || e.type === "draft-used") {
        const g = draftGameRef.current;
        if (g?.buffs) {
          const action: MPDraftAction =
            e.type === "draft-used"
              ? {
                  ply: g.board.history.length,
                  color: e.used.color,
                  a: "use",
                  buffIndex: e.used.buffIndex,
                  picks: e.used.picks,
                  card: e.used.card,
                }
              : e.resolved.kind === "picked"
                ? {
                    ply: g.board.history.length,
                    color: e.resolved.color,
                    a: "pick",
                    cards: e.resolved.cards ?? [],
                  }
                : { ply: g.board.history.length, color: e.resolved.color, a: "bank" };
          applyDraftAction(g, action);
          // Keep the record in step with the live replica so history review can
          // rebuild any past ply (see reviewDraftBoard below).
          setDtActions((prev) => [...prev, action]);
          // An activation (draft-used) is a card play the watcher must see.
          // Gambling cards first stash their just-rolled outcome (inst.state,
          // filled by the replayed activation above) for the true-branch art.
          if (e.type === "draft-used" && e.used.card?.id.startsWith("gm_")) {
            const inst = g.buffs.players[e.used.color].buffs[e.used.buffIndex];
            if (inst?.id === e.used.card.id) {
              stashGamblingOutcome(inst.id, { ...inst.state, __spent: inst.spent === true });
            }
          }
          if (e.type === "draft-used" && e.used.card) fireSignature(e.used.card.id);
          // An instant PICK also plays at pick time for the watcher (R10): the
          // player surfaces cast instant picks, so spectators must too.
          if (e.type === "draft-resolved" && e.resolved.kind === "picked") {
            for (const c of e.resolved.cards ?? []) {
              if ("id" in c && BUFF_BY_ID[c.id]?.kind === "instant") {
                fireSignature(c.id);
                break;
              }
            }
          }
          fireHookSignatures(g);
          setDraftGame({ ...g });
        }
      } else if (e.type === "draft-diff-flag") {
        // A Chess Diff clock flag: resolve the diff against the flagged color
        // and record it so history review reproduces the restored board.
        const g = draftGameRef.current;
        if (g?.buffs) {
          const action: MPDraftAction = { ply: g.board.history.length, color: e.color, a: "diffFlag" };
          applyDraftAction(g, action);
          setDtActions((prev) => [...prev, action]);
          setDraftGame({ ...g });
        }
      } else if (e.type === "draft-state") {
        // Spectator-filtered re-sync (identity reveals, effect timers).
        const g = draftGameRef.current;
        if (g?.buffs) {
          mergeDraftState(g.buffs, e.state, null);
          setDraftGame({ ...g });
        }
      } else if (e.type === "end") {
        setResult(e.end.result);
        setWhiteMs(e.end.wc);
        setBlackMs(e.end.bc);
        if (e.end.nerfs) setNerfs(e.end.nerfs);
        // Game over: both sides' held buffs go public, like the nerfs.
        const g = draftGameRef.current;
        if (g?.buffs && e.end.draftBuffs) {
          revealHeldBuffs(g.buffs, e.end.draftBuffs);
          setDraftGame({ ...g });
        }
      } else if (e.type === "clocks") {
        setWhiteMs(e.wc);
        setBlackMs(e.bc);
      } else if (e.type === "takeback") {
        setUciMoves(e.moves);
        // Drop actions recorded past the rewound head so the review record stays
        // aligned with the shortened move list.
        setDtActions((prev) => prev.filter((a) => a.ply <= e.moves.length));
        setWhiteMs(e.wc);
        setBlackMs(e.bc);
        setHistoryPly(null);
      } else if (e.type === "watchers") {
        setWatchers(e.n);
        if (e.names) setWatcherNames(e.names);
      } else if (e.type === "spectator-chat") {
        setSpectatorChat((msgs) => [...msgs, e.message].slice(-50));
      } else if (e.type === "rule-revealed") {
        // A player voluntarily showed their rule mid-game.
        setNerfs((prev) => ({ ...(prev ?? {}), [e.color]: e.nerfId }));
      } else if (e.type === "disconnected" || e.type === "reconnecting") {
        setReconnecting(true);
      } else if (e.type === "watch-start") {
        setReconnecting(false);
      }
    };

    const off = session.on((e) => {
      // Sequenced live frames route through the reducer (dedupe / order / gap ->
      // resync); frames without an envelope (control frames, older servers)
      // bypass it and apply directly.
      const env = (e as { env?: SpectatorEnvelope }).env;
      const route = routeSpectatorLiveFrame(syncRef.current, env, e);
      if (route.resync) {
        resyncSpectator();
        return;
      }
      for (const p of route.apply) applyEvent(p as MPEvent);
    });
    // Sweep a gap that never fills so one dropped frame can never freeze the
    // board: a stranded gap past the reorder window resyncs onto a fresh wstart.
    const sweepTimer = window.setInterval(() => {
      const swept = sweepSpectatorSync(syncRef.current);
      if (swept?.signal === "resync") resyncSpectator();
    }, 1000);
    return () => {
      off();
      window.clearInterval(sweepTimer);
    };
    // Subscribe once per session; the signature-firing helpers are recreated
    // every render but must not re-register the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const replayed = useMemo(() => replayUci(uciMoves), [uciMoves]);
  // Draft boards can diverge from plain move replay (buffs mutate the board
  // outside move history), so the engine replica is authoritative there.
  const board = isDraft && draftGame ? draftGame.board : replayed.board;
  const history = isDraft && draftGame ? draftGame.board.history : replayed.history;
  const clockEnabled = setup.timeSec > 0;

  // No local 100ms decrement interval here: it re-rendered the WHOLE
  // SpectatorView subtree 10x/second for the entire game. The visible clock is
  // unaffected — ClockPill self-interpolates from its `ms` prop via rAF — and
  // server clock frames keep whiteMs/blackMs authoritative. The time-pressure
  // FX (below) reads those server-frame values, which refresh often enough
  // that a low clock still calms the effects.

  // History review. A reviewed PAST ply of a draft game is rebuilt from the
  // move + action record through the engine (buildSpectatorDraftGameAtPly),
  // which reproduces board rewrites — summons, removals, teleports, drops — so
  // review works PAST a divergence instead of locking. Returns null only when
  // the record cannot replay that far (an older stream with an unknown card):
  // we then fall back to the live board rather than showing a wrong one.
  const reviewDraftBoard = useMemo(() => {
    if (!isDraft || historyPly == null || historyPly >= history.length) return undefined;
    const g = buildSpectatorDraftGameAtPly(uciMoves, dtActions, historyPly, setup.mode);
    return g.board.history.length === historyPly ? g.board : null;
  }, [isDraft, historyPly, history.length, uciMoves, dtActions, setup.mode]);

  // A reviewed ply the record can't reconstruct: snap back to the live board so
  // the viewer never sees a wrong position (graceful degrade, not a wrong
  // board). Clamped during render (converges next frame: historyPly === null
  // makes the memo above return undefined), matching the head-clamp pattern the
  // player game page uses — not an effect, which would cascade renders.
  if (reviewDraftBoard === null && historyPly != null) {
    setHistoryPly(null);
  }

  // Both draft and plain games are now fully reviewable: draft games via the
  // engine reconstruction above (past any divergence), plain games via
  // move-replay. An unreconstructable draft ply is handled by the snap-back
  // clamp above, not a lock.
  const currentPly = historyPly ?? history.length;
  const displayBoard =
    historyPly == null || historyPly >= history.length
      ? board
      : isDraft
        ? reviewDraftBoard ?? board
        : boardAtPly(history, historyPly);
  const lastMove = displayBoard.history[displayBoard.history.length - 1] ?? null;
  const zones = isDraft && draftGame ? draftZones(draftGame, "w") : null;

  // The result panel wants Nerf objects and both sides' cards. Rules only exist
  // in nerf/nerf-buff modes; the draft replica holds the (now-revealed) buffs.
  const whiteNerf = nerfs?.w ? IMPLEMENTED_BY_ID[nerfs.w] : undefined;
  const blackNerf = nerfs?.b ? IMPLEMENTED_BY_ID[nerfs.b] : undefined;

  // Passive parity for spectators (docs/passive-effect-audit.md R5/R6):
  //  - R5: merge computeFxVisual so the persistent per-card fx layer paints
  //    (king_safe / pawn-clamp / stun / motifs), mirroring game/page.tsx.
  //  - R6: feed nerfReveals so a rule becoming KNOWN plays the reveal splash;
  //    `nerfs` is the reveal channel (public rules only, populated at end-of-
  //    game reveals), so this honours section-9 "hidden until revealed".
  const fxZone = isDraft && draftGame ? computeFxVisual(draftGame) : null;
  const nerfReveals: NerfRevealInfo[] = [];
  for (const [color, nerf] of [["w", whiteNerf], ["b", blackNerf]] as const) {
    if (nerf && !NERF_REVEAL_SKIP.has(nerf.id)) {
      nerfReveals.push({
        id: nerf.id,
        name: nerf.name,
        tier: nerf.tier as number,
        color,
        highlightSquares: [],
      });
    }
  }
  const passiveNerfs = nerfReveals.map((r) => ({ cardId: r.id, color: r.color, squares: [] }));

  return (
    <>
    <ConnectionBanner session={session} />
    <GameShell
      players={setup.players}
      rated={setup.rated}
      timeControl={timeControlLabel(setup.timeSec, setup.incrementSec)}
      board={displayBoard}
      lastMove={lastMove}
      history={history}
      currentPly={currentPly}
      onPlyChange={(ply) => {
        setHistoryPly(ply >= history.length ? null : Math.max(0, ply));
      }}
      minPly={0}
      clockEnabled={clockEnabled}
      whiteMs={whiteMs}
      blackMs={blackMs}
      activeColor={result ? null : board.turn}
      mode={setup.mode}
      headerState={result ? "final" : setup.started ? "live" : "waiting"}
      watchers={watchers}
      statusLabel={
        // The Live/Final/Waiting state badge already carries the game state —
        // only spell out extra detail (result text, reconnect note) so the
        // header doesn't read "Live · Live game".
        reconnecting
          ? "Reconnecting…"
          : result
            ? describeResult(result)
            : setup.started
              ? null
              : "Waiting for players"
      }
      nerfs={nerfs}
      visual={
        zones
          ? {
              bannedSquares: zones.barred,
              frozenSquares: zones.frozen,
              frozenSkins: zones.frozenSkin,
              effectTurns: zones.turns,
              shieldedSquares: zones.shielded,
              wardSquares: zones.ward,
              strikeSquares: zones.strike,
              walnutSquares: zones.walnut,
              bananaSquares: zones.banana,
              trapSquares: zones.traps,
              doomSquares: zones.doom,
              lockedSquares: zones.locked,
              ...(fxZone ? fxVisualFields(fxZone) : {}),
            }
          : undefined
      }
      // No flourish while scrubbing history (a past position isn't a live
      // play), matching the players' own board.
      signatureCard={historyPly == null ? signatureCard : null}
      nerfReveals={historyPly == null ? nerfReveals : undefined}
      passiveNerfs={passiveNerfs}
      passiveBuffs={historyPly == null ? draftGame?.buffs ?? null : null}
      reviewingHistory={historyPly != null}
      rail={
        <div className="mt-3 space-y-3">
          {isDraft && draftGame && <SpectatorBuffsPanel game={draftGame} players={setup.players} />}
          <WatchersPanel count={watchers} names={watcherNames} />
          <SpectatorChat
            messages={spectatorChat}
            onSend={(text) => session.sendSpectatorChat(text)}
          />
        </div>
      }
    />
    {result && showResult && (
      <GameOver
        spectator
        result={result}
        myColor="w"
        myNerf={whiteNerf}
        opponentNerf={blackNerf}
        mode={setup.mode === "nerf" || setup.mode === "buff" ? setup.mode : null}
        playerNames={{ w: setup.players.w.name, b: setup.players.b.name }}
        moves={history}
        cardEvents={cardEventsFromDtActions(dtActions)}
        profiles={[
          { name: setup.players.w.name, href: `/u/${encodeURIComponent(setup.players.w.name)}` },
          { name: setup.players.b.name, href: `/u/${encodeURIComponent(setup.players.b.name)}` },
        ]}
        myBuffs={draftGame?.buffs?.players.w.buffs}
        opponentBuffs={draftGame?.buffs?.players.b.buffs}
        onRematch={() => {}}
        onNewGame={() => {
          window.location.href = "/tv";
        }}
        onDismiss={() => setShowResult(false)}
      />
    )}
    {result && !showResult && (
      <Button tone="leaf"
       
        onClick={() => setShowResult(true)}
        className="fixed bottom-14 right-3 z-40 px-4 py-2 text-sm font-semibold shadow-xl sm:bottom-4">
        Show result
      </Button>
    )}
    </>
  );
}

// Spectators only learn THAT cards are held, never which, until a card's
// identity shows on the table (instant effect, activation, a granted move)
// or the game ends. Hidden cards render as face-down minis with their tier.
// Pending offers and reveal snapshots never reach this view.
// One player per TAB: spectators flip between the two hands instead of
// scrolling one long stack, and each tab wears its player's name.
function SpectatorBuffsPanel({ game, players }: { game: NerfGame; players: MPPlayers }) {
  const [tab, setTab] = useState<Color>("w");
  // Per-row expand state for the condensed card list, keyed by tab + index.
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const bs = game.buffs;
  if (!bs) return null;
  const tabButton = (color: Color) => {
    const held = bs.players[color].buffs;
    const active = tab === color;
    return (
      <button
        type="button"
        onClick={() => setTab(color)}
        aria-pressed={active}
        className={
          "flex min-h-[36px] min-w-0 flex-1 items-center justify-center gap-1.5 border px-2 py-1.5 font-display text-[13px] font-semibold transition-colors " +
          (active
            ? "border-gold/60 bg-[rgb(var(--accent-rgb)/0.12)] text-gold-leaf"
            : "border-[color:var(--edge)] text-parchment-300 hover:bg-[var(--surface-hover)]")
        }
      >
        <span
          aria-hidden
          className={
            "h-2 w-2 shrink-0 rounded-full border " +
            (color === "w" ? "border-black/40 bg-[#e8e6e1]" : "border-white/30 bg-[#1a1a22]")
          }
        />
        <span className="min-w-0 truncate">{players[color].name}</span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-parchment-400">
          {held.length}
        </span>
      </button>
    );
  };
  const side = (color: Color) => {
    const held = bs.players[color].buffs;
    const hiddenOnes = held.filter((inst) => !BUFF_BY_ID[inst.id]);
    return (
      <div>
        {held.length === 0 ? (
          <p className="text-[12px] text-parchment-400">No buffs drafted yet.</p>
        ) : (
          <div className="mt-1 space-y-1">
            {hiddenOnes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {hiddenOnes.map((inst, i) => (
                  <span
                    key={i}
                    title={`Hidden buff · power tier ${inst.tier} of 8`}
                    className={
                      "relative flex h-9 w-7 items-center justify-center rounded-[3px] border border-gold/35 " +
                      "bg-[linear-gradient(135deg,rgb(var(--accent-gold-rgb)/0.14),rgba(14,12,9,0.95))] " +
                      (inst.spent || inst.nullified ? "opacity-40" : "")
                    }
                  >
                    <span className={`font-display text-[12px] font-bold tier-${inst.tier}`}>
                      {TIER_ROMAN[inst.tier]}
                    </span>
                  </span>
                ))}
              </div>
            )}
            {held.map((inst, i) => {
              const def = BUFF_BY_ID[inst.id];
              if (!def) return null;
              // Condensed one-line rows (name + tier), rule text one tap away:
              // spectators scan a hand, they don't study every card at once.
              const key = `${tab}-${i}`;
              const open = !!expandedRows[key];
              const dead = inst.spent || inst.nullified;
              return (
                <div key={i} className="rounded-[1px] border border-[color:var(--edge)]">
                  <button
                    type="button"
                    onClick={() => setExpandedRows((prev) => ({ ...prev, [key]: !open }))}
                    aria-expanded={open}
                    className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
                  >
                    <span
                      className={
                        "min-w-0 flex-1 truncate font-display text-[13px] font-semibold " +
                        (dead
                          ? "text-parchment-200 line-through decoration-1 decoration-parchment-500"
                          : `tier-${inst.tier}`)
                      }
                    >
                      {def.name}
                    </span>
                    <span
                      className={`shrink-0 rounded-[1px] border px-1.5 py-px font-display text-[12px] font-bold tier-bg-${inst.tier} tier-${inst.tier}`}
                    >
                      {TIER_ROMAN[inst.tier]}
                    </span>
                  </button>
                  {open && (
                    <p className="px-2 pb-1.5 text-[12px] leading-snug text-parchment-300">
                      {def.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="plate max-h-72 space-y-2 overflow-y-auto p-3">
      <div className="text-parchment-400">Drafted buffs</div>
      <div className="flex gap-1">
        {tabButton("w")}
        {tabButton("b")}
      </div>
      {side(tab)}
    </div>
  );
}

// Who is on the rail with you. Signed-in watchers by name; the rest counted.
function WatchersPanel({ count, names }: { count: number; names: string[] }) {
  const anonymous = Math.max(0, count - names.length);
  return (
    <div className="plate p-3">
      <div className="flex items-center justify-between">
        <span className="text-parchment-400">Spectators</span>
        <span className="font-mono text-[13px] tabular-nums text-parchment-100">{count}</span>
      </div>
      {(names.length > 0 || anonymous > 0) && (
        <p className="mt-1 text-[12px] leading-snug text-parchment-300 break-words">
          {names.join(", ")}
          {anonymous > 0 && (
            <span className="text-parchment-400">
              {names.length > 0 ? " + " : ""}
              {anonymous} anonymous
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// Chat between spectators only — the players never see this room.
function SpectatorChat({
  messages,
  onSend,
}: {
  messages: MPSpectatorChatMessage[];
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  // Safety controls, all local to this viewer: Hide turns the panel off,
  // muting a name drops that spectator's messages, and Report files the
  // message into the moderator queue (server-throttled).
  const [hidden, setHidden] = useState(false);
  const [mutedNames, setMutedNames] = useState<ReadonlySet<string>>(new Set());
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [reportState, setReportState] = useState<Record<string, "sent" | "failed">>({});
  const listRef = useRef<HTMLDivElement | null>(null);

  const shownMessages = messages.filter((m) => !mutedNames.has(m.name));

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, hidden, mutedNames]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  const muteName = (name: string) => {
    setMutedNames((prev) => new Set(prev).add(name));
    setActionsFor(null);
  };

  const reportMessage = async (key: string, m: MPSpectatorChatMessage) => {
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: m.name,
          reason: "chat",
          description: `Spectator chat message: "${m.text.slice(0, 500)}"`,
        }),
      });
      setReportState((prev) => ({ ...prev, [key]: res.ok ? "sent" : "failed" }));
    } catch {
      setReportState((prev) => ({ ...prev, [key]: "failed" }));
    }
    setActionsFor(null);
  };

  return (
    <div className="plate flex h-56 flex-col p-2">
      <div className="flex shrink-0 items-center justify-between px-1 pb-1.5">
        <span className="text-parchment-400">Spectator chat</span>
        <button
          type="button"
          onClick={() => setHidden((v) => !v)}
          className="text-[12px] text-parchment-400 transition-colors hover:text-parchment-100"
          title={hidden ? "Show chat messages" : "Hide chat messages"}
        >
          {hidden ? "Show chat" : "Hide chat"}
        </button>
      </div>
      {hidden ? (
        <div className="min-h-0 flex-1 px-1 text-[13px] text-parchment-400">Chat is hidden.</div>
      ) : (
      <div ref={listRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1 text-[13px] leading-snug">
        {shownMessages.length === 0 && (
          <div className="text-parchment-400">
            Chat with the other spectators. The players can&apos;t see this.
          </div>
        )}
        {shownMessages.map((m, i) => {
          const key = `${m.at}-${m.name}-${i}`;
          const report = reportState[key];
          return (
            <div key={key} className="group break-words">
              <button
                type="button"
                onClick={() => setActionsFor((cur) => (cur === key ? null : key))}
                className="font-display font-semibold text-bruise-glow hover:underline"
                title={`Actions for ${m.name}`}
                aria-expanded={actionsFor === key}
              >
                {m.name}
              </button>
              <span className="text-parchment-200"> {m.text}</span>
              {report === "sent" && (
                <span className="ml-1 text-[12px] text-parchment-400">reported</span>
              )}
              {actionsFor === key && (
                <span className="ml-2 inline-flex gap-2 text-[12px]">
                  <button
                    type="button"
                    onClick={() => muteName(m.name)}
                    className="text-parchment-400 hover:text-parchment-100"
                  >
                    Mute {m.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => reportMessage(key, m)}
                    className="text-oxblood-glow hover:underline"
                  >
                    Report
                  </button>
                  {report === "failed" && (
                    <span className="text-oxblood-glow">Couldn&apos;t report (sign in first)</span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
      )}
      {mutedNames.size > 0 && !hidden && (
        <button
          type="button"
          onClick={() => setMutedNames(new Set())}
          className="shrink-0 px-1 pt-1 text-left text-[12px] text-parchment-400 hover:text-parchment-100"
        >
          {mutedNames.size} muted · unmute all
        </button>
      )}
      <form onSubmit={submit} className="mt-2 flex shrink-0 gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={200}
          placeholder="Message…"
          aria-label="Spectator chat message"
          className="min-w-0 flex-1 rounded-sm border border-[color:var(--edge)] bg-ink-900/60 px-2 py-1.5 text-base text-parchment placeholder:text-parchment-500 focus-visible:border-gold/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-rgb))] sm:text-[13px]"
        />
        <Button tone="ghost"
          type="submit"
          disabled={!draft.trim()}
          className="shrink-0 px-3 py-1.5 text-[13px]">
          Send
        </Button>
      </form>
    </div>
  );
}

// ---------------- archived replay ----------------

function ReplayView({ game }: { game: ReplayGame }) {
  const uciMoves = useMemo(() => (game.moves ? game.moves.split(" ").filter(Boolean) : []), [game.moves]);
  // Draft games archive a full public action record: reconstruct through the
  // exact engine path a live spectator uses (buildSpectatorDraftGame), so board
  // rewrites (summons, removals, teleports, drops, timed losses) are reproduced
  // and the whole game replays. Classic and legacy (recordless) rows keep the
  // moves-only replay.
  const dtActions = game.dtActions;
  const isDraft = Array.isArray(dtActions);
  const replayed = useMemo(() => replayUci(uciMoves), [uciMoves]);
  const draftHead = useMemo(
    () => (isDraft ? buildSpectatorDraftGame(uciMoves, dtActions ?? [], undefined, game.mode) : null),
    [isDraft, uciMoves, dtActions, game.mode],
  );
  const history = isDraft && draftHead ? draftHead.board.history : replayed.history;
  // The truncation notice is now ONLY a fallback for legacy rows with no record:
  // a draft game with the record replays in full, so it never truncates.
  const truncated = !isDraft && replayed.history.length < uciMoves.length;
  const [historyPly, setHistoryPly] = useState<number>(history.length);
  const [pgnCopied, setPgnCopied] = useState(false);
  // Same neutral result panel as the live spectator, shown over the replay.
  const [showResult, setShowResult] = useState(true);
  // A reviewed past ply of a draft game is rebuilt from the record through the
  // engine (buildSpectatorDraftGameAtPly), so scrubbing works PAST a rewrite; a
  // ply the record can't reach falls back to the head board.
  const displayBoard = useMemo(() => {
    if (isDraft && draftHead) {
      if (historyPly >= history.length) return draftHead.board;
      const g = buildSpectatorDraftGameAtPly(uciMoves, dtActions ?? [], historyPly, game.mode);
      return g.board.history.length === historyPly ? g.board : draftHead.board;
    }
    return boardAtPly(history, historyPly);
  }, [isDraft, draftHead, history, historyPly, uciMoves, dtActions, game.mode]);
  const lastMove = displayBoard.history[displayBoard.history.length - 1] ?? null;

  const players: MPPlayers = {
    w: { name: game.white_name, rating: game.white_rating_before ? Math.round(game.white_rating_before) : null },
    b: { name: game.black_name, rating: game.black_rating_before ? Math.round(game.black_rating_before) : null },
  };
  const whiteNerf = IMPLEMENTED_BY_ID[game.white_nerf_id];
  const blackNerf = IMPLEMENTED_BY_ID[game.black_nerf_id];

  // Same export as the post-game screen; the archive already has both rules
  // revealed, so they always go into the tags.
  const handleCopyPGN = async () => {
    const pgn = gameToPGN({
      moves: history,
      result: { winner: game.winner, reason: game.reason },
      white: game.white_name,
      black: game.black_name,
      whiteNerf: IMPLEMENTED_BY_ID[game.white_nerf_id]?.name ?? null,
      blackNerf: IMPLEMENTED_BY_ID[game.black_nerf_id]?.name ?? null,
      startedAt: game.started_at,
    });
    try {
      await navigator.clipboard.writeText(pgn);
      setPgnCopied(true);
      window.setTimeout(() => setPgnCopied(false), 2000);
    } catch {
      // Clipboard blocked; ignore.
    }
  };

  return (
    <>
    <GameShell
      players={players}
      rated={!!game.rated}
      timeControl={timeControlLabel(game.time_sec, game.increment_sec)}
      board={displayBoard}
      lastMove={lastMove}
      history={history}
      currentPly={historyPly}
      onPlyChange={(ply) => setHistoryPly(Math.max(0, Math.min(ply, history.length)))}
      clockEnabled={false}
      whiteMs={0}
      blackMs={0}
      activeColor={null}
      mode={game.mode}
      headerState="final"
      statusLabel={describeResult({ winner: game.winner, reason: game.reason })}
      moveListNote={
        truncated
          ? `This replay shows the first ${history.length} of ${uciMoves.length} half-moves; a card rewrote the board mid-game.`
          : undefined
      }
      nerfs={{ w: game.white_nerf_id, b: game.black_nerf_id }}
      rail={
        <Button tone="ghost"
         
          onClick={handleCopyPGN}
          className="mt-3 w-full px-4 py-2 text-sm">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {pgnCopied ? "Copied" : "Copy PGN"}
        </Button>
      }
    />
    {game.winner != null && showResult && (
      <GameOver
        spectator
        result={{ winner: game.winner, reason: game.reason }}
        myColor="w"
        myNerf={whiteNerf}
        opponentNerf={blackNerf}
        mode={game.mode === "nerf" || game.mode === "buff" ? game.mode : null}
        playerNames={{ w: game.white_name, b: game.black_name }}
        moves={history}
        cardEvents={dtActions ? cardEventsFromDtActions(dtActions) : undefined}
        profiles={[
          { name: game.white_name, href: `/u/${encodeURIComponent(game.white_name)}` },
          { name: game.black_name, href: `/u/${encodeURIComponent(game.black_name)}` },
        ]}
        myBuffs={draftHead?.buffs?.players.w.buffs}
        opponentBuffs={draftHead?.buffs?.players.b.buffs}
        startedAt={game.started_at}
        gameId={game.id}
        onRematch={() => {}}
        onNewGame={() => {
          window.location.href = "/tv";
        }}
        onDismiss={() => setShowResult(false)}
      />
    )}
    {game.winner != null && !showResult && (
      <Button tone="leaf"
       
        onClick={() => setShowResult(true)}
        className="fixed bottom-14 right-3 z-40 px-4 py-2 text-sm font-semibold shadow-xl sm:bottom-4">
        Show result
      </Button>
    )}
    </>
  );
}

// ---------------- shared read-only layout ----------------

// Card markers for the result-screen timeline now come from the shared helper
// in lib/draftOnline (cardEventsFromDtActions), so live games, spectating, and
// archived replays all tell the same card history.

function describeResult(result: { winner: Color | "draw" | null; reason: string }): string {
  const head =
    result.winner === "draw" ? "Draw" : result.winner === "w" ? "White wins" : result.winner === "b" ? "Black wins" : "Aborted";
  return `${head} · ${result.reason}`;
}

// Compact identity unit for the shell header: linked name + rating.
// chip. The full avatar rows beside the board stay the primary identity; this
// mirrors the TV featured header so both surfaces read the same.
function HeaderIdentity({
  seat,
}: {
  seat: { name: string; rating: number | null; provisional?: boolean };
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <a
        href={`/u/${encodeURIComponent(seat.name)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate font-display text-[13px] font-semibold text-parchment-100 transition-colors hover:text-gold-leaf"
        title={`View ${seat.name}'s profile`}
      >
        {seat.name}
      </a>
      {seat.rating != null && (
        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] tabular-nums text-parchment-400">
          {seat.rating}
          {seat.provisional && <ProvisionalMark />}
        </span>
      )}
    </span>
  );
}

function NerfLine({ label, nerfId }: { label: string; nerfId: string }) {
  const nerf: Nerf | undefined = IMPLEMENTED_BY_ID[nerfId];
  if (!nerf) return null;
  return (
    <div className="plate p-2 px-3">
      <span className="text-[12px] text-parchment-400">{label} </span>
      <span className={`font-display text-sm font-semibold tier-${nerf.tier}`}>{nerf.name}</span>
      <span className="text-xs leading-snug text-parchment-300">: {nerf.description}</span>
    </div>
  );
}

function GameShell({
  players,
  rated,
  timeControl,
  mode,
  headerState,
  watchers,
  board,
  lastMove,
  history,
  currentPly,
  onPlyChange,
  minPly = 0,
  clockEnabled,
  whiteMs,
  blackMs,
  activeColor,
  statusLabel,
  moveListNote,
  nerfs,
  visual,
  signatureCard,
  nerfReveals,
  passiveNerfs,
  passiveBuffs,
  reviewingHistory,
  rail,
}: {
  players: MPPlayers;
  rated: boolean;
  timeControl?: string;
  // Structured header identity fields, shared with the TV featured header:
  // the mode chip, the LIVE/FINAL/waiting badge, and the watcher count. The
  // descriptive detail (result text, reconnecting note) still rides statusLabel.
  mode?: DraftMode;
  headerState: "live" | "final" | "waiting";
  watchers?: number;
  board: ReturnType<typeof replayUci>["board"];
  lastMove: ReturnType<typeof replayUci>["history"][number] | null;
  history: ReturnType<typeof replayUci>["history"];
  currentPly: number;
  onPlyChange: (ply: number) => void;
  /** Earliest reviewable ply (see MoveList.minPly). */
  minPly?: number;
  clockEnabled: boolean;
  whiteMs: number;
  blackMs: number;
  activeColor: Color | null;
  statusLabel: React.ReactNode;
  // A quiet inline note pinned under the move list (e.g. the legacy replay
  // truncation notice), kept out of the header status line.
  moveListNote?: React.ReactNode;
  nerfs: Partial<Record<Color, string>> | null;
  // Draft spectating: public zone effects painted on the board.
  visual?: React.ComponentProps<typeof Board>["visual"];
  // Card-use animation: a played card's board-wide flourish fires for
  // spectators too, so watching a game shows the same effects the players see.
  signatureCard?: React.ComponentProps<typeof Board>["signatureCard"];
  // Passive visual parity (docs/passive-effect-audit.md R5/R6): the reveal
  // splash + persistent registry auras + buff state the player surfaces feed.
  nerfReveals?: React.ComponentProps<typeof Board>["nerfReveals"];
  passiveNerfs?: React.ComponentProps<typeof Board>["passiveNerfs"];
  passiveBuffs?: React.ComponentProps<typeof Board>["passiveBuffs"];
  reviewingHistory?: boolean;
  rail?: React.ReactNode;
}) {
  const stateBadge =
    headerState === "live" ? (
      <span className="inline-flex items-center gap-1.5 rounded-[1px] border border-[rgb(var(--pos-rgb)/0.4)] bg-[rgb(var(--pos-rgb)/0.12)] px-2 py-0.5 text-[12px] font-semibold text-[rgb(var(--pos-rgb))]">
        <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--pos-rgb))]" aria-hidden />
        Live
      </span>
    ) : headerState === "final" ? (
      <span className="inline-flex items-center rounded-[1px] border border-[color:var(--edge-strong)] bg-white/[0.04] px-2 py-0.5 text-[12px] font-semibold text-parchment-300">
        Final
      </span>
    ) : (
      <span className="inline-flex items-center rounded-[1px] border border-[color:var(--edge)] px-2 py-0.5 text-[12px] font-medium text-parchment-400">
        Waiting
      </span>
    );
  return (
    <main className="min-h-screen">
      <SiteNav
        status={
          <>
            {stateBadge}
            {statusLabel && <span className="truncate text-parchment-300">{statusLabel}</span>}
          </>
        }
      />
      <div className="mx-auto w-full max-w-[1200px] px-3 pb-10 sm:px-6">
        {/* Featured-game header pattern, shared with TV: identity units, state
            badge, mode chip, time control, watcher count, then the descriptive
            status detail. */}
        <div className="zen-hide mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-parchment-400">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <HeaderIdentity seat={players.w} />
            <span className="text-parchment-500">vs</span>
            <HeaderIdentity seat={players.b} />
          </span>
          {stateBadge}
          <ModeBadge mode={mode} />
          {timeControl && <span className="tabular-nums">{timeControl}</span>}
          <span>{rated ? "Rated" : "Casual"}</span>
          {watchers != null && watchers > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Eye size={13} aria-hidden /> {watchers}
            </span>
          )}
          {statusLabel && <span className="text-parchment-300">{statusLabel}</span>}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <BoardPlayerRow
                board={board}
                playerColor="b"
                myColor="w"
                name={players.b.name}
                elo={players.b.rating}
                avatar={players.b.avatar}
                className="min-w-0 flex-1 !px-0 !py-1"
              />
              {clockEnabled && <ClockPill ms={blackMs} active={activeColor === "b"} compact />}
            </div>
            <div className="w-full max-w-[720px]">
              <Board
                board={board}
                legalMoves={[]}
                orientation="w"
                onMove={() => {}}
                myColor="w"
                fxTimePressure={clockEnabled && activeColor != null && (whiteMs < 15_000 || blackMs < 15_000)}
                visual={visual}
                signatureCard={signatureCard}
                nerfReveals={nerfReveals}
                passiveNerfs={passiveNerfs}
                passiveBuffs={passiveBuffs}
                reviewingHistory={reviewingHistory}
                lastMove={lastMove}
                disabled
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <BoardPlayerRow
                board={board}
                playerColor="w"
                myColor="w"
                name={players.w.name}
                elo={players.w.rating}
                avatar={players.w.avatar}
                className="min-w-0 flex-1 !px-0 !py-1"
              />
              {clockEnabled && <ClockPill ms={whiteMs} active={activeColor === "w"} compact />}
            </div>
            {/* Rules show only once known (end of game or a voluntary
                reveal); until then no placeholder plates take up space.
                Buff mode games carry the "none" rule, which never shows. */}
            {nerfs && (IMPLEMENTED_BY_ID[nerfs.w ?? ""] || IMPLEMENTED_BY_ID[nerfs.b ?? ""]) && (
              <div className="mt-2 space-y-1.5">
                {nerfs.w && <NerfLine label={`${players.w.name} (White)`} nerfId={nerfs.w} />}
                {nerfs.b && <NerfLine label={`${players.b.name} (Black)`} nerfId={nerfs.b} />}
              </div>
            )}
          </div>
          <div className="sm:w-64 sm:shrink-0">
            {/* Fixed-height wrapper: the compact MoveList fills it and
                scrolls internally, so long games never push the rail (or
                the page) past the viewport. */}
            <div className="h-64 xl:h-72">
              <MoveList
                moves={history}
                currentPly={currentPly}
                onPlyChange={onPlyChange}
                minPly={minPly}
                compact
              />
            </div>
            {moveListNote && (
              <p className="mt-1.5 text-[12px] leading-snug text-parchment-400">{moveListNote}</p>
            )}
            {/* Spectator list, spectator chat and the drafted-buff panel are
                social chrome, not the game: zen hides the lot. */}
            <div className="zen-hide">{rail}</div>
          </div>
        </div>
      </div>
    </main>
  );
}

// Compact game top bar (design system §9): the standard nav, compacted rather
// than replaced. Every global destination stays reachable behind the collapsed
// menu (kept visible on desktop too), so a watcher/replayer never dead-ends on
// a three-link stub. `status` carries the game state line into the bar.
function SiteNav({ status }: { status?: React.ReactNode } = {}) {
  return <CompactSiteHeader status={status} />;
}
