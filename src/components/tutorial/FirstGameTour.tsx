"use client";

// The "First Game" guided tour controller. Rendered by /tutorial/first-game
// NEXT TO the real game page component; it never touches the game. It listens
// for the tiny state snapshots the game page broadcasts with ?tour=1
// (TOUR_STATE_EVENT) and gates its steps on real play: the first-move step
// waits for an actual move, the draft step waits for the real draft overlay,
// and while that overlay owns the screen the coach card steps aside (a slim
// pick-vs-bank banner floats above the overlay instead).

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { GlossaryTerm } from "@/components/GlossaryTerm";
import { lookupEntry } from "@/lib/glossary";
import { TourCoachOverlay, type CoachStep } from "./TourCoachOverlay";
import {
  EMPTY_TOUR_STATE,
  TOUR_STATE_EVENT,
  markTutorialDone,
  type TourGameState,
} from "./tourState";

/** Inline glossary chip: hover/tap definition + a link into /guide/glossary. */
function Gloss({ term, fallback }: { term: string; fallback: string }) {
  return <GlossaryTerm term={term} definition={lookupEntry(term)?.def ?? fallback} />;
}

// Spotlight targets, resolved against the game page's existing DOM (stable
// hooks it already exposes — no game component was changed for positioning).
const BOARD = ["[data-board-measure]"] as const;
// The "Next draft in N moves" chip is the dock's first status row; below the
// lg breakpoint the dock lives in a drawer, so fall back to the whole dock
// and finally to a centered card (the copy stands alone either way).
const DRAFT_CHIP = ['[data-buff-dock] [role="status"]', "[data-buff-dock]"] as const;
const DOCK = ["[data-buff-dock]"] as const;

const STEPS: CoachStep[] = [
  {
    id: "welcome",
    kicker: "welcome",
    title: "Your first game",
    body: (
      <p>
        This is a real game against the easiest bot. Buff mode, no clock, nothing simulated.
        Take your time with each step. The tour points at each part of the game as it
        happens. Arrow keys step through it, and Escape leaves it whenever you like.
      </p>
    ),
  },
  {
    id: "king",
    kicker: "the one rule",
    title: "Capture the king",
    targetSelectors: BOARD,
    body: (
      <p>
        There is no checkmate and no stalemate here. You win by actually capturing the enemy
        king.{" "}
        <Gloss
          term="Check"
          fallback="A direct threat to capture the king, which you are never forced to answer."
        />{" "}
        carries no rule in this game. Kings may walk into danger, and both kings can even be
        in check at the same time. When you can take him, take him.
      </p>
    ),
  },
  {
    id: "first-move",
    kicker: "your turn",
    title: "Make your first move",
    targetSelectors: BOARD,
    waitLabel: "Waiting for your move…",
    body: (
      <p>
        You are White, so the board is yours. Tap a piece, or drag it, and the dots mark
        every square it can reach. Any move works. Play whatever feels natural, and take as
        long as you want.
      </p>
    ),
  },
  {
    id: "draft-counter",
    kicker: "the draft",
    title: "The draft counter",
    targetSelectors: DRAFT_CHIP,
    body: (
      <p>
        A{" "}
        <Gloss
          term="Draft"
          fallback="The recurring two-card offer: every 5 of your moves you pick one card or bank the offer."
        />{" "}
        fires every 5 of your moves. The hourglass chip counts down to it. When it reaches
        zero, both players are offered cards at the same time. On a phone this chip lives in
        the Buffs drawer along the bottom edge.
      </p>
    ),
  },
  {
    id: "banking",
    kicker: "pick or bank",
    title: "Banking an offer",
    targetSelectors: DRAFT_CHIP,
    body: (
      <p>
        When an offer opens you have two choices. Picking takes one of the cards right away.{" "}
        <Gloss
          term="Bank"
          fallback="Skip this offer entirely so your next draft rolls one tier higher."
        />{" "}
        takes nothing now, and in exchange your next draft rolls one tier higher, so patience
        buys stronger cards. Banking an offer that already holds a tier 8 card can even push
        the next one into the apex band.
      </p>
    ),
  },
  {
    id: "until-draft",
    kicker: "keep playing",
    title: "Play to your fifth move",
    targetSelectors: BOARD,
    waitLabel: "The draft fires after your 5th move…",
    body: (
      <p>
        Trade a few more moves with the bot, no rush. After your fifth move the card offer
        takes over the screen. The tour will step aside and let you choose.
      </p>
    ),
  },
  {
    id: "dock",
    kicker: "your arsenal",
    title: "The buff dock",
    targetSelectors: DOCK,
    body: (
      <p>
        Cards you draft land here.{" "}
        <Gloss term="Passive" fallback="A card that works on its own while you hold it." />{" "}
        cards work while you simply hold them.{" "}
        <Gloss
          term="Activated"
          fallback="A card you spend by hand with its Use button, usually costing your turn."
        />{" "}
        cards have a Use button, and spending one usually costs your turn, just like a move.
        The dock also keeps a ledger of every card the bot plays against you.
      </p>
    ),
  },
  {
    id: "auras",
    kicker: "reading the board",
    title: "Auras & badges",
    targetSelectors: BOARD,
    body: (
      <p>
        Cards leave visible marks on the board. Empowered pieces glow with an aura, frozen
        pieces wear an icy badge, and numbered counters show how many turns an effect has
        left. Hover or tap a marked piece to see exactly what is affecting it.
      </p>
    ),
  },
  {
    id: "finish",
    kicker: "that's the loop",
    title: "Move, draft, strike",
    nextLabel: "Finish tour",
    body: (
      <>
        <p>
          Move, draft every 5 moves, spend your cards, and take the king. Finish this game at
          your own pace. When you are ready:
        </p>
        <ul className="mt-3 space-y-1.5">
          <li>
            <FinishLink href="/guide/how-to-play">Read the full how-to-play guide</FinishLink>
          </li>
          <li>
            <FinishLink href="/codex">Browse every card in the codex</FinishLink>
          </li>
          <li>
            <FinishLink href="/lobby">Ready to play someone real? Enter the lobby</FinishLink>
          </li>
        </ul>
      </>
    ),
  },
];

function FinishLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-gold-leaf underline decoration-gold/40 underline-offset-2 transition-colors hover:text-gold-leaf hover:decoration-gold"
    >
      {children}
    </Link>
  );
}

// Step indices with gameplay gates (kept next to STEPS so they stay in sync).
const FIRST_MOVE = STEPS.findIndex((s) => s.id === "first-move");
const DRAFT_COUNTER = STEPS.findIndex((s) => s.id === "draft-counter");
const UNTIL_DRAFT = STEPS.findIndex((s) => s.id === "until-draft");
const DOCK_STEP = STEPS.findIndex((s) => s.id === "dock");
const FINISH = STEPS.length - 1;

export function FirstGameTour() {
  const [phase, setPhase] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // The player's draft overlay has opened at least once this tour.
  const [draftSeen, setDraftSeen] = useState(false);
  const [state, setState] = useState<TourGameState>(EMPTY_TOUR_STATE);

  useEffect(() => {
    const onState = (e: Event) => setState((e as CustomEvent<TourGameState>).detail);
    window.addEventListener(TOUR_STATE_EVENT, onState);
    return () => window.removeEventListener(TOUR_STATE_EVENT, onState);
  }, []);

  // Gameplay gates: steps that wait on the real game advance themselves.
  // Adjusted during render (React's "adjust state when inputs change"
  // pattern, used across the codebase) so the coach never paints a stale
  // step; every set is guarded, so it can't loop.
  const draftResolved = draftSeen || state.heldBuffs > 0 || state.banked;
  if (!dismissed) {
    if (state.over) {
      // The game ended (any time, any step): land on the finish card.
      if (phase !== FINISH) setPhase(FINISH);
    } else {
      if (state.offerOpen && phase <= UNTIL_DRAFT && !draftSeen) setDraftSeen(true);
      if (phase === FIRST_MOVE && state.myMoves >= 1) setPhase(DRAFT_COUNTER);
      // Resolved offer (picked or banked) — also satisfied instantly when a
      // refreshed mid-game already holds cards from an earlier draft.
      if (phase === UNTIL_DRAFT && !state.offerOpen && draftResolved) setPhase(DOCK_STEP);
    }
  }

  // Reaching the finish card counts as completion even if the player then
  // leaves through one of its links instead of the Finish button.
  useEffect(() => {
    if (phase === FINISH) markTutorialDone();
  }, [phase]);

  if (dismissed) return null;
  // Wait for the real game to exist (bootstrap/restore) before coaching.
  if (!state.ready) return null;

  // The draft overlay owns the screen: pause the coach card. The first time,
  // float a slim pick-vs-bank explainer above the overlay; later drafts (past
  // the dock step) need no banner — the coach simply resumes after.
  if (state.offerOpen && !state.over) {
    return phase <= UNTIL_DRAFT ? <DraftCoachBanner /> : null;
  }

  const gated =
    (phase === FIRST_MOVE && state.myMoves < 1) || (phase === UNTIL_DRAFT && !draftResolved);

  const skip = () => {
    markTutorialDone();
    setDismissed(true);
  };

  const next =
    phase === FINISH
      ? () => {
          markTutorialDone();
          setDismissed(true);
        }
      : gated
        ? undefined
        : () => setPhase((p) => Math.min(FINISH, p + 1));

  // Back skips over steps whose gate is already satisfied (they would
  // instantly re-advance) and is unavailable once the game is over.
  const backTarget = (() => {
    if (state.over) return null;
    for (let i = phase - 1; i >= 0; i--) {
      if (i === FIRST_MOVE && state.myMoves >= 1) continue;
      if (i === UNTIL_DRAFT && draftResolved) continue;
      return i;
    }
    return null;
  })();

  return (
    <TourCoachOverlay
      step={STEPS[phase]}
      index={phase}
      count={STEPS.length}
      onNext={next}
      onBack={backTarget != null ? () => setPhase(backTarget) : undefined}
      onSkip={skip}
    />
  );
}

/** Slim banner floated above the full-screen draft overlay the first time it
 * opens: explains picking vs banking without blocking the choice itself. */
function DraftCoachBanner() {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-3">
      <div
        role="status"
        className="plate max-w-md border border-gold/50 px-4 py-2.5 text-center shadow-xl"
      >
        <div className="text-[12px] text-gold-leaf">your first draft</div>
        <p className="mt-1 text-[13px] leading-snug text-parchment-200">
          <strong className="text-parchment">Pick</strong> a card to take it now, or{" "}
          <strong className="text-parchment">Bank</strong> to take nothing and make your next
          offer roll one tier higher. Banking away a tier 8 card can push the next offer into
          the apex band.
        </p>
      </div>
    </div>
  );
}
