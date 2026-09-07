"use client";

import { useReducedMotion } from "@/lib/useReducedMotion";
import { BuffOffer } from "@/engine/buff";
import { BUFF_BY_ID } from "@/engine/buffs/library";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { playDecisionStart, playDraftChime, playDraftUrgent } from "@/lib/sounds";
import { pushUiHold } from "@/lib/uiInterrupts";
import { hasRevealPlayed, markRevealPlayed, offerRevealKey } from "@/lib/draftReveal";
import { resolveDraftTimeout } from "@/lib/draftTimeout";
import { haptic } from "@/lib/haptics";
import { TIER_ROMAN } from "@/lib/tiers";
import { isGodlikeCard } from "@/lib/signatureCards";
import { useFxLevel, FX_LEVELS } from "@/lib/fxToggle";
import { INFINITE_REROLLS } from "@/lib/godPanel";
import { BuffCard } from "./BuffCard";
import { DraftVault, VAULT_OPEN_MS } from "./DraftVault";
import { OpponentDraftPanel } from "./OpponentDraftPanel";
import { LockInCountdown, useCountdown } from "./draft/LockInCountdown";
// Re-exported for the nerf-draft screen, which imported it from here.
export { LockInCountdown };
import "./DraftOverlay.css";
import { Button } from "@/components/ui/Button";
import { GlossaryText } from "@/components/GlossaryText";

interface Props {
  offer: BuffOffer;
  /** Take-both is active: picking any card takes the whole offer. */
  takeBoth?: boolean;
  /** This offer rolled one tier up thanks to a banked skip. */
  bankedBonus?: boolean;
  onPick: (index: number) => void;
  onBank: () => void;
  /** Draft rerolls left. When > 0 (and no card is chosen yet) the Reroll
   * control shows; at 0 it is hidden. */
  rerollsLeft?: number;
  /** Discard the current offer and roll a fresh one at the same tiers. */
  onReroll?: () => void;
  /** Decision deadline (ms epoch). The countdown renders while set. The
   * parent must pass null until the cards are ready (see onCardsReady): while
   * null, the timer slot shows a contextual preparation label ("Opening your
   * draft", "Dealing the cards") instead of a running countdown, so no
   * animation or loading state can ever eat into the decision window. */
  deadline?: number | null;
  /** Fired once per offer version (offer index + reroll count) when both
   * cards are fully dealt, painted, and interactive. The parent arms the
   * decision countdown on this signal and never before. Re-fires after a
   * reroll's fresh deal, so every reroll earns a complete new window. */
  onCardsReady?: (offerKey: string) => void;
  /** Legacy fallback, fired only when the decision window ends AND there is
   * nothing left to auto-resolve (an empty offer). With deterministic
   * auto-resolution on (the default) the draft resolves itself instead of
   * being parked, so this is effectively unused; kept as a safety hook. */
  onExpire?: () => void;
  /** Deterministic timeout recovery. When the decision window expires the
   * draft resolves itself rather than collapsing into a "resolve me later"
   * pending panel: a selected card is auto-confirmed, otherwise one of the
   * offered cards is chosen via `rng`. Skip & Bank is NEVER granted this way.
   * Defaults to true; pass false to keep the legacy `onExpire` parking. */
  autoResolveOnExpire?: boolean;
  /** Authoritative RNG (in [0,1)) used to pick a card when the window expires
   * with no selection. Defaults to Math.random. */
  rng?: () => number;
  /** Free window over: render as a compact side panel instead of a blocking
   * overlay. The board is visible again and picking still works. */
  minimized?: boolean;
  /** What the cards are called in this mode ("buff", or "hex" in nerf mode,
   * where the pool mixes opponent hexes with self boons and items). */
  cardNoun?: string;
  /** The opponent resolved their simultaneous draft while you are choosing. */
  oppLockedIn?: boolean;
  /** The opponent's resolution was a bank, not a pick (refines the badge). */
  oppBanked?: boolean;
  /** Recording mode (owner 9:16 layout): constrain the panel to the vertical
   * frame so it centers over the board and stays inside the crop. */
  recordingMode?: boolean;
  /** Stable per-game scope for the reveal ledger (online: the server game
   * id; local: a per-game stamp). Ties the treasure-chest reveal to the
   * exact offer version: each unique offer plays the chest once, and a
   * remount / reconnect / refresh of an already-revealed offer skips it.
   * Omitted (previews, unkeyed hosts): every mount treats the offer as
   * fresh, matching the old behavior. */
  revealScope?: string;
  /** What we can legitimately show about the opponent's draft. */
  opponent?: {
    offer: BuffOffer | null;
    showCards: boolean;
    showTier: boolean;
    /** One-shot reveal snapshot (Peek, Quick Glance, Draft Insight). */
    reveal?: { index: number; cards?: { id: string; tier: number }[]; tier?: number } | null;
    lastPick?: { id: string; tier: number } | null;
  };
  /** Both game clocks (ms), so drafting never hides the time situation. */
  clocks?: { mine: number; theirs: number } | null;
}

/** m:ss for the in-overlay clock chips. */
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The draft clock as its own chip, sitting centered immediately above
 * the draft panel (they share a flex column, so the chip travels with the
 * plate): a ring that drains with the free window plus big tabular digits.
 * Separate from the card panel so time pressure reads at a glance without
 * crowding the cards. */
function DraftTimerWindow({
  deadline,
  onExpire,
  announce = false,
}: {
  deadline: number;
  onExpire?: () => void;
  /** One-shot reveal pulse: the countdown just appeared because the cards
   * became ready. Motion-gated by the caller (off under reduced motion). */
  announce?: boolean;
}) {
  const total = 20_000;
  const leftMs = useCountdown(deadline, onExpire);
  const seconds = Math.ceil(leftMs / 1000);
  const fraction = Math.max(0, Math.min(1, leftMs / total));
  // The whole window is paused free time: you only go on your clock when it
  // fully runs out (the panel then minimizes to the red "On your clock" chip).
  // So this timer must not flash the on-your-clock red while free seconds
  // remain. Firing at 5s-left showed it at 15s into the 20s window, 5 seconds
  // too early; tie it to the window end instead.
  const urgent = leftMs <= 0;
  // r=15.5 keeps the 2.5-width stroke inside the ring (40px viewBox leaves
  // room for the outer hairline ring; the countdown math is untouched).
  const CIRC = 2 * Math.PI * 15.5;
  return (
    <div role="timer" aria-label="Draft decision timer" className="pointer-events-none shrink-0">
      <div
        className={
          "flex items-center gap-2 " +
          (urgent ? "draft-timer--urgent " : "") +
          (announce ? "draft-timer--announce" : "")
        }
      >
        <svg width="26" height="26" viewBox="0 0 40 40" aria-hidden className="-rotate-90">
          {/* Outer hairline: a second, decorative gold ring framing the dial.
              Literal mirrors --accent-gold (SVG stroke attrs can't read a CSS var). */}
          <circle cx="20" cy="20" r="18.5" fill="none" stroke="rgba(212,160,23,0.22)" strokeWidth="1" />
          <circle cx="20" cy="20" r="15.5" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
          {/* Soft glow trail riding under the crisp arc (same geometry, wide
              blurred stroke): pure decoration, shares the exact fraction. The
              stroke literals below mirror --accent-nerf (#e05252, urgent) and
              --accent-gold (#d4a017, normal); SVG stroke attrs can't read a CSS var. */}
          <circle
            cx="20"
            cy="20"
            r="15.5"
            fill="none"
            stroke={urgent ? "#e05252" : "#d4a017"}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - fraction)}
            className="draft-ring-glow"
            style={{ transition: "stroke-dashoffset 100ms linear, stroke 300ms ease" }}
          />
          <circle
            cx="20"
            cy="20"
            r="15.5"
            fill="none"
            stroke={urgent ? "#e05252" : "#d4a017"}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - fraction)}
            style={{ transition: "stroke-dashoffset 100ms linear, stroke 300ms ease" }}
          />
        </svg>
        <div
          className={
            "font-mono text-lg font-bold leading-none tabular-nums " +
            (urgent ? "text-oxblood-glow" : "text-parchment-50")
          }
        >
          {seconds}
          <span className="ml-0.5 text-xs font-semibold text-parchment-400">s</span>
        </div>
      </div>
    </div>
  );
}

/** What the timer slot shows BEFORE the decision window opens: a plain
 * contextual label for the phase that is actually running (chest opening,
 * cards dealing), never a ticking countdown. The player can see at a glance
 * that their time has not started yet. */
function DraftPrepChip({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none min-w-0 shrink">
      <div className="flex items-center gap-2">
        <span aria-hidden className="draft-prep-dot" />
        <div className="min-w-0 leading-none">
          {/* Inline in the panel header now, so it is one line: the old two-line
              chip with its own border was the box that collided with the site
              masthead on a phone. */}
          <div className="truncate text-[12px] font-semibold text-parchment-200">{label}</div>
        </div>
      </div>
    </div>
  );
}

/** Shown by the game surfaces BEFORE the draft overlay mounts, while the
 * board finishes telling the previous move's story (card spectacles, capture
 * effects). Non-blocking and purely informative: the draft opens the moment
 * the effects settle, and the decision timer starts later still. */
export function DraftResolvingChip() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 sm:inset-x-auto sm:bottom-6 sm:left-4 sm:justify-start">
      <div
        role="status"
        aria-live="polite"
        className="plate plate-raised flex items-center gap-2.5 border-gold/40 px-4 py-2 shadow-plate"
      >
        <span aria-hidden className="draft-prep-dot" />
        <span className="font-display text-sm font-semibold text-parchment-100">
          Resolving effects
        </span>
        <span className="text-[12px] text-parchment-400">Your draft opens next</span>
      </div>
    </div>
  );
}

/** Small inline check mark (no text glyphs, no emoji). */
function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 12 12" width="10" height="10" className={"shrink-0 " + className}>
      <path d="M2 6.5 4.8 9.3 10 2.9" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** Session-persisted position (top-left px) of the dragged minimized panel. */
const DRAFT_PANEL_POS_KEY = "nerfchess.draftPanelPos.v1";

