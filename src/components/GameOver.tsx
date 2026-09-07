"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useModalChrome } from "@/lib/useModalChrome";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchMe } from "@/lib/authClient";
import { GameResult } from "@/engine/game";
import { Color, Move } from "@/engine/types";
import { moveToUCI } from "@/engine/board";
import { Nerf } from "@/engine/nerf";
import { BuffInstance, type DraftMode } from "@/engine/buff";
import { BUFF_BY_ID } from "@/engine/buffs/library";
import { gameToPGN } from "@/lib/pgn";
import { playGameOver } from "@/lib/sounds";
import { haptic } from "@/lib/haptics";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { TIER_LABEL, TIER_ROMAN } from "@/lib/tiers";
import { GlossaryText } from "@/components/GlossaryText";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

// A single card marker on the match timeline. `ply` is the half-move the card
// landed on; `cardId`/`tier` name it for the hover label and tier tint. Callers
// derive this from whatever public action record they hold (dtActions in the
// spectator/replay paths, the local signature record in the bot game); callers
// with no action data pass nothing and the timeline renders moves-only.
export interface TimelineCardEvent {
  ply: number;
  color?: Color;
  cardId?: string;
  tier?: number;
}

// A linked player profile shown in the actions area. `href` points at
// /u/[username]. Every account links the same way: house accounts have real
// seeded profiles, and skipping their link would be a tell (owner request:
// no bot trace anywhere on the site).
export interface ProfileLink {
  name: string;
  href: string;
}

interface Props {
  result: GameResult;
  myColor: Color;
  myNerf?: Nerf;
  opponentNerf?: Nerf;
  // `provisional` = the post-game rating deviation is still wide (RD > 110),
  // so the new rating renders with a "?" suffix ("1500?").
  ratingChange?: { before: number; after: number; provisional?: boolean } | null;
  // Which rating pool the change applies to ("nerf" | "buff"), so the pill
  // reads "Buff rating" instead of an unlabeled number.
  ratingMode?: "nerf" | "buff" | null;
  // The section this game belonged to, drawn as a mode chip in the header.
  mode?: DraftMode | null;
  // Post-game win/loss/draw record in the pool this game counted toward, shown
  // as a "now 12W 4L 2D" line. Omitted honestly for guests and casual games.
  record?: { wins: number; losses: number; draws: number } | null;
  // Current standing in the rated pool (from the leaderboard API). Movement is
  // never shown because the before-rank is not stored; current rank only.
  rank?: number | null;
  onRematch: () => void;
  // Accepted for caller compatibility; the result screen no longer renders a
  // separate "New game" button (New opponent and Rematch cover the flows).
  onNewGame: () => void;
  // Accepted for caller compatibility; move review now lives in the game view
  // itself (dismiss the panel to scrub), not as a result-screen action.
  onReview?: () => void;
  // Online games negotiate rematches over the wire: "offered" = waiting for
  // the opponent, "incoming" = the opponent wants one.
  rematchStatus?: "none" | "offered" | "incoming";
  // Online games: the opponent's socket has been gone past the server's
  // grace period, so a rematch offer has nobody to answer it.
  opponentLeft?: boolean;
  // Withdraw a pending rematch offer (shown once the opponent has left).
  onCancelRematch?: () => void;
  // When true (the "keep opponent rules hidden" setting), the opponent's rule
  // starts face-down behind a "Reveal opponent's nerf" button.
  opponentHidden?: boolean;
  // When provided, a "Copy PGN" button exports the move list.
  moves?: Move[];
  // Card-use markers for the match timeline, one per played card (see above).
  cardEvents?: TimelineCardEvent[];
  // Opens the clip modal (auto reel mode). Rendered as a prominent "Share
  // reel" action on the result screen: the reveal is the emotional peak, so
  // that is where the reel entry belongs. Omit it (e.g. when the last plies
  // can't be reconstructed) and the button simply doesn't render.
  onClip?: () => void;
  playerNames?: Record<Color, string>;
  startedAt?: number;
  // When provided, dismissal is delegated to the parent (which can re-show
  // the screen later); otherwise the component hides itself permanently.
  onDismiss?: () => void;
  // Server game id, attached to rule feedback votes.
  gameId?: string;
  // Archived server game id: when present a "Watch replay" action links to the
  // archived replay at /game/[id].
  serverGameId?: string | null;
  // Linked player profiles for the "View profile" actions (both players).
  profiles?: ProfileLink[];
  // "New opponent" target: /lobby with the same mode + time control preselected
  // via the query params the lobby reads. Defaults to /lobby?tab=quick.
  newOpponentHref?: string;
  // Draft games: the buffs I held during the game, offered for balance votes.
  myBuffs?: BuffInstance[];
  // Draft games: the cards my opponent drafted, revealed once the game is over
  // (the same "the secret finally pays off" beat as the nerf reveal).
  opponentBuffs?: BuffInstance[];
  // Spectator view: the watcher holds no seat, so present a neutral result
  // (winner named by side), reveal both rules and both sides' cards read-only,
  // and drop the seat-only bits (Victory/Defeat wording, rating, rematch, and
  // rule/buff voting). Otherwise it's the exact same panel the players see.
  // In this mode `myColor` is the reference side (pass "w"): `myNerf`/`myBuffs`
  // are white's, `opponentNerf`/`opponentBuffs` are black's.
  spectator?: boolean;
}

