"use client";

import dynamic from "next/dynamic";
import { Board, NERF_REVEAL_SKIP, type NerfRevealInfo } from "@/components/Board";
import { BoardPlayerRow } from "@/components/BoardPlayerRow";
import { ClockPill } from "@/components/ClockPill";
import { ClockRaidLayer } from "@/components/effects/clockraid/ClockRaidLayer";
import { RailResizeHandle, useRailWidth } from "@/components/RailResizeHandle";
import { CommandRail, railGridClass } from "@/components/match/CommandRail";
// The end screen is never part of first paint; loading it on demand keeps it
// out of the page's initial bundle.
const GameOver = dynamic(() => import("@/components/GameOver").then((m) => m.GameOver), {
  ssr: false,
});
// Clip sharing is an on-demand modal (canvas replay + MediaRecorder); keep it
// out of the page's initial bundle like the end screen.
const ClipModal = dynamic(() => import("@/components/clip/ClipModal").then((m) => m.ClipModal), {
  ssr: false,
});
import { MobileMatchStack } from "@/components/MobileMatchStack";
import { BoardTools } from "@/components/board/BoardTools";
import { FxToggleButton } from "@/components/FxToggleButton";
import { MoveList } from "@/components/MoveList";
import { PlayerNerfCard } from "@/components/PlayerNerfCard";
import { TIER_LABEL, TIER_ROMAN } from "@/lib/tiers";
import { AILevel, aiBudgetMs, pickAIMove } from "@/engine/ai";
import { Nerf, type GameContext } from "@/engine/nerf";
import { IMPLEMENTED_BY_ID, openingNerfPool } from "@/engine/nerfs/library";
import { BUFF_BY_ID } from "@/engine/buffs/library";
import { OppPlaysLog, type OppPlay } from "@/components/OppPlaysLog";
import {
  aiActivateBuffs,
  aiResolveDraft,
  applyTurnStart,
  bankDraft,
  currentHint,
  enableDraftMode,
  gameInCheck,
  NerfGame,
  UNRESTRICTED_NERF,
  legalMoves,
  makeContext,
  newGame,
  pickDraftCard,
  playMove,
  rerollDraft,
  resign,
  resolveDiffFlag,
} from "@/engine/game";
import { BuffDock, EnemyBuffModal, TargetingBanner, againstYouRows, useBuffTargeting } from "@/components/BuffDock";
import { BoardSplashHost } from "@/components/BoardSplash";
import { draftCardNoun, turnCost } from "@/engine/buff";
import { draftZones } from "@/lib/draftOnline";
import { computeFxVisual, fxVisualFields } from "@/components/effects/fxZones";
import { useSignatureQueue } from "@/components/effects/useSignatureQueue";
import { MobileBuffDrawer } from "@/components/MobileBuffDrawer";
import { cardFaceIcon } from "@/lib/cardIcon";
import {
  TABLET_STACK_BOARD,
  TABLET_STACK_CENTER,
  TABLET_STACK_COL,
  TABLET_STACK_FAB,
  TABLET_STACK_HIDE,
  TABLET_STACK_SCROLL,
  TABLET_STACK_SHOW,
  TABLET_STACK_UNCLIP,
} from "@/components/matchLayout";
import { bottomChromePadClass } from "@/components/mobileChrome";
import { DraftNotice } from "@/components/DraftNotice";
import {
  DraftOverlay,
  DraftResolvingChip,
  DraftRevealBanner,
  LockInCountdown,
  type DraftRevealSide,
} from "@/components/DraftOverlay";
import { useDraftSequence } from "@/lib/useDraftSequence";
import { pushUiHold } from "@/lib/uiInterrupts";
import { NerfCard } from "@/components/NerfCard";
import { makeSeed } from "@/engine/rng";
import { BoardState, Color, Move, Square } from "@/engine/types";
import { cloneBoard, findKing, isInCheck, makeMove, moveToUCI } from "@/engine/board";
import { useDeferredMoveRisks } from "@/lib/useDeferredMoveRisks";
import { SETTINGS_CHANGED_EVENT, loadSettings } from "@/lib/settings";
import { CompactSiteHeader } from "@/components/SiteHeader";
import { useZenHotkey } from "@/lib/useZenMode";
import { ensureAccount } from "@/lib/authClient";
import type { QueuedPremove } from "@/components/Board";
import { buildCustomNerf, CustomNerf } from "@/engine/nerfs/custom";
import { playCheck, playMoveCue, playNerf } from "@/lib/sounds";
import { nerfSummary, outcomeFor, recordCompletedGame } from "@/lib/gameHistory";
import { applyResult, loadRatingFor, saveRatingFor } from "@/lib/rating";
import { loadRatings } from "@/lib/ratings";
import { clearSavedAiGame, loadSavedAiGame, restoreSavedAiGame, saveAiGame, snapshotGame } from "@/lib/gamePersistence";
import { boardAtPly, replayBoardSpan } from "@/lib/gameReview";
import { clipPliesAvailable } from "@/components/clip/clipReplay";
import { premoveOptionsFor, premoveSelfChecks, previewMovesFor } from "@/lib/premoves";
import { TOUR_STATE_EVENT, type TourGameState } from "@/components/tutorial/tourState";
import { categoryForTimeControl } from "@/lib/ratingCategories";
import type { AIWorkerRequest, AIWorkerResponse } from "@/workers/aiWorker";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

function pickRandomNerf(): Nerf {
  // Random rolls respect the temporary opening cap (tiers 1-2 only).
  const playable = openingNerfPool();
  return playable[Math.floor(Math.random() * playable.length)];
}

/** Deal the opening nerf draft: four distinct nerfs sharing one tier pairing,
 * the scheme the online worker uses (dealNerfDraftOptions). Pick an anchor
 * tier and a partner tier within one of it (possibly the same), then give
 * each side (options 0-1 and 2-3) one card of the anchor tier and one of the
 * partner tier, so both players always draft from the same tier pair. */
function dealNerfOptions(exclude: Set<string>): Nerf[] {
  // The deal draws from the capped opening pool (see MAX_OPENING_NERF_TIER).
  const pool = openingNerfPool().filter((d) => !exclude.has(d.id));
  const ofTier = (tier: number) => pool.filter((d) => d.tier === tier);
  const takeOne = (tier: number, taken: Set<string>): Nerf => {
    const candidates = ofTier(tier).filter((d) => !taken.has(d.id));
    const card = candidates[Math.floor(Math.random() * candidates.length)];
    taken.add(card.id);
    return card;
  };
  // A tier pairing is feasible only if the pool supplies the four distinct
  // cards: four of the anchor tier when the partner tier matches it,
  // otherwise two of each.
  const feasible = (anchor: number, partner: number) =>
    partner === anchor
      ? ofTier(anchor).length >= 4
      : ofTier(anchor).length >= 2 && ofTier(partner).length >= 2;
  const tiers = [...new Set(pool.map((d) => d.tier))];
  const anchorTiers = tiers.filter((anchor) =>
    tiers.some((partner) => Math.abs(partner - anchor) <= 1 && feasible(anchor, partner)),
  );
  const anchorTier = anchorTiers[Math.floor(Math.random() * anchorTiers.length)];
  const partnerTiers = tiers.filter(
    (partner) => Math.abs(partner - anchorTier) <= 1 && feasible(anchorTier, partner),
  );
  const partnerTier = partnerTiers[Math.floor(Math.random() * partnerTiers.length)];
  const taken = new Set<string>();
  const first = [takeOne(anchorTier, taken), takeOne(partnerTier, taken)];
  const second = [takeOne(anchorTier, taken), takeOne(partnerTier, taken)];
  // Randomize each side's card order and which side gets which hand, so
  // neither the anchor card nor a specific hand always lands on one player.
  if (Math.random() < 0.5) first.reverse();
  if (Math.random() < 0.5) second.reverse();
  return Math.random() < 0.5 ? [...first, ...second] : [...second, ...first];
}

// Starting a local bot game is real engagement, so it mints a guest account
// (fire-and-forget) to make engaged visitors visible in the moderators' guest
// counts — see the effect below. Module-level so remounts (color swaps,
// rematches, strict-mode double effects) never re-trigger it: at most one
// ensure per page load.
let ensuredAccountForBotGame = false;

const BOT_ELO: Record<AILevel, number> = {
  easy: 1100,
  medium: 1500,
  hard: 1900,
};

// Shared draft reveal timing, mirroring the online match: the banner eases
// in a short beat after the SECOND side resolves (so the picked card's
// pocket-flight and dock landing finish first, never mid-choice), then
// holds about four seconds.
const DRAFT_REVEAL_EASE_MS = 450;
const DRAFT_REVEAL_HOLD_MS = 4000;

export default function GamePageWrapper() {
  // Rematch remounts GamePage under a fresh key with the URL untouched, so
  // bootstrapGame re-runs against the SAME configuration (mode, strength,
  // color, clock) with every piece of game state reset. GamePage clears the
  // saved game first so the remount deals fresh instead of restoring the
  // finished game.
  const [session, setSession] = useState(0);
  return (
    <Suspense fallback={<LoadingPanel />}>
      <GamePage key={session} onRematch={() => setSession((s) => s + 1)} />
    </Suspense>
  );
}

function LoadingPanel() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="relative flex flex-col items-center">
        <div className="flex gap-1.5 mb-3">
          <span className="w-2 h-2 rounded-full bg-gold-leaf animate-bob" />
          <span className="w-2 h-2 rounded-full bg-verdigris-glow animate-bob" style={{ animationDelay: "0.15s" }} />
          <span className="w-2 h-2 rounded-full bg-bruise-glow animate-bob" style={{ animationDelay: "0.3s" }} />
        </div>
        <div className="font-display text-xl text-parchment">
          Dealing the cards
        </div>
      </div>
    </main>
  );
}

