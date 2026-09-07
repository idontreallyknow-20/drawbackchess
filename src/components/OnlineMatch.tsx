"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Board, NERF_REVEAL_SKIP, type NerfRevealInfo, QueuedPremove } from "@/components/Board";
import { BoardPlayerRow } from "@/components/BoardPlayerRow";
import { AdminGodPanel } from "@/components/AdminGodPanel";
import { OppPlaysLog, type OppPlay } from "@/components/OppPlaysLog";
import { BuffDock, EnemyBuffModal, TargetingBanner, againstYouRows, useBuffTargeting } from "@/components/BuffDock";
import { BoardSplashHost } from "@/components/BoardSplash";
import { ChatPanel } from "@/components/ChatPanel";
import { ClockPill } from "@/components/ClockPill";
import { ClockRaidLayer } from "@/components/effects/clockraid/ClockRaidLayer";
import { RailResizeHandle, useRailWidth } from "@/components/RailResizeHandle";
import { CommandRail, railGridClass } from "@/components/match/CommandRail";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { DraftNotice } from "@/components/DraftNotice";
import { WaitingCornerNotice } from "@/components/draft/WaitingCornerNotice";
import { GodPanelNotice, type GodPanelNoticeItem } from "@/components/GodPanelNotice";
import {
  DraftOverlay,
  DraftResolvingChip,
  DraftRevealBanner,
  LockInCountdown,
  type DraftRevealSide,
} from "@/components/DraftOverlay";
import { useDraftSequence } from "@/lib/useDraftSequence";
import { pushUiHold } from "@/lib/uiInterrupts";
import { OpponentDraftViewer } from "@/components/OpponentDraftViewer";
// The end screen is never part of first paint; loading it on demand keeps it
// out of the page's initial bundle.
const GameOver = dynamic(() => import("@/components/GameOver").then((m) => m.GameOver), {
  ssr: false,
});
import { MobileNavMenu } from "@/components/MobileNavMenu";
import { MobileBuffDrawer } from "@/components/MobileBuffDrawer";
import { cardFaceIcon } from "@/lib/cardIcon";
import { bottomChromePadClass } from "@/components/mobileChrome";
import { MobileMatchStack } from "@/components/MobileMatchStack";
import { BoardTools } from "@/components/board/BoardTools";
import { FxToggleButton } from "@/components/FxToggleButton";
import { MoveList } from "@/components/MoveList";
import { NerfCard } from "@/components/NerfCard";
import { Pocket } from "@/components/Pocket";
import { PlayerNerfCard } from "@/components/PlayerNerfCard";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SpectatorPill } from "@/components/SpectatorPill";
import { TIER_LABEL, TIER_ROMAN } from "@/lib/tiers";
import type { BuffOffer } from "@/engine/buff";
import { BUFF_BY_ID } from "@/engine/buffs/library";
import { cloneBoard, findKing, isInCheck, makeMove, moveFromUCI, moveToUCI, positionKey } from "@/engine/board";
import { activeRuleIds, fnv1a } from "@/engine/desync";
import { draftCardNoun, turnCost } from "@/engine/buff";
import { useDeferredMoveRisks } from "@/lib/useDeferredMoveRisks";
import { SETTINGS_CHANGED_EVENT, loadSettings } from "@/lib/settings";
import type { GameContext, Nerf } from "@/engine/nerf";
import { IMPLEMENTED_BY_ID, openingNerfPool } from "@/engine/nerfs/library";
import {
  currentHint,
  gameInCheck,
  NerfGame,
  UNRESTRICTED_NERF,
  enableDraftMode,
  legalMoves,
  makeContext,
  newGameAsColor,
  playMove,
} from "@/engine/game";
import { BoardState, Color, Move, PieceType, Square } from "@/engine/types";
import {
  applyDraftAction,
  cardEventsFromDtActions,
  draftZones,
  mergeDraftState,
  playReplicaMove,
  replayDraftGame,
  revealHeldBuffs,
} from "@/lib/draftOnline";
import { computeFxVisual, fxVisualFields } from "@/components/effects/fxZones";
import { stashGamblingOutcome } from "@/components/effects/gamblingOutcome";
import { useSignatureQueue } from "@/components/effects/useSignatureQueue";
import { isGodPanelUser, INFINITE_REROLLS } from "@/lib/godPanel";
import { nerfSummary, outcomeFor, recordCompletedGame } from "@/lib/gameHistory";
import { boardAtPly, replayBoardSpan } from "@/lib/gameReview";
import {
  clearActiveGame,
  clearOnlineSeat,
  MPChatMessage,
  MPDraftAction,
  MPDraftResolved,
  MPNerfDraft,
  MPSession,
  MPStart,
  saveActiveGame,
  saveOnlineSeat,
} from "@/lib/multiplayer";
import { premoveOptionsFor, premoveSelfChecks, previewMovesFor } from "@/lib/premoves";
import { isMuted, playCapture, playChallenge, playCheck, playError, playGameStart, playMove as playMoveSfx, playNerf, setMuted } from "@/lib/sounds";
import { Button } from "@/components/ui/Button";

// Mirrors the server's start-of-game grace: each side's first move gets this
// many free milliseconds before their clock starts charging.
const FIRST_MOVE_GRACE_MS = 10_000;

// Mirrors the server's draftLockInMs: the free lock-in window a buff/nerf
// offer gets before the game clock resumes. Used only as a fallback deadline
// for a seat whose own draft was skipped this round (it gets no dtOffer frame,
// so it never learns the real deadline; the server's value stays authoritative
// on reconnect via start.dtDeadline).
const DRAFT_LOCK_IN_MS = 20_000;

// The server allows abandonment claims 30s after the opponent disconnected,
// and its opponentGone frame already arrives after a 15s grace: wait out the
// remainder before surfacing the claim buttons.
const CLAIM_DELAY_AFTER_GONE_MS = 15_000;
// Mirrors `disconnectGraceMs` in worker.ts: how long after a socket drops the
// server waits before emitting `opponentGone`. Used to reconstruct the notice
// moment from the raw disconnect timestamp a reconnect's start frame carries
// (start.oppGoneSince), so a refresh mid-window resumes the same countdown
// rather than restarting it or jumping 15s ahead.
const DISCONNECT_GRACE_MS = 15_000;

// Shared draft reveal timing: the banner eases in a short beat after the
// SECOND side resolves (so the picked card's pocket-flight and dock landing
// finish first, never mid-choice), then holds about four seconds.
const DRAFT_REVEAL_EASE_MS = 450;
const DRAFT_REVEAL_HOLD_MS = 4000;

/** Wall-clock read, kept out of render bodies so the compiler treats callers as
 * pure (the value is only ever used inside handlers/effects). */
function nowMs(): number {
  return Date.now();
}

type PendingPremoveSend = { uci: string; ply: number };
type PendingLocalMove = { uci: string; ply: number; move: Move };

function moveKey(move: Move): string {
  return `${move.from}:${move.to}:${move.promotion ?? ""}:${move.captured ?? ""}`;
}