// The shared compact thumbs pair. One vote per item; re-clicking replaces it
// (optimistically here, INSERT OR REPLACE server side).
function VoteThumbs({ vote, onVote }: { vote: 1 | -1 | null; onVote: (value: 1 | -1) => void }) {
  return (
    <span className="flex gap-1.5">
      <button
        type="button"
        aria-label="Thumbs up"
        onClick={() => onVote(1)}
        className={
          "grid h-9 w-9 place-items-center border transition " +
          (vote === 1
            ? "border-verdigris/60 bg-verdigris/20 text-verdigris-glow"
            : "border-[color:var(--edge)] text-parchment-300 hover:border-verdigris/50 hover:text-verdigris-glow")
        }
      >
        <ThumbsUp size={13} />
      </button>
      <button
        type="button"
        aria-label="Thumbs down"
        onClick={() => onVote(-1)}
        className={
          "grid h-9 w-9 place-items-center border transition " +
          (vote === -1
            ? "border-oxblood-glow/60 bg-oxblood/20 text-oxblood-glow"
            : "border-[color:var(--edge)] text-parchment-300 hover:border-oxblood-glow/50 hover:text-oxblood-glow")
        }
      >
        <ThumbsDown size={13} />
      </button>
    </span>
  );
}

// One-tap verdict on the rule you were dealt; lands in the moderators' rule
// feedback queue so unpopular rules get rebalanced.
function RuleFeedback({ nerfId, gameId }: { nerfId: string; gameId?: string }) {
  const [vote, setVote] = useState<1 | -1 | null>(null);

  const cast = async (value: 1 | -1) => {
    setVote(value);
    try {
      await fetch("/api/nerf-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nerfId, vote: value, ...(gameId ? { gameId } : {}) }),
      });
    } catch {}
  };

  return (
    <div className="mt-2 flex items-center justify-between gap-2 border-t border-[color:var(--edge)] pt-2">
      <span className="text-xs text-parchment-400">
        {vote ? "Thanks for the feedback" : "Like this rule?"}
      </span>
      <VoteThumbs vote={vote} onVote={cast} />
    </div>
  );
}

// State tag for one drafted card at game end. Passives that were still live
// read as "Active" (and sort to the top); one-shots that fired read "Spent";
// a card an opponent cancelled reads "Nullified".
function draftedCardState(buff: BuffInstance, kind: "passive" | "instant" | "activated") {
  if (buff.nullified) return { tag: "Nullified", tone: "oxblood" as const, active: false };
  const used = !!buff.spent || !!buff.usedActivation;
  if (kind === "passive") {
    return used
      ? { tag: "Spent", tone: "muted" as const, active: false }
      : { tag: "Active", tone: "pos" as const, active: true };
  }
  if (used) return { tag: "Spent", tone: "muted" as const, active: false };
  return { tag: null, tone: "muted" as const, active: false };
}

// One compact tier-chip row in a drafted-cards group. Read-only by default;
// when `votable` (the seated player's own cards) it carries the balance-vote
// thumbs, posting to the buff feedback queue exactly as the old reveal row did.
function DraftedCardRow({
  buff,
  votable,
  gameId,
}: {
  buff: BuffInstance;
  votable?: boolean;
  gameId?: string;
}) {
  const def = BUFF_BY_ID[buff.id];
  const [vote, setVote] = useState<1 | -1 | null>(null);
  const cast = async (value: 1 | -1) => {
    setVote(value);
    try {
      await fetch("/api/buff-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buffId: buff.id, vote: value, ...(gameId ? { gameId } : {}) }),
      });
    } catch {}
  };
  if (!def) return null;
  const state = draftedCardState(buff, def.kind);
  const tagClass =
    state.tone === "pos"
      ? "border-verdigris/50 text-verdigris-glow"
      : state.tone === "oxblood"
      ? "border-oxblood-glow/50 text-oxblood-glow"
      : "border-[color:var(--edge)] text-parchment-400";
  return (
    <li className={"py-1.5" + (buff.nullified ? " opacity-60" : "")}>
      <div className="flex items-center gap-2">
        <span
          className={`shrink-0 border px-1 font-display text-[12px] font-bold leading-none tier-bg-${buff.tier} tier-${buff.tier}`}
          // title stays as the desktop hover gloss; the aria-label carries the
          // same meaning for screen readers (title alone is unreliable there,
          // and never appears on touch — where the roman numeral plus the full
          // rule text below already tell the story).
          title={`Tier ${buff.tier}: ${TIER_LABEL[buff.tier]}`}
          aria-label={`Tier ${buff.tier}: ${TIER_LABEL[buff.tier]}`}
        >
          <span aria-hidden>{TIER_ROMAN[buff.tier]}</span>
        </span>
        <span
          className={
            "min-w-0 flex-1 truncate text-[13px] text-parchment-100" +
            (buff.nullified ? " line-through decoration-parchment-500" : "")
          }
          title={def.name}
        >
          {def.name}
        </span>
        {state.tag && (
          <span className={`shrink-0 border px-1.5 py-px text-[12px] leading-none ${tagClass}`}>
            {state.tag}
          </span>
        )}
      </div>
      {/* The rule text always shows IN FULL: a card's effect must never be
          truncated into a broken fragment ("Your pawns can never be..."), and
          it must never hide behind a hover tooltip. The vote thumbs share this
          row so the name line above keeps its full width in narrow columns. */}
      <div className="mt-0.5 flex items-start gap-2">
        <p className="min-w-0 flex-1 text-left text-xs leading-snug text-parchment-300">
          {/* Glossary terms in the rule text get the tap/hover definition
              popover: this end screen is where new players most need them. */}
          <GlossaryText text={def.description} />
        </p>
        {votable && (
          <span className="shrink-0">
            <VoteThumbs vote={vote} onVote={cast} />
          </span>
        )}
      </div>
    </li>
  );
}