function GamePage({ onRematch }: { onRematch: () => void }) {
  // Zen mode: `z` hides everything but the board, clocks and move list.
  useZenHotkey();
  const router = useRouter();
  const params = useSearchParams();
  const querySignature = params.toString();
  const difficulty = (params.get("difficulty") ?? "medium") as AILevel;
  const myColorParam = params.get("color") ?? "random";
  const myNerfId = params.get("nerf") ?? "random";
  // Section split: mode=nerf (nerf pick, hidden until the end, nerf-modifier
  // buffs every ~10 moves) or mode=buff (no nerfs, normal buff drafts).
  // Old links with draft=1 and no mode keep the legacy merged rules.
  const modeParam = params.get("mode");
  const gameMode: "nerf" | "buff" | null =
    modeParam === "nerf" || modeParam === "buff" ? modeParam : null;
  // Plain chess vs the bot: no nerfs on either side and no buff drafts. Both
  // the homepage/history "Play vs Bot" links (mode=ai) and the /play "Plain
  // chess" option (mode=plain) land here, so clicking Play vs Bot never drops
  // the player into a hidden-handicap game.
  const plainMode = modeParam === "plain" || modeParam === "ai";
  // Draft mode: buff drafts on a cadence (plus a nerf draft outside buff mode).
  const draftMode = params.get("draft") === "1" || gameMode != null;
  // Games vs bots are casual by default; only rated games touch your rating.
  // Draft games are always casual until a separate Draft rating exists.
  const rated = params.get("rated") === "1" && !draftMode;
  // t = seconds per side; 0 (or missing) disables the clock entirely.
  const initialTimeMs = useMemo(() => {
    const t = parseInt(params.get("t") ?? "0", 10);
    return Number.isFinite(t) && t > 0 ? t * 1000 : 0;
  }, [params]);
  const incrementMs = useMemo(() => {
    const inc = parseInt(params.get("inc") ?? "0", 10);
    return Number.isFinite(inc) && inc > 0 ? inc * 1000 : 0;
  }, [params]);
  const clockEnabled = initialTimeMs > 0;
  // Which independent rating bucket a rated result counts toward — derived
  // from the chosen time control, exactly like online games.
  const ratingCategory = categoryForTimeControl(initialTimeMs / 1000, incrementMs / 1000);

  const [myColor, setMyColor] = useState<Color>(() => {
    if (myColorParam === "w") return "w";
    if (myColorParam === "b") return "b";
    return Math.random() < 0.5 ? "w" : "b";
  });

  const [game, setGame] = useState<NerfGame | null>(null);
  // Draft mode's opening nerf draft: both players see two nerf cards and pick
  // one. The game object isn't created until the player commits.
  const [nerfDraft, setNerfDraft] = useState<{ myOptions: Nerf[]; aiOptions: Nerf[] } | null>(null);
  // Two-step nerf pick: the first click only selects; Confirm (or a second
  // click on the same card) commits it.
  const [nerfSelected, setNerfSelected] = useState<number | null>(null);
  // Lock-in deadlines (15s), mirroring the online rules: the nerf pick and
  // every buff offer auto-resolve when the timer runs out, and the game
  // clock is paused while an offer is open.
  const [nerfDeadline, setNerfDeadline] = useState<number | null>(null);
  const [offerDeadline, setOfferDeadline] = useState<number | null>(null);
  const [offerPausedAt, setOfferPausedAt] = useState<number | null>(null);
  // Offer index whose free lock-in window has expired: the draft panel moves
  // aside, the board comes back into view, and the clock resumes — the rest
  // of the deliberation costs the player's own time.
  const [offerOnClockIndex, setOfferOnClockIndex] = useState<number | null>(null);
  const [, force] = useState(0);
  const [premoves, setPremoves] = useState<QueuedPremove[]>([]);
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [confirmingDraw, setConfirmingDraw] = useState(false);
  // A move held for confirmation (Settings > Gameplay > Move confirmation).
  const [confirmMovePending, setConfirmMovePending] = useState<Move | null>(null);
  const [showResult, setShowResult] = useState(true);
  const [drawOfferStatus, setDrawOfferStatus] = useState<"idle" | "offering" | "declined">("idle");
  const [whiteMs, setWhiteMs] = useState(initialTimeMs);
  const [blackMs, setBlackMs] = useState(initialTimeMs);
  const [uiSettings, setUiSettings] = useState(() => loadSettings());
  useEffect(() => {
    const sync = () => setUiSettings(loadSettings());
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
  }, []);
  const [historyPly, setHistoryPly] = useState<number | null>(null);
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
  const [playerElo, setPlayerElo] = useState<number | null>(null);
  // Reveal controls: peek at the opponent's rule mid-game, and offer to show
  // your own rule to the opponent.
  const [oppPeek, setOppPeek] = useState(false);
  const [sharedMine, setSharedMine] = useState(false);
  // Bumped when a targeting tap lands on a non-eligible square; the
  // TargetingBanner flashes a one-line "what is targetable" hint per bump.
  const [invalidPickKey, setInvalidPickKey] = useState(0);
  // The rail can be dragged wider/narrower by its right edge (desktop);
  // --match-rail-w feeds both the grid column and the board sizing math.
  const { railWidth, resizeRail, railWidthStyle } = useRailWidth();
  const aiThinking = useRef(false);
  const gameRef = useRef<NerfGame | null>(null);
  const aiWorkerRef = useRef<Worker | null>(null);
  const aiRequestId = useRef(0);
  const boardShellRef = useRef<HTMLDivElement | null>(null);
  // Per-ply board snapshots, captured as the game advances. History review
  // otherwise reconstructs a position by replaying moves from the initial
  // board, which cannot reproduce the position once a buff mutated the board
  // directly (a summon/removal/teleport sets buffs.historyDiverged). These
  // snapshots hold the exact board shown at each ply, so navigation (arrow
  // keys, move-list clicks, mouse wheel) keeps working across such events.
  const boardSnapshotsRef = useRef<Map<number, BoardState>>(new Map());
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
  const whiteCustomSpec = useRef<CustomNerf | null>(null);
  const blackCustomSpec = useRef<CustomNerf | null>(null);
  // Seeded from mount time via a lazy state initializer (pure in render).
  const [mountTime] = useState(() => Date.now());
  const turnStartedAtRef = useRef(mountTime);

  // whiteMs/blackMs are the single source of truth for remaining time: the
  // banked milliseconds each side had when their last turn ended. While a
  // side is on move, their live remaining time is banked minus the time since
  // the turn started; nothing else ever writes these values, so time only
  // decreases (plus increments) and never resets.
  const remainingClock = useCallback(
    (color: Color) => {
      const base = color === "w" ? whiteMs : blackMs;
      if (!clockEnabled || !game || game.result || game.board.turn !== color) return base;
      // Clock paused for a buff lock-in window: freeze the drain at the
      // moment the offer opened (turnStartedAtRef is shifted on resolve).
      const until = offerPausedAt ?? Date.now();
      return Math.max(0, base - Math.max(0, until - turnStartedAtRef.current));
    },
    [blackMs, clockEnabled, game, whiteMs, offerPausedAt]
  );

  // Bank the mover's clock at the moment their move is committed: subtract
  // the time spent this turn, add the increment, and start the opponent's
  // turn timer. Uses functional updates and no game state, so it is immune
  // to `playMove` mutating the game (the turn has already flipped by the
  // time any post-move code runs) and to stale closures.
  const commitClock = useCallback(
    (mover: Color) => {
      if (!clockEnabled) return;
      const now = Date.now();
      const spent = Math.max(0, now - turnStartedAtRef.current);
      turnStartedAtRef.current = now;
      // No increment while a Chess Diff sub-game runs: it is strictly 1+0.
      const inc = gameRef.current?.buffs?.diff ? 0 : incrementMs;
      const bank = (prev: number) => Math.max(0, prev - spent) + inc;
      if (mover === "w") setWhiteMs(bank);
      else setBlackMs(bank);
    },
    [clockEnabled, incrementMs]
  );

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  // --- First-game tour hook (additive; active only with ?tour=1) ----------
  // The guided tour route (/tutorial/first-game) renders this page and layers
  // coach marks on top. The game is never touched from outside: this effect
  // only broadcasts a tiny read-only snapshot of tour-relevant state after
  // every game update, and the tour component gates its steps on it.
  const tourMode = params.get("tour") === "1";
  useEffect(() => {
    if (!tourMode) return;
    const mine = game?.buffs?.players[myColor];
    const detail: TourGameState = {
      ready: !!game,
      myMoves: game ? game.board.history.filter((m) => m.color === myColor).length : 0,
      myTurn: !!game && !game.result && game.board.turn === myColor,
      offerOpen: !!mine?.offer && !game?.result,
      heldBuffs: mine?.buffs.length ?? 0,
      banked: !!mine?.flags.bankBonus,
      over: !!game?.result,
    };
    window.dispatchEvent(new CustomEvent<TourGameState>(TOUR_STATE_EVENT, { detail }));
  }, [tourMode, game, myColor]);

  // Chess Diff sub-game clock swap: while the engine's bs.diff runs, both
  // sides play on the diff's 1+0 minute; the paused game's clocks are stashed
  // here and restored when the diff is decided (mirrors the online server's
  // match.diff handling). The transition guard (the ref) makes the effect a
  // no-op on every re-render in between.
  const diffActive = !!game?.buffs?.diff;
  const diffSavedClocksRef = useRef<{ w: number; b: number } | null>(null);
  useEffect(() => {
    if (!clockEnabled) return;
    if (diffActive && !diffSavedClocksRef.current) {
      // Stash the LIVE remaining time, not the banked value. whiteMs/blackMs
      // are only banked when a move commits, and a diff is started by a buff
      // ACTIVATION — commitClock never ran — so the mover can have been
      // thinking for a while. Saving the banked figure handed all of that time
      // back when the diff resolved. remainingClock is the same helper the
      // display uses, and the server does the equivalent (applyDiffTransitions
      // banks via currentClocks before swapping).
      diffSavedClocksRef.current = { w: remainingClock("w"), b: remainingClock("b") };
      turnStartedAtRef.current = Date.now();
      setWhiteMs(60_000);
      setBlackMs(60_000);
    } else if (!diffActive && diffSavedClocksRef.current) {
      const saved = diffSavedClocksRef.current;
      diffSavedClocksRef.current = null;
      turnStartedAtRef.current = Date.now();
      setWhiteMs(saved.w);
      setBlackMs(saved.b);
    }
  }, [diffActive, clockEnabled, whiteMs, blackMs, remainingClock]);

  useEffect(() => {
    return () => {
      aiWorkerRef.current?.terminate();
      aiWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setPlayerElo(loadRatingFor(ratingCategory).rating);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function bootstrapGame() {
    try {
      const saved = loadSavedAiGame(querySignature);
      if (saved) {
        const restored = restoreSavedAiGame(saved);
        if (restored) {
          setMyColor(saved.myColor);
          setGame(restored);
          setWhiteMs(saved.whiteMs);
          setBlackMs(saved.blackMs);
          setPremoves([]);
          whiteCustomSpec.current =
            saved.game.white.nerf.kind === "custom" ? saved.game.white.nerf.spec : null;
          blackCustomSpec.current =
            saved.game.black.nerf.kind === "custom" ? saved.game.black.nerf.spec : null;
          lastSeenMoveCount.current = restored.board.history.length;
          sawResult.current = !!restored.result;
          // Deterministic timeout recovery replaced the "expired draft stays
          // parked" model: an unresolved draft always restarts preparation on
          // restore and receives a complete fresh window, at the end of which
          // it auto-resolves. There is no on-clock pending state to restore, so
          // a refresh can never strand a draft (or silently charge for one).
          setOfferOnClockIndex(null);
          return;
        }
      }
    } catch {
      // Ignore incompatible saved games and deal a fresh one below.
    }

    if (draftMode) {
      // Buff mode: no nerfs at all, so the game starts immediately.
      if (gameMode === "buff") {
        const g = newGame(UNRESTRICTED_NERF, UNRESTRICTED_NERF, makeSeed());
        enableDraftMode(g, makeSeed(), { mode: "buff" });
        setHistoryPly(null);
        setGame(g);
        return;
      }
      // Deal both players' nerf options; the game starts when the player
      // picks, or when the 15s lock-in window auto-picks the first option.
      const dealt = dealNerfOptions(new Set());
      setNerfDraft({ myOptions: dealt.slice(0, 2), aiOptions: dealt.slice(2, 4) });
      setNerfDeadline(Date.now() + 20_000);
      return;
    }

    if (plainMode) {
      // Plain chess: both sides run the no-nerf sentinel, so neither player
      // carries a hidden handicap. No buffs, no drafts, just chess vs the bot.
      setHistoryPly(null);
      setGame(newGame(UNRESTRICTED_NERF, UNRESTRICTED_NERF, makeSeed()));
      return;
    }

    let myDb: Nerf;
    let myCustomSpec: CustomNerf | null = null;
    if (myNerfId === "__custom__") {
      try {
        const raw = sessionStorage.getItem("dc:active-custom");
        const spec = raw ? (JSON.parse(raw) as CustomNerf) : null;
        myCustomSpec = spec;
        myDb = spec ? buildCustomNerf(spec) : pickRandomNerf();
      } catch {
        myDb = pickRandomNerf();
      }
    } else if (myNerfId === "random") {
      myDb = pickRandomNerf();
    } else {
      myDb = IMPLEMENTED_BY_ID[myNerfId] ?? pickRandomNerf();
    }
    const aiDb = pickRandomNerf();
    const wDb = myColor === "w" ? myDb : aiDb;
    const bDb = myColor === "w" ? aiDb : myDb;
    whiteCustomSpec.current = myColor === "w" ? myCustomSpec : null;
    blackCustomSpec.current = myColor === "w" ? null : myCustomSpec;
    setHistoryPly(null);
    setGame(newGame(wDb, bDb, makeSeed()));
  }

  useEffect(() => {
    // Deferred a microtask so the one-time game bootstrap doesn't set a cascade
    // of state synchronously inside the effect body (runs before first paint).
    queueMicrotask(bootstrapGame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A visitor who starts a local bot game is engaged: mint a guest account so
  // they show up in the moderators' "guests created" counts (guests used to be
  // created only on joining an online seek, leaving these visitors invisible).
  // ensureAccount no-ops for signed-in users and dedupes; the module flag keeps
  // it to one attempt per page load. Skipped for the guided tour (?tour=1),
  // which isn't a self-initiated game. Fire-and-forget: the local game never
  // waits on (or fails with) it.
  useEffect(() => {
    if (tourMode || ensuredAccountForBotGame) return;
    ensuredAccountForBotGame = true;
    void ensureAccount().catch(() => {});
  }, [tourMode]);

  // Draft mode: the player picked their nerf; the bot picks one of its two
  // options at random and the game begins.
  const startDraftGame = (picked: Nerf) => {
    if (!nerfDraft) return;
    setNerfSelected(null);
    const aiDb = nerfDraft.aiOptions[Math.floor(Math.random() * nerfDraft.aiOptions.length)];
    const wDb = myColor === "w" ? picked : aiDb;
    const bDb = myColor === "w" ? aiDb : picked;
    const g = newGame(wDb, bDb, makeSeed());
    enableDraftMode(g, makeSeed(), { mode: gameMode ?? undefined });
    g.buffs!.players[myColor].nerfOptions = nerfDraft.myOptions.map((n) => n.id);
    g.buffs!.players[myColor === "w" ? "b" : "w"].nerfOptions = nerfDraft.aiOptions.map((n) => n.id);
    setNerfDraft(null);
    setNerfDeadline(null);
    setHistoryPly(null);
    setGame(g);
  };

  // Feed of the cards the opponent (bot) has played. Each play shows in the
  // top-right for 10 seconds (OppPlaysLog TTL), then flies down into the
  // dock's permanent "Opponent played" ledger, so nothing it did is ever
  // unreadable.
  const [oppLog, setOppLog] = useState<OppPlay[]>([]);
  const oppKeyRef = useRef(0);
  // Which held-buff hook mutations have already been announced to the feed,
  // keyed by owner:index (buff slots are append-only), so a passive that fires
  // once is never re-announced on a later re-render.
  const reportedHooksRef = useRef(new Set<string>());
  // Ply at which lastHookMutations was last inspected, so the reporter reacts
  // only to real new moves (lastHookMutations is transient per playMove).
  const lastHookPlyRef = useRef(0);
  const showOppUsedCard = (card: { id: string; tier: number }, label: string) => {
    // Bounded but roomy: the dock keeps the whole game's plays readable.
    setOppLog((log) => [...log, { key: oppKeyRef.current++, card, label, at: Date.now() }].slice(-60));
  };
  // Signature spectacles: a played card's id + a monotonic key handed to the
  // Board, which dresses the resulting piece diff as that card's choreography.
  // Fires for BOTH the bot's plays and my own. My own activations run inside
  // the (un-owned) targeting hook, so the id is snapshotted at "Use" time
  // (pendingSigIdRef) and fired from onChanged once the activation lands.
  const pendingSigIdRef = useRef<string | null>(null);
  // Every known card fires: cards with a bespoke SIGNATURES entry get their
  // choreography, and every other card gets the category cast spectacle the
  // Board synthesizes from its category + tier (no card plays silently).
  // HOLD-AND-REPLAY + serialization live in the shared queue: plays that land
  // while my full-screen draft overlay covers the board (or while another
  // spectacle is mid-play) queue and step out one by one.
  const draftCoveredRef = useRef(false);
  const { signatureCard, fire: fireSigQueued, notifyGateOpen, busy: sigBusy } = useSignatureQueue(draftCoveredRef);
  // --- Draft lifecycle sequencing -----------------------------------------
  // The state machine (useDraftSequence) owns the order of the draft moments:
  // board spectacles finish FIRST (sigBusy from the signature queue), only
  // then does the overlay mount (chest + deal), and only once the overlay
  // reports both cards dealt and interactive is the 20s decision window
  // armed. The countdown can therefore never tick while anything animates.
  const liveOffer = !game?.result ? game?.buffs?.players[myColor]?.offer ?? null : null;
  const liveOfferKey = liveOffer ? `${liveOffer.index}:${liveOffer.rerolled ?? 0}` : null;
  const liveOfferOnClock = !!liveOffer && offerOnClockIndex === liveOffer.index;
  const draftSeq = useDraftSequence({
    offerKey: liveOfferKey,
    animationsBusy: sigBusy,
    onClock: liveOfferOnClock,
    onDecisionStart: (deadline) => setOfferDeadline(deadline),
    onPrepStart: () => setOfferDeadline(null),
  });
  const draftCovered = !!liveOffer && !liveOfferOnClock && draftSeq.overlayVisible;
  useEffect(() => {
    draftCoveredRef.current = draftCovered;
  });
  // An active draft (held, preparing, or deciding) gates every nonessential
  // interruption (performance prompts, achievement toasts): they queue and
  // present after the draft resolves. Board spectacles hold the gate too, so
  // a recommendation can never land mid-animation either.
  const draftActive = liveOfferKey != null;
  useEffect(() => {
    if (draftActive) return pushUiHold();
  }, [draftActive]);
  useEffect(() => {
    if (sigBusy) return pushUiHold();
  }, [sigBusy]);
  // Signature plays keyed by the ply they landed on (history length at fire
  // time), so the clip renderer can splash the card name over that segment.
  const sigPlyRef = useRef<Map<number, string>>(new Map());
  const fireSignature = (id: string) => {
    if (!BUFF_BY_ID[id]) return;
    sigPlyRef.current.set(gameRef.current?.board.history.length ?? 0, id);
    fireSigQueued(id);
  };
  useEffect(() => {
    if (!draftCovered) notifyGateOpen();
  }, [draftCovered, notifyGateOpen]);
  // Snapshot the id of a card I am about to use (dock "Use" entry point) so
  // onChanged can fire its signature once the activation resolves.
  const snapshotMySignature = (buffIndex: number) => {
    pendingSigIdRef.current = game?.buffs?.players[myColor].buffs[buffIndex]?.id ?? null;
  };

  // Shared reveal moment: once BOTH sides of a simultaneous draft round have
  // resolved (either order: the bot usually resolves first, but my pick can
  // land before its effect runs), show both briefly. The bot side follows
  // the same visibility rules as the rest of the UI: fully open-handed, every
  // card face-up (full transparency).
  const [draftReveal, setDraftReveal] = useState<{
    mine: DraftRevealSide;
    theirs: DraftRevealSide;
  } | null>(null);
  const myResolvedRef = useRef<DraftRevealSide | null>(null);
  const botResolvedRef = useRef<DraftRevealSide | null>(null);
  const draftRevealTimerRef = useRef<number | null>(null);
  const tryFireDraftReveal = () => {
    const mine = myResolvedRef.current;
    const theirs = botResolvedRef.current;
    if (!mine || !theirs) return;
    myResolvedRef.current = null;
    botResolvedRef.current = null;
    // Both sides have resolved by definition here, so the banner can never
    // appear while the player is still choosing. The short ease-in beat
    // lets the picked card's pocket-flight and dock landing play out before
    // the banner arrives instead of being stomped by the overlay teardown.
    if (draftRevealTimerRef.current != null) window.clearTimeout(draftRevealTimerRef.current);
    draftRevealTimerRef.current = window.setTimeout(
      () => setDraftReveal({ mine, theirs }),
      DRAFT_REVEAL_EASE_MS,
    );
  };
  const recordMyDraftResolution = (mine: DraftRevealSide) => {
    myResolvedRef.current = mine;
    tryFireDraftReveal();
  };
  // Hold the banner about four seconds, then dismiss it.
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

  // Draft mode: the bot resolves its pending buff drafts immediately.
  useEffect(() => {
    if (!game?.buffs || game.result) return;
    const botColor: Color = myColor === "w" ? "b" : "w";
    if (game.buffs.players[botColor].offer) {
      const before = game.buffs.players[botColor].buffs.length;
      aiResolveDraft(game, botColor);
      // Instants show on the board the moment the bot picks them; surface
      // what the card did, matching the online reveal-at-pick rule.
      const gained = game.buffs.players[botColor].buffs.slice(before);
      const instant = gained.find((b) => BUFF_BY_ID[b.id]?.kind === "instant" && !b.nullified);
      if (instant) {
        showOppUsedCard(
          { id: instant.id, tier: instant.tier },
          `Bot played a ${draftCardNoun(game.buffs.mode)}`,
        );
        // Instant attack spectacles (Cataclysm, Extinction) clear the board at
        // pick time; dress that clear as the card's signature.
        fireSignature(instant.id);
      }
      // Hold the bot's resolution for the shared reveal that fires once
      // both sides of the round are in (my pick may already be waiting).
      // FULL TRANSPARENCY: every picked card shows face-up, identity and all,
      // matching the open-handed online rules.
      botResolvedRef.current = gained.length
        ? {
            banked: false,
            cards: gained.map((b) => ({ id: b.id, tier: b.tier })),
          }
        : { banked: true, cards: [] };
      tryFireDraftReveal();
      queueMicrotask(() => setGame({ ...game }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, myColor]);

  // Clock pause for my buff offers: the clock freezes the INSTANT an offer
  // opens (before any chest or deal animation), and resolving it shifts the
  // turn start forward by the paused span so the pick cost no time. The
  // decision deadline itself is NOT armed here: the draft sequence machine
  // arms it (onDecisionStart above) only once every animation has finished
  // and both cards are dealt and interactive, so the player always gets the
  // complete 20 seconds. Once the window has expired for an offer
  // (offerOnClockIndex), the clock stays live: the panel sits at the side
  // and thinking runs on the player's time.
  useEffect(() => {
    const offer = game?.buffs?.players[myColor].offer ?? null;
    if (offer && offerPausedAt == null && offerOnClockIndex !== offer.index) {
      queueMicrotask(() => {
        setOfferPausedAt(Date.now());
      });
    } else if (!offer && offerPausedAt != null) {
      turnStartedAtRef.current += Date.now() - Math.max(offerPausedAt, turnStartedAtRef.current);
      queueMicrotask(() => {
        setOfferPausedAt(null);
        setOfferDeadline(null);
      });
    } else if (offer && offerPausedAt != null && offerOnClockIndex === offer.index) {
      // The free window ran out with the offer still open: the draft steps
      // into the corner panel and the clock resumes. The paused span is still
      // free; only the thinking from here on is charged.
      turnStartedAtRef.current += Date.now() - Math.max(offerPausedAt, turnStartedAtRef.current);
      queueMicrotask(() => setOfferPausedAt(null));
    }
  }, [game, myColor, offerPausedAt, offerOnClockIndex]);

  useEffect(() => {
    if (!game) return;
    const persist = () =>
      saveAiGame({
        query: querySignature,
        myColor,
        game,
        whiteMs: remainingClock("w"),
        blackMs: remainingClock("b"),
        premoves,
        whiteCustomSpec: whiteCustomSpec.current,
        blackCustomSpec: blackCustomSpec.current,
        draftOnClockIndex: offerOnClockIndex,
      });
    persist();
    if (!clockEnabled || game.result) return;
    // The active side's clock keeps draining between renders, so re-save it
    // periodically and on page hide — a refresh must restore the live
    // remaining time, not the time as of the last move.
    window.addEventListener("pagehide", persist);
    const id = window.setInterval(persist, 3000);
    return () => {
      window.removeEventListener("pagehide", persist);
      window.clearInterval(id);
    };
  }, [game, querySignature, myColor, premoves, remainingClock, clockEnabled, offerOnClockIndex]);

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
    // Same pruning for recorded signature plays (a fresh game resets to 0).
    for (const key of sigPlyRef.current.keys()) {
      if (key > ply) sigPlyRef.current.delete(key);
    }
  }, [game]);

  // --- Clip sharing (stylized canvas replay of the last plies) -------------
  const [clipOpen, setClipOpen] = useState(false);
  // Frozen copies of the snapshot/signature caches, taken when the modal
  // opens (refs can't be read during render, and the modal wants stable data).
  const [clipData, setClipData] = useState<{
    snapshots: Map<number, BoardState>;
    signatureIds: Map<number, string>;
  } | null>(null);
  // Whether a clip can be built right now (>= 2 consecutive reconstructable
  // positions ending at the head). Derived in an effect because it reads the
  // snapshot ref; cheap (bounded to a 10-ply window).
  const [clipPlies, setClipPlies] = useState(0);
  useEffect(() => {
    queueMicrotask(() => {
      if (!game) {
        setClipPlies(0);
        return;
      }
      setClipPlies(
        clipPliesAvailable(
          game.board.history,
          boardSnapshotsRef.current,
          !!game.buffs?.historyDiverged,
        ),
      );
    });
  }, [game]);
  const openClip = useCallback(() => {
    setClipData({
      snapshots: new Map(boardSnapshotsRef.current),
      signatureIds: new Map(sigPlyRef.current),
    });
    setClipOpen(true);
  }, []);

  // History shrank past (or exactly to) the reviewed ply — a rewind or a
  // fresh game replaced the record. Return to the LIVE board (null), never
  // to historyPly === length: that would strand the UI in a half-review
  // state showing the live position while review still blocks every move
  // and disables the forward controls. Clamped during render, not an effect.
  if (game && historyPly != null && historyPly >= game.board.history.length) {
    setHistoryPly(null);
  }

  const moves = useMemo(() => (game ? legalMoves(game) : []), [game]);
  // The opponent's would-be moves, for the click-an-enemy-piece inspection
  // preview (dots on every square that piece could reach).
  const oppPreviewMoves = useMemo(
    () => (game && !game.result ? previewMovesFor(game, myColor === "w" ? "b" : "w") : []),
    [game, myColor],
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
  // the board shell only, so scrolling the move list still scrolls it; it
  // stands down while a modal/overlay owns the screen, and leaves the event
  // alone at either end so the page can still scroll normally.
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

  // Build a "virtual" board that reflects the current actual board with every
  // queued premove applied in sequence. Pseudo-legal options for further
  // premoves are generated against this virtual board, so chained premoves
  // (move A then move B with A already applied) work naturally.
  //
  // We also synthesize "friendly-target" moves: moves that would land on one
  // of our own pieces. The user can premove these in anticipation of the
  // opponent capturing first; at execute time, if the friendly piece is still
  // there the real legal-move list won't include the move and the premove is
  // discarded.
  const myNerfForPremove = game ? (myColor === "w" ? game.white.nerf : game.black.nerf) : null;
  const myStateForPremove = game ? (myColor === "w" ? game.white.state : game.black.state) : null;

  const { virtualBoard, validPremoves } = useMemo(() => {
    if (!game || game.result || (game.board.turn === myColor && premoves.length === 0)) {
      return { virtualBoard: null as BoardState | null, validPremoves: [] as QueuedPremove[] };
    }
    let board = cloneBoard(game.board);
    board.turn = myColor;
    board.epTarget = null;
    const valid: QueuedPremove[] = [];
    for (const pm of premoves) {
      const ctx: GameContext = {
        board,
        me: myColor,
        opponentLastMove: [...board.history].reverse().find((m) => m.color !== myColor) ?? null,
        myLastMove: [...board.history].reverse().find((m) => m.color === myColor) ?? null,
        moveNumber: board.history.filter((m) => m.color === myColor).length,
        capturedByMe: game.captured[myColor],
        capturedFromMe: game.captured[myColor === "w" ? "b" : "w"],
      };
      // Passing the game unions buff-granted movement in, so a piece a card
      // transformed/upgraded can be premoved with its real moves.
      const options = premoveOptionsFor(board, myColor, myNerfForPremove, myStateForPremove, ctx, game);
      const match = options.find(
        (c) =>
          c.from === pm.from &&
          c.to === pm.to &&
          (c.promotion ?? undefined) === (pm.promotion ?? undefined) &&
          (!pm.capture || !!c.captured),
      );
      if (!match) break;
      board = makeMove(board, match);
      board.turn = myColor;
      board.epTarget = null;
      valid.push(pm);
    }
    return { virtualBoard: board, validPremoves: valid };
  }, [game, myColor, premoves, myNerfForPremove, myStateForPremove]);

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
    // The game argument unions buff-granted movement into the option set.
    return premoveOptionsFor(virtualBoard, myColor, myNerfForPremove, myStateForPremove, ctx, game);
  }, [virtualBoard, myColor, game, myNerfForPremove, myStateForPremove]);

  // The board is in true premove mode only when it's the opponent's turn. When
  // it's our turn and premoves are still pending, the head is about to commit;
  // we keep showing the virtual board so the piece doesn't flicker back to its
  // original square between the AI move landing and our queued move firing.
  const premoveMode =
    uiSettings.premovesEnabled && !!game && !game.result && game.board.turn !== myColor && !!virtualBoard;
  const premovePending = !!game && !game.result && game.board.turn === myColor && validPremoves.length > 0;

  // Played-move sound effects: react to history change.
  const lastSeenMoveCount = useRef(0);
  useEffect(() => {
    if (!game) return;
    const hist = game.board.history;
    if (hist.length === lastSeenMoveCount.current) return;
    const last = hist[hist.length - 1];
    if (last) {
      // One call, five possible voices: quiet click, capture, the castle
      // double-knock, a pocket drop, plus the promotion flourish on top. The
      // bot's moves land a semitone darker and a shade quieter than yours, so
      // "the board changed and it was not me" is audible without looking.
      playMoveCue(last, { opponent: last.color !== myColor });
      // gameInCheck also sees buff-granted movement, so a king attacked only
      // by an empowered "weird" piece (an amazon, a camel knight...) still
      // rings the check bell. Being checked keeps the full two-ring alarm;
      // a check you just delivered gets the single opening toll.
      if (gameInCheck(game, game.board.turn)) {
        const onMe = game.board.turn === myColor;
        setTimeout(() => playCheck({ onMe }), 80);
      }
    }
    // Plain ref bookkeeping; flagged only as collateral of the mutable-replica
    // bailout elsewhere in this component (isolated, this pattern is clean).
    // eslint-disable-next-line react-hooks/immutability
    lastSeenMoveCount.current = hist.length;
    // myColor only changes when a new game is set up, and the history-length
    // guard above already swallows a re-run that plays no new move, so naming
    // it here cannot double-sound anything.
  }, [game, myColor]);

  // Board-mutating self-buffs (the bot's summon/transform/revive/removal that
  // reacts to a move) mutate the board with no draft frame to hang a play on.
  // The engine records which held buffs observably changed the board on the
  // last move (lastHookMutations); surface the bot's to the play feed and fire
  // every fired card's signature, so a board-changing buff is never silent.
  useEffect(() => {
    const bs = game?.buffs;
    const histLen = game?.board.history.length ?? 0;
    if (!bs || histLen === lastHookPlyRef.current) {
      lastHookPlyRef.current = histLen;
      return;
    }
    lastHookPlyRef.current = histLen;
    const fired = bs.lastHookMutations;
    if (!fired) return;
    const botColor: Color = myColor === "w" ? "b" : "w";
    for (const { color, index } of fired) {
      const inst = bs.players[color].buffs[index];
      if (!inst || !inst.id || !BUFF_BY_ID[inst.id]) continue;
      fireSignature(inst.id);
      if (color !== botColor) continue;
      const key = `${color}:${index}`;
      if (reportedHooksRef.current.has(key)) continue;
      reportedHooksRef.current.add(key);
      showOppUsedCard({ id: inst.id, tier: inst.tier }, `Bot's ${draftCardNoun(bs.mode)} triggered`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, myColor]);

  // Game-ended hook: play the nerf sound, apply the rating, and record the
  // finished game into the local history. Runs exactly once per game;
  // restoring an already-finished saved game pre-sets sawResult so a refresh
  // never double-records.
  const sawResult = useRef(false);
  const [ratingChange, setRatingChange] = useState<{ before: number; after: number } | null>(null);
  // Post-game W/L/D in this time-control bucket, read back from the local
  // rating store once a rated result has been saved. Null for casual games.
  const [postRecord, setPostRecord] = useState<{ wins: number; losses: number; draws: number } | null>(null);
  // Snapshot of the card-play-by-ply record (sigPlyRef), taken at game end, for
  // the result screen's match timeline. A ref can't be read during render.
  const [timelineEvents, setTimelineEvents] = useState<{ ply: number; cardId: string }[]>([]);
  useEffect(() => {
    if (!game?.result || sawResult.current) return;
    // Plain ref bookkeeping; flagged only as collateral of the mutable-replica
    // bailout elsewhere in this component (isolated, this pattern is clean).
    // eslint-disable-next-line react-hooks/immutability
    sawResult.current = true;
    if (game.result.reason && game.result.reason.includes(":")) {
      playNerf();
    }
    // Casual games don't affect your rating.
    let change: { before: number; after: number } | null = null;
    if (rated) {
      const before = loadRatingFor(ratingCategory);
      const score: 0 | 0.5 | 1 =
        game.result.winner === "draw" ? 0.5 : game.result.winner === myColor ? 1 : 0;
      const after = applyResult(before, difficulty, score);
      saveRatingFor(ratingCategory, after, score === 1 ? "win" : score === 0 ? "loss" : "draw");
      change = { before: before.rating, after: after.rating };
      const applied = change;
      // Read the updated bucket back for the W/L/D line on the result screen.
      const stats = loadRatings()[ratingCategory];
      const record = { wins: stats.wins, losses: stats.losses, draws: stats.draws };
      queueMicrotask(() => {
        setPlayerElo(after.rating);
        setRatingChange(applied);
        setPostRecord(record);
      });
    }
    const events = Array.from(sigPlyRef.current, ([ply, id]) => ({ ply, cardId: id }));
    queueMicrotask(() => {
      setShowResult(true);
      setTimelineEvents(events);
    });
    recordCompletedGame({
      mode: "ai",
      opponent: `${difficulty[0].toUpperCase()}${difficulty.slice(1)} Bot`,
      myColor,
      outcome: outcomeFor(game.result.winner, myColor),
      reason: game.result.reason,
      rated,
      moveCount: game.board.history.length,
      baseSec: initialTimeMs / 1000,
      incSec: incrementMs / 1000,
      ratingChange: change,
      // Plain chess has no rules to report; leave both nerf summaries empty so
      // the history entry never shows a "No nerf" rule line.
      myNerf: plainMode ? null : nerfSummary(myColor === "w" ? game.white.nerf : game.black.nerf),
      opponentNerf: plainMode ? null : nerfSummary(myColor === "w" ? game.black.nerf : game.white.nerf),
      moves: game.board.history.map(moveToUCI),
      serverGameId: null,
    });
    // Bot games never touch the game server, so tell the site counter about
    // this one; the home "games played" stat includes bot games.
    fetch("/api/games/bot", { method: "POST" }).catch(() => {});
  }, [game, myColor, difficulty, rated, initialTimeMs, incrementMs, ratingCategory, plainMode]);

  // Execute the head of the premove queue when our turn returns. If the head
  // is no longer playable (target ran away, piece pinned, friendly target
  // still standing) we clear the whole queue (subsequent links assumed the
  // head would land, so they can't be salvaged.
  useEffect(() => {
    if (premoves.length === 0 || !game || game.result) return;
    if (game.board.turn !== myColor) return;
    // A pending buff draft must be resolved before any move fires.
    if (game.buffs?.players[myColor].offer) return;
    const head = premoves[0];
    const m = moves.find(
      (lm) =>
        lm.from === head.from &&
        lm.to === head.to &&
        (lm.promotion ?? undefined) === (head.promotion ?? undefined) &&
        // If the user premoved a capture (real or friendly-target), the
        // matching legal move must also be a capture, otherwise a planned
        // Nxe5 silently downgrades to a quiet Ne5 when the target ran away,
        // and a friendly-target premove fires only when the opponent
        // actually took our piece.
        (!head.capture || !!lm.captured),
    );
    if (!m) {
      queueMicrotask(() => setPremoves([]));
      return;
    }
    // Safety net: never auto-play into check (see premoveSelfChecks). The
    // same move stays available manually for a deliberate king walk.
    if (premoveSelfChecks(game, m, myColor)) {
      queueMicrotask(() => setPremoves([]));
      return;
    }
    const tid = setTimeout(() => {
      commitClock(myColor);
      const next = playMove(game, m);
      setGame({ ...next });
      // If makeMove rejected the move (no-op: turn didn't flip), cancel the
      // entire queue (subsequent premoves assumed this one landed).
      if (next.board.turn === myColor) {
        setPremoves([]);
      } else {
        setPremoves((q) => q.slice(1));
      }
    }, 90);
    return () => clearTimeout(tid);
  }, [game, premoves, moves, myColor, commitClock]);

  useEffect(() => {
    turnStartedAtRef.current = Date.now();
  }, [game?.board.history.length]);

  // Time pressure for the board FX. The banked whiteMs/blackMs only move when
  // a turn ends, so reading them would light the FX only after the pressure
  // is over; the live figure comes from remainingClock, and the view does not
  // repaint per tick, so one timer wakes up at the moment the active side
  // crosses the 15s line (or at once when already past it).
  const [timePressure, setTimePressure] = useState(false);
  useEffect(() => {
    if (!clockEnabled || !game || game.result || offerPausedAt != null) {
      const id = window.setTimeout(() => setTimePressure(false), 0);
      return () => window.clearTimeout(id);
    }
    const under = () => remainingClock("w") < 15_000 || remainingClock("b") < 15_000;
    const remaining = remainingClock(game.board.turn);
    const delay = remaining <= 15_000 ? 0 : remaining - 15_000 + 20;
    const id = window.setTimeout(() => setTimePressure(under()), delay);
    return () => window.clearTimeout(id);
  }, [clockEnabled, game, offerPausedAt, remainingClock]);

  // Timeout: schedule one wake-up for the active side instead of repainting the
  // whole game view every clock tick. ClockPill handles the visual countdown.
  useEffect(() => {
    if (!clockEnabled || !game || game.result) return;
    // Clock paused for a buff lock-in window: no flag can fall due.
    if (offerPausedAt != null) return;
    const active = game.board.turn;
    // A flag during a Chess Diff loses the DIFF, never the game: the other
    // side takes the mythic and the paused game (and its clocks) resumes.
    const flagFall = () => {
      // The game is a mutable engine replica advanced in place and re-rendered
      // via applyGame({ ...game }); this deliberate mutation is the app-wide
      // model, so react-hooks/immutability is suppressed rather than rewritten.
      // eslint-disable-next-line react-hooks/immutability
      if (game.buffs?.diff) {
        resolveDiffFlag(game, active);
      } else {
        game.result = {
          winner: active === "w" ? "b" : "w",
          reason: `${active === "w" ? "white" : "black"} ran out of time`,
        };
      }
      setGame({ ...game });
    };
    const remaining = remainingClock(active);
    if (remaining <= 0) {
      flagFall();
      return;
    }
    const id = window.setTimeout(flagFall, remaining + 20);
    return () => window.clearTimeout(id);
    // offerPausedAt is an intentional early-out guard, not a re-run trigger;
    // game/remainingClock already re-run this effect frequently enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockEnabled, game, remainingClock]);

  // AI move. The search runs in a web worker so the main thread (board,
  // clocks, input) never blocks while the bot thinks, and the bot's clock
  // keeps counting down exactly like a human player's: its time is spent
  // from the moment its turn starts until its move is committed.
  useEffect(() => {
    if (!game || game.result) return;
    if (game.board.turn === myColor) return;
    if (aiThinking.current) return;
    aiThinking.current = true;
    const botColor: Color = myColor === "w" ? "b" : "w";

    // Draft mode: fire an activated buff (auto-picked targets) before the
    // search, so the engine looks at the post-activation board. Activation
    // can decide the game on the spot (a removal ends it via loss checks).
    if (game.buffs) {
      try {
        const usedCard = aiActivateBuffs(game, botColor);
        if (usedCard) {
          showOppUsedCard(usedCard, `Bot used a ${draftCardNoun(game.buffs.mode)}`);
          fireSignature(usedCard.id);
          queueMicrotask(() => setGame({ ...game }));
          if (game.result) {
            aiThinking.current = false;
            return;
          }
          // Buff use consumes the turn unless the card was a free action:
          // bank the bot's clock and hand the move back to the player.
          if (game.board.turn !== botColor) {
            commitClock(botColor);
            aiThinking.current = false;
            return;
          }
        }
      } catch {
        // A buff that fails to resolve must never stall the bot's turn.
      }
    }

    const expectedPly = game.board.history.length;
    const thinkStart = Date.now();

    // Pacing (how long the move takes to appear) and search budget are both
    // clamped by the bot's remaining clock, so the bot spends its time like a
    // human and can never think past its flag or ignore the time control.
    const paceBase = difficulty === "easy" ? 600 : difficulty === "medium" ? 1200 : 2000;
    const remaining = clockEnabled ? remainingClock(botColor) : undefined;
    const pace = remaining !== undefined ? Math.min(paceBase, Math.max(150, remaining / 20)) : paceBase;
    const budget = aiBudgetMs(difficulty, remaining);

    let cancelled = false;
    let watchdog = 0;
    let applyTimer = 0;

    // Apply the chosen move once the pacing window has elapsed. A null uci
    // (worker unavailable/errored/out of sync) falls back to a quick
    // synchronous pick so the game always continues.
    const finish = (uci: string | null) => {
      if (cancelled) return;
      window.clearTimeout(watchdog);
      const applyIn = Math.max(0, pace - (Date.now() - thinkStart));
      applyTimer = window.setTimeout(() => {
        if (cancelled) return;
        aiThinking.current = false;
        try {
          const current = gameRef.current;
          if (!current || current.result || current.board.turn === myColor || current.board.history.length !== expectedPly) {
            return;
          }
          let m = uci ? legalMoves(current).find((c) => moveToUCI(c) === uci) ?? null : null;
          if (!m) m = pickAIMove(current, difficulty, 150);
          if (m) {
            commitClock(botColor);
            const next = playMove(current, m);
            setGame({ ...next });
          } else {
            current.result = { winner: myColor, reason: "AI has no legal moves" };
            setGame({ ...current });
          }
        } catch {
          const current = gameRef.current;
          if (current && !current.result) {
            current.result = { winner: myColor, reason: "AI move failed" };
            setGame({ ...current });
          }
        } finally {
          force((x) => x + 1);
        }
      }, applyIn);
    };

    const snapshot = snapshotGame(game, whiteCustomSpec.current, blackCustomSpec.current);
    let worker: Worker | null = null;
    if (snapshot && typeof Worker !== "undefined") {
      try {
        if (!aiWorkerRef.current) {
          aiWorkerRef.current = new Worker(new URL("../../workers/aiWorker", import.meta.url));
        }
        worker = aiWorkerRef.current;
      } catch {
        worker = null;
      }
    }

    if (worker && snapshot) {
      const id = ++aiRequestId.current;
      const activeWorker = worker;
      const onMessage = (event: MessageEvent<AIWorkerResponse>) => {
        if (event.data.id !== id) return;
        activeWorker.removeEventListener("message", onMessage);
        finish(event.data.uci ?? null);
      };
      activeWorker.addEventListener("message", onMessage);
      // Watchdog: a wedged worker must never freeze the game or let the bot
      // think indefinitely — terminate it and fall back to a quick sync pick.
      watchdog = window.setTimeout(() => {
        activeWorker.removeEventListener("message", onMessage);
        aiWorkerRef.current?.terminate();
        aiWorkerRef.current = null;
        finish(null);
      }, budget * 2 + 4000);
      activeWorker.postMessage({ id, snapshot, level: difficulty, budgetMs: budget } satisfies AIWorkerRequest);
      return () => {
        cancelled = true;
        activeWorker.removeEventListener("message", onMessage);
        window.clearTimeout(watchdog);
        window.clearTimeout(applyTimer);
        aiThinking.current = false;
      };
    }

    // No worker available (or non-serializable game): search synchronously
    // after the pacing delay, accepting a short UI stall.
    const syncTimer = window.setTimeout(() => {
      if (cancelled) return;
      const current = gameRef.current;
      let uci: string | null = null;
      try {
        const m = current && !current.result ? pickAIMove(current, difficulty, budget) : null;
        uci = m ? moveToUCI(m) : null;
      } catch {
        uci = null;
      }
      finish(uci);
    }, pace);
    return () => {
      cancelled = true;
      window.clearTimeout(syncTimer);
      window.clearTimeout(applyTimer);
      aiThinking.current = false;
    };
    // The handlers read the latest game through gameRef; depending on the
    // whole object would cancel a bot turn on unrelated state refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.board.history.length, game?.board.turn, game?.result, myColor, difficulty]);

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
      // Snapshot gap (several plies committed in one batched update): bridge it
      // by replaying the recorded moves onto the nearest earlier snapshot.
      let baseKey = -1;
      for (const key of snaps.keys()) {
        if (key < historyPly && key > baseKey) baseKey = key;
      }
      if (baseKey >= 0) {
        setReviewBoard(replayBoardSpan(snaps.get(baseKey)!, game.board.history, baseKey, historyPly));
        return;
      }
      // No snapshot at or below this ply (a restored game): a clean replay from
      // the start is only faithful while no card has rewritten the board.
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
  // trustworthy — a restored game that diverged before this session began has
  // none, so its earlier plies are unreviewable. Navigation clamps here and
  // the MoveList explains why instead of showing a wrong (or live) board.
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
      setPremoves([]);
    }
  };


  // Activated buffs target on the real board: candidate squares highlight on
  // the live position and clicking one advances the pick chain. Enemy-buff
  // targets fall back to the modal list.
  const buffTargeting = useBuffTargeting({
    game,
    myColor,
    active:
      !!game?.buffs &&
      !game.result &&
      game.board.turn === myColor &&
      !game.buffs.players[myColor].offer &&
      historyPly == null,
    onChanged: () => {
      if (!game) return;
      // A buff use can consume the turn: bank my clock like a move.
      if (game.board.turn !== myColor) commitClock(myColor);
      // Fire the signature for the card I just activated (snapshotted at Use
      // time), batched with the board update so the Board claims this diff.
      const sigId = pendingSigIdRef.current;
      pendingSigIdRef.current = null;
      if (sigId) fireSignature(sigId);
      setGame({ ...game });
    },
  });

  // Mirror the latest nav state into the ref the stable wheel listener reads.
  // Wheel navigation stands down while an overlay owns the screen; a draft
  // offer only blocks while its panel is front-and-center (once the free
  // lock-in window expires it minimizes and navigation returns). Written from
  // an effect (not during render) so the ref never drives rendering.
  // History navigation (wheel and arrow keys) is blocked while something owns
  // the board: the result panel, buff targeting, or a draft offer that is
  // still front-and-center (once its free window expires it minimizes and
  // navigation returns).
  const historyNavBlocked = (() => {
    if (!game) return true;
    const offer = game.buffs?.players[myColor]?.offer ?? null;
    return (
      (!!game.result && showResult) ||
      !!buffTargeting.targeting ||
      (!!offer && offerOnClockIndex !== offer.index)
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

  if (!game) {
    if (draftMode && nerfDraft) {
      return (
        <main className="min-h-screen flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-2xl">
            <div className="text-[12px] text-parchment-400 text-center">Nerf draft</div>
            <h1 className="page-title text-parchment text-center mt-1">
              Choose your handicap
            </h1>
            <p className="mt-2 text-sm text-parchment-300 text-center">
              {gameMode === "nerf"
                ? "It stays secret until the game ends."
                : "Draft buffs as you play to claw back power."}
            </p>
            {nerfDeadline != null && (
              <div className="mx-auto mt-4 max-w-sm">
                {/* Lock-in window: an unconfirmed selection commits at the
                    deadline; with nothing selected the first option is
                    picked automatically. */}
                <LockInCountdown
                  deadline={nerfDeadline}
                  onExpire={() => startDraftGame(nerfDraft.myOptions[nerfSelected ?? 0])}
                />
              </div>
            )}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {nerfDraft.myOptions.map((n, i) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => (nerfSelected === i ? startDraftGame(n) : setNerfSelected(i))}
                  className={
                    "mx-auto block w-full max-w-md sm:max-w-none text-left transition-[box-shadow,opacity] duration-200 touch-manipulation" +
                    (nerfSelected === i
                      ? " ring-2 ring-gold"
                      : nerfSelected != null
                      ? " opacity-60"
                      : "")
                  }
                >
                  <NerfCard nerf={n} preview ownerLabel={nerfSelected === i ? "Selected" : "Pick this nerf"} />
                </button>
              ))}
            </div>
            {nerfSelected != null && (
              <div className="mt-4 text-center">
                <Button tone="primary"
                  onClick={() => startDraftGame(nerfDraft.myOptions[nerfSelected])}
                  className="px-8 py-3 text-base font-semibold tracking-wide">
                  Confirm pick
                </Button>
              </div>
            )}
            {/* Nerf mode: the opponent's rule is completely hidden until the
                game ends, so their options never show either. */}
            {gameMode === "nerf" ? (
              <p className="mt-5 text-center text-[12px] text-parchment-400">
                Your opponent picks a nerf too. You will see their rule when the game ends.
              </p>
            ) : (
              <div className="mt-5 plate p-3 text-center">
                <span className="text-[12px] text-parchment-400">
                  Your opponent is choosing between
                </span>
                <div className="mt-1 text-sm text-parchment-200 font-display">
                  {nerfDraft.aiOptions.map((n) => n.name).join("  ·  ")}
                </div>
                <div className="mt-0.5 text-[12px] text-parchment-400">
                  Which one they take stays hidden, unless you draft a reveal.
                </div>
              </div>
            )}
          </div>
        </main>
      );
    }
    return <LoadingPanel />;
  }

  const myNerf = myColor === "w" ? game.white.nerf : game.black.nerf;
  const myState = myColor === "w" ? game.white.state : game.black.state;
  const myCtx = makeContext(game, myColor);
  const visual = myNerf.visual?.(myState, myCtx);
  // Draft-mode zone effects are public information: paint frozen pieces
  // (Immobilizer auras included), shielded (sanctuary) squares, and barred
  // squares for both sides — the same painting the online match uses.
  const zone = draftZones(game, myColor);
  // Effect kinds draftZones does not paint (king_safe shields, pawn-clamp
  // fences, pending-skip stuns): shared derivation, same as OnlineMatch.
  const fxZone = computeFxVisual(game);
  const opponentNerf = myColor === "w" ? game.black.nerf : game.white.nerf;
  const bsMine = game.buffs?.players[myColor];
  const bsTheirs = game.buffs?.players[myColor === "w" ? "b" : "w"];
  const myOffer = bsMine?.offer ?? null;
  // Free pick window over with the offer still open: the draft is charging my
  // clock, and the ClockPill carries a DRAFT tag saying so.
  const myDraftCharging =
    !game.result && !!myOffer && offerOnClockIndex === myOffer.index;
  // The opponent's rule shows if you peeked, once the game ends, or when a
  // reveal buff (Extra Glance / Watchtower) was drafted.
  const oppRevealed =
    (!uiSettings.hideOpponentReveal && (oppPeek || !!game.result)) || !!bsMine?.oppNerfRevealed;
  // Section games never show a "hidden rule" placeholder: the opponent card
  // carries only the player header until the rule reveals (game end). Buff
  // mode hides both rule sections entirely, there are no nerfs at all.
  const hideOppNerfCard = plainMode || gameMode === "buff" || (draftMode && !oppRevealed);
  const hideMyNerfCard = plainMode || gameMode === "buff";
  // "The rule descends": every nerf the viewer currently knows, for the
  // board's one-shot reveal splash (fired once per color+id inside Board) —
  // your own rule from game start, the bot's when it reveals (peek, reveal
  // buff, or game end). Same wiring as OnlineMatch; placeholder rules never
  // announce. Each entry pulses the squares the rule's visual() marks.
  const nerfReveals: NerfRevealInfo[] = [];
  if (!hideMyNerfCard && !NERF_REVEAL_SKIP.has(myNerf.id)) {
    nerfReveals.push({
      id: myNerf.id,
      name: myNerf.name,
      tier: myNerf.tier as number,
      color: myColor,
      highlightSquares: [...(visual?.highlightSquares ?? []), ...(visual?.bannedSquares ?? [])],
    });
  }
  if (!hideOppNerfCard && oppRevealed && !NERF_REVEAL_SKIP.has(opponentNerf.id)) {
    const oppColor: Color = myColor === "w" ? "b" : "w";
    const oppState = myColor === "w" ? game.black.state : game.white.state;
    const oppVisual = opponentNerf.visual?.(oppState, makeContext(game, oppColor));
    nerfReveals.push({
      id: opponentNerf.id,
      name: opponentNerf.name,
      tier: opponentNerf.tier as number,
      color: oppColor,
      highlightSquares: [
        ...(oppVisual?.highlightSquares ?? []),
        ...(oppVisual?.bannedSquares ?? []),
      ],
    });
  }
  // Persistent nerf auras for the PassiveLayer: the same visibility-filtered
  // known-nerf set the reveal splash uses, minus the reveal-only concerns, so
  // every known rule wears its registry aura for as long as it holds.
  const passiveNerfs = nerfReveals.map((r) => ({
    cardId: r.id,
    color: r.color,
    squares: r.highlightSquares ?? [],
  }));
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
  // A held move (confirmation setting) previews on the board before playing.
  const confirmPreviewBoard = confirmMovePending
    ? makeMove(cloneBoard(game.board), confirmMovePending)
    : null;
  const boardForDisplay = reviewBoard ?? confirmPreviewBoard ?? virtualBoard ?? game.board;
  const lastMoveForDisplay = isReviewingHistory
    ? game.board.history[currentHistoryPly - 1] ?? null
    : confirmMovePending ?? lastMove;
  const orientation: Color = uiSettings.flipBoard ? (myColor === "w" ? "b" : "w") : myColor;
  const checkedBoard = reviewBoard ?? game.board;
  // BOTH kings are tested every ply: in this variant a king may legally stand
  // in check, so a checked king stays red on the opponent's turn too. The live
  // position runs the buff-aware test (gameInCheck) so a king attacked only
  // through buff-granted movement (amazon and friends) still lights up;
  // history review falls back to the plain test (a mid-replay board has no
  // reliable buff context).
  const checkSquares: Square[] = [];
  if (uiSettings.checkHighlight) {
    for (const color of ["w", "b"] as const) {
      const attacked = reviewBoard ? isInCheck(checkedBoard, color) : gameInCheck(game, color);
      if (attacked) {
        const k = findKing(checkedBoard, color);
        if (k != null) checkSquares.push(k);
      }
    }
  }
  // A new constraint landing on me (turn skip, halted pawns, frozen piece...)
  // gets one big board-wide splash (BoardSplashHost below); the dock's
  // "Against you" section keeps the permanent record.
  const againstMe = game.buffs ? againstYouRows(game, myColor) : [];
  const hint = currentHint(game, myColor);
  const forcedSquares = hint?.squares ?? [];
  const railHeightStyle = boardHeight
    ? ({ "--board-height": `${boardHeight}px` } as CSSProperties)
    : undefined;
  // The board is square and must fit BOTH the available height (an h-dvh
  // layout) and the width left over after the side rails, at every breakpoint,
  // so it never pushes a rail off-screen. Each min() term reserves the rails
  // present at that breakpoint: none below sm, the right move rail (~288px +
  // gaps + page padding) at sm, and at lg the draggable left command rail on
  // top of that (380px + the rail's live width, --match-rail-w, default
  // 320px). Below sm the board runs nearly edge to edge (full width minus
  // 8px) height-permitting: the 13rem (16rem with a hint) height reserve
  // keeps the mobile player strips and clocks on-screen above the bottom
  // drawer even on short landscape viewports (the old 7rem reserve let the
  // bottom clock get pushed off). Literal strings only, so Tailwind's JIT
  // emits them.
  const boardFitClass = hint
    ? "w-[min(100vw,max(60dvh,calc(100dvh-12rem)))] sm:w-[min(var(--board-cap,720px),calc(100dvh-11rem),calc(100vw-344px))] lg:w-[min(var(--board-cap,720px),calc(100dvh-11rem),calc(100vw_-_380px_-_var(--match-rail-w,320px)))] max-w-full " +
      TABLET_STACK_BOARD
    : "w-[min(100vw,max(60dvh,calc(100dvh-12rem)))] sm:w-[min(var(--board-cap,720px),calc(100dvh-8rem),calc(100vw-344px))] lg:w-[min(var(--board-cap,720px),calc(100dvh-8rem),calc(100vw_-_380px_-_var(--match-rail-w,320px)))] max-w-full " +
      TABLET_STACK_BOARD;

  const handleMove = (m: Move) => {
    if (game.result || isReviewingHistory) return;
    // Resolve the pending buff draft before moving.
    if (myOffer) return;
    if (game.board.turn !== myColor) {
      if (!uiSettings.premovesEnabled) return;
      // One premove at a time, Lichess-style: a new one replaces the old.
      setPremoves([{ from: m.from, to: m.to, promotion: m.promotion, capture: !!m.captured }]);
      return;
    }
    if (uiSettings.confirmMove) {
      // Hold the move for an explicit confirm tap; the board previews it.
      setConfirmMovePending(m);
      return;
    }
    playHeldMove(m);
  };

  const playHeldMove = (m: Move) => {
    commitClock(myColor);
    const next = playMove(game, m);
    setGame({ ...next });
  };

  const confirmHeldMove = () => {
    const held = confirmMovePending;
    setConfirmMovePending(null);
    if (held) playHeldMove(held);
  };

  const cancelPremove = () => setPremoves([]);

  // Rematch restarts the same configuration in place: clear the finished
  // game's save (so the remounted page deals a fresh one instead of restoring
  // it) and let the wrapper remount this component. "New game" stays a
  // separate door back to the /play setup screen.
  const handleRematch = () => {
    clearSavedAiGame();
    onRematch();
  };

  const handleNewGame = () => router.push("/play");

  const onResign = () => {
    if (!game.result) {
      resign(game, myColor);
      setGame({ ...game });
      setPremoves([]);
    }
  };

  const requestResign = () => {
    if (uiSettings.confirmResign) setConfirmingResign(true);
    else onResign();
  };

  const onOfferDraw = () => {
    if (game.result || drawOfferStatus !== "idle") return;
    if (uiSettings.confirmDrawOffer && !confirmingDraw) {
      setConfirmingDraw(true);
      return;
    }
    setConfirmingDraw(false);
    setDrawOfferStatus("offering");
    // Simple AI policy: accept if its material isn't ahead. Otherwise decline.
    const vals: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let mine = 0, theirs = 0;
    for (const p of game.board.pieces) {
      if (!p) continue;
      const v = vals[p.type] ?? 0;
      if (p.color === myColor) mine += v;
      else theirs += v;
    }
    // AI accepts if it isn't ahead by more than 2.
    const aiAhead = theirs - mine;
    window.setTimeout(() => {
      if (aiAhead <= 2) {
        game.result = { winner: "draw", reason: "draw by agreement" };
        setGame({ ...game });
        setPremoves([]);
        setDrawOfferStatus("idle");
      } else {
        setDrawOfferStatus("declined");
        window.setTimeout(() => setDrawOfferStatus("idle"), 2500);
      }
    }, 800);
  };

  const historyActions = game.result ? null : confirmMovePending ? (
    <div className="space-y-2">
      <div className="text-[12px] text-parchment-300">Play this move?</div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={confirmHeldMove}
          className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-gold/40 bg-gold/10 text-gold-leaf hover:bg-gold/20 hover:border-gold/70 transition text-[13px] font-display font-semibold tracking-wide"
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
          className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-gold/40 bg-gold/10 text-gold-leaf hover:bg-gold/20 hover:border-gold/70 transition text-[13px] font-display font-semibold tracking-wide"
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
          onClick={() => { onResign(); setConfirmingResign(false); }}
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
  ) : (
    <div className="space-y-2">
      {drawOfferStatus === "declined" && (
        <div className="text-[12px] text-parchment-300">Draw declined.</div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onOfferDraw}
          disabled={drawOfferStatus !== "idle"}
          title="Offer a draw"
          aria-label="Offer a draw"
          className="min-w-0 min-h-[44px] inline-flex items-center justify-center px-3 py-2 border border-gold/40 bg-gold/10 text-gold-leaf hover:bg-gold/20 hover:border-gold/70 transition text-[13px] font-display font-semibold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {drawOfferStatus === "offering" ? "Offering..." : "Draw"}
        </button>
        <Button tone="danger"
          onClick={requestResign}
          title="Resign the game"
          aria-label="Resign the game"
          className="min-w-0 px-3 py-2 text-[13px] font-semibold tracking-wide">
          Resign
        </Button>
      </div>
    </div>
  );

  // History-review clip entry: lives in the move list footer (desktop rail
  // and mobile drawer both render it). Disabled honestly when the last plies
  // can't be reconstructed (board rewritten by a card, no stored positions).
  const clipButton =
    game.board.history.length >= 2 ? (
      <Button tone="ghost"
       
        onClick={openClip}
        disabled={clipPlies < 2}
        data-clip-open
        title={
          clipPlies < 2
            ? "Clip unavailable: these moves can't be replayed (the board was rewritten by a card)"
            : "Save the last moves as a short video clip"
        }
        className="min-w-0 w-full px-3 py-2 text-[13px] tracking-wide disabled:opacity-50">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
        Clip last moves
      </Button>
    ) : null;

  const moveListFooter =
    historyActions || clipButton ? (
      <div className="space-y-2">
        {historyActions}
        {clipButton}
      </div>
    ) : null;

  return (
    <main className={"flex min-h-dvh flex-col sm:h-dvh [@media(pointer:fine)]:min-h-0 sm:overflow-hidden " + TABLET_STACK_SCROLL}>
      {/* The live game had NO h1 at all: the only one on this route sits in
          the pre-game nerf-draft branch, so the moment a game started the
          page lost its heading. A screen reader landing here was told nothing
          about what the page is, and /tutorial/first-game inherited the same
          gap because it renders this same wrapper.

          Visually hidden rather than displayed, because the board IS the
          content and a printed heading above it would be exactly the
          brochure-style padding section 4 rules out on app surfaces. It names
          the mode and the side, which is what a player arriving by keyboard
          needs to know first. */}
      <h1 className="sr-only">
        {gameMode === "nerf" ? "Nerf mode" : gameMode === "buff" ? "Buff mode" : "Chess"} game
        against the computer, playing {myColor === "w" ? "White" : "Black"}
      </h1>
      <CompactSiteHeader
        status={
          <span className="zen-hide hidden sm:inline">
            playing {myColor === "w" ? "White" : "Black"} ·{" "}
            {gameMode && (
              <>
                <span className={gameMode === "nerf" ? "text-mode-nerfGlow" : "text-mode-buffGlow"}>
                  {gameMode} mode
                </span>
                {" · "}
              </>
            )}
            {plainMode && <>plain chess · </>}
            bot on {difficulty} · {rated ? "rated" : "casual"}
          </span>
        }
      />

      <div
        className={
          "mx-auto flex w-full max-w-[1360px] flex-1 min-h-0 flex-col gap-2 px-0 sm:overflow-hidden sm:px-6 xl:max-w-[1680px] " +
          TABLET_STACK_UNCLIP +
          " " +
          bottomChromePadClass(!!game.buffs)
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
        <div
          // The rail column tracks the draggable --match-rail-w and a thin
          // resize-handle column sits between rail and board; the 6px gaps +
          // 4px handle keep the same 16px gutter as before.
          className={railGridClass(false)}
          style={{ ...railHeightStyle, ...railWidthStyle }}
        >
          {/* The command rail: one framed column (mode header, opponent, dock,
              you) instead of floating islands; the same component the online
              match uses, so the two layouts cannot drift apart again. */}
          <CommandRail
            mode={plainMode ? "plain" : gameMode === "buff" ? "buff" : "nerf"}
            subtitle="Casual · vs bot"
            opponent={
              <PlayerNerfCard
                board={boardForDisplay}
                playerColor={myColor === "w" ? "b" : "w"}
                myColor={myColor}
                heartbeatKey={
                  game.fx?.find(
                    (e) => e.kind === "nerf-turnstart" && e.color === (myColor === "w" ? "b" : "w"),
                  )?.ply ?? null
                }
                name={`${difficulty[0].toUpperCase()}${difficulty.slice(1)} Bot`}
                elo={BOT_ELO[difficulty]}
                nerf={opponentNerf}
                revealed={oppRevealed}
                hideNerf={hideOppNerfCard}
                ownerLabel=""
                compact
                action={
                  // Section games: the opponent's rule stays fully hidden until
                  // the game ends, so there is no self-peek. Plain chess has no
                  // rule to reveal at all.
                  gameMode == null && !plainMode && !oppRevealed && !uiSettings.hideOpponentReveal ? (
                    <Button tone="ghost" size="sm" block onClick={() => setOppPeek(true)}>
                      Reveal their rule
                    </Button>
                  ) : null
                }
              />
            }
            center={
              game.buffs ? (
                <BuffDock
                  game={game}
                  myColor={myColor}
                  canAct={
                    !game.result && game.board.turn === myColor && !myOffer && !isReviewingHistory
                  }
                  onStartUse={(i) => {
                    snapshotMySignature(i);
                    buffTargeting.start(i);
                  }}
                  plays={oppLog}
                />
              ) : undefined
            }
            self={
              <PlayerNerfCard
                board={boardForDisplay}
                playerColor={myColor}
                myColor={myColor}
                heartbeatKey={
                  game.fx?.find((e) => e.kind === "nerf-turnstart" && e.color === myColor)?.ply ?? null
                }
                name="You"
                elo={playerElo}
                nerf={myNerf}
                hideNerf={hideMyNerfCard}
                ownerLabel=""
                compact
                progress={myNerf.progress?.(myState, myCtx) ?? null}
                boons={myHeldBoons}
                action={
                  gameMode === "buff" || plainMode ? null : (
                    <Button
                      tone={sharedMine ? "leaf" : "ghost"}
                      size="sm"
                      block
                      onClick={() => setSharedMine((v) => !v)}
                    >
                      {sharedMine ? "Rule shared with opponent" : "Reveal my rule to opponent"}
                    </Button>
                  )
                }
              />
            }
          />
          <RailResizeHandle railWidth={railWidth} resizeRail={resizeRail} />
          <div className={"flex min-h-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:justify-start " + TABLET_STACK_COL}>
            {/* In the band the whole column — player strips, board, stack —
                shares the board's width and centres as one, so the strips line
                up with the board's edges instead of spanning the viewport. */}
            <div
              ref={boardShellRef}
              className={`min-h-0 min-w-0 sm:flex-none ${TABLET_STACK_BOARD} ${TABLET_STACK_CENTER}`}
            >
              {/* Mobile-only player strips: the side rails (clocks, cards,
                  actions) are hidden below the sm breakpoint. */}
              <div className={"flex items-center justify-between gap-2 px-2 sm:hidden " + TABLET_STACK_SHOW}>
                <BoardPlayerRow
                  // Material counts read the COMMITTED position (a queued premove
                  // must never bump the capture tally early); history review
                  // still shows the reviewed position's material.
                  board={isReviewingHistory ? boardForDisplay : game.board}
                  playerColor={myColor === "w" ? "b" : "w"}
                  myColor={myColor}
                  name={`${difficulty[0].toUpperCase()}${difficulty.slice(1)} Bot`}
                  elo={BOT_ELO[difficulty]}
                  linkProfile={false}
                  className="min-w-0 flex-1 !px-0 !py-1"
                />
                {clockEnabled && (
                  <ClockPill
                    ms={myColor === "w" ? blackMs : whiteMs}
                    seat={myColor === "w" ? "b" : "w"}
                    ended={!!game.result}
                    active={!game.result && offerPausedAt == null && game.board.turn !== myColor}
                    compact
                  />
                )}
              </div>
              <div data-board-measure className={`relative mx-auto sm:mx-0 ${TABLET_STACK_CENTER} ${boardFitClass}`}>
                <Board
                  board={boardForDisplay}
                  // Removal FX diff the committed position, never the premove /
                  // confirm / review overlays (see Board.fxBoard).
                  fxBoard={game.board}
                  legalMoves={
                    isReviewingHistory || buffTargeting.targeting
                      ? []
                      : game.board.turn === myColor && !premovePending
                      ? moves
                      : premoveMode
                        ? premoveOptions
                        : []
                  }
                  orientation={orientation}
                  onMove={handleMove}
                  myColor={myColor}
                  // Click an enemy piece to preview where it could move
                  // (suspended during history review and buff targeting).
                  opponentMoves={
                    isReviewingHistory || buffTargeting.targeting ? [] : oppPreviewMoves
                  }
                  fxTimePressure={clockEnabled && !game.result && timePressure}
                  visual={
                    isReviewingHistory
                      ? undefined
                      : {
                          ...(visual ?? {}),
                          highlightSquares: forcedSquares,
                          bannedSquares: [...(visual?.bannedSquares ?? []), ...zone.barred],
                          frozenSquares: zone.frozen,
                          frozenSkins: zone.frozenSkin,
                          effectTurns: zone.turns,
                          shieldedSquares: zone.shielded,
                          wardSquares: zone.ward,
                          strikeSquares: zone.strike,
                          walnutSquares: zone.walnut,
                          bananaSquares: zone.banana,
                          trapSquares: zone.traps,
                          doomSquares: zone.doom,
                          lockedSquares: zone.locked,
                          barredSquares: zone.barred,
                          ...fxVisualFields(fxZone),
                        }
                  }
                  lastMove={lastMoveForDisplay}
                  nerfReveals={nerfReveals}
                  passiveNerfs={passiveNerfs}
                  // Both props: `passiveBuffs` paints the held-card marks,
                  // `buffs` is what tells the board which cards can FIRE here.
                  // Without it the bot game never fetched the play-art modules
                  // and never fired the acquire or use beats, so every card
                  // fell back to a faint generated ring ("I used Vanguard and
                  // nothing happened").
                  buffs={isReviewingHistory ? null : game.buffs}
                  passiveBuffs={isReviewingHistory ? null : game.buffs}
                  reviewingHistory={isReviewingHistory}
                  // The engine's per-cycle fx narration (nerf bites, victim
                  // receives, expiries) for the FruitionLayer.
                  fx={isReviewingHistory ? null : game.fx ?? null}
                  disabled={!!game.result || premovePending || isReviewingHistory || !!confirmMovePending || !!myOffer}
                  premoveMode={!isReviewingHistory && premoveMode}
                  premoves={isReviewingHistory ? [] : validPremoves}
                  onCancelPremove={cancelPremove}
                  moveRisks={isReviewingHistory || premovePending ? undefined : moveRisks}
                  autoQueen={uiSettings.autoQueen}
                  showCoordinates={uiSettings.showCoordinates}
                  highlightLastMove={uiSettings.highlightLastMove}
                  showLegalMoves={uiSettings.showLegalMoves}
                  checkSquares={isReviewingHistory ? undefined : checkSquares}
                  signatureCard={isReviewingHistory ? null : signatureCard}
                  pickSquares={
                    buffTargeting.targeting?.target.kind === "square"
                      ? buffTargeting.targeting.target.squares
                      : undefined
                  }
                  onPickSquare={
                    buffTargeting.targeting?.target.kind === "square"
                      ? (sq) => buffTargeting.pick({ square: sq })
                      : undefined
                  }
                  onInvalidPick={() => setInvalidPickKey((k) => k + 1)}
                />
                {bsTheirs && (
                  <DraftNotice
                    buffs={bsTheirs.buffs}
                    banked={!!bsTheirs.flags.bankBonus}
                    cardNoun={draftCardNoun(game.buffs?.mode)}
                  />
                )}
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
              <div className={"flex items-center justify-between gap-2 px-2 sm:hidden " + TABLET_STACK_SHOW}>
                <BoardPlayerRow
                  // Material counts read the COMMITTED position (a queued premove
                  // must never bump the capture tally early); history review
                  // still shows the reviewed position's material.
                  board={isReviewingHistory ? boardForDisplay : game.board}
                  playerColor={myColor}
                  myColor={myColor}
                  name="You"
                  elo={playerElo}
                  linkProfile={false}
                  className="min-w-0 flex-1 !px-0 !py-1"
                />
                {clockEnabled && (
                  <ClockPill
                    ms={myColor === "w" ? whiteMs : blackMs}
                    seat={myColor}
                    ended={!!game.result}
                    active={!game.result && offerPausedAt == null && game.board.turn === myColor}
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
                  gameMode !== "buff" && !plainMode ? (
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
                  game.buffs
                    ? {
                        label: draftCardNoun(game.buffs.mode) === "hex" ? "Hexes & boons" : "Buffs",
                        summary:
                          game.buffs.players[myColor].buffs.length === 0
                            ? "None yet"
                            : `${game.buffs.players[myColor].buffs.length} held`,
                        content: (
                          <BuffDock
                            game={game}
                            myColor={myColor}
                            canAct={!game.result && game.board.turn === myColor && !myOffer && !isReviewingHistory}
                            onStartUse={(i) => {
                              snapshotMySignature(i);
                              buffTargeting.start(i);
                            }}
                            plays={oppLog}
                          />
                        ),
                      }
                    : null
                }
                extra={clipButton}
              />
            </div>
            <div
              className={
                "hidden min-h-0 overflow-hidden gap-3 sm:grid sm:h-[var(--board-height)] sm:w-72 sm:shrink-0 " +
                // The move rail is the thing that was squeezing the board on a
                // portrait tablet; there its clocks ride the player strips and
                // its move list is the horizontal strip in the stack.
                TABLET_STACK_HIDE +
                " " +
                (clockEnabled ? "sm:grid-rows-[auto_minmax(0,1fr)_auto]" : "sm:grid-rows-[minmax(0,1fr)]")
              }
              style={railHeightStyle}
            >
              {clockEnabled && (
                <ClockPill
                  ms={myColor === "w" ? blackMs : whiteMs}
                  seat={myColor === "w" ? "b" : "w"}
                  ended={!!game.result}
                  active={!game.result && offerPausedAt == null && game.board.turn !== myColor}
                />
              )}
              <MoveList
                moves={game.board.history}
                currentPly={currentHistoryPly}
                onPlyChange={handleHistoryPlyChange}
                navBlocked={historyNavBlocked}
                minPly={reviewFloor}
                compact
                showHeader={false}
                footer={moveListFooter}
              />
              {clockEnabled && (
                <ClockPill
                  ms={myColor === "w" ? whiteMs : blackMs}
                  seat={myColor}
                  ended={!!game.result}
                  active={!game.result && offerPausedAt == null && game.board.turn === myColor}
                  warnLowTime={uiSettings.lowTimeWarning}
                  draftRunning={myDraftCharging}
                />
              )}
              <div className="zen-hide flex items-center justify-end gap-2 pt-1">
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


      {game.buffs && (
        <MobileBuffDrawer
          label={draftCardNoun(game.buffs.mode) === "hex" ? "Hexes & boons" : "Buffs"}
          held={game.buffs.players[myColor].buffs.length}
          usable={
            game.result || game.board.turn !== myColor || myOffer || isReviewingHistory
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
            canAct={!game.result && game.board.turn === myColor && !myOffer && !isReviewingHistory}
            onStartUse={(i) => {
              snapshotMySignature(i);
              buffTargeting.start(i);
            }}
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

      <OppPlaysLog plays={oppLog} />
      {/* Clock-raid spectacle for clock-touching cards (Time Thief and kin):
          measures the [data-clock-seat] pills and runs the grab/carry/pop
          out-of-board choreography. Cosmetic; clock frames stay authoritative. */}
      <ClockRaidLayer fx={game.fx ?? null} />

      {/* Shared reveal moment: both sides of the simultaneous draft round
          resolved. Non-blocking, click to dismiss, auto-dismisses after
          about four seconds. */}
      {draftReveal && !game.result && (
        <DraftRevealBanner
          mine={draftReveal.mine}
          theirs={draftReveal.theirs}
          onDismiss={() => setDraftReveal(null)}
        />
      )}

      {/* Board spectacles still playing when the draft arrived: a small
          status chip says so while the overlay waits its turn. The machine
          caps this hold, so a stuck animation can never block the draft. */}
      {myOffer && !game.result && !draftSeq.overlayVisible && <DraftResolvingChip />}
      {myOffer && !game.result && draftSeq.overlayVisible && (
        <DraftOverlay
          offer={myOffer}
          // Local games have no server id; the start stamp survives the AI
          // save/restore round-trip, so it scopes the chest-reveal ledger to
          // this exact game (a restored game skips already-seen reveals, a
          // fresh game never inherits them).
          revealScope={`ai:${game.startedAt}`}
          takeBoth={(bsMine?.flags.takeBoth ?? 0) > 0}
          bankedBonus={!!myOffer.banked}
          deadline={offerDeadline}
          onCardsReady={draftSeq.reportCardsReady}
          // Same rule as online: when the decision window ends the draft
          // shrinks into the corner panel and the player's clock runs, but
          // nothing is ever picked for them. The compact panel stays until
          // they choose.
          autoResolveOnExpire={false}
          onExpire={() => setOfferOnClockIndex(myOffer.index)}
          minimized={liveOfferOnClock}
          cardNoun={draftCardNoun(game.buffs?.mode)}
          onPick={(i) => {
            const before = game.buffs?.players[myColor].buffs.length ?? 0;
            pickDraftCard(game, myColor, i);
            // My own cards are mine to see: the reveal names them all
            // (take-both offers can land more than one).
            const gained = game.buffs?.players[myColor].buffs.slice(before) ?? [];
            recordMyDraftResolution({
              banked: false,
              cards: gained.map((b) => ({ id: b.id, tier: b.tier })),
            });
            // My own instant spectacle (Cataclysm, Extinction, and now every
            // instant via the category cast layer) resolves at pick time;
            // dress that resolution as the card's signature.
            const inst = gained.find((b) => BUFF_BY_ID[b.id]?.kind === "instant");
            if (inst) fireSignature(inst.id);
            draftSeq.noteConfirmed();
            setGame({ ...game });
          }}
          onBank={() => {
            bankDraft(game, myColor);
            recordMyDraftResolution({ banked: true, cards: [] });
            draftSeq.noteConfirmed();
            setGame({ ...game });
          }}
          rerollsLeft={bsMine?.rerollsLeft ?? 0}
          onReroll={() => {
            // Local game: reroll on the real engine, fresh cards at the same
            // tiers. The bumped `rerolled` counter replays the deal animation.
            rerollDraft(game, myColor);
            setGame({ ...game });
          }}
          opponent={{
            offer: bsTheirs?.offer ?? null,
            showCards: !!bsMine?.flags.seeOppCards,
            showTier: !!bsMine?.flags.seeOppTier,
            reveal: bsMine?.oppReveal ?? null,
            // Hidden model: never name the bot's held cards in the overlay.
            lastPick: null,
          }}
        />
      )}

      {game.result && !showResult && (
        <Button tone="leaf"
         
          onClick={() => setShowResult(true)}
          className={"fixed bottom-4 right-3 z-40 px-4 py-2 text-sm font-semibold shadow-xl sm:bottom-16 lg:bottom-4 " + TABLET_STACK_FAB}>
          Show result
        </Button>
      )}
      {game.result && showResult && (
        <GameOver
          onDismiss={() => setShowResult(false)}
          result={game.result}
          myColor={myColor}
          myNerf={gameMode === "buff" || plainMode ? undefined : myNerf}
          opponentNerf={gameMode === "buff" || plainMode ? undefined : opponentNerf}
          opponentHidden={uiSettings.hideOpponentReveal && !oppPeek && !bsMine?.oppNerfRevealed}
          ratingChange={ratingChange}
          mode={gameMode}
          record={postRecord}
          newOpponentHref={`/lobby?tab=quick${gameMode ? `&mode=${gameMode}` : ""}`}
          onRematch={handleRematch}
          onNewGame={handleNewGame}
          onReview={() => handleHistoryPlyChange(0)}
          onClip={clipPlies >= 2 ? openClip : undefined}
          moves={game.board.history}
          cardEvents={timelineEvents}
          playerNames={{
            w: myColor === "w" ? "You" : `${difficulty[0].toUpperCase()}${difficulty.slice(1)} Bot`,
            b: myColor === "b" ? "You" : `${difficulty[0].toUpperCase()}${difficulty.slice(1)} Bot`,
          }}
          startedAt={game.startedAt}
          myBuffs={game.buffs?.players[myColor].buffs}
        />
      )}
      {clipOpen && clipData && (
        <ClipModal
          open={clipOpen}
          onClose={() => setClipOpen(false)}
          moves={game.board.history}
          snapshots={clipData.snapshots}
          signatureIds={clipData.signatureIds}
          historyDiverged={!!game.buffs?.historyDiverged}
          orientation={orientation}
          playerNames={{
            w: myColor === "w" ? "You" : `${difficulty[0].toUpperCase()}${difficulty.slice(1)} Bot`,
            b: myColor === "b" ? "You" : `${difficulty[0].toUpperCase()}${difficulty.slice(1)} Bot`,
          }}
          result={game.result ?? null}
        />
      )}
    </main>
  );
}