// --- Adaptive ambient-stage degradation --------------------------------------
// The dungeon stage's ambient layers (torches, nebulae, fog, aurora, motes)
// are pure compositor load. On weak GPUs they can drag the whole draft under
// 30fps even though script cost is ~zero. While the stage runs at full
// intensity we sample real frame deltas; sustained slowness flips a one-way
// session latch that downgrades the ambience to the same reduced set the
// Calm intensity uses. Capable machines never trip it and keep the full look;
// the FX dial still overrides everything (Off/Calm always reduced).
let ambientAutoCalm = false;

function useAmbientAutoCalm(active: boolean): boolean {
  const [autoCalm, setAutoCalm] = useState(ambientAutoCalm);
  useEffect(() => {
    if (!active || autoCalm || ambientAutoCalm) return;
    let raf = 0;
    let frames = 0;
    let slow = 0;
    let last = 0;
    const loop = (t: number) => {
      if (last > 0) {
        const dt = t - last;
        // Ignore tab-hidden gaps and one-off spikes; count real slow frames.
        if (dt > 40 && dt < 500) slow++;
        if (dt < 500) frames++;
        if (frames >= 20) {
          if (slow >= 12) {
            ambientAutoCalm = true;
            setAutoCalm(true);
            return;
          }
          frames = 0;
          slow = 0;
        }
      }
      last = t;
      raf = requestAnimationFrame(loop);
    };
    // Warm-up delay: skip the mount/deal jank so we only measure steady state.
    const timer = window.setTimeout(() => {
      raf = requestAnimationFrame(loop);
    }, 1200);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [active, autoCalm]);
  return autoCalm || ambientAutoCalm;
}

/** Small six-dot drag grip (no emoji). Signals the header is grabbable. */
function GripIcon({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 10 16" width="10" height="14" fill="currentColor" className={"shrink-0 " + className}>
      <circle cx="2.5" cy="3" r="1.3" />
      <circle cx="7.5" cy="3" r="1.3" />
      <circle cx="2.5" cy="8" r="1.3" />
      <circle cx="7.5" cy="8" r="1.3" />
      <circle cx="2.5" cy="13" r="1.3" />
      <circle cx="7.5" cy="13" r="1.3" />
    </svg>
  );
}

/** Clamp a top-left position so the whole `w`x`h` panel stays on screen. */
function clampPanelPos(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - w);
  const maxY = Math.max(0, window.innerHeight - h);
  return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
}

/** Remembered panel position, read once on the client (guarded for SSR). A
 * generous size estimate; the real size re-clamps once the panel mounts. */
function readStoredDragPos(): { x: number; y: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_PANEL_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof p?.x === "number" && typeof p?.y === "number") {
      return clampPanelPos(p.x, p.y, 304, 360);
    }
  } catch {}
  return null;
}

/** Static circular-arrow mark for the reroll control (no motion, no emoji). */
function RerollIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={"shrink-0 " + className}
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

/** Where the confirmed card flies: the buff dock ("your pocket") if it is
 * visible, otherwise off toward the bottom-left where the mobile drawer
 * lives. Returns the translation from the card's current center. */
function pocketDelta(cardEl: HTMLElement | null): { dx: number; dy: number } {
  const fallback = { dx: -180, dy: 220 };
  if (!cardEl) return fallback;
  const c = cardEl.getBoundingClientRect();
  const cx = c.left + c.width / 2;
  const cy = c.top + c.height / 2;
  const dock = document.querySelector("[data-buff-dock]");
  if (dock) {
    const d = (dock as HTMLElement).getBoundingClientRect();
    // A hidden dock (mobile: it lives in a closed drawer) measures ~0.
    if (d.width > 40 && d.height > 40) {
      return {
        dx: d.left + d.width / 2 - cx,
        dy: d.top + Math.min(d.height / 2, 140) - cy,
      };
    }
  }
  // Mobile: the buff drawer handle sits along the bottom edge.
  return { dx: -cx + 48, dy: window.innerHeight - cy - 24 };
}

/** Translation from a card's center to the Skip button ("the bank"). */
function bankDelta(cardEl: HTMLElement | null, bankEl: HTMLElement | null): { dx: number; dy: number } {
  const fallback = { dx: 0, dy: 240 };
  if (!cardEl || !bankEl) return fallback;
  const c = cardEl.getBoundingClientRect();
  const b = bankEl.getBoundingClientRect();
  return {
    dx: b.left + b.width / 2 - (c.left + c.width / 2),
    dy: b.top + b.height / 2 - (c.top + c.height / 2),
  };
}

// Deal choreography budget: three cards fully dealt and flipped in under
// ~900ms. Cards fly from a face-down stack at the bottom center of the
// panel to their slots with a stagger, then flip face-up; higher tiers flip
// a touch later so the best card is the last reveal.
const DEAL_STAGGER_MS = 80;
const DEAL_MS = 280;
const FLIP_MS = 300;
const DEAL_TOTAL_MS = 900;
// Pack opening: how long the sealed pack sits before tearing itself, and how
// long the tear runs before the cards deal out of it.
const PACK_HOLD_MS = 1150;
// The minimized panel runs on the player's own clock: the pack still shows
// (a reroll always earns its box) but tears itself almost immediately.
const PACK_HOLD_MINIMIZED_MS = 450;
// The vault-opening sequence: spin-up -> faces shear away -> core blooms ->
// flash and shockwave. The cards deal out of the flash.
const PACK_TEAR_MS = VAULT_OPEN_MS;
const flipDelayMs = (i: number, tier: number) => i * DEAL_STAGGER_MS + DEAL_MS + 40 + tier * 12;

// Accidental-double-click guard: a click on the already-selected card only
// confirms once this much time has passed since it was selected. The explicit
// Confirm button is exempt (it sits elsewhere, so a double-click cannot land
// on it by accident).
const CONFIRM_GUARD_MS = 400;

// Hard ceiling on the pocket-flight before the pick force-commits. The flight
// itself runs 550ms; if onAnimationComplete never fires (branch switch,
// background-tab rAF stall, anything) this timer commits the pick anyway.
const COMMIT_FALLBACK_MS = 900;

/** Small inline eye icon for the hide/peek control (no emoji). */
function EyeIcon({ off = false, className = "" }: { off?: boolean; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={"shrink-0 " + className}
    >
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="2.5" />
      {off && <line x1="4" y1="20" x2="20" y2="4" />}
    </svg>
  );
}

/** Seconds readout for the "Draft open" chip while the overlay is hidden.
 * Display only: the expiry callback stays with the (still-mounted, merely
 * invisible) DraftTimerWindow so it can never fire twice. */
function ChipCountdown({ deadline }: { deadline: number }) {
  const leftMs = useCountdown(deadline);
  const seconds = Math.ceil(leftMs / 1000);
  // Same rule as the other draft timers: the whole window is paused free
  // time, so the urgent red must not appear until the window actually ends.
  const urgent = leftMs <= 0;
  return (
    <span
      className={
        "font-mono text-sm font-bold tabular-nums " +
        (urgent ? "text-oxblood-glow" : "text-gold-leaf")
      }
    >
      {seconds}s
    </span>
  );
}