// One side's drafted cards, grouped and labeled. Passives that were active at
// game end sort first (they are the ones still shaping the final position),
// then the rest in draft order.
function DraftedGroup({
  label,
  hint,
  buffs,
  votable,
  gameId,
}: {
  label: string;
  hint?: string;
  buffs: BuffInstance[];
  votable?: boolean;
  gameId?: string;
}) {
  const ordered = useMemo(() => {
    return buffs
      .map((b, i) => ({ b, i }))
      .sort((a, z) => {
        const da = BUFF_BY_ID[a.b.id];
        const dz = BUFF_BY_ID[z.b.id];
        const aa = da ? (draftedCardState(a.b, da.kind).active ? 0 : 1) : 1;
        const za = dz ? (draftedCardState(z.b, dz.kind).active ? 0 : 1) : 1;
        return aa - za || a.i - z.i;
      })
      .map((x) => x.b);
  }, [buffs]);
  if (ordered.length === 0) return null;
  // No inner scroll/clip: the two side-by-side groups stretch to equal heights
  // (grid default) and the panel itself scrolls, so no row is ever cut off.
  return (
    <div className="border border-[color:var(--edge)] bg-ink-900/40 p-3 text-left">
      <div className="flex items-baseline justify-between gap-2">
        <span>{label}</span>
        {hint && <span className="shrink-0 text-xs text-parchment-400">{hint}</span>}
      </div>
      <ul className="mt-1.5 divide-y divide-[color:var(--edge)]">
        {ordered.map((buff, i) => (
          <DraftedCardRow key={`${buff.id}-${i}`} buff={buff} votable={votable} gameId={gameId} />
        ))}
      </ul>
    </div>
  );
}

// A single revealed rule row for the post game summary. Both players' rules are
// shown once the game is over, so the "secret" finally pays off.
function RuleReveal({ label, nerf, children }: { label: string; nerf: Nerf; children?: ReactNode }) {
  return (
    <div className={`border p-3 text-left tier-bg-${nerf.tier}`}>
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span
          className={`inline-flex items-center gap-1 border px-1.5 py-0.5 font-display text-[12px] font-bold leading-none tier-bg-${nerf.tier} tier-${nerf.tier}`}
          title={`Difficulty ${nerf.tier}: ${TIER_LABEL[nerf.tier]}`}
        >
          <span aria-hidden>{TIER_ROMAN[nerf.tier]}</span>
          <span>{TIER_LABEL[nerf.tier]}</span>
        </span>
      </div>
      <div className={`mt-1 font-display text-base font-semibold leading-tight tier-${nerf.tier}`}>
        {nerf.name}
      </div>
      <p className="mt-1 text-xs leading-snug text-parchment-200">
        {/* Glossary terms in the revealed rule get the tap/hover definition
            popover, so the reveal explains itself to new players. */}
        <GlossaryText text={nerf.description} />
      </p>
      {children}
    </div>
  );
}