// Report a detected turn/board divergence to the telemetry sink so real
// traffic names the culprit rule instead of us hunting blind (see
// src/engine/desync.ts and /api/desync). Best-effort and fire-and-forget: a
// failed beacon must never disturb the resync that actually fixes the game.
function beaconTurnDesync(
  gameId: string,
  clientHash: string,
  serverHash: string,
  rules: string[],
) {
  try {
    void fetch("/api/desync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gameId,
        clientHash,
        serverHash,
        // The whose-turn / board drift this guard catches is always a
        // position divergence (side to move is part of positionKey).
        diverged: { pos: true, moves: false, rules: false },
        rules,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

function pickRandomNerf(): Nerf {
  // Fallback for an unknown server nerf id; respects the opening tier cap.
  const pool = openingNerfPool();
  return pool[Math.floor(Math.random() * pool.length)];
}

// Rebuild the authoritative game state from a server `start` payload. Used on
// mount and again whenever a reconnect replays the game.
function buildGameFromStart(start: MPStart): NerfGame {
  // Buff mode has no handicaps: both sides run the unrestricted rule.
  const myNerf =
    start.mode === "buff"
      ? UNRESTRICTED_NERF
      : IMPLEMENTED_BY_ID[start.nerfId] ?? pickRandomNerf();
  let next = newGameAsColor(myNerf, start.color, start.nerfSeed);
  if (start.draft) {
    // The REAL draft seed (older servers omit it: fall back to 1). Offer rolls
    // are still discarded (the server's dtOffer / dtState frames carry the real
    // cards); matching the seed only keeps this replica's local placeholder
    // rolls harmless. Card-EFFECT randomness no longer depends on any seed at
    // all: api.rng is now derived per event from the synced public state (see
    // fxRng in engine/game.ts), so random removals replay identically here,
    // on the server, and for spectators. The mode sets the draft cadence the
    // dock displays.
    enableDraftMode(next, start.draftSeed ?? 1, { mode: start.mode });
    next = replayDraftGame(next, start.moves ?? [], start.dtActions ?? []);
    if (next.buffs && start.dtState) {
      mergeDraftState(next.buffs, start.dtState, start.color);
      // rerollsLeft is not part of mergeDraftState (rerolls are filtered from
      // the replayed action record), so carry the server's authoritative count
      // over by hand. Keeps the reroll control correct across a reconnect.
      for (const c of ["w", "b"] as Color[]) {
        const rl = start.dtState.players[c]?.rerollsLeft;
        if (rl != null) next.buffs.players[c].rerollsLeft = rl;
      }
    }
    return next;
  }
  for (const uci of start.moves ?? []) {
    // Server-validated moves the replica cannot regenerate (the opponent's
    // hidden rule can force passes and other flows we cannot predict) are
    // applied raw rather than stranding the replay mid-game.
    const move =
      legalMoves(next).find((candidate) => moveToUCI(candidate) === uci) ??
      moveFromUCI(next.board, uci);
    if (!move) return next;
    next = playMove(next, move);
  }
  return next;
}

interface Props {
  session: MPSession;
  start: MPStart;
  subtitle: string;
  onExit: () => void;
}

// What this rated game is worth: the projected rating change for each result.
function RatingStakes({ stakes }: { stakes: { win: number; draw: number; loss: number } }) {
  const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  return (
    <div className="plate flex items-center justify-between gap-2 p-2 px-3">
      <span className="text-[12px] text-parchment-400">Rating at stake</span>
      <span className="font-mono text-[12px] tabular-nums">
        <span className="text-verdigris">W {fmt(stakes.win)}</span>
        <span className="text-parchment-400"> · D {fmt(stakes.draw)} · </span>
        <span className="text-oxblood-glow">L {fmt(stakes.loss)}</span>
      </span>
    </div>
  );
}

// Shared empty arrays for the Board's list props.
//
// A fresh `[]` in JSX is a new identity every render, and these feed Board's
// squareEnv dependency list, so an inline literal keeps all 64 memoized squares
// re-rendering however well the rest of the props are memoized. Module-level
// constants cost nothing and are never mutated (Board only reads them).
const EMPTY_SQUARES: Square[] = [];
const EMPTY_MOVES: Move[] = [];
const EMPTY_PREMOVES: QueuedPremove[] = [];

// The in-game view for any server-authoritative online game (friend games and
// rated matchmade games). The parent owns the connection and lobby flow; this
// component takes over once the server has sent `start`.
export function OnlineMatch({ session, start, subtitle, onExit }: Props) {
  const myColor = start.color;
  const clockEnabled = start.timeSec > 0;
  const myName = start.players?.[myColor]?.name ?? "You";
  // Owner "fun with friends" gate (UX only; the server re-verifies the account
  // on every gated message). The -15s clock button and the god panel show only
  // for the god-panel accounts; matched case-insensitively like the server does.
  const isOwnerAccount = isGodPanelUser(myName);
  const myRating = start.players?.[myColor]?.rating ?? null;
  const myProvisional = start.players?.[myColor]?.provisional ?? false;
  const oppColor: Color = myColor === "w" ? "b" : "w";
  const oppName = start.players?.[oppColor]?.name ?? "Opponent";
  const oppRating = start.players?.[oppColor]?.rating ?? null;
  const oppProvisional = start.players?.[oppColor]?.provisional ?? false;
  // Draft ruleset: the server owns offers and resolutions; this component
  // keeps a deterministic replica in the game object (see lib/draftOnline).
  const isDraft = !!start.draft;
  // Section split: nerf mode (hidden nerfs, nerf-modifier buffs only) or
  // buff mode (no nerfs at all). Absent = legacy merged draft games.
  const isBuffMode = isDraft && start.mode === "buff";
  const isNerfMode = isDraft && start.mode === "nerf";
  const picksVisible = !!start.picksVisible;

  // Owner god panel is opt-in: it only mounts when ilovenewjeans has switched it
  // on from /mod (persisted in app_settings). Fetched once for the owner account;
  // non-owners never render the panel and never make this request. Defaults to
  // hidden, so a failed or pending fetch simply keeps it off.
  const [godPanelOn, setGodPanelOn] = useState(false);
  useEffect(() => {
    if (!isOwnerAccount) return;
    let cancelled = false;
    fetch("/api/mod/god-panel")
      .then((res) => (res.ok ? (res.json() as Promise<{ enabled: boolean }>) : null))
      .then((data) => {
        if (!cancelled && data) setGodPanelOn(data.enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOwnerAccount]);

  // "Game on" flourish: the board just went live for you — your challenge was
  // accepted, you were matched, or you joined a friend's game and both players
  // are now here. Play it once, at the true start only:
  //  - `start.moves.length === 0` keeps a mid-game reconnect / resume silent
  //    (the server replays a `start` frame with the moves already on the board,
  //    and opening an in-progress game in a fresh tab lands here too).
  //  - a per-game-id sessionStorage flag survives a refresh in the opening
  //    seconds (before either side has moved), so the kickoff never repeats.
  // Spectators render a different view and never reach OnlineMatch, so they are
  // naturally excluded. Empty deps: this fires on the initial mount only.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (start.moves && start.moves.length > 0) return;
    const key = `dc:started:${start.id}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // sessionStorage unavailable (private mode / quota): fall through and
      // still announce — a rare double-ding beats silence at the true start.
    }
    playGameStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draft games open with a nerf draft: pick one of two rules before the
  // game exists. While it is unresolved there is no game to build (the
  // server holds the match un-started and the clocks off).
  const [nerfDraft, setNerfDraft] = useState<MPNerfDraft | null>(() => start.nerfDraft ?? null);
  // Two-step nerf pick: the first click only selects; Confirm (or a second
  // click on the same card) sends it. Purely client-side, the server still
  // receives the same single pick message.
  const [nerfSelected, setNerfSelected] = useState<number | null>(null);
  const [game, setGame] = useState<NerfGame | null>(() =>
    start.nerfDraft ? null : buildGameFromStart(start),
  );
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Owner "recording mode": a purely-visual layout that reflows the board,
  // players, and clocks into a centered 9:16 column for a vertical-video crop
  // (YouTube Shorts / Instagram Reels). Toggled from the god panel; changes
  // nothing about the game itself. Off for everyone but the owner account.
  const [recordingMode, setRecordingMode] = useState(false);
  // Owner "clean frame" for recording: hide the clock + player-name bar that
  // rides beneath the board in recording mode, for a board-only capture (a
  // scripted-video aid). Purely visual and owner-only, like recording mode.
  const [recCleanFrame, setRecCleanFrame] = useState(false);
  const [uiSettings, setUiSettings] = useState(() => loadSettings());
  // Follow settings written from anywhere, not only from this page's own
  // settings panel closing. The board flip control and its `f` key write
  // `flipBoard` through the normal settings path, and without this listener the
  // board would not turn until the panel was next opened and shut. Mirrors
  // /game's own sync (src/app/game/page.tsx).
  useEffect(() => {
    const sync = () => setUiSettings(loadSettings());
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
  }, []);
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [confirmingDraw, setConfirmingDraw] = useState(false);
  // A move held for confirmation (Settings > Gameplay > Move confirmation).
  const [confirmMovePending, setConfirmMovePending] = useState<Move | null>(null);
  const [drawOfferBy, setDrawOfferBy] = useState<Color | null>(null);
  const [drawOfferStatus, setDrawOfferStatus] = useState<"idle" | "offering" | "declined">("idle");
  // Abort-abuse notice from the server after my abort: at the threshold
  // ("warning") or actively blocked from new games ("timeout" + cooldown
  // minutes, computed at event time -- render must stay pure).
  const [abortNotice, setAbortNotice] = useState<{ level: "warning" | "timeout"; minutes?: number } | null>(null);
  const [takebackOfferBy, setTakebackOfferBy] = useState<Color | null>(null);
  const [takebackStatus, setTakebackStatus] = useState<"idle" | "offering" | "declined">("idle");
  const [whiteMs, setWhiteMs] = useState(start.wc);
  const [blackMs, setBlackMs] = useState(start.bc);
  const [premoves, setPremoves] = useState<QueuedPremove[]>([]);
  // Crazyhouse drop mode: the pocket piece type currently armed for a drop, or
  // null. While set, the board highlights every legal drop square (via the
  // shared pickSquares plumbing) and clicking one plays the drop.
  const [dropType, setDropType] = useState<PieceType | null>(null);
  const [pendingLocalMove, setPendingLocalMoveState] = useState<PendingLocalMove | null>(null);
  const [awaitingPremoveAck, setAwaitingPremoveAckState] = useState(false);
  const [historyPly, setHistoryPly] = useState<number | null>(null);
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
  // Desktop: the left command rail can be collapsed to give the board the
  // extra ~340px. Persisted per browser; the board sizing math reserves less
  // width while collapsed (see boardFitClass).
  const [railCollapsed, setRailCollapsed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRailCollapsed(window.localStorage.getItem("dc:rail-collapsed") === "1");
    } catch {}
  }, []);
  const toggleRail = () => {
    setRailCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("dc:rail-collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  };
  // The rail can also be dragged wider/narrower by its right edge (desktop);
  // --match-rail-w feeds both the grid column and the board sizing math.
  const { railWidth, resizeRail, railWidthStyle } = useRailWidth();
  const [revealedOppNerf, setRevealedOppNerf] = useState<Nerf | null>(() => {
    const oppId = start.revealed?.[start.color === "w" ? "b" : "w"];
    return oppId ? IMPLEMENTED_BY_ID[oppId] ?? null : null;
  });
  const [ratingChange, setRatingChange] = useState<{ before: number; after: number; provisional?: boolean } | null>(null);
  // Post-game standing in the mode pool: the viewer's W/L/D and current rank,
  // read once from the leaderboard API after a rated game. Null for guests and
  // casual games (the API returns no `me` row for them).
  const [poolStanding, setPoolStanding] = useState<{
    record: { wins: number; losses: number; draws: number };
    rank: number;
  } | null>(null);
  const [chatMessages, setChatMessages] = useState<MPChatMessage[]>(() => start.chat ?? []);
  // The full public draft-action record for THIS viewer: seeded from the start
  // payload (so refreshes and reconnects keep the whole history) and appended
  // as resolved/used frames arrive. Feeds the result screen's match timeline;
  // without it a finished draft game wrongly read "no card record".
  const [dtActionLog, setDtActionLog] = useState<MPDraftAction[]>(() =>
    start.dtActions ? [...start.dtActions] : [],
  );
  const [rematchStatus, setRematchStatus] = useState<"none" | "offered" | "incoming">("none");
  // Abandonment claims: opponentGone arrived and no sign of life since; after
  // CLAIM_DELAY_AFTER_GONE_MS the claim buttons appear (server re-checks).
  const [opponentGone, setOpponentGone] = useState(false);
  const [claimReady, setClaimReady] = useState(false);
  // When the opponent-gone frame arrived (local receipt). The server sends no
  // disconnect timestamp on that frame, so the "claim in Ns" countdown below is
  // measured from this local receipt plus the fixed CLAIM_DELAY_AFTER_GONE_MS,
  // not from an authoritative server time. It is honest about one thing only:
  // when this client will surface the claim buttons (and the server re-checks
  // the abandonment when the claim is actually sent).
  const [opponentGoneAt, setOpponentGoneAt] = useState<number | null>(null);
  const [claimInSeconds, setClaimInSeconds] = useState(0);
  // Who is spectating this game right now, pushed by the server's `watchers`
  // frame (seeded on connect, refreshed on every watch/leave). Names are the
  // signed-in watchers only; `n` includes anonymous viewers.
  const [spectators, setSpectators] = useState<{ n: number; names: string[] }>({ n: 0, names: [] });
  // Feed of the cards/hexes the opponent has played. Each play shows in the
  // top-right for 10 seconds (OppPlaysLog TTL), then flies down into the
  // dock's permanent "Opponent played" ledger, so nothing they did is ever
  // unreadable.
  const [oppLog, setOppLog] = useState<OppPlay[]>([]);
  const oppKeyRef = useRef(0);
  const showOppUsedCard = (card: { id: string; tier: number }, label: string) => {
    // Bounded but roomy: the dock keeps the whole game's plays readable.
    setOppLog((log) => [...log, { key: oppKeyRef.current++, card, label, at: Date.now() }].slice(-60));
  };
  // Transient "God panel used" banners: the server broadcasts a godUsed frame to
  // the whole table whenever an owner uses a god-panel tool, and each one shows
  // as a floating notice for a few seconds so its use is never silent. Timers
  // are tracked so they can be cleared on unmount.
  const [godNotices, setGodNotices] = useState<GodPanelNoticeItem[]>([]);
  const godKeyRef = useRef(0);
  const godTimersRef = useRef<number[]>([]);
  const showGodPanelUse = (by: string, action: string) => {
    const key = godKeyRef.current++;
    setGodNotices((cur) => [...cur, { key, by, action, leaving: false }].slice(-4));
    godTimersRef.current.push(
      window.setTimeout(() => {
        setGodNotices((cur) => cur.map((n) => (n.key === key ? { ...n, leaving: true } : n)));
      }, 4200),
      window.setTimeout(() => {
        setGodNotices((cur) => cur.filter((n) => n.key !== key));
      }, 4600),
    );
  };
  useEffect(() => {
    const timers = godTimersRef.current;
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);
  // Short-lived timers fired from inside the websocket handler (a delayed check
  // sound, the 2.5s "idle" resets for the draw/takeback chips). The handler's
  // own cleanup only unsubscribes, so before this these kept running after the
  // component unmounted: the sound still played on the next page and the
  // setState landed on a dead tree. Same shape as godTimersRef above.
  const transientTimersRef = useRef<number[]>([]);
  const laterRef = useRef((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      transientTimersRef.current = transientTimersRef.current.filter((t) => t !== id);
      fn();
    }, ms);
    transientTimersRef.current.push(id);
  });
  const later = laterRef.current;
  useEffect(() => {
    const timers = transientTimersRef;
    return () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
  }, []);
  // Recording mode is an owner-only, god-panel-driven layout. The reflow is
  // applied only while the panel that owns the toggle is actually mounted, so a
  // stale flag can never reflow the board for a non-owner or after the panel
  // (the toggle's only home) goes away — the frame simply reverts, and the
  // owner's preference is remembered for the next live draft.
  const godPanelAvailable = isOwnerAccount && godPanelOn && isDraft && !!game?.buffs;
  const recordingLayout = recordingMode && godPanelAvailable;
  // Signature spectacles: a played card's id + a monotonic key handed to the
  // Board, which dresses the resulting piece diff as that card's choreography.
  // Fired for BOTH sides' plays (the server echoes every activation), so both
  // players see the identical animation. Set alongside the board update so the
  // two batch into one render and the signature claims exactly that diff.
  // HOLD-AND-REPLAY (owner: "animations must happen when the opponent is
  // watching"): while MY full-screen draft overlay covers the board, incoming
  // play animations would fire to nobody - the single biggest reason plays
  // went unseen. They queue in the shared signature queue instead and replay
  // one by one (2.6s apart, newest 6 kept) the moment the board is visible
  // again. A replayed play has lost its removal diff, so it renders through
  // the board-wide lead fallback (full art + name label, no per-square hits) -
  // the right trade. The queue also serializes SIMULTANEOUS plays (several
  // passives triggered by one move) so each is seen instead of only the last.
  const draftCoveredRef = useRef(false);
  const { signatureCard, fire: fireSigQueued, notifyGateOpen, busy: sigBusy } = useSignatureQueue(draftCoveredRef);
  const fireSignature = (id: string) => {
    // Every known card fires: bespoke signatures get their choreography and
    // every other card gets the Board's category cast spectacle.
    if (!BUFF_BY_ID[id]) return;
    fireSigQueued(id);
  };
  // A held/passive buff whose onMovePlayed hook observably changed the board
  // (a summon, relocate, transform, revive, pawn-push, or a fresh board
  // effect) is a play the table must see too, exactly like an instant pick or
  // an activation. The server reveals every hook-fired card before the move
  // frame, so the id is known here: surface the opponent's to the play feed
  // and fire the signature for either side's, so the whole board-changing
  // archetype is announced, not only captures and hexes.
  const reportHookMutations = (next: NerfGame) => {
    const fired = next.buffs?.lastHookMutations;
    if (!fired) return;
    // Fire every hook-mutated card's signature, not just the first (docs/
    // passive-effect-audit.md R9). The passive layer reads the full mutation
    // list, so simultaneous hook activations each surface their own visual
    // rather than being coalesced to one.
    for (const { color, index } of fired) {
      const inst = next.buffs?.players[color].buffs[index];
      if (!inst?.id) continue;
      if (color !== myColor) {
        showOppUsedCard(
          { id: inst.id, tier: inst.tier },
          `Opponent's ${draftCardNoun(start.mode)} triggered`,
        );
      }
      // Gambling cards record their rolled outcome in inst.state; hand it to
      // the play animation so the table enacts what actually happened.
      if (inst.id.startsWith("gm_")) {
        stashGamblingOutcome(inst.id, { ...inst.state, __spent: inst.spent === true });
      }
      fireSignature(inst.id);
    }
  };
  // Voluntary rule reveals: mine (button flow) and the opponent's (event).
  const [myRevealState, setMyRevealState] = useState<"hidden" | "confirm" | "revealed">(() =>
    start.revealed?.[start.color] ? "revealed" : "hidden",
  );
  const [liveOppReveal, setLiveOppReveal] = useState(() => !!start.revealed?.[start.color === "w" ? "b" : "w"]);
  // The end screen can be dismissed and brought back.
  const [showResult, setShowResult] = useState(true);
  // Draft ruleset UI state: hide the overlay after sending a pick/bank (the
  // server's dtResolved confirms it), and surface the opponent's drafting.
  const [draftSubmitted, setDraftSubmitted] = useState(false);
  // Did I actually pick/bank in the CURRENT shared draft round? Distinguishes
  // "I already resolved, opponent still choosing" from "my draft was genuinely
  // skipped", so the waiting overlay never falsely claims a skip. Set on
  // pick/bank and on my dtResolved; reset when any new round is dealt.
  const [myDraftResolved, setMyDraftResolved] = useState(false);
  // Player clicked the post-draft waiting card away (collapses to the banner).
  const [waitingMinimized, setWaitingMinimized] = useState(false);
  // Enlarged view of the opponent's open offer while I wait for them to finish
  // drafting (their offer is public data — see the DraftOverlay opponent prop).
  const [oppDraftEnlarged, setOppDraftEnlarged] = useState(false);
  // Skip popup (overhaul UX): fires exactly once per fresh engine-recorded
  // skip (lastSkip.atPly changes), announcing WHY the draft round passed the
  // player by, then auto-dismisses. Distinct from the passive waiting card.
  const [skipToast, setSkipToast] = useState<null | { reason: "blocked" | "dry" }>(null);
  // Short answers to the offers you make: "Draw declined", "Takeback declined".
  // The controls panel already says it in small print, but a reply to your
  // offer deserves to land where you are looking, so it also rides the same
  // top toast slot as the draft-skip notice for a few seconds.
  const [replyToast, setReplyToast] = useState<string | null>(null);
  const replyToastTimer = useRef<number | null>(null);
  const showReplyToast = (text: string) => {
    setReplyToast(text);
    if (replyToastTimer.current != null) window.clearTimeout(replyToastTimer.current);
    replyToastTimer.current = window.setTimeout(() => setReplyToast(null), 4500);
  };
  const seenSkipPlyRef = useRef<number | null>(null);
  useEffect(() => {
    const skip = game?.buffs?.players[myColor]?.lastSkip;
    if (!skip || skip.atPly === seenSkipPlyRef.current) return;
    seenSkipPlyRef.current = skip.atPly;
    setSkipToast({ reason: skip.reason });
    const id = window.setTimeout(() => setSkipToast(null), 6500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.buffs?.players[myColor]?.lastSkip?.atPly]);
  const [oppDrafting, setOppDrafting] = useState(() => {
    const opp = start.dtState?.players?.[start.color === "w" ? "b" : "w"];
    return !!opp?.offerPending || !!opp?.offer;
  });
  // Un-dismiss the waiting card whenever the opponent is no longer mid-draft,
  // so each new waiting period starts with the full card again. Adjusted on the
  // change during render rather than in an effect.
  const [prevOppDrafting, setPrevOppDrafting] = useState(oppDrafting);
  if (prevOppDrafting !== oppDrafting) {
    setPrevOppDrafting(oppDrafting);
    if (!oppDrafting) {
      setWaitingMinimized(false);
      // The enlarged opponent-draft view has nothing to show once they lock
      // in; close it so the next waiting period starts fresh.
      setOppDraftEnlarged(false);
    }
  }
  // Lock-in window for the current buff offers; the server auto-resolves at
  // the deadline while both clocks stay paused.
  const [draftDeadline, setDraftDeadline] = useState<number | null>(() => start.dtDeadline ?? null);
  // The opponent resolved their simultaneous draft while mine is still open.
  const [oppLockedIn, setOppLockedIn] = useState(false);
  // Their resolution was a bank rather than a pick (refines the badge copy).
  const [oppBanked, setOppBanked] = useState(false);
  // Shared reveal moment: once BOTH sides of a draft round have resolved, a
  // brief banner pairs my pick with whatever is legitimately visible of the
  // opponent's. The refs hold each side's resolution until the other lands
  // (either order), then the banner fires once and the refs reset.
  const [draftReveal, setDraftReveal] = useState<{
    mine: DraftRevealSide;
    theirs: DraftRevealSide;
  } | null>(null);
  const myResolvedRef = useRef<DraftRevealSide | null>(null);
  const oppResolvedRef = useRef<DraftRevealSide | null>(null);
  const draftRevealTimerRef = useRef<number | null>(null);
  const recordDraftResolution = (resolved: MPDraftResolved) => {
    const side: DraftRevealSide =
      resolved.kind === "picked"
        ? {
            banked: false,
            // Server-filtered already: masked entries carry only a tier and
            // render face-down; never anything the seat may not see.
            cards: (resolved.cards ?? []).map((c) =>
              "id" in c ? { id: c.id, tier: c.tier } : { tier: c.tier },
            ),
          }
        : { banked: true, cards: [] };
    if (resolved.color === myColor) myResolvedRef.current = side;
    else oppResolvedRef.current = side;
    if (myResolvedRef.current && oppResolvedRef.current) {
      const pair = { mine: myResolvedRef.current, theirs: oppResolvedRef.current };
      myResolvedRef.current = null;
      oppResolvedRef.current = null;
      // Both sides have resolved by definition here (either order), so the
      // banner can never appear while a player is still choosing. The short
      // ease-in beat lets the picked card's pocket-flight and dock landing
      // play out before the banner arrives instead of being stomped by the
      // overlay teardown.
      if (draftRevealTimerRef.current != null) window.clearTimeout(draftRevealTimerRef.current);
      draftRevealTimerRef.current = window.setTimeout(
        () => setDraftReveal(pair),
        DRAFT_REVEAL_EASE_MS,
      );
    }
  };
  // The reveal banner is a moment, not a fixture: it holds about four
  // seconds, then dismisses itself.
  useEffect(() => {
    if (!draftReveal) return;
    const id = window.setTimeout(() => setDraftReveal(null), DRAFT_REVEAL_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [draftReveal]);
  useEffect(
    () => () => {
      if (draftRevealTimerRef.current != null) window.clearTimeout(draftRevealTimerRef.current);
    },
    [],
  );
  // Bumped on every `start` replay (reconnect/resync): keys the draft
  // overlay so a rebuilt game always gets a fresh overlay instance. Without
  // it, a pick whose send was lost to a disconnect would leave the overlay's
  // committed flag set with no way back (the offer index alone does not
  // change across a replay of the same round).
  const [replayEpoch, setReplayEpoch] = useState(0);
  // The free lock-in window has run out: the draft moves to a side panel,
  // the board comes back, and the clock runs — deliberating past the window
  // costs the straggler's own time (the server resumes the clock too).
  const [draftGraceOver, setDraftGraceOver] = useState(false);
  // --- Draft lifecycle sequencing -----------------------------------------
  // The state machine (useDraftSequence) orders the draft moments: board
  // spectacles finish first (sigBusy), only then does the overlay mount
  // (chest + deal), and only once the overlay reports both cards dealt and
  // interactive does the countdown REVEAL. The server's shared deadline
  // already includes the presentation budget (draftPrepMs), so the full
  // decision window remains when the countdown appears.
  const liveOffer =
    !game?.result && !draftSubmitted ? game?.buffs?.players[myColor]?.offer ?? null : null;
  const liveOfferKey = liveOffer ? `${liveOffer.index}:${liveOffer.rerolled ?? 0}` : null;
  // The countdown stays hidden until the cards are ready (or the window has
  // already expired, where the compact panel takes over).
  const [countdownRevealed, setCountdownRevealed] = useState(false);
  const draftSeq = useDraftSequence({
    offerKey: liveOfferKey,
    animationsBusy: sigBusy,
    onClock: draftGraceOver,
    onDecisionStart: () => setCountdownRevealed(true),
    onPrepStart: () => setCountdownRevealed(false),
  });
  // An active draft (held, preparing, or deciding) plus any playing spectacle
  // gate every nonessential interruption (performance prompts, achievement
  // toasts): they queue and present after the draft resolves.
  const draftActive = liveOfferKey != null;
  useEffect(() => {
    if (draftActive) return pushUiHold();
  }, [draftActive]);
  useEffect(() => {
    if (sigBusy) return pushUiHold();
  }, [sigBusy]);
  // The board is covered while my offer renders full-screen (the grace-over
  // minimized panel leaves the board visible; a held overlay waiting out the
  // spectacles leaves it visible too). Kept in a ref for fireSignature and
  // mirrored to state-shaped deps for the flush effect.
  const draftCovered = !!liveOffer && !draftGraceOver && draftSeq.overlayVisible;
  useEffect(() => {
    draftCoveredRef.current = draftCovered;
  });
  useEffect(() => {
    if (!draftCovered) notifyGateOpen();
  }, [draftCovered, notifyGateOpen]);
  useEffect(() => {
    // A null deadline means "no live lock-in window" — not started yet, or
    // closed because both seats resolved (draft-state sends an explicit null
    // then). Neither is "the window expired": treating null as already-over
    // was the bug behind "the draft menu keeps minimizing randomly" — a start
    // replay or a frame-early offer saw the deadline as null for a beat and
    // the fresh draft opened straight into the minimized side panel. With no
    // window there is no offer on screen, so the last grace state simply
    // stops mattering; leave it be.
    if (draftDeadline == null) return;
    const left = draftDeadline - Date.now();
    if (left <= 0) {
      queueMicrotask(() => setDraftGraceOver(true));
      return;
    }
    queueMicrotask(() => setDraftGraceOver(false));
    const id = window.setTimeout(() => setDraftGraceOver(true), left + 50);
    return () => window.clearTimeout(id);
  }, [draftDeadline]);
  // A genuinely new offer round always opens full-screen, even when its
  // deadline frame lands a beat behind the offer (the old stale-past deadline
  // would otherwise keep the fresh draft minimized). The one exception is a
  // reconnecting straggler whose window really has expired: a stale-PAST
  // deadline for this very round keeps the side panel. Keyed on the offer
  // alone by design — the deadline effect above owns deadline changes.
  const draftDeadlineRef = useRef(draftDeadline);
  useEffect(() => {
    draftDeadlineRef.current = draftDeadline;
  }, [draftDeadline]);
  useEffect(() => {
    if (liveOfferKey == null) return;
    const dl = draftDeadlineRef.current;
    if (dl != null && dl - Date.now() <= 0) return;
    setDraftGraceOver(false);
  }, [liveOfferKey]);

  // Auto-dismiss the full-screen "waiting for opponent" overlay: while it is
  // up, start a short timer that collapses it to the non-blocking corner pill.
  // The board is click-through underneath either way, but the dim never
  // lingers, so a slow or vanished opponent cannot hold the screen hostage.
  const myOfferOpen = !!game?.buffs?.players[myColor].offer;
  // The opponent's draft is open while I hold no offer of my own: I may not
  // play a live move (the server refuses it with opp_draft_pending), my
  // clock is not being charged, and board input banks premoves until their
  // pick lands.
  const oppDraftHold = isDraft && !!game && !game.result && oppDrafting && !myOfferOpen;
  // Which seat the match clock is charging right now, mirroring the server's
  // chargedColor: nobody during the free lock-in window, the straggling
  // drafter once the window expires with their offer still open, otherwise
  // the side to move.
  const chargedColor: Color | null =
    !game || game.result
      ? null
      : isDraft && !draftGraceOver && (myOfferOpen || oppDrafting)
        ? null
        : isDraft && oppDrafting && !myOfferOpen
          ? oppColor
          : isDraft && myOfferOpen && !oppDrafting
            ? myColor
            : game.board.turn;
  // Skip-pause: when a card the opponent played SKIPS my draft this round, the
  // server still opens the shared lock-in window and pauses BOTH clocks, but I
  // get no dtOffer frame (no offer was rolled for me), so I never learn the
  // window deadline. Without it draftGraceOver stays true (my last deadline is
  // stale/past), the clock is treated as live, and my screen ticks the mover's
  // time while the server has it paused: on my board the opponent's clock runs
  // and mine sits frozen, out of step with the opponent's screen. Adopt the
  // same window locally so both clocks freeze for the free window and resume
  // together when it ends. A real future deadline (my own dtOffer, or the start
  // frame on reconnect) is always trusted over this approximation.
  const skipPauseArmedRef = useRef(false);
  useEffect(() => {
    if (!isDraft || game?.result) {
      skipPauseArmedRef.current = false;
      return;
    }
    // Opponent is drafting while I hold no offer: either my draft was skipped,
    // or their offer simply landed a beat before mine. Arm once per window so a
    // deadline that later expires (opponent still deliberating) is not re-armed.
    const windowOpen = oppDrafting && !myOfferOpen;
    if (!windowOpen) {
      skipPauseArmedRef.current = false;
      return;
    }
    if (skipPauseArmedRef.current) return;
    skipPauseArmedRef.current = true;
    if (draftDeadline == null || draftDeadline - Date.now() <= 0) {
      queueMicrotask(() => setDraftDeadline(Date.now() + DRAFT_LOCK_IN_MS));
    }
  }, [isDraft, oppDrafting, myOfferOpen, game?.result, draftDeadline]);

  const boardShellRef = useRef<HTMLDivElement | null>(null);
  // Mouse-wheel move navigation (lichess-style): a stable, non-passive wheel
  // listener on the board reads the latest nav state from this ref, so the
  // handler never needs re-binding as the game advances.
  const wheelNavRef = useRef<{
    blocked: boolean;
    ply: number | null;
    min: number;
    max: number;
    nav: (ply: number) => void;
  }>({ blocked: false, ply: null, min: 0, max: 0, nav: () => {} });
  const lastWheelNavRef = useRef(0);
  const recordedResult = useRef(false);
  // The authoritative game, mirrored in a ref so websocket events can read
  // and advance it synchronously (several frames can arrive in one tick).
  // Server events must never do their work inside a setState updater: React
  // may invoke updaters more than once, which would double-fire side effects
  // like shifting the premove queue.
  const gameRef = useRef<NerfGame | null>(game);
  // Per-ply board snapshots, captured as the game advances. History review
  // otherwise reconstructs a position by replaying moves from the initial
  // board, which cannot reproduce the position once a buff mutated the board
  // directly (a summon/removal/teleport sets buffs.historyDiverged). These
  // snapshots hold the exact board shown at each ply, so navigation keeps
  // working across such events.
  const boardSnapshotsRef = useRef<Map<number, BoardState>>(new Map());
  const awaitingPremoveAckRef = useRef(false);
  const pendingPremoveRef = useRef<PendingPremoveSend | null>(null);
  const pendingLocalMoveRef = useRef<PendingLocalMove | null>(null);
  const premovesRef = useRef<QueuedPremove[]>([]);

  const applyGame = (next: NerfGame | null) => {
    gameRef.current = next;
    setGame(next);
  };

  const setAwaitingPremoveAck = (value: boolean, pending: PendingPremoveSend | null = null) => {
    awaitingPremoveAckRef.current = value;
    pendingPremoveRef.current = value ? pending : null;
    setAwaitingPremoveAckState(value);
  };

  const setPendingLocalMove = (pending: PendingLocalMove | null) => {
    pendingLocalMoveRef.current = pending;
    setPendingLocalMoveState(pending);
  };

  // Replica drift recovery: when the server accepts a move our replica cannot
  // reproduce (buff-granted moves, dropped frames) or rejects one of ours as
  // stale, never strand the board. Log the desync, show a transient notice,
  // and pull the full authoritative state; the replayed `start` frame rebuilds
  // the game and clears the notice. Rate-limited so a persistent mismatch
  // cannot spin the socket.
  const lastResyncAtRef = useRef(0);
  const resyncFromServer = (reason: string) => {
    console.error(`[online] board desynced from server (${reason}); requesting authoritative state`);
    setError("Board out of sync, refreshing from the server…");
    setPendingLocalMove(null);
    setAwaitingPremoveAck(false);
    clearPremoves();
    const now = nowMs();
    if (now - lastResyncAtRef.current < 2000) return;
    lastResyncAtRef.current = now;
    session.resync();
  };

  useEffect(() => {
    queueMicrotask(() => setMutedState(isMuted()));
  }, []);

  // Remember that this device is mid-game so the home page can offer a
  // "rejoin" shortcut if the tab is closed; forget it once the game ends.
  // The seat credentials go into the per-game store too: friend games never
  // pass through the queue/lobby seat save, so without this the rejoin link
  // at /game/[id] would land the seat holder as a spectator.
  useEffect(() => {
    saveActiveGame(start.id);
    saveOnlineSeat(start.id, { color: start.color, token: start.token });
  }, [start.id, start.color, start.token]);
  useEffect(() => {
    if (!game?.result) return;
    // A finished game must never re-capture /friend or /game/[id].
    clearActiveGame(start.id);
    clearOnlineSeat(start.id);
  }, [game?.result, start.id]);

  // The queue ref is always updated synchronously alongside the state, so
  // websocket handlers can trust it without waiting for a render.
  const setPremoveQueue = (next: QueuedPremove[]) => {
    premovesRef.current = next;
    setPremoves(next);
  };

  const clearPremoves = () => setPremoveQueue([]);

  // One premove at a time, Lichess-style: a new premove replaces the old one
  // (the queue type stays an array so the board props and the ack path are
  // unchanged, but its length is never above one).
  const enqueuePremove = (move: Move) => {
    setPremoveQueue([
      { from: move.from, to: move.to, promotion: move.promotion, capture: !!move.captured },
    ]);
  };

  const shiftPremove = () => setPremoveQueue(premovesRef.current.slice(1));

  // Matches a queued premove against a concrete legal move. A premove queued
  // as a capture only fires as a capture; a quiet premove may still fire as a
  // capture if the destination got occupied in the meantime.
  const premoveMatches = (head: QueuedPremove) => (candidate: Move) =>
    candidate.from === head.from &&
    candidate.to === head.to &&
    (candidate.promotion ?? undefined) === (head.promotion ?? undefined) &&
    (!head.capture || !!candidate.captured);

  // Immediate audio feedback for a move we just sent: the board already shows
  // it optimistically, so the sound must not wait for the server ack either.
  const playMoveSound = (move: Move, base: BoardState) => {
    if (move.captured) playCapture();
    else playMoveSfx();
    const after = makeMove(cloneBoard(base), move);
    // Run the buff-aware test against a view of the live game holding the
    // optimistic board, so a check delivered only through buff-granted
    // movement still sounds; without game context fall back to the plain test.
    const g = gameRef.current;
    const inCheck = g ? gameInCheck({ ...g, board: after }, after.turn) : isInCheck(after, after.turn);
    if (inCheck) later(playCheck, 80);
  };

  // Fire the queued premove the instant it becomes our turn. No artificial
  // delay: the board already shows the premoved position, so the accepted
  // move landing is visually a no-op (Lichess-style).
  function queuePremoveSend(snapshot: NerfGame) {
    if (awaitingPremoveAckRef.current || pendingLocalMoveRef.current) return;
    if (snapshot.result || snapshot.board.turn !== myColor) return;
    // Draft: a pending buff offer blocks all of my moves (the server would
    // reject them with draft_pending); the queue fires once it resolves.
    if (snapshot.buffs?.players[myColor].offer) return;
    // The opponent's open draft blocks my moves too (opp_draft_pending):
    // hold the queue until their pick lands — the draft-resolved handler
    // re-fires it.
    if (snapshot.buffs?.players[oppColor].offer) return;
    const head = premovesRef.current[0];
    if (!head) return;
    const move = legalMoves(snapshot).find(premoveMatches(head));
    if (!move) {
      // The premove became illegal: cancel the queue cleanly.
      clearPremoves();
      return;
    }
    // Safety net: never auto-play into check (see premoveSelfChecks). The
    // same move stays available manually for a deliberate king walk.
    if (premoveSelfChecks(snapshot, move, myColor)) {
      clearPremoves();
      return;
    }

    const uci = moveToUCI(move);
    const ply = snapshot.board.history.length;
    const sent = session.sendMove(uci, ply);
    if (!sent) {
      clearPremoves();
      setError("Disconnected from the game server.");
      return;
    }
    // "held": the move is buffered until the socket is back. No ack timer
    // (nothing is in flight yet) and no optimistic state; the reconnecting
    // banner already explains the wait, and the disconnected handler drops
    // the held copy if the connection is lost again.
    if (sent === "sent") setAwaitingPremoveAck(true, { uci, ply });
    playMoveSound(move, snapshot.board);
  }

  // Server events. The server is authoritative: a local move is shown
  // optimistically (pendingLocalBoard) and confirmed, or rolled back, when the
  // websocket answers.
  useEffect(() => {
    const off = session.on((e) => {
      if (e.type === "error") {
        setError(e.message);
        setPendingLocalMove(null);
        setAwaitingPremoveAck(false);
        clearPremoves();
        // A rejected draft frame re-opens the overlay for another try.
        setDraftSubmitted(false);
        // The server refusing our move as stale or illegal means the local
        // replica has drifted from the authoritative game: resync instead of
        // dead-ending on the error message. The optimistic piece snaps back
        // when pendingLocalMove clears above, so pair that rollback with an
        // audible cue and a message that says what happened and what to do.
        if (e.code === "stale_ply" || e.code === "illegal_move") {
          playError();
          setError("Your move was not accepted. The board has been resynced; try the move again.");
          resyncFromServer(`server rejected our move: ${e.code}`);
        }
      } else if (e.type === "disconnected") {
        // The ConnectionBanner (session.onConnectionState) owns the visible
        // "Connection lost / Reconnecting" notice; keep the action-rail error
        // free for move/action failures rather than duplicating it here.
        setPendingLocalMove(null);
        setAwaitingPremoveAck(false);
        // The optimistic move just rolled back, so a copy held for the
        // reconnect must not play on our behalf later; and the premove queue
        // is cleared so it cannot double-send once the socket is back.
        session.dropHeldMove();
        clearPremoves();
      } else if (e.type === "reconnecting") {
        // Handled by the ConnectionBanner; nothing to surface in the rail.
      } else if (e.type === "start") {
        // Reconnected: the server replayed the full game (moves, clocks,
        // chat, and a trailing `end` frame if it finished while we were away).
        setError(null);
        // Restore the abandonment state from the server rather than blindly
        // clearing it: `opponentGone` is a one-shot frame the server latches
        // and will not re-send, so a refresh mid-window used to lose the
        // claim-win UI permanently. oppGoneSince is the real disconnect
        // timestamp, so the "claim in Ns" countdown resumes where it stood
        // instead of restarting.
        if (e.setup.oppGoneSince != null) {
          setOpponentGone(true);
          // Normalize to the moment the notice would have fired, which is what
          // the claim countdown below measures from.
          setOpponentGoneAt(e.setup.oppGoneSince + DISCONNECT_GRACE_MS);
        } else {
          setOpponentGone(false);
        }
        setPendingLocalMove(null);
        setAwaitingPremoveAck(false);
        clearPremoves();
        setWhiteMs(e.setup.wc);
        setBlackMs(e.setup.bc);
        setChatMessages(e.setup.chat ?? []);
        const oppRevealId = e.setup.revealed?.[oppColor];
        if (oppRevealId && IMPLEMENTED_BY_ID[oppRevealId]) {
          setRevealedOppNerf(IMPLEMENTED_BY_ID[oppRevealId]);
          setLiveOppReveal(true);
        }
        if (e.setup.revealed?.[myColor]) setMyRevealState("revealed");
        setDraftSubmitted(false);
        // A replay cannot prove whether I resolved the in-flight round; clear
        // the mark and lean on the blockedDrafts evidence gate so an uncertain
        // reconnect shows the neutral "waiting", never a false skip.
        setMyDraftResolved(false);
        const oppState = e.setup.dtState?.players?.[oppColor];
        setOppDrafting(!!oppState?.offerPending || !!oppState?.offer);
        setDraftDeadline(e.setup.dtDeadline ?? null);
        setOppLockedIn(false);
        // A replay is a clean slate for the shared reveal moment too (a
        // queued ease-in from before the disconnect must not fire late).
        myResolvedRef.current = null;
        oppResolvedRef.current = null;
        if (draftRevealTimerRef.current != null) {
          window.clearTimeout(draftRevealTimerRef.current);
          draftRevealTimerRef.current = null;
        }
        setDraftReveal(null);
        setReplayEpoch((n) => n + 1);
        // Nerf draft still unresolved: (re)enter the pick screen with the
        // server's authoritative options and pick state. Otherwise build the
        // game as usual (this is also how the draft screen hands over once
        // both picks are in).
        setNerfDraft(e.setup.nerfDraft ?? null);
        // The replayed start carries the authoritative action record: reset the
        // local log to it so the timeline never double-counts after a reconnect.
        setDtActionLog(e.setup.dtActions ? [...e.setup.dtActions] : []);
        applyGame(e.setup.nerfDraft ? null : buildGameFromStart(e.setup));
      } else if (e.type === "nerf-picked") {
        // Progress only: never the card. My own echo is just an ack.
        if (e.color !== myColor) {
          setNerfDraft((nd) => (nd ? { ...nd, oppPicked: true } : nd));
        }
      } else if (e.type === "opponent-gone") {
        // The dedicated claim panel below surfaces "Opponent disconnected" plus
        // the countdown, so the rail error is left for real action failures.
        setOpponentGone(true);
        setOpponentGoneAt(Date.now());
        setPendingLocalMove(null);
        setAwaitingPremoveAck(false);
      } else if (e.type === "clocks") {
        setWhiteMs(e.wc);
        setBlackMs(e.bc);
      } else if (e.type === "watchers") {
        setSpectators({ n: e.n, names: e.names ?? [] });
      } else if (e.type === "move") {
        setDrawOfferBy(null);
        setDrawOfferStatus("idle");
        // Any accepted move proves the opponent (or we) are alive again.
        setOpponentGone(false);
        const g = gameRef.current;
        if (!g) return;
        // Turn/ply authority: the server stamps every accepted move with its
        // post-move ply (its authoritative move count). A replica that is not
        // exactly one ply behind has missed or duplicated a frame, so its
        // board.turn has drifted from the server — whoever's turn it thinks it
        // is no longer matches. Never apply a move on top of that gap (the
        // incoming UCI can be coincidentally legal in the stale position and
        // advance the board onto a permanently wrong turn): force a full
        // resync from the authoritative snapshot instead. This is the fix for
        // two clients disagreeing on whose turn it is after a dropped frame.
        if (e.move.ply !== g.board.history.length + 1) {
          setWhiteMs(e.move.wc);
          setBlackMs(e.move.bc);
          resyncFromServer(
            `move ply ${e.move.ply} does not follow local ply ${g.board.history.length} (missed/duplicated frame)`,
          );
          return;
        }
        // The server already validated this move. If the replica cannot
        // regenerate it (a hidden nerf or buff effect it does not know
        // about), apply it raw instead of freezing the board — a raw apply
        // keeps the position, turn, and clocks in sync, where the old
        // resync-only path could dead-end forever if the rebuilt replay hit
        // the same blind spot. The ply guard above already proved this frame
        // lands exactly one ply ahead, so a raw apply never runs on a gap.
        let lm = legalMoves(g).find((x) => moveToUCI(x) === e.move.u);
        if (!lm) {
          const raw = moveFromUCI(g.board, e.move.u);
          if (raw) {
            console.warn(
              `[online] applying server-accepted move ${e.move.u} raw (not locally reproducible)`,
            );
            lm = raw;
          }
        }
        const wasAwaitingPremove = awaitingPremoveAckRef.current;
        const pendingPremove = pendingPremoveRef.current;
        const pendingLocal = pendingLocalMoveRef.current;
        // Our own optimistic sends already sounded at send time.
        const alreadySounded =
          (pendingLocal && pendingLocal.uci === e.move.u && e.move.ply === pendingLocal.ply + 1) ||
          (wasAwaitingPremove &&
            pendingPremove &&
            pendingPremove.uci === e.move.u &&
            e.move.ply === pendingPremove.ply + 1);
        if (!lm) {
          // The server accepted a move our replica considers illegal (a
          // buff-granted move it could not regenerate, or any other drift).
          // Keep the clocks honest and rebuild from the server's replay
          // rather than leaving the board frozen.
          setWhiteMs(e.move.wc);
          setBlackMs(e.move.bc);
          resyncFromServer(`accepted move ${e.move.u} (ply ${e.move.ply}) is not reproducible locally`);
          return;
        }
        // Draft replicas discard the placeholder offer rolls playMove makes
        // locally; the server's dtOffer / dtState frames carry the real ones.
        const next = isDraft ? playReplicaMove(g, lm) : playMove(g, lm);
        // Authoritative position/turn check: the server ships fnv1a(positionKey)
        // of its post-move board (side to move included). Even at the right ply,
        // a raw apply can land on a different position than the server (a hidden
        // nerf side-effect the replica cannot reproduce), which would silently
        // flip whose turn each client shows. Compare our post-move hash against
        // the server's; on a mismatch, trust the server, beacon the drift, and
        // resync rather than playing on from a diverged board. dtState frames
        // never carry the board, so a position mismatch can only be repaired by
        // a full resync.
        if (e.move.f) {
          const clientHash = fnv1a(positionKey(next.board));
          if (clientHash !== e.move.f) {
            setWhiteMs(e.move.wc);
            setBlackMs(e.move.bc);
            beaconTurnDesync(start.id, clientHash, e.move.f, activeRuleIds(next));
            resyncFromServer(
              `post-move position hash ${clientHash} != server ${e.move.f} at ply ${e.move.ply}`,
            );
            return;
          }
        }
        applyGame({ ...next });
        // A held buff whose onMovePlayed hook mutated the board this move (a
        // self-buff summon/transform/revive/removal reacting to the move) has
        // no play frame of its own: surface it from the recorded mutations.
        reportHookMutations(next);
        setConfirmMovePending(null);
        setWhiteMs(e.move.wc);
        setBlackMs(e.move.bc);
        if (pendingLocalMoveRef.current) {
          setPendingLocalMove(null);
        }
        if (wasAwaitingPremove) {
          setAwaitingPremoveAck(false);
          if (
            pendingPremove &&
            lm.color === myColor &&
            e.move.u === pendingPremove.uci &&
            e.move.ply === pendingPremove.ply + 1
          ) {
            shiftPremove();
          } else {
            clearPremoves();
          }
        }
        if (!alreadySounded) {
          if (lm.captured) playCapture();
          else playMoveSfx();
          if (gameInCheck(next, next.board.turn)) later(playCheck, 80);
        }
        // Our turn again (opponent moved, or our premove landed and the next
        // queued one already applies): fire the queued premove immediately.
        if (next.board.turn === myColor) queuePremoveSend(next);
      } else if (e.type === "end") {
        setConfirmMovePending(null);
        setConfirmingDraw(false);
        setOpponentGone(false);
        setShowResult(true);
        setWhiteMs(e.end.wc);
        setBlackMs(e.end.bc);
        setPendingLocalMove(null);
        setAwaitingPremoveAck(false);
        setDrawOfferBy(null);
        setDrawOfferStatus("idle");
        clearPremoves();
        const oppNerfId = e.end.nerfs?.[oppColor];
        if (oppNerfId && IMPLEMENTED_BY_ID[oppNerfId]) {
          setRevealedOppNerf(IMPLEMENTED_BY_ID[oppNerfId]);
        }
        const change = e.end.ratings?.[myColor];
        if (change) setRatingChange({ before: change.before, after: change.after, provisional: change.provisional });
        const finished = gameRef.current;
        if (finished) {
          // Game over: every held buff goes public (like both nerfs), so
          // swap the masked placeholders for the revealed record.
          if (e.end.draftBuffs && finished.buffs) revealHeldBuffs(finished.buffs, e.end.draftBuffs);
          applyGame({ ...finished, result: e.end.result });
        }
      } else if (e.type === "draw-offer") {
        setError(null);
        setDrawOfferBy(e.color);
        setDrawOfferStatus(e.color === myColor ? "offering" : "idle");
      } else if (e.type === "abort-warning") {
        setAbortNotice({
          level: e.level,
          minutes: e.until ? Math.max(1, Math.ceil((e.until - Date.now()) / 60_000)) : undefined,
        });
      } else if (e.type === "draw-declined") {
        setDrawOfferBy(null);
        setDrawOfferStatus(e.color === myColor ? "idle" : "declined");
        if (e.color !== myColor) showReplyToast("Draw declined");
        if (e.color !== myColor) {
          later(() => setDrawOfferStatus("idle"), 2500);
        }
      } else if (e.type === "takeback-offer") {
        setError(null);
        setTakebackOfferBy(e.color);
        setTakebackStatus(e.color === myColor ? "offering" : "idle");
      } else if (e.type === "takeback-declined") {
        setTakebackOfferBy(null);
        setTakebackStatus(e.color === myColor ? "idle" : "declined");
        if (e.color !== myColor) showReplyToast("Takeback declined");
        if (e.color !== myColor) {
          later(() => setTakebackStatus("idle"), 2500);
        }
      } else if (e.type === "takeback") {
        // The server rewound the move list — rebuild the whole game from it,
        // exactly like a reconnect replay.
        setError(null);
        setPendingLocalMove(null);
        setAwaitingPremoveAck(false);
        clearPremoves();
        setHistoryPly(null);
        setConfirmMovePending(null);
        setTakebackOfferBy(null);
        setTakebackStatus("idle");
        setDrawOfferBy(null);
        setWhiteMs(e.wc);
        setBlackMs(e.bc);
        applyGame(buildGameFromStart({ ...start, moves: e.moves }));
        playMoveSfx();
      } else if (e.type === "chat") {
        setChatMessages((msgs) => [...msgs, e.message].slice(-50));
      } else if (e.type === "god-panel-used") {
        showGodPanelUse(e.by, e.action);
      } else if (e.type === "rule-revealed") {
        if (e.color === myColor) {
          setMyRevealState("revealed");
        } else if (IMPLEMENTED_BY_ID[e.nerfId]) {
          setRevealedOppNerf(IMPLEMENTED_BY_ID[e.nerfId]);
          setLiveOppReveal(true);
          playNerf();
        }
      } else if (e.type === "draft-offer") {
        const g = gameRef.current;
        if (e.offer.color !== myColor) setOppDrafting(true);
        // A fresh round of simultaneous offers: restart the lock-in window.
        if (e.offer.deadline) setDraftDeadline(e.offer.deadline);
        setOppLockedIn(false);
        setOppBanked(false);
        // A new shared round is being dealt (both offers arrive together, and
        // before either side resolves): clear the "resolved this round" mark so
        // the waiting overlay can tell a real skip from a just-finished pick.
        setMyDraftResolved(false);
        // New round: any half-collected reveal from the last one is stale.
        if (e.offer.color === myColor) {
          myResolvedRef.current = null;
          oppResolvedRef.current = null;
        }
        if (!g?.buffs) return;
        // Only frames the server addressed to us carry cards we may see: our
        // own offers always, the opponent's only under picksVisible.
        if (e.offer.color === myColor || picksVisible) {
          g.buffs.players[e.offer.color].offer = {
            cards: e.offer.cards as BuffOffer["cards"],
            index: e.offer.index,
            ...(e.offer.banked ? { banked: true } : {}),
          };
          if (e.offer.color === myColor) setDraftSubmitted(false);
          applyGame({ ...g });
        }
      } else if (e.type === "draft-state") {
        const g = gameRef.current;
        // The server's live lock-in deadline rides every dtState frame: a
        // reroll restarts the shared window (fresh prep + full decision time)
        // and this is how the fresh deadline reaches both clients.
        // `null` is meaningful: it means the window closed (both seats resolved
        // before it expired), so the local copy must be cleared. Only an
        // ABSENT field is "no news" — an older server that never sends it.
        if (e.state.deadline !== undefined) setDraftDeadline(e.state.deadline);
        if (!g?.buffs) return;
        mergeDraftState(g.buffs, e.state, myColor);
        // Server-authoritative reroll counts (not carried by mergeDraftState).
        for (const c of ["w", "b"] as Color[]) {
          const rl = e.state.players[c]?.rerollsLeft;
          if (rl != null) g.buffs.players[c].rerollsLeft = rl;
        }
        const opp = e.state.players[oppColor];
        setOppDrafting(!!opp?.offerPending || !!opp?.offer);
        applyGame({ ...g });
      } else if (e.type === "draft-resolved") {
        const g = gameRef.current;
        if (!g?.buffs) return;
        const action: MPDraftAction =
          e.resolved.kind === "picked"
            ? { ply: g.board.history.length, color: e.resolved.color, a: "pick", cards: e.resolved.cards ?? [] }
            : { ply: g.board.history.length, color: e.resolved.color, a: "bank" };
        applyDraftAction(g, action);
        setDtActionLog((log) => [...log, action]);
        // Shared reveal moment: hold this side's resolution; once both sides
        // of the round are in (either order), fire the banner. The server
        // already filtered `cards` for this seat (masked entries carry only a
        // tier), so nothing hidden can surface.
        recordDraftResolution(e.resolved);
        if (e.resolved.color === myColor) {
          setDraftSubmitted(false);
          // I picked or banked this round: never let the waiting overlay call
          // it a skip while the opponent is still deciding.
          setMyDraftResolved(true);
        } else {
          setOppDrafting(false);
          // "Opponent locked in": shown while my own pick is still open.
          setOppLockedIn(true);
          setOppBanked(e.resolved.kind !== "picked");
          if (e.resolved.kind === "picked") {
            playNerf();
            // Instants reveal at pick because their effect already shows on
            // the board; explain what the card did.
            const revealed = (e.resolved.cards ?? []).find((c) => "id" in c) as
              | { id: string; tier: number }
              | undefined;
            if (revealed) showOppUsedCard(revealed, `Opponent played a ${draftCardNoun(start.mode)}`);
          }
        }
        // A signature card that resolves as a draft instant (rather than a
        // later activation) fires here for whichever seat can see its id.
        if (e.resolved.kind === "picked") {
          for (const c of e.resolved.cards ?? []) {
            // Instants resolve on the board at pick time; other kinds fire
            // later at activation (dtUsed), so only instants cast here.
            if ("id" in c && BUFF_BY_ID[c.id]?.kind === "instant") {
              fireSignature(c.id);
              break;
            }
          }
        }
        applyGame({ ...g });
        // The opponent's pick lifted the draft hold: any premove banked
        // while the board was locked fires now (no move frame arrives to
        // trigger it otherwise, since it is already my turn).
        if (e.resolved.color !== myColor && !g.buffs?.players[myColor].offer) {
          queuePremoveSend(g);
        }
      } else if (e.type === "draft-used") {
        const g = gameRef.current;
        if (!g?.buffs) return;
        const useAction: MPDraftAction = {
          ply: g.board.history.length,
          color: e.used.color,
          a: "use",
          buffIndex: e.used.buffIndex,
          picks: e.used.picks,
          card: e.used.card,
        };
        applyDraftAction(g, useAction);
        setDtActionLog((log) => [...log, useAction]);
        if (e.used.color !== myColor) {
          playNerf();
          if (e.used.card) showOppUsedCard(e.used.card, `Opponent used a ${draftCardNoun(start.mode)}`);
        }
        // Signature spectacle for EITHER side's activation (the board update
        // below batches with this so the Board claims exactly this diff).
        // Gambling cards first stash their just-rolled outcome (inst.state,
        // filled by applyDraftAction above) so the animation plays the TRUE
        // branch: the lootbox opens what it opened.
        if (e.used.card?.id.startsWith("gm_")) {
          const inst = g.buffs.players[e.used.color].buffs[e.used.buffIndex];
          if (inst?.id === e.used.card.id) {
            stashGamblingOutcome(inst.id, { ...inst.state, __spent: inst.spent === true });
          }
        }
        if (e.used.card) fireSignature(e.used.card.id);
        applyGame({ ...g });
      } else if (e.type === "draft-diff-flag") {
        // Someone flagged the Chess Diff's 1+0 clock: replay the same action
        // the server recorded, so the diff ends against them, the paused game
        // (board, effects) is restored, and the winner's mythic lands. The
        // restored clocks arrive through the accompanying clock frame.
        const g = gameRef.current;
        if (!g?.buffs) return;
        applyDraftAction(g, { ply: g.board.history.length, color: e.color, a: "diffFlag" });
        applyGame({ ...g });
      } else if (e.type === "rematch-offer") {
        setRematchStatus(e.color === myColor ? "offered" : "incoming");
        // An offer from the opponent is proof of life. It also dings like a
        // challenge, so an offer arriving with the end panel closed (or the
        // tab in the background) still lands.
        if (e.color !== myColor) {
          setOpponentGone(false);
          playChallenge();
        }
      } else if (e.type === "rematch-cancelled") {
        // Only clear the status when the withdrawn offer is the one it shows:
        // our own offer withdrawn from another tab, or the opponent taking
        // back the incoming one. The opponent cancelling a stale offer of
        // theirs must not erase an offer we still have standing.
        setRematchStatus((s) => (e.color === myColor || s === "incoming" ? "none" : s));
      } else if (e.type === "rematched") {
        // Take the new seat and load the fresh game with a clean slate.
        saveOnlineSeat(e.id, { color: e.color, token: e.token });
        window.location.href = `/game/${e.id}`;
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, myColor]);

  const moves = useMemo(() => (game ? legalMoves(game) : []), [game]);
  // The opponent's would-be moves, for the click-an-enemy-piece inspection
  // preview (dots on every square that piece could reach).
  const oppPreviewMoves = useMemo(
    () => (game && !game.result ? previewMovesFor(game, oppColor) : []),
    [game, oppColor],
  );
  // Computed off the render path (idle callback) so the frame that lands the
  // opponent's move never pays for 30 to 80 makeMove calls before it paints.
  const moveRisks = useDeferredMoveRisks(
    game,
    moves,
    uiSettings.moveRiskWarnings && !!game && game.board.turn === myColor,
  );

  useEffect(() => {
    if (!game) return;
    const shell = boardShellRef.current;
    const boardEl = shell?.querySelector("[data-board-measure]");
    if (!boardEl) return;
    let raf = 0;
    const syncHeight = () => setBoardHeight(boardEl.getBoundingClientRect().height);
    // Defer a frame before re-measuring: on fullscreen / orientation / viewport
    // changes the board's dvh/vw-based size settles a tick after the event
    // fires, so measuring immediately would cache a stale height and leave the
    // side rails clipped or misaligned.
    const syncDeferred = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncHeight);
    };
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(boardEl);
    window.addEventListener("resize", syncDeferred);
    window.addEventListener("orientationchange", syncDeferred);
    document.addEventListener("fullscreenchange", syncDeferred);
    window.visualViewport?.addEventListener("resize", syncDeferred);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", syncDeferred);
      window.removeEventListener("orientationchange", syncDeferred);
      document.removeEventListener("fullscreenchange", syncDeferred);
      window.visualViewport?.removeEventListener("resize", syncDeferred);
    };
  }, [game]);

  // Scroll over the board to step through the game (wheel up = back, wheel
  // down = forward), mirroring the arrow-key navigation. The listener lives on
  // the board shell only, so scrolling the move list or chat still scrolls
  // them; it stands down while a modal/overlay owns the screen, and leaves the
  // event alone at either end so the page can still scroll normally.
  useEffect(() => {
    const el = boardShellRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const st = wheelNavRef.current;
      if (st.blocked || st.max === 0) return;
      // Ignore mostly-horizontal scrolls (trackpad side-swipes).
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const cur = st.ply ?? st.max;
      const next = cur + (e.deltaY < 0 ? -1 : 1);
      // st.min is the earliest reviewable ply (positions past a board-rewriting
      // card can't be replayed); past either end the page scrolls normally.
      if (next < st.min || next > st.max) return;
      e.preventDefault();
      // Throttle to one step per gesture beat, so inertia scrolling does not
      // rocket through the whole game in a single flick.
      const now = Date.now();
      if (now - lastWheelNavRef.current < 60) return;
      lastWheelNavRef.current = now;
      st.nav(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [game]);

  // Record the live board at each ply so history review can reconstruct
  // positions even after a board-mutating buff diverged from move history.
  useEffect(() => {
    if (!game) return;
    const ply = game.board.history.length;
    // cloneBoard only slices the pieces array (the Piece objects stay shared),
    // so also copy each Piece: a persisted snapshot must never be rewritten by
    // a later in-place mutation (a promotion or a transform buff).
    const snap = cloneBoard(game.board);
    snap.pieces = snap.pieces.map((p) => (p ? { ...p } : null));
    boardSnapshotsRef.current.set(ply, snap);
    // Drop snapshots past the current head so a takeback/rewind never leaves
    // stale future positions behind.
    for (const key of boardSnapshotsRef.current.keys()) {
      if (key > ply) boardSnapshotsRef.current.delete(key);
    }
  }, [game]);

  // History shrank past (or exactly to) the reviewed ply — a takeback or a
  // resync replaced the record. Return to the LIVE board (null), never to
  // historyPly === length: that would strand the UI in a half-review state
  // showing the live position while review still blocks every move and
  // disables the forward controls. Clamped during render, not in an effect.
  if (game && historyPly != null && historyPly >= game.board.history.length) {
    setHistoryPly(null);
  }

  // Game-ended hook: write the finished game into the local history, once.
  // A restored session may already carry a finished game; never re-record it.
  useEffect(() => {
    if (!game?.result) return;
    // Aborted games have no outcome (winner null) and stay out of the local
    // history, which only knows win/loss/draw.
    if (game.result.winner === null && game.result.reason === "aborted") {
      recordedResult.current = true;
      return;
    }
    if (!recordedResult.current && game.board.history.length === (start.moves?.length ?? 0)) {
      // Result present on first render (restored finished game) — skip.
      recordedResult.current = true;
      return;
    }
    if (recordedResult.current) return;
    recordedResult.current = true;
    recordCompletedGame({
      mode: start.rated ? "online" : "friend",
      opponent: oppName,
      myColor,
      outcome: outcomeFor(game.result.winner, myColor),
      reason: game.result.reason,
      rated: !!start.rated,
      moveCount: game.board.history.length,
      baseSec: start.timeSec,
      incSec: start.incrementSec,
      ratingChange,
      myNerf: nerfSummary(myColor === "w" ? game.white.nerf : game.black.nerf),
      opponentNerf: nerfSummary(revealedOppNerf),
      moves: game.board.history.map(moveToUCI),
      serverGameId: start.id,
    });
  }, [game, myColor, oppName, ratingChange, revealedOppNerf, start]);

  // One leaderboard read after a rated game supplies both the post-game W/L/D
  // record and the current rank for the result screen (the API's `me` row).
  // Fires once per finished game; guests/casual get no `me` row and are omitted.
  useEffect(() => {
    if (!start.rated || !game?.result) return;
    if (start.mode !== "nerf" && start.mode !== "buff") return;
    let cancelled = false;
    fetch(`/api/leaderboard?category=${start.mode}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const me = (data as { me?: { rank?: number; wins?: number; losses?: number; draws?: number } } | null)?.me;
        if (!cancelled && me && typeof me.rank === "number") {
          setPoolStanding({
            record: { wins: me.wins ?? 0, losses: me.losses ?? 0, draws: me.draws ?? 0 },
            rank: me.rank,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [start.rated, start.mode, game?.result]);

  // The reviewed board is derived from the snapshot cache (a ref, so writing it
  // every ply never re-renders). Refs cannot be read during render, so the
  // review board is computed in an effect and held as state instead; review is
  // a deliberate, low-frequency interaction, so the extra render is free.
  const [reviewBoard, setReviewBoard] = useState<BoardState | null>(null);
  useEffect(() => {
    queueMicrotask(() => {
      if (!game || historyPly == null) {
        setReviewBoard(null);
        return;
      }
      const snaps = boardSnapshotsRef.current;
      // Prefer the exact board we witnessed live at this ply: a snapshot taken
      // as the game advanced includes any buff mutations (summons, removals,
      // teleports) that a pure move replay cannot reproduce.
      const snap = snaps.get(historyPly);
      if (snap) {
        setReviewBoard(snap);
        return;
      }
      // Snapshot gap (several server frames applied in one batched update leave
      // intermediate plies without a snapshot): bridge it by replaying the
      // recorded moves onto the nearest earlier snapshot.
      let baseKey = -1;
      for (const key of snaps.keys()) {
        if (key < historyPly && key > baseKey) baseKey = key;
      }
      if (baseKey >= 0) {
        setReviewBoard(replayBoardSpan(snaps.get(baseKey)!, game.board.history, baseKey, historyPly));
        return;
      }
      // No snapshot at or below this ply (a reconnect rebuild): a clean replay
      // from the start is only faithful while no card has rewritten the board.
      // Navigation never reaches here after divergence (reviewFloor clamps),
      // so the null is a backstop, not a UI state.
      if (game.buffs?.historyDiverged) {
        setReviewBoard(null);
        return;
      }
      setReviewBoard(boardAtPly(game.board.history, historyPly));
    });
     
  }, [game, historyPly]);
  // Earliest ply history review can faithfully reach. While the move list
  // still reproduces the board (no card rewrote it) everything replays from
  // ply 0. After divergence only positions witnessed live (the snapshots) are
  // trustworthy — a reconnect that joined after the divergence has none, so
  // its earlier plies are unreviewable. Navigation clamps here and the
  // MoveList explains why instead of showing a wrong (or live) board.
  const [reviewFloor, setReviewFloor] = useState(0);
  useEffect(() => {
    queueMicrotask(() => {
      if (!game?.buffs?.historyDiverged) {
        setReviewFloor(0);
        return;
      }
      let min = game.board.history.length;
      for (const key of boardSnapshotsRef.current.keys()) {
        if (key < min) min = key;
      }
      setReviewFloor(min);
    });
     
  }, [game]);
  const pendingLocalBoard = useMemo(() => {
    if (!game || !pendingLocalMove || pendingLocalMove.ply !== game.board.history.length) return null;
    return makeMove(cloneBoard(game.board), pendingLocalMove.move);
  }, [game, pendingLocalMove]);
  const currentHistoryPly = historyPly ?? game?.board.history.length ?? 0;
  const isReviewingHistory = historyPly != null;
  const handleHistoryPlyChange = (ply: number) => {
    const max = game?.board.history.length ?? 0;
    // Clamp into the reviewable window; the head (or an empty window, when
    // reviewFloor === max) always resolves to the live board.
    const target = Math.max(reviewFloor, ply);
    if (target >= max) {
      setHistoryPly(null);
    } else {
      setHistoryPly(Math.max(0, target));
      clearPremoves();
    }
  };

  const myNerfForPremove = game ? (myColor === "w" ? game.white.nerf : game.black.nerf) : null;
  const myStateForPremove = game ? (myColor === "w" ? game.white.state : game.black.state) : null;

  // The board shown while premoves are queued: the current position (plus my
  // own not-yet-acknowledged move, if any) with every still-plausible queued
  // premove applied. Premoved pieces stay visually "held" on their destination
  // squares through opponent moves until the premove executes or is cancelled.
  const { virtualBoard, validPremoves } = useMemo(() => {
    if (
      !game ||
      game.result ||
      (game.board.turn === myColor && !pendingLocalMove && premoves.length === 0)
    ) {
      return { virtualBoard: null as BoardState | null, validPremoves: [] as QueuedPremove[] };
    }
    let board = cloneBoard(pendingLocalBoard ?? game.board);
    board.turn = myColor;
    board.epTarget = null;
    // When it's actually my turn (no local move in flight), the head premove
    // is about to be sent: validate it against the same legal-move list
    // queuePremoveSend uses, so the display never disagrees with execution.
    const executingHead = game.board.turn === myColor && !pendingLocalBoard;
    const valid: QueuedPremove[] = [];
    for (const [index, pm] of premoves.entries()) {
      let match: Move | undefined;
      if (index === 0 && executingHead) {
        match = legalMoves(game).find(premoveMatches(pm));
      } else {
        const ctx: GameContext = {
          board,
          me: myColor,
          opponentLastMove: [...board.history].reverse().find((m) => m.color !== myColor) ?? null,
          myLastMove: [...board.history].reverse().find((m) => m.color === myColor) ?? null,
          moveNumber: board.history.filter((m) => m.color === myColor).length,
          capturedByMe: game.captured[myColor],
          capturedFromMe: game.captured[myColor === "w" ? "b" : "w"],
        };
        // Passing the game unions buff-granted movement into both sets, so a
        // piece a card transformed/upgraded can be premoved with its real
        // moves and still matches when the premove fires.
        const strictOptions = premoveOptionsFor(board, myColor, myNerfForPremove, myStateForPremove, ctx, game);
        const fallbackOptions = premoveOptionsFor(board, myColor, null, null, null, game);
        const options = [
          ...strictOptions,
          ...fallbackOptions.filter((m) => !strictOptions.some((s) => moveKey(s) === moveKey(m))),
        ];
        match = options.find(premoveMatches(pm));
      }
      if (!match) break;
      board = makeMove(board, match);
      board.turn = myColor;
      board.epTarget = null;
      valid.push(pm);
    }
    return { virtualBoard: board, validPremoves: valid };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, myColor, premoves, pendingLocalBoard, myNerfForPremove, myStateForPremove]);

  const premoveOptions = useMemo<Move[]>(() => {
    if (!virtualBoard || !game) return [];
    const ctx: GameContext = {
      board: virtualBoard,
      me: myColor,
      opponentLastMove: [...virtualBoard.history].reverse().find((m) => m.color !== myColor) ?? null,
      myLastMove: [...virtualBoard.history].reverse().find((m) => m.color === myColor) ?? null,
      moveNumber: virtualBoard.history.filter((m) => m.color === myColor).length,
      capturedByMe: game.captured[myColor],
      capturedFromMe: game.captured[myColor === "w" ? "b" : "w"],
    };
    // Strict (nerf-filtered) options only, so the dots shown during the
    // opponent's turn already reflect where your rule forbids you to move.
    // Queued premoves are still re-validated with a lenient fallback when the
    // turn actually arrives (context-dependent rules can change by then).
    // The game argument unions buff-granted movement into the option set.
    return premoveOptionsFor(virtualBoard, myColor, myNerfForPremove, myStateForPremove, ctx, game);
  }, [virtualBoard, myColor, game, myNerfForPremove, myStateForPremove]);

  // Any time it is not strictly "my turn with nothing in flight" — opponent
  // thinking, my own move awaiting its ack, or a queued premove being sent —
  // board input queues premoves instead of being dropped, so fast players
  // never hit a dead input window between moves.
  const premoveMode =
    uiSettings.premovesEnabled &&
    !!game &&
    !game.result &&
    !!virtualBoard &&
    (game.board.turn !== myColor ||
      !!pendingLocalMove ||
      awaitingPremoveAck ||
      premoves.length > 0 ||
      // Waiting on the opponent's draft: live moves are blocked, so board
      // input banks premoves that flush the instant their pick lands.
      oppDraftHold);

  // Draft ruleset: activation is only legal on my turn with nothing pending.
  const draftCanAct =
    isDraft &&
    !!game &&
    !game.result &&
    game.board.turn === myColor &&
    !game.buffs?.players[myColor].offer &&
    // The opponent's open draft blocks activations the same way it blocks
    // moves (the server refuses both with opp_draft_pending).
    !oppDraftHold &&
    !isReviewingHistory &&
    !pendingLocalMove &&
    !awaitingPremoveAck;
  // Activated buffs target on the real board: candidate squares highlight on
  // the live board and clicking one advances the pick chain. Enemy-buff-list
  // targets fall back to the modal below.
  // Presentation only: bumped when a targeting tap lands on a non-eligible
  // square, so the TargetingBanner flashes its "what is targetable" hint.
  const [invalidPickKey, setInvalidPickKey] = useState(0);
  // Purely visual reconnect treatment: mirror the same coarse connection
  // state the ConnectionBanner subscribes to (multi-listener, read-only).
  // While the socket is down the board dims 20% and input is disabled via the
  // Board's existing disabled prop; nothing about the reconnect logic or the
  // live game state is touched, and recovery restores silently.
  const [connectionLost, setConnectionLost] = useState(false);
  useEffect(() => {
    return session.onConnectionState((state) => {
      setConnectionLost(state === "lost" || state === "reconnecting");
    });
  }, [session]);
  const buffTargeting = useBuffTargeting({
    game,
    myColor,
    active: draftCanAct,
    onUse: (buffIndex, picks) => {
      if (!session.useBuff(buffIndex, picks)) setError("Disconnected from the game server.");
    },
  });

  // Mirror the latest nav state into the ref the stable wheel listener reads.
  // Written from an effect (not during render) so the ref never drives
  // rendering; kept above every early return to stay a valid hook, so the
  // block condition is recomputed here from source state (mirrors the render
  // derivation below of myOffer / genuinelySkipped / showWaitingOverlay).
  // The same flag gates the move list's arrow keys.
  const historyNavBlocked = (() => {
    if (!game) return true;
    const mine = isDraft ? game.buffs?.players[myColor] : undefined;
    const offer = mine?.offer ?? null;
    const skipped =
      !offer && !draftSubmitted && !myDraftResolved && (mine?.flags.blockedDrafts ?? 0) > 0;
    const waiting =
      isDraft && !game.result && oppDrafting && (draftSubmitted || myDraftResolved || skipped);
    return (
      settingsOpen ||
      (!!game.result && showResult) ||
      !!buffTargeting.targeting ||
      (isDraft && !!offer && !draftSubmitted && !draftGraceOver && !game.result) ||
      waiting
    );
  })();
  useEffect(() => {
    if (!game) return;
    wheelNavRef.current = {
      blocked: historyNavBlocked,
      ply: historyPly,
      min: reviewFloor,
      max: game.board.history.length,
      nav: handleHistoryPlyChange,
    };
  });

  const handleLocalMove = (m: Move) => {
    if (!game || game.result || isReviewingHistory) return;
    // Draft: resolve the pending buff draft before moving (mirrors the
    // server's draft_pending rejection).
    if (game.buffs?.players[myColor].offer) return;
    if (premoveMode) {
      enqueuePremove(m);
      return;
    }
    // Premoves disabled + opponent mid-draft: drop the input rather than
    // send a move the server will refuse (opp_draft_pending).
    if (oppDraftHold) return;
    if (game.board.turn !== myColor) return;
    if (awaitingPremoveAck || pendingLocalMove) return;
    // Match on drop too: a crazyhouse drop has from === to, so two pocket
    // pieces droppable onto the same square would otherwise be indistinguishable
    // by from/to/promotion alone.
    const lm = moves.find(
      (x) =>
        x.from === m.from &&
        x.to === m.to &&
        (x.promotion ?? null) === (m.promotion ?? null) &&
        (x.drop ?? null) === (m.drop ?? null),
    );
    if (!lm) return;
    if (uiSettings.confirmMove) {
      // Hold the move for an explicit confirm tap; the board previews it.
      setConfirmMovePending(lm);
      return;
    }
    sendMoveNow(lm);
  };

  const sendMoveNow = (lm: Move) => {
    if (!game) return;
    clearPremoves();
    setAwaitingPremoveAck(false);
    const uci = moveToUCI(lm);
    const ply = game.board.history.length;
    const sent = session.sendMove(uci, ply);
    if (!sent) {
      setPendingLocalMove(null);
      setError("Disconnected from the game server.");
      return;
    }
    // "held": the socket is down and the move is buffered until the seat is
    // reclaimed. Show nothing optimistic for it: the board stays on the last
    // confirmed position, the ConnectionBanner covers the wait, and the move
    // arrives as a normal server frame once flushed (or is dropped by the
    // disconnected handler if the link fails again). That keeps the display
    // honest: a piece never sits on a square the server has not confirmed
    // while the link that would confirm it is down.
    if (sent === "held") return;
    setPendingLocalMove({ uci, ply, move: lm });
    playMoveSound(lm, game.board);
  };

  const confirmHeldMove = () => {
    const held = confirmMovePending;
    setConfirmMovePending(null);
    if (held) sendMoveNow(held);
  };

  // Drop mode: Escape disarms the pocket piece, matching the buff-targeting
  // cancel gesture.
  useEffect(() => {
    if (!dropType) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropType(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dropType]);

  // Losing the turn (or any pending/offer state) auto-disarms drop mode so the
  // board never stays in a pick state the player can no longer act on. Adjusted
  // during render rather than in an effect so no stale pick state lingers.
  if (dropType && !draftCanAct) setDropType(null);

  // Execute queued premove when our turn comes
  useEffect(() => {
    if (!game || game.result || premoves.length === 0) return;
    queuePremoveSend(game);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, premoves, moves, myColor, awaitingPremoveAck]);

  useEffect(() => {
    if (!awaitingPremoveAck) return;
    const id = window.setTimeout(() => {
      setAwaitingPremoveAck(false);
      setPendingLocalMove(null);
      clearPremoves();
      playError();
      setError("The premove did not reach the game server. Try the move again.");
    }, 5000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingPremoveAck]);

  useEffect(() => {
    if (!pendingLocalMove) return;
    const id = window.setTimeout(() => {
      setPendingLocalMove(null);
      playError();
      setError("The move did not reach the game server. Try the move again.");
    }, 5000);
    return () => window.clearTimeout(id);
     
  }, [pendingLocalMove]);

  // When the current turn started. Held as state (read during render by the
  // clock-delay helper below), seeded from mount time via a lazy initializer;
  // the per-turn update is deferred a microtask so it isn't a synchronous
  // setState inside the effect body.
  // null until this client has actually WATCHED a turn begin. Seeding it from
  // mount time meant every reconnect/refresh re-granted a full grace: refresh
  // 90s into your own first move and the pill froze showing "+10" free seconds
  // the server had exhausted 80s earlier, and the flag nudge below was armed
  // 10s late. The one case where mount time IS the turn start is a game that
  // has only just begun — no moves yet and both clocks still untouched — so
  // that seeds honestly and every other mount shows no grace at all (the
  // server is authoritative for the clock either way; the display just stops
  // claiming time that may already be spent).
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(() =>
    start.moves.length === 0 && start.wc === start.bc ? Date.now() : null,
  );
  const seenPlyRef = useRef<number | null>(null);
  useEffect(() => {
    const ply = game?.board.history.length;
    if (ply == null) return;
    const prev = seenPlyRef.current;
    seenPlyRef.current = ply;
    // Only a transition we observed marks a fresh turn; the first run after a
    // mount just records where we came in.
    if (prev !== null && prev !== ply) queueMicrotask(() => setTurnStartedAt(Date.now()));
  }, [game?.board.history.length]);

  const clockStartDelay = (color: Color) => {
    if (!game || game.result || game.board.turn !== color) return 0;
    if (turnStartedAt === null) return 0;
    const activeMoves = game.board.history.filter((m) => m.color === color).length;
    if (activeMoves > 0) return 0;
    return Math.max(0, FIRST_MOVE_GRACE_MS - (Date.now() - turnStartedAt));
  };

  // Server-authoritative timeout: the moment the active side's clock reads
  // zero locally, ask the server for clocks — it runs its flag check before
  // answering and broadcasts the end frame, so the game finishes promptly
  // even if neither player sends another move. Keep nudging until the end
  // arrives (covers clock drift and dropped frames); the server remains the
  // sole judge of whether anyone actually flagged.
  useEffect(() => {
    if (!clockEnabled || !game || game.result) return;
    // Clock paused for a draft lock-in window: no flag can fall due. Once
    // the free window has expired the clock is live again even with an
    // unresolved offer — charged to the straggling drafter — so the flag
    // check must keep running against whoever is actually being billed.
    if (chargedColor === null) return;
    const active = chargedColor;
    const activeMs = active === "w" ? whiteMs : blackMs;
    let interval: number | undefined;
    const timer = window.setTimeout(() => {
      session.requestClocks();
      interval = window.setInterval(() => session.requestClocks(), 500);
    }, Math.max(0, clockStartDelay(active) + activeMs) + 200);
    return () => {
      window.clearTimeout(timer);
      if (interval !== undefined) window.clearInterval(interval);
    };
    // draftGraceOver / oppDrafting must be deps: the early return above keys on
    // them, and draftGraceOver flips on its own timer with no game/clock frame
    // accompanying it. Without them, a draft window that expired with no
    // further server frames left this effect un-rerun — no flag-check timer was
    // ever armed, so a player letting their clock run out after the free
    // window could hang the game until some other frame arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, whiteMs, blackMs, clockEnabled, session, draftGraceOver, oppDrafting]);

  // The low-time warning is owned by the local player's ClockPill (warnLowTime):
  // it plays the lichess LowTime sample as the visible clock ticks under 10s and
  // an urgent tick under 5s, once per crossing, deduped across the duplicated
  // mobile/desktop copies. Tying it to the ClockPill keeps the alert in step with
  // the countdown the player actually sees (a one-shot timer here drifted from
  // the display and fired at a fixed 15s) and matches the local game exactly.
  // Draft free-window pauses are handled for free: the ClockPill's `active`
  // prop is gated on `draftClockPaused`, so no warning sounds mid-pick.

  // Surface the claim buttons once the opponent has stayed gone long enough
  // for the server to accept a claim; hide them the moment they return.
  useEffect(() => {
    if (!opponentGone || game?.result) {
      queueMicrotask(() => setClaimReady(false));
      return;
    }
    // Wait out only the time REMAINING. On a reconnect opponentGoneAt is
    // reconstructed from the server's disconnect timestamp, so most (or all) of
    // the delay may already have elapsed; a flat 15s here would restart it.
    const elapsed = opponentGoneAt != null ? Date.now() - opponentGoneAt : 0;
    const wait = Math.max(0, CLAIM_DELAY_AFTER_GONE_MS - elapsed);
    const id = window.setTimeout(() => setClaimReady(true), wait);
    return () => {
      window.clearTimeout(id);
      setClaimReady(false);
    };
  }, [opponentGone, opponentGoneAt, game?.result]);

  // Tick the "You can claim the win in Ns" countdown while the opponent is gone
  // but the claim window has not opened yet. Derived purely from the local
  // opponent-gone receipt (see opponentGoneAt) since the server frame carries
  // no timestamp; it counts down exactly to when claimReady flips.
  useEffect(() => {
    if (!opponentGone || claimReady || game?.result) return;
    const start = opponentGoneAt ?? Date.now();
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((CLAIM_DELAY_AFTER_GONE_MS - (Date.now() - start)) / 1000),
      );
      setClaimInSeconds(remaining);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [opponentGone, claimReady, opponentGoneAt, game?.result]);

  // Everything the Board needs, derived once per position.
  //
  // This sits ABOVE the early returns below because it has to: the derivations
  // it replaces live after `if (!game) return null`, so a hook there would be
  // conditional. Up here it is unconditionally reached and guards on `!game`
  // itself.
  //
  // Why it matters: Board keys around thirty internal memos and all 64 memoized
  // squares on the identity of `visual` and its fields. Building that object
  // inline in JSX handed them a brand new object, with brand new nested arrays,
  // on EVERY render, so every clock frame (twice a second), every toast and
  // every drawer toggle re-rendered the whole board and rebuilt every overlay
  // memo. Board's memo machinery was doing nothing.
  //
  // Keying on `game` identity is safe for the reason the codebase already
  // relies on: setGame is called in exactly one place (applyGame) and every
  // call site passes a fresh shallow copy. `moves` above has depended on that
  // same contract all along. These derivations are pure reads with no clock or
  // randomness, so nothing can go stale that `game` identity misses.
  const derived = useMemo(() => {
    if (!game) return null;
    const dMyNerf = myColor === "w" ? game.white.nerf : game.black.nerf;
    const dMyState = myColor === "w" ? game.white.state : game.black.state;
    const dMyCtx = makeContext(game, myColor);
    const dVisual = dMyNerf.visual?.(dMyState, dMyCtx);
    const dZone = isDraft && game.buffs ? draftZones(game, myColor) : null;
    // Effect kinds draftZones does not paint (king_safe shields, pawn-clamp
    // fences, pending-skip stuns): shared derivation, same as the bot game.
    const dFxZone = dZone ? computeFxVisual(game) : null;
    const dHint = currentHint(game, myColor);
    const dForced = dHint?.squares ?? EMPTY_SQUARES;
    const dBoardVisual = {
      ...(dVisual ?? {}),
      highlightSquares: dForced,
      ...(dZone
        ? {
            bannedSquares: [...(dVisual?.bannedSquares ?? []), ...dZone.barred],
            frozenSquares: dZone.frozen,
            frozenSkins: dZone.frozenSkin,
            effectTurns: dZone.turns,
            shieldedSquares: dZone.shielded,
            wardSquares: dZone.ward,
            strikeSquares: dZone.strike,
            walnutSquares: dZone.walnut,
            bananaSquares: dZone.banana,
            trapSquares: dZone.traps,
            doomSquares: dZone.doom,
            // Previously missing online: king-only / no-pawn-advance shackles
            // now paint here too.
            lockedSquares: dZone.locked,
            barredSquares: dZone.barred,
            ...(dFxZone ? fxVisualFields(dFxZone) : {}),
          }
        : {}),
    };
    return {
      myNerf: dMyNerf,
      myState: dMyState,
      myCtx: dMyCtx,
      visual: dVisual,
      zone: dZone,
      fxZone: dFxZone,
      hint: dHint,
      forcedSquares: dForced,
      boardVisual: dBoardVisual,
    };
  }, [game, myColor, isDraft]);

  // The check highlight, memoized for the same reason as `derived`: it was a
  // fresh array every render and sits directly in Board's squareEnv dependency
  // list, so on its own it would have kept all 64 squares re-rendering however
  // well the visual object was memoized. It also runs gameInCheck for BOTH
  // colors, and in a draft game each of those is a full move generation.
  //
  // BOTH kings are tested every ply: a king may legally stand in check in this
  // variant, so a checked king stays red on the opponent's turn too. Buff-aware
  // on the live position (amazon-style empowered attacks count), plain test
  // while reviewing history.
  //
  // The optimistic board (my move, not yet acknowledged) is what gets tested
  // when it exists, so the enemy king turns red the instant my piece lands
  // rather than one round trip later.
  const checkSquares = useMemo(() => {
    if (!game || !uiSettings.checkHighlight) return EMPTY_SQUARES;
    const checked = reviewBoard ?? pendingLocalBoard ?? game.board;
    const liveGame = pendingLocalBoard && !reviewBoard ? { ...game, board: pendingLocalBoard } : game;
    const out: Square[] = [];
    for (const color of ["w", "b"] as const) {
      const attacked = reviewBoard ? isInCheck(checked, color) : gameInCheck(liveGame, color);
      if (!attacked) continue;
      const k = findKing(checked, color);
      if (k != null) out.push(k);
    }
    return out.length ? out : EMPTY_SQUARES;
  }, [game, uiSettings.checkHighlight, reviewBoard, pendingLocalBoard]);

  const onClaimWin = () => {
    if (!game || game.result) return;
    setError(null);
    if (!session.claimWin()) setError("Disconnected from the game server.");
  };

  const onClaimDraw = () => {
    if (!game || game.result) return;
    setError(null);
    if (!session.claimDraw()) setError("Disconnected from the game server.");
  };

  const onResign = () => {
    if (!game || game.result) return;
    session.resign();
  };

  // Abort: no confirm step -- it is only offered before one whole turn exists,
  // so nothing is at stake yet (the server enforces the same bound).
  const onAbort = () => {
    if (!game || game.result) return;
    setError(null);
    if (!session.abort()) setError("Disconnected from the game server.");
  };

  const requestResign = () => {
    if (uiSettings.confirmResign) setConfirmingResign(true);
    else onResign();
  };

  const onOfferDraw = () => {
    if (!game || game.result || drawOfferStatus === "offering") return;
    if (uiSettings.confirmDrawOffer && !confirmingDraw) {
      setConfirmingDraw(true);
      return;
    }
    setConfirmingDraw(false);
    setError(null);
    if (!session.offerDraw()) {
      setError("Disconnected from the game server.");
    }
  };

  const onAcceptDraw = () => {
    if (!game || game.result) return;
    setError(null);
    if (!session.acceptDraw()) {
      setError("Disconnected from the game server.");
    }
  };

  const onDeclineDraw = () => {
    if (!game || game.result) return;
    setError(null);
    setDrawOfferBy(null);
    if (!session.declineDraw()) {
      setError("Disconnected from the game server.");
    }
  };

  const onOfferTakeback = () => {
    if (!game || game.result || takebackStatus === "offering") return;
    setError(null);
    if (!session.offerTakeback()) {
      setError("Disconnected from the game server.");
    }
  };

  const onAcceptTakeback = () => {
    if (!game || game.result) return;
    setError(null);
    if (!session.acceptTakeback()) {
      setError("Disconnected from the game server.");
    }
  };

  const onDeclineTakeback = () => {
    if (!game || game.result) return;
    setError(null);
    setTakebackOfferBy(null);
    if (!session.declineTakeback()) {
      setError("Disconnected from the game server.");
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

  // No optimistic echo: the server broadcasts chat back to both players,
  // including the sender.
  const handleSendChat = (text: string) => {
    if (!session.sendChat(text)) {
      setError("Disconnected from the game server.");
    }
  };

  const handleRematch = () => {
    if (rematchStatus === "offered") return;
    if (!session.requestRematch()) {
      setError("Disconnected from the game server.");
      return;
    }
    if (rematchStatus !== "incoming") setRematchStatus("offered");
  };

  // Withdraw a pending rematch offer (surfaced when the opponent has left, so
  // the player is not stuck staring at a "waiting" button nobody will answer).
  const handleCancelRematch = () => {
    if (rematchStatus !== "offered") return;
    if (session.cancelRematch()) setRematchStatus("none");
    else setError("Disconnected from the game server.");
  };

  // Draft games: the opening nerf draft runs before the game exists. Same
  // screen as the bot game: pick one of two nerfs, with the opponent's two
  // options shown on a plate below. The server owns the deal; we only ever
  // send back an index.
  if (nerfDraft) {
    const toNerfs = (ids: string[]) =>
      ids.map((id) => IMPLEMENTED_BY_ID[id]).filter((n): n is Nerf => !!n);
    const myOptions = toNerfs(nerfDraft.options[myColor] ?? []);
    const oppOptions = toNerfs(nerfDraft.options[oppColor] ?? []);
    const picked = nerfDraft.myPick != null ? myOptions[nerfDraft.myPick] ?? null : null;
    const sendPick = (index: number) => {
      if (nerfDraft.myPick != null) return;
      if (session.sendNerfPick(index)) {
        setError(null);
        setNerfDraft({ ...nerfDraft, myPick: index });
      } else {
        setError("Disconnected from the game server.");
      }
    };
    return (
      <main className="min-h-dvh flex items-center justify-center px-4 py-8">
        <ConnectionBanner session={session} />
        <div className="w-full max-w-2xl">
          <div className="text-[12px] text-parchment-400 text-center">Nerf draft</div>
          <h1 className="font-display text-4xl text-parchment text-center mt-1">
            Choose your handicap
          </h1>
          <p className="mt-2 text-sm text-parchment-300 text-center">
            {isNerfMode
              ? "It stays secret until the game ends."
              : "Draft buffs as you play to claw back power."}
          </p>
          {error && (
            <p className="mt-2 text-center text-xs text-oxblood-glow">{error}</p>
          )}
          {nerfDraft.deadline != null && (
            <div className="mx-auto mt-4 max-w-sm">
              {/* At the deadline an unconfirmed selection is submitted as the
                  pick; with nothing selected the server auto-picks option 0. */}
              <LockInCountdown
                deadline={nerfDraft.deadline}
                onExpire={() => {
                  if (nerfDraft.myPick == null && nerfSelected != null) sendPick(nerfSelected);
                }}
              />
            </div>
          )}
          {picked ? (
            <>
              <div className="mt-6 mx-auto max-w-md">
                <NerfCard nerf={picked} ownerLabel="Your nerf" />
              </div>
              <div role="status" aria-live="polite" className="mt-4 plate p-3 text-center">
                <span className="font-display text-sm text-parchment-200">
                  {nerfDraft.oppPicked
                    ? "Opponent locked in."
                    : "Locked in. Waiting for your opponent to choose their rule."}
                </span>
              </div>
            </>
          ) : (
            <>
              {nerfDraft.oppPicked && (
                <div role="status" aria-live="polite" className="mt-4 plate p-2 px-3 text-center">
                  <span className="font-display text-sm font-semibold text-verdigris-glow">
                    Opponent locked in.
                  </span>
                  <span className="font-display text-sm text-parchment-200"> Pick your rule.</span>
                </div>
              )}
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {myOptions.map((n, i) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => (nerfSelected === i ? sendPick(i) : setNerfSelected(i))}
                    className={
                      "mx-auto block w-full max-w-md sm:max-w-none text-left transition-[box-shadow,opacity] duration-200 touch-manipulation" +
                      (nerfSelected === i
                        ? " ring-2 ring-gold"
                        : nerfSelected != null
                        ? " opacity-60"
                        : "")
                    }
                  >
                    <NerfCard
                      nerf={n}
                      preview
                      ownerLabel={nerfSelected === i ? "Selected" : "Pick this nerf"}
                    />
                  </button>
                ))}
              </div>
              {nerfSelected != null && (
                <div className="mt-4 text-center">
                  <Button tone="primary"
                    onClick={() => sendPick(nerfSelected)}
                    className="px-8 py-3 text-base font-semibold tracking-wide">
                    Confirm pick
                  </Button>
                </div>
              )}
            </>
          )}
          {/* Nerf mode: the opponent's nerf is completely hidden; it only
              reveals when the game ends, so their options never show. */}
          {!isNerfMode && (
            <div className="mt-5 plate p-3 text-center">
              <span className="text-[12px] text-parchment-400">
                Your opponent is choosing between
              </span>
              <div className="mt-1 text-sm text-parchment-200 font-display">
                {oppOptions.map((n) => n.name).join("  ·  ")}
              </div>
              <div className="mt-0.5 text-[12px] text-parchment-400">
                {picksVisible
                  ? "Their choice will be visible when the game starts."
                  : "Which one they take stays hidden, unless you draft a reveal."}
              </div>
            </div>
          )}
          {isNerfMode && (
            <p className="mt-5 text-center text-[12px] text-parchment-400">
              Your opponent picks a nerf too. You will see their rule when the game ends.
            </p>
          )}
        </div>
      </main>
    );
  }

  if (!game) return null;
  const ratingStakes = start.rated && !game.result ? start.preview?.[myColor] ?? null : null;
  // Derived once per position by the `derived` memo above.
  const { myNerf, myState, myCtx, visual, zone, fxZone, hint, forcedSquares, boardVisual } =
    derived!;
  // Draft ruleset: pending offer (blocks my board), held-buff dock, and the
  // public zone-effect painting shared with the bot game.
  const bsMine = isDraft ? game.buffs?.players[myColor] : undefined;
  const bsTheirs = isDraft ? game.buffs?.players[oppColor] : undefined;
  const myOffer = bsMine?.offer ?? null;
  // My unresolved draft is past its free window and eating my clock: the
  // ClockPill surfaces a DRAFT tag next to the time so the reason the clock
  // runs is visible even with the draft panel hidden or tucked away.
  const myDraftCharging =
    isDraft && !!myOffer && !draftSubmitted && draftGraceOver && !game.result;
  // Skip detection (overhaul): the engine now records every skipped round
  // explicitly on the victim (lastSkip: blocked by an opponent card, or the
  // pool ran dry), synced through dtState. That replaces the old
  // blockedDrafts>0 heuristic, which could never fire for a SINGLE blocked
  // draft (the counter was already decremented to zero by the time the
  // client looked). A skip is "this round" while I still have no offer and
  // have not resolved one.
  const myLastSkip = bsMine?.lastSkip ?? null;
  const genuinelySkipped =
    !myOffer &&
    !draftSubmitted &&
    !myDraftResolved &&
    (myLastSkip != null || (bsMine?.flags.blockedDrafts ?? 0) > 0);
  const skipReason: "blocked" | "dry" =
    myLastSkip?.reason === "dry" ? "dry" : "blocked";
  // What the opponent drafted this round, for the skipped player's reveal
  // (their held list's newest card; identities are public in draft games).
  const oppNewestCard = (() => {
    const held = bsTheirs?.buffs;
    if (!held?.length) return null;
    const last = held[held.length - 1];
    return last && !last.nullified ? BUFF_BY_ID[last.id] ?? null : null;
  })();
  // The post-draft waiting overlay shows only once I have actually resolved my
  // own draft this round: I picked, I banked, or I was genuinely skipped. It
  // must NOT show merely because I have no offer yet. At the very start of a
  // round the opponent can receive their offer a beat before mine, and keying
  // on !myOffer flashed "opponent is choosing" before my own draft appeared.
  const showWaitingOverlay =
    isDraft &&
    !game.result &&
    oppDrafting &&
    (draftSubmitted || myDraftResolved || genuinelySkipped);
  // Crazyhouse pocket (viewer's own): banked piece types with a positive count.
  // Kings are never bankable. Empty pocket renders no tray.
  const myInventory = game.buffs?.players[myColor].inventory ?? null;
  const pocketEntries = myInventory
    ? (Object.keys(myInventory) as PieceType[])
        .filter((t) => t !== "k" && (myInventory[t] ?? 0) > 0)
        .map((t) => ({ type: t, count: myInventory[t]! }))
    : [];
  // The opponent's pocket, read-only (owner: "be able to see your opponent's
  // pocket") - full transparency covers banked pieces too.
  const oppInventory = game.buffs?.players[oppColor].inventory ?? null;
  const oppPocketEntries = oppInventory
    ? (Object.keys(oppInventory) as PieceType[])
        .filter((t) => t !== "k" && (oppInventory[t] ?? 0) > 0)
        .map((t) => ({ type: t, count: oppInventory[t]! }))
    : [];
  // Squares where the armed pocket piece may legally drop: the engine already
  // generated these as drop moves in the live legal-move list.
  const dropSquares = dropType ? moves.filter((m) => m.drop === dropType).map((m) => m.to) : [];
  // Play the armed drop onto a picked square: find the exact drop move (type +
  // target) and submit it through the same path a normal move uses.
  const submitDrop = (sq: Square) => {
    const dm = moves.find((m) => m.drop === dropType && m.to === sq);
    setDropType(null);
    if (dm) handleLocalMove(dm);
  };
  // Arming a pocket piece cancels any in-progress buff targeting (both drive the
  // board's pickSquares plumbing); clicking the same piece again disarms.
  const handlePocketSelect = (type: PieceType) => {
    buffTargeting.cancel();
    setDropType((prev) => (prev === type ? null : type));
  };
  // Starting a buff activation disarms drop mode for the same reason.
  const startBuffUse = (index: number) => {
    setDropType(null);
    buffTargeting.start(index);
  };
  // Effect kinds draftZones does not paint (king_safe shields, pawn-clamp
  // fences, pending-skip stuns): shared derivation, same as the bot game.
  // Clock displays follow chargedColor (defined with the draft-hold state
  // above): nobody ticks during the free lock-in window, and past it the
  // straggling drafter's pill ticks — never the waiting player's.
  const opponentNerf = revealedOppNerf ?? (myColor === "w" ? game.black.nerf : game.white.nerf);
  const oppNerfShown = !!revealedOppNerf && (liveOppReveal || !uiSettings.hideOpponentReveal);
  // "The rule descends": every nerf the viewer currently knows, for the
  // board's one-shot reveal splash (fired once per color+id inside Board) —
  // their own rule from game start, the opponent's the moment it shows.
  // Placeholder rules (buff mode's no-nerf, the unshackled stub) never
  // announce. Each entry pulses the squares the rule's visual() marks.
  const nerfReveals: NerfRevealInfo[] = [];
  if (!NERF_REVEAL_SKIP.has(myNerf.id)) {
    nerfReveals.push({
      id: myNerf.id,
      name: myNerf.name,
      tier: myNerf.tier as number,
      color: myColor,
      highlightSquares: [...(visual?.highlightSquares ?? []), ...(visual?.bannedSquares ?? [])],
    });
  }
  if (oppNerfShown && revealedOppNerf && !NERF_REVEAL_SKIP.has(revealedOppNerf.id)) {
    const oppState = myColor === "w" ? game.black.state : game.white.state;
    const oppVisual = revealedOppNerf.visual?.(oppState, makeContext(game, oppColor));
    nerfReveals.push({
      id: revealedOppNerf.id,
      name: revealedOppNerf.name,
      tier: revealedOppNerf.tier as number,
      color: oppColor,
      highlightSquares: [
        ...(oppVisual?.highlightSquares ?? []),
        ...(oppVisual?.bannedSquares ?? []),
      ],
    });
  }
  // Persistent nerf auras for the PassiveLayer: the same visibility-filtered
  // known-nerf set the reveal splash uses (own rule always, opponent's once
  // revealed), so every known rule wears its registry aura while it holds.
  const passiveNerfs = nerfReveals.map((r) => ({
    cardId: r.id,
    color: r.color,
    squares: r.highlightSquares ?? [],
  }));
  // Draft games have no "hidden rule" placeholder: while the opponent's rule
  // is unknown their card shows only the player header, and the rule appears
  // there once revealed (end of game or a voluntary reveal). Buff mode never
  // shows a rule section on either card, there are no nerfs at all.
  const hideOppNerfCard = isBuffMode || (isDraft && !oppNerfShown);
  // Nerf mode: held boons ride in the same corner card as the nerf, so the
  // handicap and its reliefs read together at a glance.
  const myHeldBoons =
    game.buffs?.mode === "nerf"
      ? game.buffs.players[myColor].buffs
          .filter((b) => !b.spent && !b.nullified)
          .flatMap((b) => {
            const def = BUFF_BY_ID[b.id];
            return def
              ? [{ name: def.name, tier: b.tier, status: def.status?.(b) ?? null, cost: turnCost(def) }]
              : [];
          })
      : undefined;
  const lastMove = game.board.history[game.board.history.length - 1] ?? null;
  // A held move (confirmation setting) previews on the board before sending.
  const confirmPreviewBoard = confirmMovePending
    ? makeMove(cloneBoard(game.board), confirmMovePending)
    : null;
  // virtualBoard already includes the pending local move (it builds on
  // pendingLocalBoard), so it wins while premoves are queued.
  const boardForDisplay =
    reviewBoard ?? confirmPreviewBoard ?? virtualBoard ?? pendingLocalBoard ?? game.board;
  const orientation: Color = uiSettings.flipBoard ? oppColor : myColor;
  const checkedBoard = reviewBoard ?? game.board;
  // BOTH kings are tested every ply (a king may legally stand in check here,
  // so a checked king stays red on the opponent's turn too). Buff-aware test
  // on the live position (amazon-style empowered attacks count); plain test
  // while reviewing history.
  // checkSquares is memoized above, beside the other per-position derivations.
  // A new constraint landing on me (turn skip, halted pawns, frozen piece...)
  // gets one big board-wide splash (BoardSplashHost below); the dock's
  // "Against you" section keeps the permanent record.
  const againstMe = isDraft && game.buffs ? againstYouRows(game, myColor) : [];
  const lastMoveForDisplay = isReviewingHistory
    ? game.board.history[currentHistoryPly - 1] ?? null
    : confirmMovePending ?? pendingLocalMove?.move ?? lastMove;
  const railHeightStyle = boardHeight
    ? ({ "--board-height": `${boardHeight}px` } as CSSProperties)
    : undefined;
  // Board sizing: the square board must fit BOTH the available height (an
  // h-dvh layout, now including the always-visible player bars above and below
  // the board) and the width left over after the rails present at each
  // breakpoint, so it can never push a rail off-screen. Each min() term
  // reserves: none below sm, the right move rail (~288px + gaps + page
  // padding = 344px) at sm, and at lg the draggable left rail on top of that
  // (380px + the rail's live width, --match-rail-w, default 320px). With the
  // rail collapsed (railCollapsed) only the right rail is reserved, so the
  // board grows to its height/cap limit.
  // The below-sm height reserve is 13rem (16rem with a hint): the nav, both
  // player-bar/clock strips, and the bottom drawer really do stack ~13rem of
  // chrome on short landscape viewports, and the old 7rem reserve let the
  // board push the bottom clock off-screen / under the drawer there.
  // Literal class strings only, so Tailwind's JIT emits them.
  const boardFitClass = hint
    ? railCollapsed
      ? "w-[min(100vw,max(60dvh,calc(100dvh-12rem)))] sm:w-[min(var(--board-cap,720px),calc(100dvh-15rem),calc(100vw-344px))] lg:w-[min(var(--board-cap,720px),calc(100dvh-15rem),calc(100vw-380px))] max-w-full"
      : "w-[min(100vw,max(60dvh,calc(100dvh-12rem)))] sm:w-[min(var(--board-cap,720px),calc(100dvh-15rem),calc(100vw-344px))] lg:w-[min(var(--board-cap,720px),calc(100dvh-15rem),calc(100vw_-_380px_-_var(--match-rail-w,320px)))] max-w-full"
    : railCollapsed
    ? "w-[min(100vw,max(60dvh,calc(100dvh-12rem)))] sm:w-[min(var(--board-cap,720px),calc(100dvh-12rem),calc(100vw-344px))] lg:w-[min(var(--board-cap,720px),calc(100dvh-12rem),calc(100vw-380px))] max-w-full"
    : "w-[min(100vw,max(60dvh,calc(100dvh-12rem)))] sm:w-[min(var(--board-cap,720px),calc(100dvh-12rem),calc(100vw-344px))] lg:w-[min(var(--board-cap,720px),calc(100dvh-12rem),calc(100vw_-_380px_-_var(--match-rail-w,320px)))] max-w-full";
  // Takebacks are casual-only (and off in Draft games, whose rolled offers
  // and applied buffs cannot rewind) and need a move of mine on the board.
  const takebackAvailable =
    !start.rated && !isDraft && game.board.history.some((m) => m.color === myColor);
  // Opening grace window: until one whole turn (two plies) has been played,
  // the Draw button reads Abort instead -- end the game with no result and no
  // rating change rather than negotiate a draw nobody wants that early.
  const canAbort = game.board.history.length < 2;
  const revealControl = game.result ? null : myRevealState === "revealed" ? (
    <div className="plate flex items-center gap-2 p-2 px-3 text-xs text-parchment-300">
      <span aria-hidden className="text-verdigris-glow">✓</span>
      Your rule is visible to your opponent.
    </div>
  ) : myRevealState === "confirm" ? (
    <div className="plate space-y-2 p-2 px-3">
      <div className="text-[12px] text-parchment-300">
        Show your secret rule to your opponent? This can&apos;t be undone.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => {
            if (!session.revealRule()) setError("Disconnected from the game server.");
          }}
          className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-gold/40 bg-gold/10 text-gold-leaf hover:bg-gold/20 hover:border-gold/70 transition text-xs font-display font-semibold tracking-wide"
        >
          Reveal
        </button>
        <Button tone="ghost"
          onClick={() => setMyRevealState("hidden")}
          className="min-w-0 px-3 py-2 text-xs tracking-wide">
          Cancel
        </Button>
      </div>
    </div>
  ) : (
    <button
      onClick={() => setMyRevealState("confirm")}
      className="plate w-full p-2 px-3 text-left text-xs text-parchment-300 transition hover:border-gold/40 hover:text-gold-leaf"
    >
      Reveal my rule to my opponent…
    </button>
  );

  const historyActions = game.result ? null : confirmMovePending ? (
    <div className="space-y-2">
      <div className="text-[12px] text-parchment-300">Play this move?</div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={confirmHeldMove}
          className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-gold/40 bg-gold/10 text-gold-leaf hover:bg-gold/20 hover:border-gold/70 transition text-xs font-display font-semibold tracking-wide"
        >
          Confirm
        </button>
        <Button tone="ghost"
          onClick={() => setConfirmMovePending(null)}
          className="min-w-0 px-3 py-2 text-xs tracking-wide">
          Cancel
        </Button>
      </div>
    </div>
  ) : confirmingDraw ? (
    <div className="space-y-2">
      <div className="text-[12px] text-parchment-300">Offer a draw?</div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onOfferDraw}
          className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-gold/40 bg-gold/10 text-gold-leaf hover:bg-gold/20 hover:border-gold/70 transition text-xs font-display font-semibold tracking-wide"
        >
          Offer draw
        </button>
        <Button tone="ghost"
          onClick={() => setConfirmingDraw(false)}
          className="min-w-0 px-3 py-2 text-xs tracking-wide">
          Cancel
        </Button>
      </div>
    </div>
  ) : confirmingResign ? (
    <div className="space-y-2">
      <div className="text-[12px] text-parchment-300">Resign the game?</div>
      <div className="grid grid-cols-2 gap-2">
        <Button tone="danger"
          onClick={() => {
            onResign();
            setConfirmingResign(false);
          }}
          className="min-w-0 px-3 py-2 text-xs font-semibold tracking-wide">
          Yes
        </Button>
        <Button tone="ghost"
          onClick={() => setConfirmingResign(false)}
          className="min-w-0 px-3 py-2 text-xs tracking-wide">
          Cancel
        </Button>
      </div>
    </div>
  ) : claimReady ? (
    <div className="space-y-2">
      <div className="text-[12px] text-parchment-300">
        Your opponent seems to have abandoned the game.
      </div>
      {error && <div className="text-xs text-oxblood-glow leading-snug">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onClaimWin}
          className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-gold/40 bg-gold/10 text-gold-leaf hover:bg-gold/20 hover:border-gold/70 transition text-xs font-display font-semibold tracking-wide"
        >
          Claim win
        </button>
        <Button tone="ghost"
          onClick={onClaimDraw}
          className="min-w-0 px-3 py-2 text-xs font-semibold tracking-wide">
          Claim draw
        </Button>
      </div>
    </div>
  ) : opponentGone && !game?.result ? (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="text-[12px] text-parchment-300">
        Opponent disconnected.{" "}
        {claimInSeconds > 0
          ? `You can claim the win in ${claimInSeconds}s.`
          : "Checking with the server…"}
      </div>
      {error && <div className="text-xs text-oxblood-glow leading-snug">{error}</div>}
    </div>
  ) : takebackOfferBy && takebackOfferBy !== myColor ? (
    <div className="space-y-2">
      <div className="text-[12px] text-parchment-300">Opponent asks for a takeback.</div>
      {error && <div className="text-xs text-oxblood-glow leading-snug">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onAcceptTakeback}
          className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-gold/40 bg-gold/10 text-gold-leaf hover:bg-gold/20 hover:border-gold/70 transition text-xs font-display font-semibold tracking-wide"
        >
          Allow
        </button>
        <Button tone="ghost"
          onClick={onDeclineTakeback}
          className="min-w-0 px-3 py-2 text-xs font-semibold tracking-wide">
          Decline
        </Button>
      </div>
    </div>
  ) : drawOfferBy && drawOfferBy !== myColor ? (
    <div className="space-y-2">
      <div className="text-[12px] text-parchment-300">Opponent offered a draw.</div>
      {error && <div className="text-xs text-oxblood-glow leading-snug">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onAcceptDraw}
          className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-gold/40 bg-gold/10 text-gold-leaf hover:bg-gold/20 hover:border-gold/70 transition text-xs font-display font-semibold tracking-wide"
        >
          Accept
        </button>
        <Button tone="ghost"
          onClick={onDeclineDraw}
          className="min-w-0 px-3 py-2 text-xs font-semibold tracking-wide">
          Decline
        </Button>
      </div>
      <Button tone="danger"
        onClick={requestResign}
        className="w-full min-w-0 px-3 py-2 text-xs font-semibold tracking-wide">
        Resign
      </Button>
    </div>
  ) : (
    <div className="space-y-2">
      {drawOfferStatus === "declined" && (
        <div className="text-[12px] text-parchment-300">Draw declined.</div>
      )}
      {takebackStatus === "declined" && (
        <div className="text-[12px] text-parchment-300">Takeback declined.</div>
      )}
      {error && <div className="text-xs text-oxblood-glow leading-snug">{error}</div>}
      <div className={"grid gap-2 " + (takebackAvailable ? "grid-cols-3" : "grid-cols-2")}>
        {canAbort ? (
          <button
            onClick={onAbort}
            title="End the game without a result. Nobody wins and no rating changes."
            className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-gold/40 bg-gold/10 text-gold-leaf hover:bg-gold/20 hover:border-gold/70 transition text-xs font-display font-semibold tracking-wide"
          >
            Abort
          </button>
        ) : (
          <button
            onClick={onOfferDraw}
            disabled={drawOfferStatus === "offering"}
            className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-gold/40 bg-gold/10 text-gold-leaf hover:bg-gold/20 hover:border-gold/70 transition text-xs font-display font-semibold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {drawOfferStatus === "offering" ? "Offered" : "Draw"}
          </button>
        )}
        {takebackAvailable && (
          <button
            onClick={onOfferTakeback}
            disabled={takebackStatus === "offering"}
            title="Ask your opponent to let you take your last move back"
            className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-bruise-glow/40 bg-bruise/10 text-bruise-glow hover:bg-bruise/20 hover:border-bruise-glow/70 transition text-xs font-display font-semibold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {takebackStatus === "offering" ? "Asked" : "Takeback"}
          </button>
        )}
        <Button tone="danger"
          onClick={requestResign}
          className="min-w-0 px-3 py-2 text-xs font-semibold tracking-wide">
          Resign
        </Button>
      </div>
    </div>
  );

  return (
    <main
      className={
        "flex min-h-dvh flex-col sm:h-dvh sm:min-h-0 sm:overflow-hidden" +
        (recordingLayout ? " recording-mode" : "")
      }
    >
      <ConnectionBanner session={session} />
      {abortNotice && (
        <div
          role="status"
          aria-live="polite"
          // Owns the top-16 lane; OppPlaysLog sits below it at z-[39] so the
          // two can never render on top of each other.
          className="fixed right-3 top-16 z-40 w-[min(80vw,20rem)] border border-gold/40 bg-ink-700/95 p-3 shadow-plate"
        >
          <div className="text-[12px] text-parchment-400">
            {abortNotice.level === "timeout" ? "New games paused" : "Abort warning"}
          </div>
          <p className="mt-1 text-xs leading-snug text-parchment-300">
            {abortNotice.level === "timeout"
              ? `You've aborted too many of your recent games, so starting new games is paused for about ${abortNotice.minutes ?? 10} minutes.`
              : "You've aborted several of your recent games. Abort another soon and starting new games will be paused for a while."}
          </p>
          <Button tone="ghost"
            onClick={() => setAbortNotice(null)}
            className="mt-2 px-2 py-1 text-[13px] tracking-wide">
            Dismiss
          </Button>
        </div>
      )}
      <nav className="sticky top-0 z-20 flex w-full shrink-0 items-center justify-between px-2 py-1 sm:px-5 sm:py-3">
        {/* Wordmark + collapsed nav menu: design system §9 keeps every global
            destination reachable from the in-game bar (the menu shows on desktop
            too via hideAt="none"), compacted rather than dropped. Plain links,
            no confirm traps -- the live game keeps running server-side. */}
        <div className="flex items-center gap-2">
          <MobileNavMenu align="left" hideAt="none" />
          <Link href="/" className="font-display text-xl tracking-tight sm:text-2xl">
            nerf<span className="text-gold-leaf">chess</span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden text-[12px] text-parchment-400 sm:block">
            playing {myColor === "w" ? "White" : "Black"} ·{" "}
            {isDraft && (
              <>
                {isBuffMode ? (
                  <span className="text-mode-buffGlow">buff mode</span>
                ) : isNerfMode ? (
                  <span className="text-mode-nerfGlow">nerf mode</span>
                ) : (
                  "draft"
                )}
                {" · "}
              </>
            )}
            {subtitle}
          </div>
          <SpectatorPill n={spectators.n} names={spectators.names} />
          <Button tone="ghost"
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            title={muted ? "Sound off" : "Sound on"}
            className="h-11 w-11 sm:h-9 sm:w-9 rounded-full">
            {muted ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="22" y1="9" x2="16" y2="15" />
                <line x1="16" y1="9" x2="22" y2="15" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </Button>
          <Button tone="ghost"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
            className="h-11 w-11 sm:h-9 sm:w-9 rounded-full">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Button>
        </div>
      </nav>

      <div
        className={
          "match-content mx-auto flex w-full max-w-[1360px] flex-1 min-h-0 flex-col gap-2 px-0 sm:overflow-hidden sm:px-6 xl:max-w-[1680px] " +
          bottomChromePadClass(!!(isDraft && game.buffs))
        }
      >
        {hint && (
          <div
            role="status"
            aria-live="polite"
            className={
              "plate shrink-0 p-2 px-3 flex items-center gap-2 " +
              (hint.tone === "warn"
                ? "border-oxblood-glow/60 bg-oxblood/15"
                : "border-gold/40 bg-gold/10")
            }
          >
            <span aria-hidden="true" className="text-gold-leaf font-display font-bold text-lg leading-none">!</span>
            <span className="font-display text-sm text-parchment">
              {hint.text}
            </span>
          </div>
        )}
        {/* The opponent-drafting status lives in the waiting overlay below
            (and inside the draft overlay while my own pick is open). */}
        <div
          className={railGridClass(railCollapsed)}
          style={{ ...railHeightStyle, ...railWidthStyle }}
        >
          {/* The command rail: one framed column (mode header, opponent, dock
              + chat, you) instead of three floating islands, so the left side
              reads as a single control surface. */}
          <CommandRail
            mode={isBuffMode ? "buff" : "nerf"}
            subtitle={subtitle}
            collapsed={railCollapsed}
            onToggleCollapse={toggleRail}
            opponentCharged={chargedColor === oppColor}
            selfCharged={chargedColor === myColor}
            opponent={
              <PlayerNerfCard
                board={boardForDisplay}
                playerColor={oppColor}
                myColor={myColor}
                heartbeatKey={
                  game.fx?.find((e) => e.kind === "nerf-turnstart" && e.color === oppColor)?.ply ?? null
                }
                name={oppName}
                elo={oppRating}
                provisional={oppProvisional}
                avatar={start.players?.[oppColor]?.avatar}
                nerf={opponentNerf}
                revealed={oppNerfShown}
                hideNerf={hideOppNerfCard}
                ownerLabel=""
                compact
                connected={!opponentGone}
              />
            }
            center={
              <div
                className={
                  "hidden min-h-0 gap-2 lg:grid " +
                  (isDraft && game.buffs
                    ? // The dock owns the column; chat rests as a compact strip
                      // (auto row) and expands in place on demand.
                      "grid-rows-[minmax(0,1fr)_auto]"
                    : "grid-rows-[minmax(0,1fr)]")
                }
              >
                {isDraft && game.buffs && (
                  <BuffDock
                    game={game}
                    myColor={myColor}
                    canAct={draftCanAct}
                    onStartUse={startBuffUse}
                    plays={oppLog}
                  />
                )}
                <ChatPanel
                  messages={chatMessages}
                  myColor={myColor}
                  onSend={handleSendChat}
                  collapsible={isDraft && !!game.buffs}
                  className={isDraft && game.buffs ? "" : "h-full"}
                />
              </div>
            }
            self={
              <PlayerNerfCard
                board={boardForDisplay}
                playerColor={myColor}
                myColor={myColor}
                heartbeatKey={
                  game.fx?.find((e) => e.kind === "nerf-turnstart" && e.color === myColor)?.ply ?? null
                }
                name={myName}
                elo={myRating}
                provisional={myProvisional}
                avatar={start.players?.[myColor]?.avatar}
                nerf={myNerf}
                hideNerf={isBuffMode}
                ownerLabel=""
                progress={myNerf.progress?.(myState, myCtx) ?? null}
                boons={myHeldBoons}
                compact
                connected={!connectionLost}
              />
            }
            footer={
              <>
                {!isBuffMode && revealControl}
                {ratingStakes && <RatingStakes stakes={ratingStakes} />}
              </>
            }
          />
          {!railCollapsed && !recordingLayout && (
            <RailResizeHandle railWidth={railWidth} resizeRail={resizeRail} />
          )}
          <div className="match-board-col flex min-h-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:justify-start">
            <div ref={boardShellRef} className="match-board-shell min-h-0 min-w-0 sm:flex-none">
              {/* Player bars at every breakpoint (2026-07 layout pass): the
                  opponent's identity + clock ride directly above the board and
                  the viewer's directly below it, so nothing forces a scan
                  across the screen. The rails keep the rules/moves/chat. */}
              <div className="board-strip flex items-center justify-between gap-2 px-2 sm:px-0">
                {railCollapsed && (
                  <Button tone="ghost"
                   
                    onClick={toggleRail}
                    aria-label="Show side panel"
                    title="Show the side panel"
                    className="hidden h-8 w-8 shrink-0 place-items-center text-parchment-300 hover:text-parchment-100 lg:grid">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <polyline points="13 17 18 12 13 7" />
                      <polyline points="6 17 11 12 6 7" />
                    </svg>
                  </Button>
                )}
                <BoardPlayerRow
                  // Material counts read the COMMITTED position (a queued premove
                  // must never bump the capture tally early); history review
                  // still shows the reviewed position's material.
                  board={isReviewingHistory ? boardForDisplay : game.board}
                  playerColor={oppColor}
                  myColor={myColor}
                  name={oppName}
                  elo={oppRating}
                  avatar={start.players?.[oppColor]?.avatar}
                  linkProfile={false}
                  className="min-w-0 flex-1 !px-0 !py-1"
                  connected={!opponentGone}
                />
                {clockEnabled && (
                  <ClockPill
                    ms={myColor === "w" ? blackMs : whiteMs}
                    seat={myColor === "w" ? "b" : "w"}
                    ended={!!game.result}
                    active={chargedColor === oppColor}
                    startDelayMs={clockStartDelay(oppColor)}
                    compact
                  />
                )}
              </div>
              <div
                data-board-measure
                className={
                  `relative mx-auto sm:mx-0 transition-opacity duration-200 ${boardFitClass}` +
                  // Reconnecting: dim the board 20% (it stays visible, never
                  // unmounted) while input is disabled below.
                  (connectionLost ? " opacity-80" : "")
                }
              >
                <Board
                  board={boardForDisplay}
                  // Removal FX diff the committed position, never the premove /
                  // confirm / review overlays (see Board.fxBoard).
                  fxBoard={game.board}
                  legalMoves={
                    isReviewingHistory || buffTargeting.targeting
                      ? EMPTY_MOVES
                      : premoveMode
                      ? premoveOptions
                      : game.board.turn === myColor
                      ? moves
                      : EMPTY_MOVES
                  }
                  orientation={orientation}
                  onMove={handleLocalMove}
                  myColor={myColor}
                  // Click an enemy piece to preview where it could move
                  // (suspended during history review and buff targeting).
                  opponentMoves={
                    isReviewingHistory || buffTargeting.targeting ? EMPTY_MOVES : oppPreviewMoves
                  }
                  // Public buff state, so the board can paint BOTH sides'
                  // persistent buff markers (bound-buff sigils, and the live
                  // shield / royal-guard recompute) for the viewer, not just the
                  // caster. Masked opponent cards carry an empty id, so nothing
                  // still-secret can surface here; history review passes null so
                  // no live marker bleeds onto a past position.
                  buffs={isReviewingHistory ? null : game.buffs}
                  visual={isReviewingHistory ? undefined : boardVisual}
                  lastMove={lastMoveForDisplay}
                  nerfReveals={nerfReveals}
                  passiveNerfs={passiveNerfs}
                  reviewingHistory={isReviewingHistory}
                  // The engine's per-cycle fx narration (nerf bites, victim
                  // receives, expiries) for the FruitionLayer.
                  fx={isReviewingHistory ? null : game.fx ?? null}
                  fxTimePressure={
                    clockEnabled && !game.result && (whiteMs < 15_000 || blackMs < 15_000)
                  }
                  disabled={
                    !!game.result ||
                    isReviewingHistory ||
                    !!confirmMovePending ||
                    !!myOffer ||
                    connectionLost ||
                    (!uiSettings.premovesEnabled && (awaitingPremoveAck || !!pendingLocalMove))
                  }
                  premoveMode={!isReviewingHistory && premoveMode}
                  premoves={isReviewingHistory ? EMPTY_PREMOVES : validPremoves}
                  onCancelPremove={clearPremoves}
                  moveRisks={isReviewingHistory || premoveMode ? undefined : moveRisks}
                  autoQueen={uiSettings.autoQueen}
                  showCoordinates={uiSettings.showCoordinates}
                  highlightLastMove={uiSettings.highlightLastMove}
                  showLegalMoves={uiSettings.showLegalMoves}
                  checkSquares={isReviewingHistory ? undefined : checkSquares}
                  signatureCard={isReviewingHistory ? null : signatureCard}
                  pickSquares={
                    buffTargeting.targeting?.target.kind === "square"
                      ? buffTargeting.targeting.target.squares
                      : dropType
                      ? dropSquares
                      : undefined
                  }
                  onPickSquare={
                    buffTargeting.targeting?.target.kind === "square"
                      ? (sq) => buffTargeting.pick({ square: sq })
                      : dropType
                      ? submitDrop
                      : undefined
                  }
                  onInvalidPick={() => setInvalidPickKey((k) => k + 1)}
                />
                {isDraft && bsTheirs && (
                  <DraftNotice
                    buffs={bsTheirs.buffs}
                    banked={!!bsTheirs.flags.bankBonus}
                    hidden={!picksVisible}
                    cardNoun={draftCardNoun(start.mode)}
                  />
                )}
                <GodPanelNotice notices={godNotices} />
                {buffTargeting.targeting && buffTargeting.targeting.target.kind === "square" && (
                  <TargetingBanner
                    game={game}
                    myColor={myColor}
                    targeting={buffTargeting.targeting}
                    onCancel={buffTargeting.cancel}
                    onFinish={buffTargeting.finish}
                    invalidKey={invalidPickKey}
                  />
                )}
                {!isReviewingHistory && <BoardSplashHost rows={againstMe} />}
              </div>
              {/* Reconnecting status line: pairs with the top ConnectionBanner
                  and the 20% board dim above. Disappears silently on recovery. */}
              {connectionLost && (
                <div role="status" aria-live="polite" className="mt-1 flex justify-center">
                  <span className="plate plate-raised border-oxblood-glow/50 px-3 py-1.5 font-display text-xs font-semibold text-oxblood-glow">
                    Reconnecting · moves are paused until the connection returns
                  </span>
                </div>
              )}
              {/* Crazyhouse pocket: the viewer's banked pieces sit in a tray
                  directly under the board. Click one to arm a drop; the board
                  then highlights every legal drop square. Hidden while reviewing
                  history and when the pocket is empty. */}
              {isDraft && game.buffs && !isReviewingHistory && pocketEntries.length > 0 && (
                <div className={`mx-auto mt-1 sm:mx-0 ${boardFitClass}`}>
                  <Pocket
                    entries={pocketEntries}
                    color={myColor}
                    activeType={dropType}
                    canDrop={draftCanAct}
                    onSelect={handlePocketSelect}
                  />
                </div>
              )}
              {/* Opponent's pocket, read-only: what they can drop is public
                  information under full transparency. */}
              {isDraft && game.buffs && !isReviewingHistory && oppPocketEntries.length > 0 && (
                <div className={`mx-auto mt-1 sm:mx-0 ${boardFitClass}`}>
                  <Pocket
                    entries={oppPocketEntries}
                    color={oppColor}
                    activeType={null}
                    canDrop={false}
                    onSelect={() => {}}
                    label="Their pocket"
                  />
                </div>
              )}
              <div className="board-strip flex items-center justify-between gap-2 px-2 sm:px-0">
                <BoardPlayerRow
                  // Material counts read the COMMITTED position (a queued premove
                  // must never bump the capture tally early); history review
                  // still shows the reviewed position's material.
                  board={isReviewingHistory ? boardForDisplay : game.board}
                  playerColor={myColor}
                  myColor={myColor}
                  name={myName}
                  elo={myRating}
                  avatar={start.players?.[myColor]?.avatar}
                  linkProfile={false}
                  className="min-w-0 flex-1 !px-0 !py-1"
                  connected={!connectionLost}
                />
                {clockEnabled && (
                  <ClockPill
                    ms={myColor === "w" ? whiteMs : blackMs}
                    seat={myColor}
                    ended={!!game.result}
                    active={chargedColor === myColor}
                    startDelayMs={clockStartDelay(myColor)}
                    warnLowTime={uiSettings.lowTimeWarning}
                    draftRunning={myDraftCharging}
                    compact
                  />
                )}
              </div>
              <MobileMatchStack
                actions={historyActions}
                moves={game.board.history}
                currentPly={currentHistoryPly}
                onPlyChange={handleHistoryPlyChange}
                minPly={reviewFloor}
                rule={
                  !isBuffMode ? (
                    <div className="plate p-2 px-3">
                      <div className="flex items-center gap-2">
                        <span className={`min-w-0 truncate font-display text-sm font-semibold tier-${myNerf.tier}`}>
                          {myNerf.name}
                        </span>
                        <span
                          className={`ml-auto shrink-0 rounded-[1px] border px-2 py-0.5 font-display text-[12px] font-bold tier-bg-${myNerf.tier} tier-${myNerf.tier}`}
                          title={`Tier ${myNerf.tier}: ${TIER_LABEL[myNerf.tier]}`}
                        >
                          {TIER_ROMAN[myNerf.tier]} · {TIER_LABEL[myNerf.tier]}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[13px] leading-snug text-parchment-300">{myNerf.description}</p>
                    </div>
                  ) : null
                }
                cards={
                  isDraft && game.buffs
                    ? {
                        label: draftCardNoun(start.mode) === "hex" ? "Hexes & boons" : "Buffs",
                        summary:
                          game.buffs.players[myColor].buffs.length === 0
                            ? "None yet"
                            : `${game.buffs.players[myColor].buffs.length} held`,
                        content: (
                          <BuffDock
                            game={game}
                            myColor={myColor}
                            canAct={draftCanAct}
                            onStartUse={buffTargeting.start}
                            plays={oppLog}
                          />
                        ),
                      }
                    : null
                }
                chat={
                  <ChatPanel
                    messages={chatMessages}
                    myColor={myColor}
                    onSend={handleSendChat}
                    collapsible
                    expandedClassName="h-48"
                  />
                }
                extra={ratingStakes ? <RatingStakes stakes={ratingStakes} /> : null}
              />
              {/* Recording mode: both clocks (with names) flow directly beneath
                  the board, inside the board shell, so they hug the board's
                  bottom edge in the 9:16 frame instead of being pinned near the
                  frame floor. Owner-only layout; purely presentational. The
                  "clean frame" toggle hides this whole bar (clock + names) for a
                  board-only capture. */}
              {recordingLayout && clockEnabled && !recCleanFrame && (
                <div className="rec-clock-bar">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="max-w-[7rem] truncate font-display text-sm font-semibold text-parchment-100"
                      title={oppName}
                    >
                      {oppName}
                    </span>
                    <ClockPill
                      ms={myColor === "w" ? blackMs : whiteMs}
                      seat={myColor === "w" ? "b" : "w"}
                      ended={!!game.result}
                      active={chargedColor === oppColor}
                      startDelayMs={clockStartDelay(oppColor)}
                      compact
                    />
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <ClockPill
                      ms={myColor === "w" ? whiteMs : blackMs}
                      seat={myColor}
                      ended={!!game.result}
                      active={chargedColor === myColor}
                      startDelayMs={clockStartDelay(myColor)}
                      draftRunning={myDraftCharging}
                      compact
                    />
                    <span
                      className="max-w-[7rem] truncate font-display text-sm font-semibold text-gold-leaf"
                      title={myName}
                    >
                      {myName}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div
              className={
                "match-side-rail hidden min-h-0 overflow-hidden gap-3 sm:grid sm:h-[var(--board-height)] sm:w-72 sm:shrink-0 " +
                (clockEnabled && !start.rated
                  ? "sm:grid-rows-[auto_minmax(0,1fr)_auto]"
                  : "sm:grid-rows-[minmax(0,1fr)_auto]")
              }
              style={railHeightStyle}
            >
              {/* Clocks now live in the player bars above/below the board; the
                  rail keeps only the casual-game clock courtesy tools. */}
              {clockEnabled && !start.rated && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => session.adjustOppClock(false)}
                    disabled={!!game.result}
                    title="Give your opponent 15 seconds"
                    className="flex-1 rounded-[1px] border border-mint/40 bg-mint/10 px-2 py-1 text-[12px] font-semibold text-mint-glow transition-colors hover:bg-mint/20 disabled:opacity-40"
                  >
                    +15s
                  </button>
                  {isOwnerAccount && (
                    <button
                      type="button"
                      onClick={() => session.adjustOppClock(true)}
                      disabled={!!game.result}
                      title="Take 15 seconds from your opponent"
                      className="flex-1 rounded-[1px] border border-coral/40 bg-coral/10 px-2 py-1 text-[12px] font-semibold text-coral-glow transition-colors hover:bg-coral/20 disabled:opacity-40"
                    >
                      -15s
                    </button>
                  )}
                </div>
              )}
              <MoveList
                moves={game.board.history}
                currentPly={currentHistoryPly}
                onPlyChange={handleHistoryPlyChange}
                navBlocked={historyNavBlocked}
                minPly={reviewFloor}
                compact
                showHeader={false}
                footer={historyActions}
              />
              {/* The effects control keeps clear inset from the rail edge so
                  its slider and labels are never clipped at any width. */}
              <div className="flex items-center justify-end gap-2 px-1 pt-1">
                {/* Flip and the shortcut sheet, plus the keymap binding for
                    this surface (f, ?, k/j, 0/$, Home/End, c). The ply jump
                    reuses the same state the wheel-over-board scrub reads. */}
                <BoardTools
                  onPlyNav={(to) => {
                    const st = wheelNavRef.current;
                    if (st.blocked || st.max === 0) return;
                    const cur = st.ply ?? st.max;
                    const next =
                      to === "first"
                        ? st.min
                        : to === "last"
                        ? st.max
                        : cur + (to === "prev" ? -1 : 1);
                    st.nav(Math.max(st.min, Math.min(next, st.max)));
                  }}
                />
                <FxToggleButton />
              </div>
            </div>
          </div>
        </div>
      </div>

      <OppPlaysLog plays={oppLog} />
      {/* Clock-raid spectacle for clock-touching cards (Time Thief and kin):
          measures the [data-clock-seat] pills and runs the grab/carry/pop
          out-of-board choreography. Cosmetic; clock frames stay authoritative. */}
      <ClockRaidLayer fx={game.fx ?? null} />

      {/* Owner god panel: far-right, mounted only for the ilovenewjeans account,
          only when he has switched it on from /mod, and only in a live draft game
          (buffs exist there). Fixed at xl+ so it never overlaps the board on
          normal screens. Server re-verifies every gated message. */}
      {godPanelAvailable && (
        <AdminGodPanel
          session={session}
          recordingMode={recordingMode}
          onToggleRecordingMode={() => setRecordingMode((v) => !v)}
          cleanFrame={recCleanFrame}
          onToggleCleanFrame={() => setRecCleanFrame((v) => !v)}
        />
      )}

      {/* Recording mode chrome: just the 9:16 crop guide (dims everything
          outside the vertical frame). The clocks now render inside the board
          shell, directly beneath the board (see above). Purely presentational
          and only mounts in recording mode. */}
      {recordingLayout && <div className="rec-frame-guide" aria-hidden />}

      {/* Shared reveal moment: both sides of the draft round resolved, show
          the outcome briefly. Non-blocking, click to dismiss, auto-dismisses
          after about four seconds. */}
      {isDraft && draftReveal && !game.result && (
        <DraftRevealBanner
          mine={draftReveal.mine}
          theirs={draftReveal.theirs}
          onDismiss={() => setDraftReveal(null)}
        />
      )}

      {isDraft && game.buffs && (
        <MobileBuffDrawer
          label={draftCardNoun(start.mode) === "hex" ? "Hexes & boons" : "Buffs"}
          held={game.buffs.players[myColor].buffs.length}
          usable={
            !draftCanAct
              ? 0
              : game.buffs.players[myColor].buffs.filter((inst) => {
                  const def = BUFF_BY_ID[inst.id];
                  return def?.kind === "activated" && !inst.spent && !inst.nullified;
                }).length
          }
          autoCloseWhen={!!buffTargeting.targeting}
          preview={
            <>
              {game.buffs.players[myColor].buffs.slice(0, 6).map((inst, i) => {
                const def = BUFF_BY_ID[inst.id];
                if (!def) return null;
                const Icon = cardFaceIcon(def.id, def.category, def.icon);
                return (
                  <span
                    key={`${inst.id}-${i}`}
                    title={def.name}
                    className={`grid h-6 w-6 shrink-0 place-items-center border tier-bg-${def.tier} tier-${def.tier} ${inst.spent ? "opacity-40" : ""}`}
                  >
                    {Icon ? <Icon size={13} strokeWidth={1.8} /> : null}
                  </span>
                );
              })}
            </>
          }
        >
          <BuffDock
            game={game}
            myColor={myColor}
            canAct={draftCanAct}
            onStartUse={buffTargeting.start}
            plays={oppLog}
          />
        </MobileBuffDrawer>
      )}

      {buffTargeting.targeting && buffTargeting.targeting.target.kind === "enemy-buff" && (
        <EnemyBuffModal
          game={game}
          myColor={myColor}
          targeting={buffTargeting.targeting}
          onPick={buffTargeting.pick}
          onCancel={buffTargeting.cancel}
        />
      )}

      {/* Simultaneous draft, my side resolved (pick sent or already applied)
          but the opponent's is still open. The waiting card holds — with no
          dark backdrop and the board fully visible/usable above it — and never
          auto-hides: it stays until the opponent locks in, so a straggling (or
          vanished) opponent can never make the game *feel* frozen. The player
          may still manually minimize the card; when they do (or once the free
          window ends and the dawdler is burning their own clock), it collapses
          into a prominent, persistent top banner rather than an easily-missed
          corner pill. While oppDrafting is true this notice never fully
          disappears, so the player always knows the game is alive, not stuck. */}
      {/* Skip popup: an explicit, animated announcement the moment a draft
          round passes this player by (blocked by an opponent card or a dry
          pool), so a missing draft is never confusing. Static-friendly: the
          entrance is a short fade/slide and the body is plain text. */}
      {replyToast && !game.result && (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-[46] flex justify-center px-4">
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            role="status"
            aria-live="assertive"
            className="plate flex max-w-[92vw] items-center gap-3 px-4 py-2.5 shadow-plate"
          >
            <span className="font-display text-sm font-semibold text-parchment-100">{replyToast}</span>
          </motion.div>
        </div>
      )}
      {skipToast && !game.result && (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-[46] flex justify-center px-4">
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            role="status"
            aria-live="assertive"
            className="plate flex max-w-[92vw] items-center gap-3 border-gold/50 px-4 py-2.5 shadow-plate"
          >
            <span className="font-display text-sm font-bold text-gold-leaf">Draft skipped</span>
            <span className="text-[13px] text-parchment-200">
              {skipToast.reason === "dry"
                ? "The card pool ran dry this round."
                : "An opponent card blocked your draft this round."}
            </span>
          </motion.div>
        </div>
      )}
      {showWaitingOverlay && (
        <WaitingCornerNotice
          oppName={oppName}
          noun={draftCardNoun(start.mode)}
          compact={draftGraceOver || waitingMinimized}
          skipped={genuinelySkipped}
          skipReason={skipReason}
          oppLockedIn={oppLockedIn}
          oppBanked={oppBanked}
          oppNewestCardName={oppNewestCard?.name ?? null}
          oppNewestCardTier={oppNewestCard?.tier ?? null}
          onClock={draftGraceOver}
          deadline={draftDeadline}
          canViewTheirs={!!bsTheirs?.offer}
          onViewTheirs={() => setOppDraftEnlarged(true)}
          onDismiss={() => setWaitingMinimized(true)}
          liftForDrawer={!!(isDraft && game.buffs)}
        />
      )}

      {/* Enlarged, read-only look at the opponent's open offer while you wait:
          full-size cards instead of the tiny summary, so you can plan around
          whatever they end up taking. Closes itself the moment they lock in
          (oppDrafting flips false and resets the flag above). */}
      {showWaitingOverlay && oppDraftEnlarged && bsTheirs?.offer && (
        <OpponentDraftViewer
          offer={bsTheirs.offer}
          oppName={oppName}
          cardNoun={draftCardNoun(start.mode)}
          onClose={() => setOppDraftEnlarged(false)}
        />
      )}

      {/* Board spectacles still playing when the draft arrived: a small
          status chip says so while the overlay waits its turn. The sequence
          machine caps this hold, so nothing can block the draft. */}
      {isDraft && myOffer && !draftSubmitted && !game.result && !draftSeq.overlayVisible && (
        <DraftResolvingChip />
      )}
      {isDraft && myOffer && !draftSubmitted && !game.result && draftSeq.overlayVisible && (
        <DraftOverlay
          key={`draft-${replayEpoch}-${myOffer.index}`}
          offer={myOffer}
          // The reveal ledger scope: ties the chest animation to this game's
          // exact offer versions, so remounts (this key changes on every new
          // offer and replay epoch), reconnects, and refreshes never replay a
          // reveal the player already watched — and never skip a fresh one.
          revealScope={start.id}
          takeBoth={(bsMine?.flags.takeBoth ?? 0) > 0}
          bankedBonus={!!myOffer.banked}
          // The countdown is withheld until the cards are ready: the server's
          // deadline includes the presentation budget, so the full decision
          // window remains when it appears. An expired window (grace over)
          // shows regardless: the compact panel handles that state.
          deadline={countdownRevealed || draftGraceOver ? draftDeadline : null}
          // ONLINE NEVER AUTO-PICKS. The server deliberately stopped resolving
          // overdue buff offers (see enforceDraftDeadlines in worker.ts: "the
          // offer stays open, the clock resumes, and the straggler pays"), and
          // this component carries the whole apparatus for that outcome —
          // chargedColor, the DRAFT tag on the running clock, the "on their
          // clock now" line. The overlay's own backstop defaulted to true and
          // was never told otherwise, so at t=deadline it confirmed a RANDOM
          // card for a player who was still deciding, and none of the straggler
          // path was reachable. Local/bot games keep the default: nothing
          // server-side is there to take over for them.
          autoResolveOnExpire={false}
          onCardsReady={draftSeq.reportCardsReady}
          // When the free window ends the draft steps aside into the corner
          // panel: the board is playable again, the clock is charging, and the
          // compact panel stays put (no auto-tuck, no auto-pick) until the
          // player resolves it.
          minimized={draftGraceOver}
          cardNoun={draftCardNoun(start.mode)}
          oppLockedIn={oppLockedIn && !oppDrafting}
          oppBanked={oppBanked}
          // Both game clocks stay visible while drafting (with the clock rule
          // stated in the panel), so time pressure never hides behind cards.
          clocks={
            clockEnabled
              ? {
                  mine: myColor === "w" ? whiteMs : blackMs,
                  theirs: myColor === "w" ? blackMs : whiteMs,
                }
              : null
          }
          // Recording mode: cap the draft panel to the 9:16 frame so it lands
          // centered on the board (which is screen-centered here) instead of
          // spilling past the vertical crop.
          recordingMode={recordingLayout}
          onPick={(i) => {
            if (session.sendDraftPick(i)) {
              draftSeq.noteConfirmed();
              setDraftSubmitted(true);
              setMyDraftResolved(true);
            } else setError("Disconnected from the game server.");
          }}
          onBank={() => {
            if (session.sendDraftBank()) {
              draftSeq.noteConfirmed();
              setDraftSubmitted(true);
              setMyDraftResolved(true);
            } else setError("Disconnected from the game server.");
          }}
          rerollsLeft={bsMine?.rerollsLeft ?? 0}
          onReroll={() => {
            if (session.sendDraftReroll()) {
              // The server owns the roll and answers with a fresh draft-state
              // (new cards + bumped rerolled counter). Decrement locally too so
              // the control reflects the spend at once: the replica's
              // mergeDraftState does not carry rerollsLeft back.
              // God-panel "infinite rerolls" reports a large sentinel count the
              // server keeps topped up; skip the optimistic drain so the control
              // never flickers from ∞ to a number between reroll and dtState.
              if (bsMine && (bsMine.rerollsLeft ?? 0) < INFINITE_REROLLS) {
                // Mutable engine replica advanced in place then re-rendered via
                // applyGame({ ...game }) — the app-wide model, so
                // react-hooks/immutability is suppressed rather than rewritten.
                // eslint-disable-next-line react-hooks/immutability
                bsMine.rerollsLeft = Math.max(0, (bsMine.rerollsLeft ?? 0) - 1);
                applyGame({ ...game });
              }
            } else setError("Disconnected from the game server.");
          }}
          opponent={{
            // Replica opponent offers only ever hold cards the server sent
            // us (picksVisible matches); otherwise they stay null.
            offer: bsTheirs?.offer ?? null,
            // Full transparency (owner rule): the opponent's offer is public
            // data the server already sends open - always show it face-up.
            // The old reveal flags survive only as inputs no longer needed.
            showCards: true,
            showTier: true,
            reveal: bsMine?.oppReveal ?? null,
            lastPick: bsTheirs?.buffs.length
              ? {
                  id: bsTheirs.buffs[bsTheirs.buffs.length - 1].id,
                  tier: bsTheirs.buffs[bsTheirs.buffs.length - 1].tier,
                }
              : null,
          }}
        />
      )}

      {game.result && !showResult && rematchStatus === "incoming" && (
        /* The end panel is closed but the opponent just asked for a rematch:
           surface it as a floating offer so it can never be missed. Accept
           fires the same handler as the panel's button; opening the panel
           remains one tap away. */
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
          aria-live="assertive"
          className="plate fixed bottom-20 right-3 z-40 flex max-w-[92vw] items-center gap-3 border-gold/50 p-3 px-4 shadow-xl sm:bottom-28 lg:bottom-16"
        >
          <span aria-hidden className="h-2 w-2 shrink-0 bg-gold-leaf animate-flicker" />
          <span className="min-w-0 truncate font-display text-sm text-parchment-100">
            {oppName} wants a rematch
          </span>
          <Button tone="leaf"
           
            onClick={handleRematch}
            className="shrink-0 px-3 py-1.5 text-xs font-semibold">
            Accept
          </Button>
        </motion.div>
      )}
      {game.result && !showResult && (
        <Button tone="leaf"
         
          onClick={() => setShowResult(true)}
          className="fixed bottom-4 right-3 z-40 px-4 py-2 text-sm font-semibold shadow-xl sm:bottom-16 lg:bottom-4">
          Show result
        </Button>
      )}
      {game.result && showResult && (
        <GameOver
          onDismiss={() => setShowResult(false)}
          result={game.result}
          myColor={myColor}
          myNerf={isBuffMode ? undefined : myNerf}
          opponentNerf={isBuffMode ? undefined : revealedOppNerf ?? undefined}
          opponentHidden={uiSettings.hideOpponentReveal}
          ratingChange={ratingChange}
          ratingMode={start.mode === "nerf" || start.mode === "buff" ? start.mode : null}
          mode={start.mode === "nerf" || start.mode === "buff" ? start.mode : null}
          record={poolStanding?.record ?? null}
          rank={poolStanding?.rank ?? null}
          serverGameId={start.id}
          newOpponentHref={`/lobby?tab=quick${
            start.mode === "nerf" || start.mode === "buff" ? `&mode=${start.mode}` : ""
          }`}
          profiles={[
            ...(start.players?.[myColor]?.name
              ? [
                  {
                    name: start.players[myColor]!.name,
                    href: `/u/${encodeURIComponent(start.players[myColor]!.name)}`,
                  },
                ]
              : []),
            ...(start.players?.[oppColor]?.name
              ? [
                  {
                    name: oppName,
                    href: `/u/${encodeURIComponent(oppName)}`,
                  },
                ]
              : []),
          ]}
          rematchStatus={rematchStatus}
          opponentLeft={opponentGone}
          onRematch={handleRematch}
          onCancelRematch={handleCancelRematch}
          onNewGame={onExit}
          // Through the handler so review from the end screen respects the
          // reviewable floor (ply 0 may be unreplayable after a card rewrote
          // the board on a reconnected client).
          onReview={() => handleHistoryPlyChange(0)}
          moves={game.board.history}
          // The full public card history (picks, uses) with plies, so the match
          // timeline shows the real record instead of "no card record".
          cardEvents={isDraft ? cardEventsFromDtActions(dtActionLog) : undefined}
          playerNames={{
            w: myColor === "w" ? myName : oppName,
            b: myColor === "b" ? myName : oppName,
          }}
          startedAt={game.startedAt}
          gameId={start.id}
          myBuffs={game.buffs?.players[myColor].buffs}
          opponentBuffs={isBuffMode ? game.buffs?.players[oppColor].buffs : undefined}
        />
      )}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setUiSettings(loadSettings());
        }}
      />
    </main>
  );
}