export function DraftOverlay({
  offer,
  takeBoth,
  bankedBonus,
  onPick,
  onBank,
  rerollsLeft = 0,
  onReroll,
  deadline,
  onCardsReady,
  onExpire,
  autoResolveOnExpire = true,
  rng,
  minimized,
  cardNoun = "buff",
  oppLockedIn,
  oppBanked,
  recordingMode = false,
  revealScope,
  opponent,
  clocks,
}: Props) {
  const noun = cardNoun;
  const nounCap = noun.charAt(0).toUpperCase() + noun.slice(1);
  // Untimed games (casual bot games with the clock off) pass clocks: null.
  // An expired decision window there is NOT a punishment: the pending panel
  // says "take your time" instead of warning about a clock that is not
  // running.
  const timed = !!clocks;
  // The OPENING pick (offer index 0, buff mode's game-start pair) wears its
  // own label everywhere the round number would show: "Opening pick" instead
  // of "Buff draft #0".
  const isOpeningPick = offer.index === 0;
  const draftLabel = isOpeningPick ? "Opening pick" : `${nounCap} draft #${offer.index}`;
  const reduceMotion = useReducedMotion();
  // The board-effects dial also governs the draft spectacle: Off/Calm strips
  // the chest's particle/ray layers and stands down the shake + confetti.
  const fxLevel = useFxLevel();
  // Calm when the dial says so, or when measured frame times say this device
  // cannot afford the full ambient stage (one-way session latch).
  const autoCalm = useAmbientAutoCalm(fxLevel > 1 && !reduceMotion);
  const fxCalm = fxLevel <= 1 || autoCalm;
  const fxShake = FX_LEVELS[fxLevel].shake !== "none";
  // The strongest card in the offer decides the chest's material (wood ->
  // iron -> gilded -> arcane -> apex -> mythic) and whether the reveal earns
  // a shake + confetti.
  const maxTier = offer.cards.reduce((m, c) => Math.max(m, c.tier), 1);
  // Two-step pick: the first click only selects (highlight); the Confirm
  // button (or a second click on the same card) locks it in. `chosen` is the
  // confirmed card sliding into the pocket (the buff dock) before the pick
  // commits.
  const [selected, setSelected] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  // Skip and bank: the cards flip back face-down and slide into a bank stack
  // (toward the Skip button) before the overlay closes.
  const [banking, setBanking] = useState(false);
  const [bankDeltas, setBankDeltas] = useState<{ dx: number; dy: number }[] | null>(null);
  // True once the deal has settled: later animations (dim, select) run
  // without the deal's stagger delays.
  const [dealt, setDealt] = useState(() => !!reduceMotion);
  // A reroll request is in flight (online: awaiting the server's fresh offer):
  // disables the reroll control until the new cards deal in. Reset by the deal
  // effect whenever the offer changes.
  const [rerolling, setRerolling] = useState(false);
  // Peek at the board: the full-screen overlay can be temporarily hidden
  // behind a slim "Draft open" chip. Purely visual (visibility, not unmount),
  // so the pick state, timers, and any in-flight animation are untouched.
  const [hidden, setHidden] = useState(false);
  // Banking routes your next draft toward the top-tier apex, so it is a
  // deliberate choice: the Bank control arms on the first click, then a second
  // click (or the explicit confirm) actually banks. Auto-disarms so it never
  // sticks after an accidental tap.
  const [bankArmed, setBankArmed] = useState(false);
  // The minimized panel is the persistent "resolve your draft" reminder. It
  // never tucks itself away; the player can tuck it into a slim chip (still
  // one click from the cards) with the header control, and a fresh offer /
  // reroll / window expiry pops it back so an unresolved draft keeps
  // re-announcing itself.
  const [tucked, setTucked] = useState(false);
  // Pack opening: each offer arrives as a sealed treasure chest that opens
  // before the cards deal. Tap to open immediately; it auto-opens after a
  // beat so a player who just wants cards is never held up. The chest plays
  // exactly once per unique offer version: the reveal ledger (localStorage,
  // keyed by game + offer index + reroll count) remembers which reveals this
  // player has watched, so remounts, reconnects, StrictMode double-mounts,
  // and refreshes of an already-seen offer all skip straight to the cards,
  // while a genuinely new offer — including one that lands while the panel
  // is minimized — always gets its chest (the minimized panel just runs the
  // fast fuse). Reduced motion skips the sequence and counts as revealed.
  const alreadyRevealed = (key: string) => !!revealScope && hasRevealPlayed(revealScope, key);
  const [packStage, setPackStage] = useState<"sealed" | "tearing" | "open">(() =>
    reduceMotion || alreadyRevealed(offerRevealKey(offer.index, offer.rerolled)) ? "open" : "sealed",
  );
  // Measured flight path from the chosen card to the dock, captured at
  // confirm time (measuring during render would thrash layout).
  const [pocket, setPocket] = useState<{ dx: number; dy: number } | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bankBtnRef = useRef<HTMLButtonElement | null>(null);
  const bankTimer = useRef<number | null>(null);
  // Synchronous double-commit guard. `committedRef` is read inside handlers so a
  // second click can never slip through before a re-render; `committed` mirrors
  // it for render-time gating (a ref must not drive rendering).
  const committedRef = useRef(false);
  const [committed, setCommitted] = useState(false);
  // When the current selection happened: a second click on the same card
  // only confirms after CONFIRM_GUARD_MS (accidental double-click guard).
  const selectedAtRef = useRef(0);

  // Draggable minimized panel. When the free window expires the overlay
  // shrinks to a compact side panel that runs on the player's own clock; its
  // default corner can sit on top of the clock, so the header is a drag handle
  // (pointer AND touch) and the chosen spot is remembered for the session.
  // `dragPos` null = use the default bottom-right CSS anchor.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(readStoredDragPos);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    dragPosRef.current = dragPos;
  }, [dragPos]);

  // Once the compact panel actually mounts, re-clamp any restored position with
  // its real measured size so it can never sit partly off a short screen.
  useEffect(() => {
    if (!minimized) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragPos((prev) => (prev ? clampPanelPos(prev.x, prev.y, rect.width, rect.height) : prev));
     
  }, [minimized]);

  // Keep the panel on screen if the viewport shrinks (rotate, keyboard open).
  //
  // Deliberately NOT keyed on dragPos. It used to be, and since dragging sets
  // dragPos on every pointermove, this listener was torn down and re-registered
  // on every single move event. The handler reads the live value through
  // dragPosRef instead, so it can register once.
  useEffect(() => {
    const onResize = () => {
      if (!dragPosRef.current) return;
      const rect = panelRef.current?.getBoundingClientRect();
      setDragPos((prev) =>
        prev ? clampPanelPos(prev.x, prev.y, rect?.width ?? 304, rect?.height ?? 220) : prev,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Focus containment for the draft dialog. The overlay is a forced decision,
  // so focus must not be able to leave it while it is up: Tab cycles inside,
  // and focus is pulled in on open and restored on close. Escape peeks at the
  // board (the Hide affordance) rather than closing, because there is nothing
  // to close to.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (hidden) return;
    const root = overlayRef.current;
    if (!root) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
    // Pull focus in, but only if it is currently outside: never steal it from a
    // control the player already reached inside the panel.
    if (!root.contains(document.activeElement)) focusables()[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setHidden(true);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreFocusRef.current?.focus?.();
    };
  }, [hidden]);

  const onGripPointerDown = (e: ReactPointerEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setDragging(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  };
  const onGripPointerMove = (e: ReactPointerEvent) => {
    const off = dragOffset.current;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!off || !rect) return;
    setDragPos(clampPanelPos(e.clientX - off.dx, e.clientY - off.dy, rect.width, rect.height));
  };
  const endGripDrag = (e: ReactPointerEvent) => {
    if (!dragOffset.current) return;
    dragOffset.current = null;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    try {
      if (dragPosRef.current) {
        window.localStorage.setItem(DRAFT_PANEL_POS_KEY, JSON.stringify(dragPosRef.current));
      }
    } catch {}
  };

  // FREE WINDOW EXPIRY: the moment `minimized` flips on (the parent detected
  // the free pick window ending), the draft must re-announce itself even if
  // the player had hidden it — a hidden draft with the clock silently running
  // was very easy to miss. On that transition we force the panel back open
  // (clearing both `hidden` and `tucked`), pulse it, and play a distinct
  // "time's up" sound. If a piece drag is mid-flight (Board advertises it via
  // body[data-board-drag]), a sticky warning shows instead and the reopen
  // lands the instant the drag does.
  const [justExpired, setJustExpired] = useState(false);
  const [reopenHold, setReopenHold] = useState(false);
  const [expiryBeat, setExpiryBeat] = useState(0);
  // Detect the minimized flip with the render-time adjust pattern (same as
  // the offer reset above): the state updates land in the same render pass,
  // and the sound rides a separate beat-keyed effect below.
  const [prevMinimized, setPrevMinimized] = useState(minimized);
  if (prevMinimized !== minimized) {
    setPrevMinimized(minimized);
    if (!minimized) {
      setJustExpired(false);
      setReopenHold(false);
    } else if (!committed && chosen == null && !banking) {
      setExpiryBeat((b) => b + 1);
    }
  }
  // Each expiry edge: play the distinct "time's up" voice, then force the
  // panel back open. All state writes happen inside timer callbacks (never
  // the effect body). If a piece drag is mid-flight (Board advertises it via
  // body[data-board-drag]) the sticky warning shows instead, and the reopen
  // lands the moment the drag does — capped at 6s so a drag that dies without
  // clearing (tab switch mid-drag) can never hold the reopen hostage.
  useEffect(() => {
    if (expiryBeat === 0) return;
    playDraftUrgent();
    const finish = () => {
      window.clearInterval(poll);
      window.clearTimeout(cap);
      setReopenHold(false);
      setHidden(false);
      setTucked(false);
      setJustExpired(true);
    };
    const poll = window.setInterval(() => {
      if (document.body.dataset.boardDrag) setReopenHold(true);
      else finish();
    }, 120);
    const cap = window.setTimeout(finish, 6000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(cap);
    };
  }, [expiryBeat]);
  // The expiry pulse is a short one-shot; let the panel settle afterwards.
  useEffect(() => {
    if (!justExpired) return;
    const id = window.setTimeout(() => setJustExpired(false), 3200);
    return () => window.clearTimeout(id);
  }, [justExpired]);

  // A reroll keeps the same offer index but swaps the cards, so key the deal
  // on both: bumping `rerolled` replays the deal (and chime) for fresh cards.
  const dealKey = `${offer.index}:${offer.rerolled ?? 0}`;
  // Reset all per-offer state the instant a new offer (or reroll) arrives.
  // Adjusting state during render on a key change is React's sanctioned reset
  // pattern and avoids the stale-frame flash a post-render effect would leave.
  const [dealtKey, setDealtKey] = useState(dealKey);
  if (dealtKey !== dealKey) {
    setDealtKey(dealKey);
    setSelected(null);
    setChosen(null);
    setPocket(null);
    setBanking(false);
    setBankDeltas(null);
    setHidden(false);
    setBankArmed(false);
    setTucked(false);
    setRerolling(false);
    setCommitted(false);
    setDealt(!!reduceMotion);
    // Fresh cards arrive as a sealed chest (full overlay or the minimized
    // panel, which runs the fast fuse); the deal timer starts once the chest
    // opens (see the pack effects below). An offer version whose reveal
    // already played — a re-delivered draft state, a replayed merge — skips
    // straight to the cards instead of re-running the chest.
    setPackStage(reduceMotion || alreadyRevealed(dealKey) ? "open" : "sealed");
  }
  // Ref bookkeeping and the attention chime are side effects, so they stay in
  // an effect keyed on the same offer identity (runs on mount and each deal).
  useEffect(() => {
    committedRef.current = false;
    selectedAtRef.current = 0;
    // A fresh offer demands attention: the board is blocked until it
    // resolves. But only a fresh offer — a remount of an already-revealed
    // one (refresh, reconnect, replay epoch) stays quiet.
    if (!revealScope || !hasRevealPlayed(revealScope, dealKey)) playDraftChime();
    // revealScope is stable for the life of a game; keying on the offer only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealKey]);

  // The reveal has played (or was skipped by reduced motion, which still
  // counts as the player seeing the offer): record it, so this exact offer
  // version never replays the chest. Idempotent, so StrictMode double-effects
  // and rerenders are harmless.
  useEffect(() => {
    if (packStage === "open" && revealScope) markRevealPlayed(revealScope, dealKey);
  }, [packStage, dealKey, revealScope]);

  // CARDS READY: the chest is open and the deal has settled. Wait two more
  // animation frames so the card faces are actually painted and clickable,
  // then report readiness to the parent. This is the event that lets the
  // parent arm the decision countdown; there is no duration guessing anywhere
  // in that chain. A reroll bumps dealKey, so the fresh deal re-reports and
  // earns a complete new window. The report itself carries the offer version
  // and the parent is idempotent per version, so an effect re-run (StrictMode
  // remount, dev fast refresh) re-reporting is harmless while a NEVER-firing
  // report would strand the draft in preparation (the parent's watchdog would
  // then arm the countdown late).
  const onCardsReadyRef = useRef(onCardsReady);
  useEffect(() => {
    onCardsReadyRef.current = onCardsReady;
  });
  useEffect(() => {
    if (packStage !== "open" || !dealt) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        onCardsReadyRef.current?.(dealKey);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [packStage, dealt, dealKey]);

  // DECISION START MOMENT: the countdown appearing (deadline flipping from
  // null to a timestamp while the full overlay is up) is the signal that the
  // player's time is now running. Mark it with a soft two-note cue and a
  // one-shot pulse on the timer chip, both stood down by the usual gates
  // (sound prefs inside playDecisionStart; motion via reduceMotion).
  const [timerAnnounce, setTimerAnnounce] = useState(false);
  const prevDeadlineRef = useRef<number | null | undefined>(deadline);
  useEffect(() => {
    const prev = prevDeadlineRef.current;
    prevDeadlineRef.current = deadline;
    if (!(prev == null && deadline != null && !minimized)) return;
    playDecisionStart();
    if (reduceMotion) return;
    // State writes live in timer callbacks, never the effect body.
    let settle = 0;
    const arm = window.setTimeout(() => {
      setTimerAnnounce(true);
      settle = window.setTimeout(() => setTimerAnnounce(false), 1500);
    }, 0);
    return () => {
      window.clearTimeout(arm);
      if (settle) window.clearTimeout(settle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, minimized]);

  // While this draft is unresolved it holds the UI interrupt gate: nothing
  // nonessential (performance prompts, achievement toasts, announcements) may
  // present over the cards or the compact pending panel. Released on commit
  // and on unmount; urgent connection failures bypass the gate by design.
  useEffect(() => {
    if (committed) return;
    return pushUiHold();
  }, [committed]);

  // Pack lifecycle: sealed -> (tap or auto) tearing -> open. The card deal and
  // its settle timer only start once the pack is open.
  useEffect(() => {
    if (packStage !== "sealed") return;
    const id = window.setTimeout(
      () => setPackStage("tearing"),
      minimized ? PACK_HOLD_MINIMIZED_MS : PACK_HOLD_MS,
    );
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packStage]);
  useEffect(() => {
    if (packStage !== "tearing") return;
    const id = window.setTimeout(() => setPackStage("open"), PACK_TEAR_MS);
    return () => window.clearTimeout(id);
  }, [packStage]);
  useEffect(() => {
    if (packStage !== "open") return;
    // Reduced motion still defers by a tick rather than setting synchronously,
    // so the deal state settles outside the effect body (imperceptible at 0ms).
    const id = window.setTimeout(() => setDealt(true), reduceMotion ? 0 : DEAL_TOTAL_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packStage]);
  const tearPack = () =>
    setPackStage((s) => {
      if (s === "sealed") haptic("light");
      return s === "sealed" ? "tearing" : s;
    });

  // The one place onBank actually fires. Idempotent (bankFiredRef), so the
  // slide timer, the unmount fallback, and the reduced-motion path can all
  // call it without double-banking.
  const bankFiredRef = useRef(false);
  const fireBank = useCallback(() => {
    if (bankFiredRef.current) return;
    bankFiredRef.current = true;
    onBank();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const bankingRef = useRef(false);

  useEffect(
    () => () => {
      if (bankTimer.current != null) window.clearTimeout(bankTimer.current);
      // RACE PROOFING, mirroring the pick path's commit-on-minimize: banking
      // marks the offer committed IMMEDIATELY but used to fire onBank only
      // from the 750ms slide timer. If the overlay unmounts inside that
      // window (game transition, parent teardown) the bank action was
      // dropped while the UI looked resolved. Fire the pending bank now.
      if (bankingRef.current) fireBank();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const commit = (i: number) => {
    if (committedRef.current) return;
    committedRef.current = true;
    setCommitted(true);
    onPick(i);
  };

  const selectCard = (i: number, at: number) => {
    setSelected(i);
    selectedAtRef.current = at;
    // Reaching for a card means you are not banking after all.
    setBankArmed(false);
  };

  // An armed Bank button disarms itself after a few seconds so a stray first
  // click never leaves it primed to bank on the next accidental tap.
  useEffect(() => {
    if (!bankArmed) return;
    const id = window.setTimeout(() => setBankArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [bankArmed]);

  // The compact panel never tucks itself away: once the draft has stepped
  // into the corner it stays there, cards visible, until the player resolves
  // it. (The old auto-tuck fuse was the "draft minimized randomly" complaint.)
  // The slim chip is reached only through the Tuck control in the panel
  // header; clicking the chip brings the cards back.

  const confirmCard = (i: number) => {
    if (chosen != null || banking || committedRef.current) return;
    haptic("medium");
    if (reduceMotion) {
      // No pocket flight to wait for: commit on the spot. Relying on framer's
      // animate-complete under reduced motion would leave the commit hostage
      // to an animation the user never sees.
      setChosen(i);
      commit(i);
      return;
    }
    setPocket(pocketDelta(cardRefs.current[i]));
    setChosen(i);
  };

  const choose = (i: number, at: number) => {
    if (chosen != null || banking) return;
    if (selected === i) {
      // Second click on the selected card confirms it, but only after the
      // guard window: an accidental double-click must not lock the pick in.
      // `at` is the click event's timestamp, so the delta is real elapsed time.
      if (at - selectedAtRef.current < CONFIRM_GUARD_MS) return;
      confirmCard(i);
      return;
    }
    selectCard(i, at);
  };

  const confirmSelection = () => {
    if (chosen != null || banking || selected == null) return;
    confirmCard(selected);
  };

  // RACE PROOFING for the pocket flight. The parent can flip `minimized` on
  // its own timer (OnlineMatch's draftGraceOver) at any moment, including the
  // instant between setChosen and the flight's onAnimationComplete. Switching
  // to the minimized branch unmounts the full-screen card mid-flight, the
  // completion callback never fires, and without this the pick would be lost
  // (the panel then sits dead in the corner until a refresh). Whenever a
  // confirmed-but-uncommitted pick exists while minimized, commit it now.
  useEffect(() => {
    if (minimized && chosen != null && !committedRef.current) {
      commit(chosen);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimized, chosen]);

  // Belt and braces: a confirmed pick always commits within a fixed budget,
  // even if the flight's completion callback is lost some other way (rAF
  // stalls in a backgrounded tab, a dropped animation frame). Committing
  // twice is impossible (committedRef), so firing after a normal completion
  // is a no-op.
  useEffect(() => {
    if (chosen == null) return;
    const id = window.setTimeout(() => commit(chosen), COMMIT_FALLBACK_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  // Skip and bank with feedback: the offer flips face-down and slides into
  // the bank (the Skip button) before the overlay closes. Reduced motion
  // banks immediately.
  const handleBank = () => {
    if (chosen != null || banking || committedRef.current) return;
    haptic("medium");
    committedRef.current = true;
    setCommitted(true);
    bankingRef.current = true;
    if (reduceMotion) {
      fireBank();
      return;
    }
    // Land the cards in the vault door that opens just above the button
    // (see .bank-vault), not on the button label itself.
    setBankDeltas(
      offer.cards.map((_, i) => {
        const d = bankDelta(cardRefs.current[i], bankBtnRef.current);
        return { dx: d.dx, dy: d.dy - 66 };
      }),
    );
    setBanking(true);
    bankTimer.current = window.setTimeout(fireBank, 750);
  };

  // Reroll: discard the current offer, roll fresh cards at the same tiers. The
  // offer stays open (no commit), so this never touches committedRef. The
  // `rerolling` guard blocks a double-fire until the new cards deal in.
  const canReroll = rerollsLeft > 0 && !!onReroll && chosen == null && !banking && !committed;
  // The god-panel "infinite rerolls" tool reports the count as a large sentinel;
  // show it as "∞" rather than a meaningless big number.
  const rerollBadge = rerollsLeft >= INFINITE_REROLLS ? "∞" : String(rerollsLeft);
  const rerollTimer = useRef<number | null>(null);
  const handleReroll = () => {
    if (!canReroll || rerolling) return;
    setRerolling(true);
    if (reduceMotion) {
      onReroll?.();
      return;
    }
    // Give the shuffle a beat to read (cards flip face-down and converge into
    // a spinning stack) before the fresh roll swaps them out.
    rerollTimer.current = window.setTimeout(() => onReroll?.(), 480);
  };
  // Fail-safe: if the fresh offer never arrives (disconnect, dropped frame),
  // un-shuffle so the current cards come back instead of sitting invisible.
  useEffect(() => {
    if (!rerolling) return;
    const id = window.setTimeout(() => setRerolling(false), 4000);
    return () => window.clearTimeout(id);
  }, [rerolling]);
  useEffect(
    () => () => {
      if (rerollTimer.current != null) window.clearTimeout(rerollTimer.current);
    },
    [],
  );

  // DETERMINISTIC TIMEOUT RECOVERY. When the decision window expires the draft
  // resolves itself instead of collapsing into a "resolve me later" pending
  // panel: a selected card is auto-confirmed, otherwise one of the offered
  // cards is chosen via the authoritative RNG. Skip & Bank is never granted
  // here — only an explicit press does that. Idempotent per offer version
  // (autoResolvedRef, reset on each deal) AND per commit (committedRef inside
  // confirmCard), so a refresh, a doubled interval tick, or the render-branch
  // race below can never grant two cards. `selected` is read through a ref so
  // the deadline backstop always sees the latest highlight.
  const autoResolvedRef = useRef(false);
  useEffect(() => {
    autoResolvedRef.current = false;
  }, [dealKey]);
  // A latest-closure ref (assigned in an effect, never during render) so the
  // deadline backstop below stays keyed on `deadline` alone yet always runs
  // against the current selection / commit state.
  const autoResolveRef = useRef(() => {});
  useEffect(() => {
    autoResolveRef.current = () => {
      if (autoResolvedRef.current || committedRef.current || chosen != null || banking) return;
      autoResolvedRef.current = true;
      if (autoResolveOnExpire === false) {
        onExpire?.();
        return;
      }
      const res = resolveDraftTimeout({
        offeredCount: offer.cards.length,
        selectedIndex: selected,
        random: rng,
      });
      if (res) confirmCard(res.index);
      else onExpire?.();
    };
  });
  const handleExpire = () => autoResolveRef.current();
  // Backstop the countdown's own onExpire: a parent that minimizes the overlay
  // at the same instant (OnlineMatch's separate grace timer) would otherwise
  // unmount the full-overlay countdown before it fired, stranding the draft.
  // This deadline-keyed poll resolves regardless of which branch is on screen;
  // autoResolvedRef makes the two paths mutually idempotent. The clock read
  // lives in the deferred tick (same pattern as useCountdown), never in the
  // effect body.
  useEffect(() => {
    if (autoResolveOnExpire === false || deadline == null) return;
    let id = 0;
    const tick = () => {
      if (deadline - Date.now() <= 0) autoResolveRef.current();
      else id = window.setTimeout(tick, 120);
    };
    id = window.setTimeout(tick, 120);
    return () => window.clearTimeout(id);
  }, [deadline, autoResolveOnExpire]);

  if (minimized) {
    // A committed pick renders the panel inert while the server (or engine)
    // resolves it; `chosen` alone is not enough because the commit-on-minimize
    // effect can have fired without an animation ever setting `chosen` late.
    const settled = chosen != null || banking || committed;
    const chooseMinimized = (i: number, at: number) => {
      if (settled) return;
      if (selected === i) {
        // Same double-click guard as the full overlay.
        if (at - selectedAtRef.current < CONFIRM_GUARD_MS) return;
        setChosen(i);
        commit(i);
        return;
      }
      selectCard(i, at);
    };
    // A piece drag was mid-flight when the free window expired: hold the
    // forced reopen so the panel doesn't materialize under the pointer, and
    // say so loudly — the clock IS running. The reopen fires the instant the
    // drag lands (see the expiry effect above).
    if (reopenHold && !settled) {
      return (
        <div role="alert" className="fixed inset-x-0 top-14 z-50 flex justify-center px-3">
          <div className="plate plate-raised border-2 border-oxblood-glow/70 bg-ink-900/95 px-4 py-2.5 text-center shadow-plate">
            <span className="block font-display text-sm font-bold text-oxblood-glow">
              {timed ? "Draft pending. Your game clock is running." : "Draft pending."}
            </span>
            <span className="block text-[12px] text-parchment-300">
              The draft reopens as soon as you finish this move.
            </span>
          </div>
        </div>
      );
    }
    // Tucked (by the header control): the panel has stepped aside to a slim
    // chip. It stays one tap from the cards (click re-opens) and a new offer /
    // reroll re-shows it automatically (deal effect clears tucked).
    if (tucked && !settled) {
      return (
        <div
          ref={panelRef}
          style={dragPos ? { left: dragPos.x, top: dragPos.y } : undefined}
          className={"fixed z-40 " + (dragPos ? "" : "bottom-4 right-3 sm:bottom-16 lg:bottom-4")}
        >
          <button
            type="button"
            onClick={() => setTucked(false)}
            aria-label={
              timed
                ? `Resolve your ${noun} draft. Your game clock is running.`
                : `Resolve your ${noun} draft.`
            }
            // Large, persistent, and impossible to miss: an unresolved draft
            // with the clock running must never hide behind a subtle chip.
            className="plate plate-raised flex min-h-[52px] items-center gap-2.5 rounded-[1px] border-2 border-gold/70 bg-gold/10 px-4 py-2.5 shadow-plate transition hover:border-gold hover:bg-gold/20"
          >
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-[1px] bg-oxblood-glow animate-flicker" />
            <span className="text-left">
              <span className="block font-display text-sm font-bold tracking-wide text-gold-leaf">
                Resolve draft
              </span>
              <span
                className={
                  "block text-[12px] " +
                  (timed ? "text-oxblood-glow" : "text-parchment-400")
                }
              >
                {timed ? "Your game clock is running" : "Draft pending"}
              </span>
            </span>
            {clocks && (
              <span className="ml-1 shrink-0 font-mono text-sm font-bold tabular-nums text-parchment-100">
                {fmtClock(clocks.mine)}
              </span>
            )}
          </button>
        </div>
      );
    }
    return (
      <div
        ref={panelRef}
        style={dragPos ? { left: dragPos.x, top: dragPos.y } : undefined}
        className={
          "fixed z-40 w-[min(92vw,19rem)] " + (dragPos ? "" : "bottom-4 right-3 sm:bottom-16 lg:bottom-4")
        }
      >
        <motion.div
          initial={dragging ? false : { opacity: 0, x: 80, scale: 0.9 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className={
            "plate plate-raised border-gold/40 p-3 shadow-plate" +
            // Expiry announcement: a brief oxblood pulse so the forced reopen
            // reads as "this needs you NOW", then the panel settles.
            (justExpired ? " draft-expire-pulse" : "")
          }
        >
          {/* Drag handle: grab the header (mouse or touch) to move the panel so
              it never covers the clock. touch-none stops the page scrolling
              under a touch-drag; the spot is remembered for the session. */}
          <div
            onPointerDown={onGripPointerDown}
            onPointerMove={onGripPointerMove}
            onPointerUp={endGripDrag}
            onPointerCancel={endGripDrag}
            title="Drag to move this panel"
            className={
              "-mx-3 -mt-3 mb-2 flex touch-none select-none items-center justify-between gap-2 px-3 py-2.5 " +
              (dragging ? "cursor-grabbing" : "cursor-grab")
            }
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <GripIcon className="text-parchment-500" />
              <span className="truncate text-[12px] text-parchment-400">
                {draftLabel}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {clocks && (
                <span className="font-mono text-[12px] font-bold tabular-nums text-parchment-100">
                  {fmtClock(clocks.mine)}
                </span>
              )}
              <span
                className={
                  "text-[12px] " + (timed ? "text-oxblood-glow" : "text-parchment-400")
                }
              >
                {timed ? "On your clock" : "Draft pending"}
              </span>
              {/* Tuck: step the panel aside into the slim "Resolve draft"
                  chip. The only way the chip is reached; the panel never
                  tucks on its own. Pointer events stop here so a tap on it
                  does not start a header drag. */}
              <Button
                tone="ghost"
                size="xs"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setTucked(true)}
                aria-label="Tuck the draft panel into a chip"
                title="Tuck into a chip; click the chip to bring the cards back"
                className="gap-1 px-2 text-[13px] max-sm:min-h-[44px]"
              >
                <EyeIcon off />
                Tuck
              </Button>
            </span>
          </div>
          {/* Why the draft moved: the decision countdown ended, so it
              collapsed here rather than covering the board. Nothing was
              discarded: the cards, any selection, rerolls, and the bank
              option all carry over untouched. */}
          <p
            className={
              "text-[12px] font-semibold leading-snug " +
              (timed ? "text-oxblood-glow" : "text-parchment-200")
            }
          >
            {timed ? "Draft pending. Your game clock is running." : "Draft pending."}
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-parchment-400">
            {timed
              ? "Your draft moved here; further thinking costs your own time."
              : "No clock in this game; resolve it whenever you are ready."}
          </p>
          {takeBoth && (
            <p className="mt-1 text-[12px] font-semibold leading-snug text-gold-leaf">
              Picking any card takes the whole offer.
            </p>
          )}
          {packStage !== "open" ? (
            /* Reroll (or a fresh offer) in the compact panel still earns its
               vault moment: a mini vault that bursts open on a fast fuse. */
            <DraftVault
              tier={maxTier}
              count={offer.cards.length}
              label={draftLabel}
              stage={packStage}
              onOpen={tearPack}
              mini
              calm={fxCalm}
              still={!!reduceMotion}
            />
          ) : (
          <div data-draft-compact-cards className="mt-2 space-y-1.5">
            {offer.cards.map((card, i) => {
              const def = BUFF_BY_ID[card.id];
              if (!def) return null;
              return (
                // Selection ring rides on the card itself (glow), not a static
                // wrapper, so the hover lift can never leave the ring behind.
                <div key={i}>
                  <BuffCard
                    buff={def}
                    tier={card.tier}
                    compact
                    glow={selected === i}
                    // performance.now() shares the event-timeStamp clock the full overlay
                    // records selections with, so the double-click guard measures real
                    // elapsed time here too (Date.now() is an epoch and never blocked).
                    onClick={!settled ? () => chooseMinimized(i, performance.now()) : undefined}
                  />
                </div>
              );
            })}
          </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* ALWAYS rendered, merely disabled until a card is selected. It
                used to appear on selection, and since every button in this row
                is flex-1, inserting a third one resized and re-wrapped Reroll
                and Bank the instant you clicked a card: the row moved under the
                cursor mid-click. The full overlay already does it this way. */}
            <Button tone="leaf"
              disabled={selected == null || settled}
              onClick={() => {
                if (selected == null || settled) return;
                setChosen(selected);
                commit(selected);
              }}
              className="min-w-[6rem] flex-1 touch-manipulation px-3 py-2 text-xs font-semibold tracking-wide">
              {selected != null
                ? `Confirm ${BUFF_BY_ID[offer.cards[selected]?.id]?.name ?? "pick"}`
                : "Pick a card"}
            </Button>
            {canReroll && (
              <button
                onClick={handleReroll}
                disabled={rerolling}
                className="flex min-w-[6rem] min-h-[44px] flex-1 touch-manipulation items-center justify-center gap-1 rounded-[1px] border border-[color:var(--edge)] bg-white/[0.03] px-3 py-2 font-display text-[14px] sm:text-[13px] font-semibold tracking-wide text-parchment-200 transition hover:border-gold/50 hover:text-gold-leaf disabled:opacity-40"
                title="Roll fresh cards at the same tier"
              >
                <RerollIcon className={"text-gold-leaf" + (rerolling ? " reroll-spin" : "")} /> Reroll ({rerollBadge})
              </button>
            )}
            <button
              onClick={
                settled
                  ? undefined
                  : bankArmed
                  ? () => {
                      // Same one-shot guard as the full overlay's handleBank: a
                      // rapid double-click on the armed Bank button must not
                      // send the bank action twice (the overlay only unmounts
                      // after the parent processes the first one).
                      if (committedRef.current) return;
                      committedRef.current = true;
                      onBank();
                    }
                  : () => setBankArmed(true)
              }
              disabled={settled}
              className={
                "min-w-[6rem] min-h-[44px] flex-1 touch-manipulation rounded-[1px] border px-3 py-2 font-display text-[14px] sm:text-[13px] font-semibold tracking-wide transition disabled:opacity-40 " +
                (bankArmed
                  ? "border-coral/50 bg-coral/10 text-coral-glow hover:bg-coral/20"
                  : "border-[color:var(--edge)] bg-white/[0.03] text-parchment-200 hover:border-gold/50 hover:text-gold-leaf")
              }
              title={
                bankArmed
                  ? "Click again to confirm banking (routes your next draft a tier higher)"
                  : "Skip this draft; your next one pulls from a tier higher"
              }
            >
              {bankArmed ? "Confirm bank" : "Skip & bank"}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const mid = (offer.cards.length - 1) / 2;

  return (
    <>
      {/* Peek at the board: while hidden, a slim chip keeps the draft (and
          its running lock-in timer) one click away. The overlay itself stays
          mounted underneath (visibility only), so timers, the pick state,
          and any in-flight animation carry on unaffected. */}
      {hidden && (
        <div className="fixed bottom-4 right-3 z-50 sm:bottom-16 lg:bottom-4">
          <button
            type="button"
            onClick={() => setHidden(false)}
            aria-label="Show the draft"
            className="plate plate-raised flex items-center gap-2 border-gold/40 px-3 py-2 shadow-plate transition hover:border-gold/70"
          >
            <EyeIcon className="text-gold-leaf" />
            <span className="font-display text-xs font-semibold tracking-wide text-parchment-100">
              Draft open
            </span>
            {deadline != null && <ChipCountdown deadline={deadline} />}
          </button>
        </div>
      )}
      <div
        ref={overlayRef}
        // The most blocking surface in the product had no dialog semantics at
        // all: no role, no aria-modal, no focus management. A keyboard user
        // tabbed straight out of a forced decision into the board underneath.
        // Note there is deliberately no Escape-to-close: a draft cannot be
        // dismissed, so Escape maps to the same peek the Hide button gives.
        role="dialog"
        aria-modal={hidden ? undefined : true}
        aria-label={`${draftLabel}: choose a card`}
        aria-hidden={hidden || undefined}
        // z-[55]: strictly above every z-50 sibling (end screens, side modals,
        // stray toasts) so nothing can ever sit invisibly over the cards and
        // eat the pick clicks. No backdrop blur: a full-screen blur repainted
        // on every board animation frame chugged phones.
        //
        // The scrim is one flat 60% dim at every width: the draft is a plain
        // modal over the board, not a lit stage, and the panel has to stay
        // readable on a phone where the column overlaps the masthead and the
        // player row.
        // overflow-x-hidden is load-bearing, not tidiness: `overflow-y: auto`
        // with overflow-x left at `visible` makes the browser COMPUTE
        // overflow-x as `auto` too, so anything bleeding a pixel or two past
        // the panel made this root horizontally scrollable on a phone. Any
        // stray sideways scroll then dragged the whole panel off-centre.
        className={
          "fixed inset-0 z-[55] overflow-y-auto overflow-x-hidden overscroll-contain bg-black/60" +
          (hidden ? " invisible" : "")
        }
      >
      {/* A high-tier pull warms the whole screen once: a soft tier-colored
          glow pulse breathing in from the viewport edges as the cards reveal.
          Decorative, one shot per deal, gone under reduced motion. */}
      {packStage === "open" && maxTier >= 7 && !reduceMotion && !fxCalm && (
        <span key={`edge-${dealKey}`} aria-hidden data-tier={maxTier} className="draft-edge-pulse" />
      )}
      {/* A min-height flex wrapper centers the panel when it fits and lets the
          whole thing scroll on short or zoomed viewports, instead of the outer
          flex clipping the Skip/Confirm buttons off the top and bottom. */}
      <div className="flex min-h-full items-center justify-center px-3 py-4 sm:px-4">
      {/* Timer and panel share one column: the clock chip sits centered right
          above the plate with a small gap and moves with it. */}
      <div
        className={
          "draft-col flex min-w-0 w-full max-w-2xl flex-col items-center gap-2.5 lg:max-w-3xl" +
          (recordingMode ? " draft-col--rec" : "")
        }
      >
        {/* The countdown used to live HERE, in a bordered chip floating above
            the panel. On a phone that box overlapped the masthead and read as a
            stray rectangle pasted over the site chrome, belonging to nothing:
            two separate bordered boxes stacked with a gap between them. It now
            sits inline in the panel header, next to the label it governs. */}
        {/* Both game clocks stay visible while drafting, with the clock rule
            stated plainly: choosing is paused time; overrunning the countdown
            puts further deliberation on the player's own clock. */}
        {clocks && (
          <div className="pointer-events-none flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-parchment-300">
            <span className="font-mono tabular-nums">
              You <span className="font-bold text-parchment-100">{fmtClock(clocks.mine)}</span>
            </span>
            <span aria-hidden className="text-parchment-500">·</span>
            <span className="font-mono tabular-nums">
              Opponent <span className="font-bold text-parchment-100">{fmtClock(clocks.theirs)}</span>
            </span>
            {/* Its own full-width line, and NOT smallcaps. This is a full
                sentence: set in wide-tracked uppercase at 11px it wrapped to
                three lines on a phone, sat across the masthead and the player
                row, and was the hardest thing on the screen to read. Sentence
                case on its own row costs nothing and reads at a glance. */}
            <span className="w-full text-center text-[12px] leading-snug text-parchment-400">
              Clocks are paused while you choose. Past the countdown, drafting runs on your clock.
            </span>
          </div>
        )}
        <div className="relative min-w-0 w-full">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          // Entrance inside the system's 320ms budget (dur-3); the card deal
          // inside is a choreographed game effect with its own budget.
          transition={{ duration: 0.28, ease: "easeOut" }}
          className={
            "min-w-0 w-full" +
            // A mythic-grade pull rattles the whole panel as the chest opens
            // (stood down when the FX dial disables shake).
            (packStage === "open" && maxTier >= 9 && !reduceMotion && fxShake ? " draft-shake" : "")
          }
        >
          <div className="plate max-h-[78dvh] w-full overflow-y-auto overflow-x-hidden p-5 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-[12px] text-parchment-400">
              {draftLabel}
            </span>
            {/* The decision countdown, inline with the label it belongs to. */}
            {deadline != null ? (
              <DraftTimerWindow
                deadline={deadline}
                onExpire={handleExpire}
                announce={timerAnnounce}
              />
            ) : (
              /* Before the window opens, say WHAT is happening instead of
                 counting: the player can see their time has not started. */
              <DraftPrepChip
                label={
                  packStage !== "open"
                    ? "Opening your draft"
                    : !dealt
                    ? "Dealing the cards"
                    : "Preparing your draft"
                }
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            {oppLockedIn && (
              <div
                role="status"
                className="flex items-center gap-1.5 rounded-[1px] border border-verdigris-glow/50 bg-verdigris/10 px-2.5 py-0.5"
              >
                <CheckIcon className="text-verdigris-glow" />
                <span className="font-display text-[12px] font-semibold text-verdigris-glow">
                  {oppBanked ? "Opponent banked" : "Opponent locked in"}
                </span>
              </div>
            )}
            {/* Peek control: hide the overlay to study the board; the timer
                keeps running and the pick state is untouched. */}
            <button
              type="button"
              onClick={() => setHidden(true)}
              title="Hide the draft and peek at the board"
              className="flex items-center gap-1.5 min-h-[44px] touch-manipulation rounded-[1px] border border-[color:var(--edge)] bg-white/[0.03] px-3 py-0.5 text-parchment-300 transition hover:border-gold/50 hover:text-gold-leaf"
            >
              <EyeIcon off />
              <span className="font-display text-[14px] sm:text-[13px] font-semibold tracking-wide">Hide</span>
            </button>
          </div>
        </div>
        <h2 className="font-display text-3xl mt-1">
          {takeBoth
            ? "Take your cards"
            : noun === "hex"
            ? "Choose a hex or a boon"
            : `Choose a ${noun}`}
        </h2>
        {/* Reassurance while the chest and the deal play: the decision clock has
            not started. It used to be the second line of the timer chip, which
            no longer exists (the countdown moved inline into the header), so it
            lives here in the panel body where there is room for a sentence. */}
        {deadline == null && (
          <p className="mt-1 text-[12px] leading-snug text-parchment-400">
            Your timer starts when the cards are ready.
          </p>
        )}
        {(takeBoth || bankedBonus) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {takeBoth && (
              <div
                role="status"
                className="inline-flex items-center gap-2 rounded-[1px] border border-gold/60 bg-gold/15 px-3 py-1"
              >
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 bg-gold-leaf animate-flicker" />
                <span className="font-display text-xs font-bold tracking-wide text-gold-leaf">
                  You take BOTH cards this draft
                </span>
              </div>
            )}
            {bankedBonus && (
              <div className="inline-flex items-center gap-2 rounded-[1px] border border-[color:var(--edge-strong)] bg-white/[0.05] px-3 py-1">
                <span className="font-display text-xs font-semibold tracking-wide text-parchment-200">
                  +1 tier from your banked skip
                </span>
              </div>
            )}
          </div>
        )}

        {packStage !== "open" && (
          /* The sealed sigil vault: the individual cards stay secret, but the
             vault's material climbs with the best card inside, from rough
             slate at the bottom of the ladder up through iron, gilt, arcane
             glass, apex gold and mythic star-glass. Tap opens it immediately;
             Skip drops the whole ceremony and deals now. */
          <>
            <DraftVault
              tier={maxTier}
              count={offer.cards.length}
              label={draftLabel}
              stage={packStage}
              onOpen={tearPack}
              calm={fxCalm}
              still={!!reduceMotion}
            />
            <div className="mt-1 flex justify-center">
              <button
                type="button"
                onClick={() => setPackStage("open")}
                className="min-h-[36px] px-3 py-1 text-[12px] text-parchment-400 transition-colors hover:text-parchment-100"
              >
                Skip
              </button>
            </div>
          </>
        )}

        {packStage === "open" && maxTier >= 9 && !reduceMotion && !fxCalm && (
          /* A tier 9/10 pull is THE event: the pack detonates into a white
             flash, a rotating god-ray fan floods the panel, sparks climb the
             air, and the classic confetti burst rides on top. One shot,
             deterministic, and pointer-events-none throughout so it can never
             block a pick. Tier 9 pulls burn gold; tier 10 burns mythic cyan. */
          <div key={`pull-${dealKey}`} aria-hidden className="pointer-events-none">
            <span className="draft-pull absolute inset-0 overflow-hidden" data-tier={maxTier}>
              <span className="draft-pull__flash absolute inset-0" />
              <span className="draft-pull__rays absolute left-1/2 top-[38%]" />
              <span className="draft-pull__rays draft-pull__rays--rev absolute left-1/2 top-[38%]" />
              {Array.from({ length: 14 }).map((_, i) => (
                <i
                  key={i}
                  style={{
                    ["--x" as string]: `${6 + ((i * 61) % 88)}%`,
                    ["--rise-delay" as string]: `${(i % 7) * 110}ms`,
                    ["--rise-dur" as string]: `${1200 + ((i * 97) % 700)}ms`,
                  }}
                  className="draft-pull__mote"
                />
              ))}
            </span>
            <span className="draft-confetti relative">
              {Array.from({ length: 26 }).map((_, i) => (
                <i
                  key={i}
                  style={{
                    ["--ang" as string]: `${(i * 137) % 360}deg`,
                    ["--dist" as string]: `${110 + ((i * 53) % 140)}px`,
                    ["--conf-delay" as string]: `${(i % 7) * 28}ms`,
                  }}
                  className={`confetti-bit confetti-bit--${i % 4}`}
                />
              ))}
            </span>
          </div>
        )}

        {packStage === "open" && (
        <div
          className={`draft-deal-grid mt-5 grid items-stretch gap-3 lg:gap-4 ${offer.cards.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
        >
          {offer.cards.map((card, i) => {
            const def = BUFF_BY_ID[card.id];
            if (!def) return null;
            const flipDelay = flipDelayMs(i, card.tier);
            return (
              <motion.div
                // Key by the offer index AND reroll count so a fresh draft (or
                // a reroll of the same draft) remounts the cards, replaying the
                // deal from the deck and the flip reveal.
                key={`${dealKey}-${i}`}
                ref={(el) => {
                  cardRefs.current[i] = el;
                }}
                data-tier={card.tier}
                data-cat={def.category}
                // The one-shot shine pass (CSS) waits for this card's own flip
                // to finish before it crosses.
                style={{ ["--reveal-delay" as string]: `${flipDelay + FLIP_MS + 80}ms` }}
                className={
                  "draft-fx mx-auto h-full w-full max-w-md sm:max-w-none " +
                  (selected === i && chosen == null && !banking ? "draft-fx--selected" : "")
                }
                // Deal from the chest: the card starts face-down where the
                // chest's open mouth sat (top center of the grid), then fans
                // out and down into its slot as if lifted from the hoard.
                initial={
                  reduceMotion
                    ? { opacity: 0 }
                    : {
                        x: `${(mid - i) * 104}%`,
                        y: "-42%",
                        rotate: (i - mid) * 2,
                        scale: 0.58,
                        opacity: 1,
                      }
                }
                animate={
                  chosen === i
                    ? // Into the pocket: the confirmed card arcs toward the
                      // dock (measured at confirm time), shrinking as it goes,
                      // and fades just before it lands. Under reduced motion it
                      // simply fades: this and the bank flight below are the
                      // LARGEST movements in the app (a full cross-viewport
                      // arc) and were the only two branches here with no
                      // reduced-motion check, while their immediate siblings
                      // all had one.
                      reduceMotion
                      ? { opacity: 0 }
                      : {
                          x: pocket?.dx ?? -180,
                          y: pocket?.dy ?? 220,
                          scale: 0.18,
                          rotate: -5,
                          opacity: [1, 1, 0.85, 0],
                        }
                    : chosen != null
                    ? // The unpicked card bows out: it sinks and fades while
                      // the chosen one lifts away (fade only, reduced motion).
                      reduceMotion
                      ? { opacity: 0.12 }
                      : { opacity: 0.1, y: 26, scale: 0.94, rotate: 1.2 }
                    : banking
                    ? // Into the bank: face-down again (the inner flip) and off
                      // toward the vault over the Skip button as a stack. Fade
                      // only under reduced motion.
                      reduceMotion
                      ? { opacity: 0 }
                      : {
                          x: bankDeltas?.[i]?.dx ?? 0,
                          y: bankDeltas?.[i]?.dy ?? 240,
                          scale: 0.22,
                          rotate: 4,
                          opacity: [1, 1, 0.9, 0],
                        }
                    : rerolling && !reduceMotion
                    ? {
                        // Reroll: the rejected cards flip face-down (inner
                        // wrapper below) and converge into ONE spinning stack
                        // back at the chest's mouth, each a beat apart with a
                        // slight fan, then the fresh offer deals back out.
                        x: `${(mid - i) * 104 * 0.06}%`,
                        y: "-40%",
                        rotate: 360 + (i - mid) * 14,
                        scale: 0.5,
                        opacity: [1, 1, 1, 0],
                      }
                    : // Once a card is selected the others dim to focus it.
                      {
                        opacity: selected != null && selected !== i ? 0.55 : 1,
                        x: 0,
                        // The picked card holds its slot: selection reads through
                        // the gold ring, glow, and check seal alone. A lift/swell
                        // here pushed the selected card's title and edges out of
                        // line with its sibling (same-height grid), which looked
                        // like a layout bug — so it stays put and aligned.
                        y: 0,
                        rotate: 0,
                        scale: 1,
                      }
                }
                transition={
                  chosen === i
                    ? { duration: 0.55, ease: [0.3, 0.05, 0.2, 1], opacity: { times: [0, 0.6, 0.85, 1] } }
                    : chosen != null
                    ? { duration: 0.3, ease: "easeIn" }
                    : rerolling && !reduceMotion
                    ? { delay: i * 0.05, duration: 0.52, ease: [0.4, 0, 0.3, 1], opacity: { times: [0, 0.6, 0.85, 1] } }
                    : banking
                    ? {
                        delay: 0.14 + i * 0.06,
                        duration: 0.4,
                        ease: [0.3, 0.05, 0.2, 1],
                        opacity: { times: [0, 0.5, 0.8, 1] },
                      }
                    : dealt
                    ? { duration: 0.18, ease: "easeOut" }
                    : {
                        delay: (i * DEAL_STAGGER_MS) / 1000,
                        duration: DEAL_MS / 1000,
                        ease: [0.2, 0.8, 0.2, 1],
                      }
                }
                onAnimationComplete={() => {
                  if (chosen === i) commit(i);
                }}
                // Belt and braces for the pick click: if ANY decorative layer
                // (holo, sheen, glow, a future overlay) ever swallows the
                // click before it reaches the card's button, the shell catches
                // the bubble and picks anyway. Events that already went
                // through the button are skipped (their target sits inside
                // it), so nothing double-fires.
                onClick={(e) => {
                  if (chosen != null || banking) return;
                  if ((e.target as HTMLElement).closest("button")) return;
                  choose(i, Date.now());
                }}
                // Parallax tilt: the pointer's position tips the card face in
                // 3D (CSS vars read by .draft-card-front, so framer's own
                // transform on this wrapper is never touched).
                onMouseMove={
                  reduceMotion
                    ? undefined
                    : (e) => {
                        const el = e.currentTarget as HTMLElement;
                        const r = el.getBoundingClientRect();
                        el.style.setProperty(
                          "--tiltY",
                          `${((e.clientX - r.left) / r.width - 0.5) * 9}deg`,
                        );
                        el.style.setProperty(
                          "--tiltX",
                          `${((e.clientY - r.top) / r.height - 0.5) * -9}deg`,
                        );
                      }
                }
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.removeProperty("--tiltX");
                  el.style.removeProperty("--tiltY");
                }}
              >
                <span aria-hidden className="draft-fx__glow" />
                {/* Selection seal: an unmistakable gold check on the selected
                    card, over and above the brighter border, so "which card
                    am I about to confirm" never needs a second look. */}
                {selected === i && chosen == null && !banking && (
                  <span aria-hidden className="draft-sel-check">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                )}
                {/* 3D flip: the back faces the viewer while dealing, then the
                    wrapper rotates to reveal the face (higher tier flips a
                    touch later). Banking rotates it face-down again. */}
                <motion.div
                  className="draft-flip"
                  initial={reduceMotion ? false : { rotateY: 180 }}
                  animate={{ rotateY: (banking || rerolling) && !reduceMotion ? 180 : 0 }}
                  transition={
                    banking || rerolling
                      ? { duration: 0.22, ease: "easeIn" }
                      : {
                          delay: reduceMotion || dealt ? 0 : flipDelay / 1000,
                          duration: FLIP_MS / 1000,
                          ease: [0.3, 0.1, 0.3, 1],
                        }
                  }
                >
                  <div className="draft-card-front">
                    {/* Mythic presence: a tier 9/10 card radiates its own
                        breathing halo behind the face, so THE card of the
                        pull is unmistakable even inside a strong offer. */}
                    {(card.tier >= 9 || isGodlikeCard(card.id)) && (
                      <span
                        aria-hidden
                        className="draft-mythic-aura"
                        // The signature cards pull with their own radiance
                        // regardless of tier (see lib/signatureCards.ts).
                        // Presentation only: no tier, pool or odds change.
                        data-tier={isGodlikeCard(card.id) ? "god" : card.tier}
                      />
                    )}
                    {/* Rarity-scaled reveal: tier 6+ cards land with a
                        tier-colored ring blooming off the face right as the
                        flip finishes (rides the same --reveal-delay). */}
                    {card.tier >= 6 && !reduceMotion && (
                      <span aria-hidden className="draft-reveal-ring" />
                    )}
                    <BuffCard
                      buff={def}
                      tier={card.tier}
                      onClick={chosen == null && !banking ? () => choose(i, Date.now()) : undefined}
                      // Draft picker only: the looping animation-preview
                      // medallion, so a card's effect style reads at a glance.
                      preview
                    />
                    {/* Foil finish: tier 7+ faces carry a slow holographic
                        sheen that drifts across the card, TCG-rare style. */}
                    {card.tier >= 7 && <span aria-hidden className="draft-holo" />}
                  </div>
                  {/* Card back: an ink panel with a hairline frame and the
                      tier numeral as a quiet watermark. */}
                  <div aria-hidden className="draft-card-back">
                    <span className={`draft-card-back__numeral font-display tier-${card.tier}`}>
                      {TIER_ROMAN[card.tier]}
                    </span>
                  </div>
                </motion.div>
                <span aria-hidden className="draft-fx__sheen" />
                {/* Pick confirmation: the chosen card flares once and sheds a
                    stream of gold motes as it dissolves toward the dock (the
                    layer rides the wrapper's pocket flight, so the motes trail
                    the card the whole way). Reduced motion commits instantly
                    with no flight, so this never renders there. */}
                {chosen === i && !reduceMotion && (
                  <span aria-hidden className="pick-dissolve">
                    <span className="pick-dissolve__flare" />
                    {Array.from({ length: 10 }).map((_, m) => (
                      <i
                        key={m}
                        style={{
                          ["--ang" as string]: `${(m * 36 + 12) % 360}deg`,
                          ["--pd" as string]: `${30 + ((m * 31) % 40)}px`,
                          ["--pdelay" as string]: `${(m % 5) * 45}ms`,
                        }}
                      />
                    ))}
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
        )}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
          <Button
            tone="primary"
            onClick={confirmSelection}
            disabled={selected == null || chosen != null || banking}
            className={
              "w-full touch-manipulation px-8 py-3 text-base font-semibold tracking-wide sm:w-auto" +
              // With a card selected the commit is THE action: it picks up a
              // gold ready-glow so it clearly outranks Reroll / Skip & bank.
              (selected != null && chosen == null && !banking ? " draft-confirm-ready" : "")
            }
          >
            {/* The commit names the selected card ("Confirm Holy Hell") so
                the player always knows exactly what they are locking in. */}
            {selected != null
              ? `Confirm ${BUFF_BY_ID[offer.cards[selected]?.id]?.name ?? "pick"}`
              : "Pick a card"}
          </Button>
          {canReroll && (
            <Button tone="glass"
              onClick={handleReroll}
              disabled={rerolling}
              // Quiet secondary: btn-glass is reserved for the lock-in commits
              // (Confirm pick / Bank this draft), one glass primary per region.
              className="flex w-full touch-manipulation border border-[color:var(--edge)] bg-white/[0.03] px-6 py-3 text-sm font-semibold tracking-wide text-parchment-200 hover:border-gold/50 hover:text-gold-leaf sm:w-auto" title="Discard this offer and roll fresh cards at the same tier">
              <RerollIcon className={"text-gold-leaf" + (rerolling ? " reroll-spin" : "")} />
              Reroll <span className="text-parchment-400">({rerollBadge})</span>
            </Button>
          )}
          <div className="relative flex w-full items-center gap-2 sm:w-auto">
            {bankArmed ? (
              <>
                {/* Second step: banking sends this draft to the bank and rolls
                    your next one a tier higher, so it asks before committing. */}
                <Button
                  tone="glass"
                  ref={bankBtnRef}
                  onClick={handleBank}
                  disabled={chosen != null || banking}
                  className={
                    "w-full touch-manipulation border-coral/50 px-6 py-3 font-semibold tracking-wide text-coral-glow sm:w-auto" +
                    // The vault takes the deposit: one pulse as the face-down
                    // cards land in the button.
                    (banking ? " bank-pulse" : "")
                  }
                  title="Bank this draft and roll a tier higher next time"
                >
                  Bank this draft?
                </Button>
                <button
                  type="button"
                  onClick={() => setBankArmed(false)}
                  disabled={banking}
                  className="shrink-0 touch-manipulation rounded-[1px] border border-[color:var(--edge)] bg-white/[0.03] px-3 py-3 font-display text-[14px] sm:text-[13px] font-semibold tracking-wide text-parchment-200 transition hover:border-[color:var(--edge-strong)] hover:text-parchment-100 disabled:opacity-40"
                >
                  Keep looking
                </button>
              </>
            ) : (
              <button
                onClick={() => setBankArmed(true)}
                disabled={chosen != null || banking}
                // Quiet secondary (arm step, not a commit): glass stays with
                // the lock-in buttons only.
                className="w-full touch-manipulation rounded-[1px] border border-[color:var(--edge)] bg-white/[0.03] px-6 py-3 font-display text-sm font-semibold tracking-wide text-parchment-200 transition hover:border-[color:var(--edge-strong)] hover:text-parchment-100 disabled:opacity-40 sm:w-auto"
                title="Skip this draft; your next one pulls from a tier higher"
              >
                Skip &amp; bank <span className="ml-1 text-parchment-400">+1 tier next draft</span>
              </button>
            )}
            {banking && (
              <>
                <motion.span
                  aria-hidden
                  initial={{ opacity: 0, y: 6, x: "-50%" }}
                  animate={{ opacity: [0, 1, 1, 0], y: -26, x: "-50%" }}
                  transition={{ duration: 0.7, delay: 0.5 }}
                  className="pointer-events-none absolute -top-1 left-1/2 font-display text-sm font-bold text-gold-leaf"
                >
                  +1 tier
                </motion.span>
                {/* THE VAULT: a steel door materializes above the button, its
                    wheel spins shut as the face-down cards fly in, and it
                    flashes gold as the deposit lands. Decorative, one shot. */}
                <span aria-hidden className="bank-vault">
                  <span className="bank-vault__door" />
                  <span className="bank-vault__wheel">
                    <span className="bank-vault__spoke" />
                    <span className="bank-vault__spoke bank-vault__spoke--cross" />
                  </span>
                  <span className="bank-vault__flash" />
                </span>
                {/* A golden shockwave ring (plus a fainter echo) blooms off the
                    vault, a gleam sweeps the button, and a fan of coins and
                    glints bursts upward. Deterministic, one shot, decorative. */}
                <span aria-hidden className="bank-ring" />
                <span aria-hidden className="bank-ring--echo" />
                <span aria-hidden className="bank-gleam" />
                <span aria-hidden className="bank-burst">
                  {Array.from({ length: 16 }).map((_, i) => (
                    <i
                      key={i}
                      style={{
                        // An upward fan: -60deg..+60deg around straight up.
                        ["--ang" as string]: `${Math.round(-60 + (i * 120) / 15)}deg`,
                        ["--dist" as string]: `${34 + ((i * 29) % 34)}px`,
                        ["--d" as string]: `${(i % 6) * 26}ms`,
                      }}
                      className={i % 2 === 0 ? "bank-coin" : "bank-coin bank-coin--spark"}
                    />
                  ))}
                </span>
              </>
            )}
          </div>
        </div>

        {opponent && <OpponentDraftPanel opponent={opponent} />}
          </div>
        </motion.div>
        </div>
      </div>
      </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared reveal moment: once BOTH sides of a simultaneous draft round have
// resolved, the match page shows this brief, non-blocking banner pairing your
// pick with whatever is legitimately visible of the opponent's (their card
// when its identity is public, a face-down back with the tier numeral when
// hidden, or a "Banked" tag). Click dismisses; the page auto-dismisses on a
// short timer. Rendering is purely presentational: the caller passes only
// data it already holds, so nothing hidden can leak here.
// ---------------------------------------------------------------------------

export interface DraftRevealCard {
  /** Absent (or unknown to BUFF_BY_ID) = identity hidden: render face-down. */
  id?: string;
  tier: number;
}

export interface DraftRevealSide {
  banked: boolean;
  cards: DraftRevealCard[];
}

function RevealColumn({ label, side }: { label: string; side: DraftRevealSide }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[12px] text-parchment-400">{label}</span>
      {side.banked ? (
        <span className="inline-flex w-fit items-center rounded-[1px] border border-[color:var(--edge-strong)] bg-white/[0.05] px-1.5 py-px font-display text-[12px] font-semibold tracking-wide text-parchment-200">
          Banked
        </span>
      ) : side.cards.length === 0 ? (
        <span className="text-[12px] text-parchment-400">Picked</span>
      ) : (
        side.cards.map((c, i) => {
          const def = c.id ? BUFF_BY_ID[c.id] : undefined;
          const roman = TIER_ROMAN[c.tier] ?? "";
          if (def) {
            return (
              <span key={i} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className={`min-w-0 truncate font-display text-[13px] font-semibold tier-${c.tier}`}>
                    {def.name}
                  </span>
                  <span
                    className={`shrink-0 rounded-[1px] border px-1.5 py-px font-display text-[12px] font-bold tier-bg-${c.tier} tier-${c.tier}`}
                  >
                    {roman}
                  </span>
                </span>
                {/* What the card does: shown only for a revealed pick, so a
                    masked draft (below) never leaks its effect. */}
                <span className="hidden text-[12px] leading-snug text-parchment-300 sm:block"><GlossaryText text={def.description} /></span>
              </span>
            );
          }
          return (
            <span key={i} className="flex items-center gap-1.5">
              {/* Face-down card back: an ink mini with the tier numeral, the
                  same treatment the dock gives hidden cards. */}
              <span
                aria-hidden
                className="relative flex h-7 w-5 shrink-0 items-center justify-center rounded-[1px] border border-gold/35 bg-ink-950"
              >
                <span aria-hidden className="absolute inset-[2px] rounded-[1px] border border-gold/20" />
                <span className={`font-display text-[12px] font-bold tier-${c.tier}`}>{roman}</span>
              </span>
              <span className="text-[12px] text-parchment-400">Hidden · tier {c.tier}</span>
            </span>
          );
        })
      )}
    </span>
  );
}

export function DraftRevealBanner({
  mine,
  theirs,
  onDismiss,
}: {
  mine: DraftRevealSide;
  theirs: DraftRevealSide;
  onDismiss: () => void;
}) {
  const reduceMotion = useReducedMotion();
  // The banner explains itself in a glance; it leaves on its own after a few
  // seconds so it never sits over the board on a phone.
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 7000);
    return () => window.clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 sm:inset-x-auto sm:bottom-6 sm:left-4 sm:justify-start">
      <motion.button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="plate plate-raised pointer-events-auto w-full max-w-[min(94vw,32rem)] border-gold/40 p-3 text-left shadow-plate"
      >
        <span className="block text-[12px] text-parchment-400">Draft resolved</span>
        <span className="mt-1.5 flex items-stretch gap-3">
          {/* My card slides in from the left, theirs from the right, meeting
              in the middle (a single container fade under reduced motion). */}
          <motion.span
            className="flex min-w-0 flex-1"
            initial={reduceMotion ? false : { opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
          >
            <RevealColumn label="You drafted" side={mine} />
          </motion.span>
          <span aria-hidden className="w-px shrink-0 self-stretch bg-white/15" />
          <motion.span
            className="flex min-w-0 flex-1"
            initial={reduceMotion ? false : { opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
          >
            <RevealColumn label="Opponent" side={theirs} />
          </motion.span>
        </span>
      </motion.button>
    </div>
  );
}