// A folded summary section on the game-over panel. Playtest feedback: the end
// screen printed every rule and drafted card in full and grew "way too large"
// — the verdict and rating drowned. Each reference block now sits behind a
// native <details> row that names itself and its count; one tap opens the full
// content (which still renders complete rule text — the no-truncation rule
// holds INSIDE the fold).
function SummaryFold({
  label,
  count,
  hint,
  children,
}: {
  label: string;
  count?: number;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <details className="group mt-5 border border-[color:var(--edge)] bg-ink-900/40 text-left">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 outline-none focus-visible:text-gold-leaf [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-baseline gap-2">
          <span>{label}</span>
          {count != null && (
            <span className="font-mono text-[12px] tabular-nums text-parchment-400">{count}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {hint && <span className="text-xs text-parchment-400">{hint}</span>}
          <span
            aria-hidden
            className="text-parchment-400 motion-safe:transition-transform group-open:rotate-90"
          >
            &#9656;
          </span>
        </span>
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
}

// A compact horizontal strip of the game's shape: a tick every 10 plies and a
// tier-tinted marker at every ply a card was played. Hovering (or tapping, on
// touch) a marker names the card and the ply. With no card data it degrades to
// the plain move ruler.
function MatchTimeline({
  moves,
  cardEvents,
}: {
  moves?: Move[];
  cardEvents?: TimelineCardEvent[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = moves?.length ?? 0;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let p = 10; p < total; p += 10) out.push(p);
    return out;
  }, [total]);
  const events = useMemo(
    () =>
      (cardEvents ?? [])
        .filter((e) => e.ply >= 0 && e.ply <= total)
        .map((e) => ({ ...e, def: e.cardId ? BUFF_BY_ID[e.cardId] : undefined })),
    [cardEvents, total],
  );
  if (total < 2) return null;
  const activeEvent = active != null ? events[active] : null;
  return (
    <section className="mt-5 text-left" aria-label="Match timeline">
      <div className="flex items-baseline justify-between gap-2">
        <span>Match timeline</span>
        <span className="text-xs text-parchment-400 tabular">{total} plies</span>
      </div>
      <div className="relative mt-2 h-8">
        {/* Base ruler. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[color:var(--edge-strong)]"
        />
        {/* Tick every 10 plies. */}
        {ticks.map((p) => (
          <span
            key={`t${p}`}
            aria-hidden
            className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-[color:var(--edge-strong)]"
            style={{ left: `${(p / total) * 100}%` }}
          />
        ))}
        {/* Card markers. */}
        {events.map((e, i) => (
          <button
            key={`e${i}`}
            type="button"
            title={`${e.def?.name ?? "Card"} · ply ${e.ply}`}
            aria-label={`${e.def?.name ?? "Card"} played at ply ${e.ply}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
            onFocus={() => setActive(i)}
            onBlur={() => setActive((cur) => (cur === i ? null : cur))}
            onClick={() => setActive((cur) => (cur === i ? null : i))}
            className={
              "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border transition " +
              (e.tier
                ? `tier-bg-${e.tier} tier-${e.tier} border-current`
                : "border-gold/60 bg-gold/30 text-gold-leaf") +
              (active === i ? " scale-125" : "")
            }
            style={{ left: `${(e.ply / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-parchment-400">
        <span>Opening</span>
        <span>Endgame</span>
      </div>
      {/* Tap/hover readout: keeps the marker legible on touch, where title
          tooltips never appear. */}
      <p className="mt-1 min-h-[1.1rem] text-xs text-parchment-300" role="status">
        {activeEvent
          ? `${activeEvent.def?.name ?? "Card"} · ply ${activeEvent.ply}`
          : events.length > 0
          ? "Hover or tap a marker to see the card played there."
          : cardEvents
          ? "No cards landed on the board in this game."
          : "Moves only: this game has no card record."}
      </p>
    </section>
  );
}

function splitReason(reason: string) {
  const marker = reason.indexOf(":");
  if (marker < 0) return { nerfName: "", cause: reason };
  return {
    nerfName: reason.slice(0, marker).trim(),
    cause: reason.slice(marker + 1).trim(),
  };
}

// The game-over chime fires once per finished game, not once per mount:
// dismissing and reopening the result screen, or a reconnect replaying the
// end frame, remounts this component and must stay silent.
const playedGameOverKeys = new Set<string>();

// Count a figure from `from` up to `to` over a short beat, so the post-game
// rating change reads as earned rather than snapping into place. Jumps straight
// to the final value when motion is reduced. Pure requestAnimationFrame, no deps.
function useCountUp(from: number, to: number, animate: boolean, durationMs = 700) {
  const [value, setValue] = useState(animate ? from : to);
  // With motion reduced the figure just tracks its target; adjust during render
  // instead of in an effect so no extra cascading render is scheduled.
  if (!animate && value !== to) setValue(to);
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    let startTs: number | null = null;
    const tick = (ts: number) => {
      if (startTs === null) startTs = ts;
      const t = Math.min(1, (ts - startTs) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValue(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, animate, durationMs]);
  return value;
}

// Shared share/copy/replay glyphs, so the action buttons stay one-line.
const shareIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);
const pgnIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const reelIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

export function GameOver({
  result,
  myColor,
  myNerf,
  opponentNerf,
  ratingChange,
  ratingMode,
  mode,
  record,
  rank,
  onRematch,
  rematchStatus = "none",
  opponentLeft = false,
  onCancelRematch,
  opponentHidden = false,
  moves,
  onClip,
  cardEvents,
  playerNames,
  startedAt,
  onDismiss,
  gameId,
  serverGameId,
  profiles,
  newOpponentHref,
  myBuffs,
  opponentBuffs,
  spectator = false,
}: Props) {
  const [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => {
    if (onDismiss) onDismiss();
    else setDismissed(true);
  }, [onDismiss]);
  // Body scroll lock, Escape, and the ghost-click guard. The guard matters
  // most here: the winning move commits on pointerdown and this panel mounts
  // in the same frame, so on touch the finishing tap's trailing synthesized
  // mouse event landed on the brand-new backdrop and dismissed the result
  // screen instantly (Board.tsx documents the same hazard for its promotion
  // picker).
  const chrome = useModalChrome(!dismissed, dismiss);
  const { attachDialog } = chrome;
  const [shared, setShared] = useState(false);
  const [pgnCopied, setPgnCopied] = useState(false);
  // The "Shared" / "Copied" flashes reset on a timer; cleared on unmount so a
  // late tick never sets state on a gone component.
  const sharedTimer = useRef<number | null>(null);
  const pgnCopiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (sharedTimer.current != null) window.clearTimeout(sharedTimer.current);
      if (pgnCopiedTimer.current != null) window.clearTimeout(pgnCopiedTimer.current);
    },
    [],
  );
  // Guests get one quiet post-game nudge to keep what they just earned; it
  // never blocks the actions below. Spectators are never nudged here.
  const [isGuest, setIsGuest] = useState(false);
  useEffect(() => {
    if (spectator) return;
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (!cancelled) setIsGuest(!!me?.isGuest);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [spectator]);
  const [oppRevealed, setOppRevealed] = useState(!opponentHidden);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const reduceMotion = useReducedMotion();
  const draw = result.winner === "draw";
  // An aborted game has no winner at all (null, not "draw"): nobody scores
  // and no rating moved, so the screen stays neutral for everyone.
  const aborted = result.winner === null;
  const won = result.winner === myColor;
  const oppColor: Color = myColor === "w" ? "b" : "w";
  const names = playerNames ?? { w: "White", b: "Black" };
  const sideLabel = (c: Color) => (c === "w" ? "White" : "Black");
  const winnerColor = draw || aborted ? null : (result.winner as Color);
  // A spectator has no seat, so the headline is neutral: name the winning side
  // rather than reading it as the viewer's Victory/Defeat. Players keep the
  // seat-relative wording.
  const outcome = aborted
    ? "Aborted"
    : spectator
    ? draw
      ? "Draw"
      : `${sideLabel(winnerColor as Color)} wins`
    : draw
    ? "Draw"
    : won
    ? "Victory"
    : "Defeat";
  // Draws carry their cause in the reason ("draw by agreement", "draw by
  // threefold repetition", ...); surface it instead of assuming agreement.
  const headline = aborted
    ? "The game ended before it began"
    : spectator
    ? draw
      ? `${names.w} (White) and ${names.b} (Black) share the point`
      : `${names[winnerColor as Color]} (${sideLabel(winnerColor as Color)}) defeated ${
          names[winnerColor === "w" ? "b" : "w"]
        } (${sideLabel(winnerColor === "w" ? "b" : "w")})`
    : draw
    ? result.reason.charAt(0).toUpperCase() + result.reason.slice(1)
    : result.winner === "w"
    ? "White wins"
    : "Black wins";
  // The winner's side always reads celebratory (gold); the losing tone only
  // applies to a seated player who actually lost.
  const tone =
    draw || aborted ? "text-bruise-glow" : spectator || won ? "text-gold-leaf" : "text-oxblood-glow";
  const { nerfName, cause } = useMemo(() => splitReason(result.reason), [result.reason]);
  // One reason sentence, consistent by construction with the outcome above it:
  // a rule-caused ending keeps the rule name inline ("Lucky: checkmate"), never
  // as a floating chip and never with a viewer-relative "Lost:" prefix (which
  // read as a contradiction under a Victory headline). The rules themselves
  // live only in the reveals section below.
  const reasonSentence = useMemo(() => {
    const text = nerfName ? `${nerfName}: ${cause}` : cause;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }, [nerfName, cause]);
  const ratingDelta = ratingChange ? Math.round(ratingChange.after - ratingChange.before) : 0;
  const ratingNow = useCountUp(
    ratingChange ? Math.round(ratingChange.before) : 0,
    ratingChange ? Math.round(ratingChange.after) : 0,
    !reduceMotion && !!ratingChange,
  );
  // One feedback row per buff id, even if copies were drafted (Mirror etc.);
  // the server keys votes per player per buff anyway.
  const ratableBuffs = useMemo(() => {
    const seen = new Set<string>();
    return (myBuffs ?? []).filter((b) => {
      if (seen.has(b.id) || !BUFF_BY_ID[b.id]) return false;
      seen.add(b.id);
      return true;
    });
  }, [myBuffs]);
  // The opponent's drafted cards, deduped and dropping any that stayed masked
  // (an empty id the server never revealed), shown as a plain reveal list.
  const revealedOppBuffs = useMemo(() => {
    const seen = new Set<string>();
    return (opponentBuffs ?? []).filter((b) => {
      if (seen.has(b.id) || !BUFF_BY_ID[b.id]) return false;
      seen.add(b.id);
      return true;
    });
  }, [opponentBuffs]);

  const modeChip = mode === "nerf" || mode === "buff";

  // Share copies a short text summary of the game (result plus both rules) to
  // the clipboard. It works client side today; a hosted replay link can be
  // dropped in later without changing the button.
  const handleShare = async () => {
    const lines = [
      `Nerf Chess: ${outcome}`,
      myNerf ? `My rule: ${myNerf.name} (${myNerf.description})` : null,
      opponentNerf && oppRevealed
        ? `Opponent rule: ${opponentNerf.name} (${opponentNerf.description})`
        : null,
      typeof window !== "undefined" ? window.location.origin : "https://nerfchess.com",
    ].filter(Boolean);
    const text = lines.join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
      }
      setShared(true);
      if (sharedTimer.current != null) window.clearTimeout(sharedTimer.current);
      sharedTimer.current = window.setTimeout(() => setShared(false), 2000);
    } catch {
      // User dismissed the share sheet or clipboard was blocked; ignore.
    }
  };

  // Copy PGN honors the hidden-rule setting: the opponent's nerf appears in
  // the export only once it has been revealed on screen.
  const handleCopyPGN = async () => {
    if (!moves) return;
    const myNerfName = myNerf?.name ?? null;
    const oppNerfName = oppRevealed ? opponentNerf?.name ?? null : null;
    const pgn = gameToPGN({
      moves,
      result,
      white: playerNames?.w,
      black: playerNames?.b,
      whiteNerf: myColor === "w" ? myNerfName : oppNerfName,
      blackNerf: myColor === "b" ? myNerfName : oppNerfName,
      startedAt,
    });
    try {
      await navigator.clipboard.writeText(pgn);
      setPgnCopied(true);
      if (pgnCopiedTimer.current != null) window.clearTimeout(pgnCopiedTimer.current);
      pgnCopiedTimer.current = window.setTimeout(() => setPgnCopied(false), 2000);
    } catch {
      // Clipboard blocked; ignore.
    }
  };

  // Deep link into the analysis board with the whole game replayed, when the
  // analysis route (which reads ?moves=<uci csv>) can take it. A draft game
  // is never offered: cards move, summon, and remove pieces outside the move
  // list, so a plain UCI replay would stop early or diverge from what was
  // actually played. The draft mode chip, the held cards, and the card
  // timeline are the signals this panel already has for that.
  const cardGame =
    mode === "buff" || !!myBuffs?.length || !!opponentBuffs?.length || !!cardEvents?.length;
  const analysisHref = useMemo(() => {
    if (cardGame || !moves || moves.length === 0) return null;
    return `/analysis?moves=${moves.map(moveToUCI).join(",")}`;
  }, [cardGame, moves]);

  // Every seat links to its profile; house accounts have real profile pages.
  const linkedProfiles = useMemo(() => (profiles ?? []).filter((p) => p.href), [profiles]);

  useEffect(() => {
    const key = gameId ?? (startedAt != null ? `local:${startedAt}` : null);
    if (key) {
      if (playedGameOverKeys.has(key)) return;
      playedGameOverKeys.add(key);
    }
    // The result screen is the one place that knows how the game ended from
    // THIS seat, so it voices the outcome rather than the neutral dong: a
    // rising fanfare for a win, a soft fall for a loss, an unresolved pair for
    // a draw. A spectator holds no seat and an abort has no winner, so both
    // keep the neutral voice (passing "loss" to a watcher would be a lie).
    playGameOver(spectator || aborted ? undefined : won ? "win" : draw ? "draw" : "loss");
    // Victory earns a short success pulse on devices that support haptics.
    if (won && !spectator) haptic("success");
    // Mount-only by design: the key identifies the game, not a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (dismissed) return;
    primaryRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismissed, dismiss]);

  if (dismissed) return null;

  const recordLine = record ? `now ${record.wins}W ${record.losses}L ${record.draws}D` : null;

  return (
    <motion.div
      ref={attachDialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
      aria-describedby="game-over-reason"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto overscroll-contain bg-[#0f0d0a]/80 px-4 py-6"
      onPointerDown={chrome.onBackdropPointerDown}
    >
      {/* Level-3 victory beat: one energy ring blooms behind the panel while
          sparks in the four energy hues climb and die. Winners only, one
          shot, never under reduced motion. */}
      {won && !spectator && !draw && !reduceMotion && (
        <span aria-hidden className="victory-burst">
          <i className="victory-burst__ring" />
          <i className="victory-burst__ring victory-burst__ring--echo" />
          {Array.from({ length: 12 }).map((_, i) => (
            <i
              key={i}
              style={{
                ["--vx" as string]: `${8 + ((i * 61) % 84)}%`,
                ["--vdelay" as string]: `${(i % 6) * 90}ms`,
                ["--spark-rgb" as string]: [
                  "244 196 48",
                  "168 119 216",
                  "34 211 238",
                  "255 138 52",
                ][i % 4],
              }}
              className="victory-burst__spark"
            />
          ))}
        </span>
      )}
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { y: 16, scale: 0.96, opacity: 0 }}
        animate={reduceMotion ? { opacity: 1 } : { y: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="plate plate-raised relative w-[min(94vw,30rem)] max-h-[calc(100dvh-3rem)] overflow-y-auto p-6 text-center sm:p-7"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="card-corner tl" />
        <span className="card-corner tr" />
        <span className="card-corner bl" />
        <span className="card-corner br" />
        {!reduceMotion && (
          <motion.div
            aria-hidden="true"
            className={
              "pointer-events-none absolute inset-x-0 top-0 h-px " +
              (draw
                ? "bg-bruise-glow/60"
                : spectator || won
                ? // The win beat is the site's signature: the Nerf→Buff seam
                  // sweeps once across the top edge, warm into cool.
                  "bg-gradient-to-r from-mode-nerf via-parchment-100/60 to-mode-buff"
                : "bg-oxblood-glow/80")
            }
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: [0, 1, 0.45], scaleX: 1 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
        )}

        <div className="flex items-center justify-center gap-2">
          <p>Game over</p>
          {modeChip && (
            <span
              className={
                "inline-flex items-center rounded-[1px] border px-2 py-0.5 text-[12px] leading-none " +
                (mode === "nerf"
                  ? "border-mode-nerf/40 bg-mode-nerf/10 text-mode-nerfGlow"
                  : "border-mode-buff/40 bg-mode-buff/10 text-mode-buffGlow")
              }
            >
              {mode === "nerf" ? "Nerf" : "Buff"}
            </span>
          )}
        </div>
        <h2 id="game-over-title" className={`mt-1 font-display text-5xl font-bold leading-none ${tone}`}>
          {outcome}
        </h2>
        <p className="mt-2 text-sm text-parchment-300">{headline}</p>

        <p
          id="game-over-reason"
          className="mx-auto mt-4 max-w-sm text-balance text-base leading-relaxed text-parchment"
        >
          {reasonSentence}
        </p>

        {(ratingChange || recordLine || rank != null) && (
          <div className="mt-5 flex flex-col items-center gap-1.5">
            {ratingChange && (
              <div className="inline-flex items-center gap-2 rounded-sm border border-gold/25 bg-gold/5 px-3 py-2 font-mono text-sm">
                <span className="text-xs text-parchment-400">
                  {ratingMode === "nerf" ? "Nerf rating" : ratingMode === "buff" ? "Buff rating" : "Rating"}
                </span>
                <span className="text-parchment tabular">
                  {Math.round(ratingNow)}
                  {ratingChange.provisional ? "?" : ""}
                </span>
                <span
                  className={"tabular " + (ratingDelta >= 0 ? "text-gold-leaf" : "text-oxblood-glow")}
                >
                  {ratingDelta >= 0 ? "+" : ""}
                  {ratingDelta}
                </span>
              </div>
            )}
            {(recordLine || rank != null) && (
              <div className="flex items-center justify-center gap-x-3 gap-y-0.5 text-xs text-parchment-300">
                {recordLine && <span className="tabular">{recordLine}</span>}
                {recordLine && rank != null && (
                  <span aria-hidden className="text-parchment-500">
                    ·
                  </span>
                )}
                {rank != null && (
                  <span className="tabular">
                    Rank <span className="text-gold-leaf">#{rank}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {(myNerf || opponentNerf) && (
          <SummaryFold
            label="Rules this game"
            count={(myNerf ? 1 : 0) + (opponentNerf ? 1 : 0)}
            hint={!spectator && opponentNerf && !oppRevealed ? "opponent's still sealed" : undefined}
          >
          <div className="grid gap-2 sm:grid-cols-2">
            {myNerf && (
              <RuleReveal
                label={spectator ? `${names[myColor]} (${sideLabel(myColor)})` : "Your rule"}
                nerf={myNerf}
              >
                {!spectator && <RuleFeedback nerfId={myNerf.id} gameId={gameId} />}
              </RuleReveal>
            )}
            {opponentNerf &&
              (spectator || oppRevealed ? (
                <RuleReveal
                  label={spectator ? `${names[oppColor]} (${sideLabel(oppColor)})` : "Opponent rule"}
                  nerf={opponentNerf}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setOppRevealed(true)}
                  className="flex min-h-[6.5rem] flex-col items-center justify-center gap-2 border border-[color:var(--edge)] bg-ink-900/40 p-3 text-parchment-200 transition hover:border-gold/50 hover:bg-gold/10 hover:text-gold-leaf"
                >
                  <span
                    aria-hidden
                    className="grid h-8 w-8 place-items-center rounded-full border border-gold/40 bg-gold/10 font-display text-lg font-bold text-gold"
                  >
                    ?
                  </span>
                  <span className="font-display text-sm font-semibold">
                    Reveal opponent&apos;s nerf
                  </span>
                </button>
              ))}
          </div>
          </SummaryFold>
        )}

        {/* Cards drafted: the grouped summary (compact tier chips with
            spent/nullified/active state, passives-active-first) folds behind a
            counted disclosure row. Spectators see both sides read-only; a
            seated player sees the opponent's cards and their own with the
            balance-vote thumbs — the "Rate the balance" invitation rides the
            summary row so voting stays discoverable while folded. */}
        {(ratableBuffs.length > 0 || revealedOppBuffs.length > 0) && (
          <SummaryFold
            label="Cards drafted"
            count={ratableBuffs.length + revealedOppBuffs.length}
            hint={!spectator && ratableBuffs.length > 0 ? "rate the balance" : undefined}
          >
            {spectator ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <DraftedGroup
                  label={`${names[myColor]} (${sideLabel(myColor)})`}
                  buffs={ratableBuffs}
                />
                <DraftedGroup
                  label={`${names[oppColor]} (${sideLabel(oppColor)})`}
                  buffs={revealedOppBuffs}
                />
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {ratableBuffs.length > 0 && (
                  <DraftedGroup
                    label="Cards you drafted"
                    hint="Rate the balance"
                    buffs={ratableBuffs}
                    votable
                    gameId={gameId}
                  />
                )}
                {revealedOppBuffs.length > 0 && (
                  <DraftedGroup label="Opponent's cards" buffs={revealedOppBuffs} />
                )}
              </div>
            )}
          </SummaryFold>
        )}

        <MatchTimeline moves={moves} cardEvents={cardEvents} />

        {opponentLeft && (
          <p
            role="status"
            className="mt-5 flex items-center justify-center gap-2 text-xs text-oxblood-glow"
          >
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-oxblood-glow" />
            Opponent left the game
            {rematchStatus === "offered" ? ": your rematch offer has nobody to answer it." : "."}
          </p>
        )}

        {spectator ? (
          // No seat, so no rematch or new opponent: both players' profiles
          // prominent, then Close/Share, then the quiet way out.
          <div className="mt-6 flex flex-col gap-2">
            {linkedProfiles.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {linkedProfiles.map((p) => (
                  <LinkButton tone="ghost"
                    key={p.href}
                    href={p.href}
                    className="px-4 py-2 text-sm">
                    {p.name}
                  </LinkButton>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button tone="leaf"
                ref={primaryRef}
               
                onClick={dismiss}
                className="px-5 py-2.5">
                Close
              </Button>
              <Button tone="ghost"
               
                onClick={handleShare}
                className="px-5 py-2.5 text-sm">
                {shareIcon}
                {shared ? "Copied" : "Share game"}
              </Button>
              {analysisHref && (
                <LinkButton tone="ghost"
                  href={analysisHref}
                  className="px-4 py-2 text-sm">
                  Analyze
                </LinkButton>
              )}
              {moves && (
                <Button tone="ghost"
                 
                  onClick={handleCopyPGN}
                  className="px-5 py-2.5 text-sm">
                  {pgnIcon}
                  {pgnCopied ? "Copied" : "Copy PGN"}
                </Button>
              )}
            </div>
            <Link
              href="/tv"
              className="mx-auto mt-1 inline-flex min-h-[44px] items-center px-2 text-[13px] text-parchment-300 hover:text-gold-leaf hover:underline"
            >
              Watch another game
            </Link>
          </div>
        ) : (
          <>
            {/* The reel entry rides the emotional peak: right under the
                verdict, before the routine actions (marketing plan Phase 0).
                Gold, because a ready-to-post highlight of the game you just
                lived through is a reward, not a routine action. */}
            {onClip && (
              <Button
                tone="gold"
                onClick={onClip}
                data-share-reel
                block
                className="zen-hide mt-6 px-5 py-2.5 font-semibold"
              >
                {reelIcon}
                Share reel
              </Button>
            )}
            <div className={`${onClip ? "mt-2" : "mt-6"} grid grid-cols-2 gap-2`}>
              {rematchStatus === "offered" && onCancelRematch ? (
                // The Rematch button is disabled while an offer is out, so the
                // cancel control is the only way back (not just when the
                // opponent is gone).
                <Button tone="ghost"
                  ref={primaryRef}
                 
                  onClick={onCancelRematch}
                  className="px-5 py-2.5">
                  Cancel rematch offer
                </Button>
              ) : (
                <Button
                  tone={rematchStatus === "offered" ? "ghost" : "leaf"}
                  ref={primaryRef}
                  onClick={onRematch}
                  disabled={rematchStatus === "offered"}
                  className={
                    "px-5 py-2.5 " +
                    (rematchStatus === "offered"
                      ? "opacity-70 cursor-default"
                      : rematchStatus === "incoming"
                        ? "animate-flicker"
                        : "")
                  }
                >
                  {rematchStatus === "offered"
                    ? "Rematch offered…"
                    : rematchStatus === "incoming"
                    ? "Accept rematch"
                    : "Rematch"}
                </Button>
              )}
              <LinkButton tone="ghost"
                href={newOpponentHref ?? "/lobby?tab=quick"}
                className="px-5 py-2.5">
                New opponent
              </LinkButton>
            </div>

            {/* Secondary actions: Share, Analyze, the archived replay, PGN,
                and both players' profiles (real usernames). One entry each;
                the move-review entry point lives in the game view, and the
                reel entry is the gold action above.
                zen-hide: these are the social/sharing extras, so zen mode
                stands them down and leaves Rematch and New opponent. */}
            <div className="zen-hide mt-2 grid grid-cols-2 gap-2">
              <Button tone="ghost"
               
                onClick={handleShare}
                className="px-4 py-2 text-sm">
                {shareIcon}
                {shared ? "Copied" : "Share game"}
              </Button>
              {analysisHref && (
                <LinkButton tone="ghost"
                  href={analysisHref}
                  className="px-4 py-2 text-sm">
                  Analyze
                </LinkButton>
              )}
              {serverGameId && (
                <LinkButton tone="ghost"
                  href={`/game/${serverGameId}`}
                  className="px-4 py-2 text-sm">
                  Watch replay
                </LinkButton>
              )}
              {moves && (
                <Button tone="ghost"
                 
                  onClick={handleCopyPGN}
                  className="px-4 py-2 text-sm">
                  {pgnIcon}
                  {pgnCopied ? "Copied" : "Copy PGN"}
                </Button>
              )}
              {linkedProfiles.map((p) => (
                <LinkButton tone="ghost"
                  key={p.href}
                  href={p.href}
                  className="px-4 py-2 text-sm">
                  {p.name}
                </LinkButton>
              ))}
            </div>

            {/* Quiet ways out: plain text links, not more boxes. */}
            <div className="mt-3 flex items-center justify-center gap-4">
              <Link
                href="/lobby"
                className="inline-flex min-h-[44px] items-center px-2 text-[13px] text-parchment-300 hover:text-gold-leaf hover:underline"
              >
                Back to lobby
              </Link>
              <span aria-hidden className="text-parchment-500">
                ·
              </span>
              <Link
                href="/tv"
                className="inline-flex min-h-[44px] items-center px-2 text-[13px] text-parchment-300 hover:text-gold-leaf hover:underline"
              >
                Watch another game
              </Link>
            </div>

            {isGuest && (
              <p className="mt-4 border-t border-[color:var(--edge)] pt-3 text-xs text-parchment-400">
                <Link href="/login?upgrade=1" className="text-gold-leaf hover:underline">
                  Create an account
                </Link>{" "}
                to save your rating and game history.
              </p>
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
