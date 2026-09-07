"use client";

// React binding for the draft lifecycle state machine (draftSequence.ts).
//
// One hook instance per game surface. It owns a DraftSequence for the offer
// currently on the table and turns the two real completion signals the
// surfaces have into machine transitions:
//
//   1. "the board's spectacles finished" (the signature queue went idle)
//      gates ANIMATIONS_PLAYING -> CARDS_PREPARING, which is when the draft
//      overlay is allowed to mount at all;
//   2. "both cards are dealt, painted, and interactive" (DraftOverlay's
//      onCardsReady) gates CARDS_PREPARING -> CARDS_READY, at which point the
//      decision countdown is armed with its FULL duration.
//
// Both gates carry watchdog caps inside the machine, so a lost animation
// event delays the draft by at most a few seconds instead of blocking it.
// A reroll (offer key change) restarts preparation and earns a complete
// fresh window. An offer that is already running on the player's own clock
// (the decision window expired, e.g. restored from a save or a reconnect)
// skips the hold entirely: the compact pending panel must show immediately
// and no new countdown is ever armed for it.
//
// ONE COMMIT, NOT TWO (C49). The machine lives in an effect, so mirroring its
// phase into React state costs a second commit: the board painted, its passive
// effects flushed, a microtask carried the phase into the scheduler, and only
// then did the overlay render. At game start there is nothing to wait for —
// `animationsBusy` is false from the very first render — so the whole detour
// bought an empty "Resolving effects" window. The phase is therefore DERIVED
// during render (`deriveDraftPhase`) for an offer version the machine has not
// adopted yet, so a brand-new offer on a quiet board lands in the SAME commit
// as the board: hydration to the overlay being in the DOM went from 435ms to
// 228ms median (five interleaved runs each, dev, `node
// scripts/measure-draft-open.mjs`), and the offer's own first render now
// contains the overlay instead of one arriving ~270ms later. Two properties
// make that safe:
//
//   * the mirrored phase is TAGGED with the offer version it describes, so
//     "this offer has not opened yet" and "this offer is finished" are
//     different states even though both read DRAFT_COMPLETE. A derivation on
//     the phase alone flashes the overlay back on after a pick, in the window
//     before the parent clears the offer;
//   * the cards-ready report is LATCHED (`CardsReadyGate`). Child effects run
//     before parent effects, so an overlay mounted in the same commit as the
//     machine can report `onCardsReady` before the machine has adopted the
//     key and armed the signal. Dropping that report as stale would strand
//     the draft until the 12s CARDS_READY_CAP_MS watchdog fired.

import { useEffect, useRef, useState } from "react";
import { DraftSequence, type DraftPhase } from "./draftSequence";

/** Cap on waiting for board spectacles before the draft proceeds anyway. */
const ANIMATIONS_SETTLE_CAP_MS = 7000;
/** Cap on waiting for the overlay's cards-ready report (unmounted overlay,
 * crashed animation) before the countdown arms anyway. */
const CARDS_READY_CAP_MS = 12000;

/** True for the phases during which the draft overlay is on screen. */
export function isDraftOverlayPhase(phase: DraftPhase): boolean {
  return (
    phase === "CARDS_PREPARING" ||
    phase === "CARDS_READY" ||
    phase === "DRAFT_DECIDING" ||
    phase === "DRAFT_CONFIRMING" ||
    phase === "SELECTION_ANIMATING"
  );
}

/**
 * A machine phase together with the offer version it describes. The tag is
 * what makes "the machine has not started this offer yet" distinguishable
 * from "the machine finished this offer": both read DRAFT_COMPLETE, and only
 * the first may open the overlay.
 */
export interface DraftPhaseSnapshot {
  /** Offer version this phase belongs to; null before any draft has run. */
  key: string | null;
  phase: DraftPhase;
}

export const IDLE_DRAFT_SNAPSHOT: DraftPhaseSnapshot = { key: null, phase: "DRAFT_COMPLETE" };

/**
 * The phase to render RIGHT NOW for `offerKey`.
 *
 * When the snapshot already describes this offer version, it is the truth —
 * including a finished one, which is how a confirmed draft is kept from
 * flashing the overlay back on while the parent still has the offer in hand.
 * Otherwise the machine has not adopted this offer version yet (its effect
 * runs after this render commits), and the phase is predicted from the same
 * two inputs the effect will use: a quiet board (or an offer already running
 * on the player's clock) goes straight to CARDS_PREPARING, so the overlay
 * mounts in this commit; a busy board holds at ANIMATIONS_PLAYING exactly as
 * the machine will.
 */
export function deriveDraftPhase(
  snapshot: DraftPhaseSnapshot,
  offerKey: string | null,
  animationsBusy: boolean,
  onClock: boolean,
): DraftPhase {
  if (snapshot.key === offerKey) return snapshot.phase;
  if (offerKey == null) return "DRAFT_COMPLETE";
  return animationsBusy && !onClock ? "ANIMATIONS_PLAYING" : "CARDS_PREPARING";
}

/**
 * The cards-ready handshake between the overlay and the machine, with a latch.
 *
 * React runs a child's effects BEFORE its parent's, so an overlay that mounts
 * in the same commit that hands the offer to the machine can report its cards
 * ready before `arm` has registered the signal to resolve. The report is then
 * remembered and honoured the moment the signal is armed, instead of being
 * dropped as stale and leaving the 12 second watchdog to arm the countdown.
 *
 * Only the offer version that was reported is honoured: a latch belonging to
 * any other version is dropped by `retarget`, so a stale report from an offer
 * that has been replaced can never satisfy the next one.
 */
export class CardsReadyGate {
  private resolve: (() => void) | null = null;
  private armedKey: string | null = null;
  private latchedKey: string | null = null;

  /** The machine adopted `key` (or lost its offer): drop a stale resolver and
   * any latch that belongs to a different offer version. */
  retarget(key: string | null): void {
    this.resolve = null;
    this.armedKey = null;
    if (this.latchedKey !== key) this.latchedKey = null;
  }

  /** Register this offer version's cards-ready signal. Returns whether a
   * report for this version had already arrived. */
  arm(key: string, resolve: () => void): "armed" | "honoured-latch" {
    if (this.latchedKey === key) {
      // The cards for THIS offer version are already ready: resolve at once
      // rather than leaving the watchdog cap to do it 12 seconds from now.
      resolve();
      return "honoured-latch";
    }
    this.armedKey = key;
    this.resolve = resolve;
    return "armed";
  }

  /** The overlay reported both cards dealt, painted and interactive. */
  report(key: string): "resolved" | "latched" {
    // Remembered for the life of this offer version (dropped by `retarget`),
    // so a signal armed again for the same cards — the machine effect running
    // a second time under StrictMode's simulated remount — is satisfied
    // immediately instead of waiting for a report that will not come again.
    this.latchedKey = key;
    if (key === this.armedKey && this.resolve) {
      const resolve = this.resolve;
      this.resolve = null;
      this.armedKey = null;
      resolve();
      return "resolved";
    }
    // Either the machine has not adopted this offer version yet (child effects
    // run before parent effects), or it has but has not armed the signal.
    return "latched";
  }
}

// --- Opening-arc instrumentation (C49) --------------------------------------
// Opt in with ?perf=1, the same switch src/app/game/page.tsx uses. Off, this is
// a dead branch on a module constant. On, it records the cards-ready handshake
// and the machine's stalls in window.__draftSeq so a harness can see whether a
// report arrived before the machine armed (and was honoured) rather than
// inferring it from timings.
const PROBE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("perf") === "1";
function probe(n: string) {
  if (!PROBE) return;
  try {
    const w = window as unknown as { __draftSeq?: Array<{ n: string; t: number }> };
    (w.__draftSeq ??= []).push({ n, t: performance.now() });
  } catch {
    // instrumentation must never break the draft
  }
}

export interface UseDraftSequenceOptions {
  /** Identity of the live offer version (`${index}:${rerolled}`); null when
   * no draft is open. A key change with a draft still open is a reroll (or a
   * re-dealt offer) and restarts preparation. */
  offerKey: string | null;
  /** True while board spectacles (card plays, captures) are still playing. */
  animationsBusy: boolean;
  /** True when this offer's decision window has already expired and the
   * draft runs on the player's clock. */
  onClock: boolean;
  /** Full decision window granted once the cards are ready. */
  decisionMs?: number;
  /** Arm the countdown at this absolute deadline (epoch ms). */
  onDecisionStart: (deadline: number) => void;
  /** A fresh offer version entered preparation: clear any armed countdown. */
  onPrepStart?: () => void;
}

export interface DraftSequenceHandle {
  /** Current machine phase (DRAFT_COMPLETE when no draft is open). */
  phase: DraftPhase;
  /** True once the draft overlay may render (animations settled). */
  overlayVisible: boolean;
  /** Pass to DraftOverlay's onCardsReady. */
  reportCardsReady: (offerKey: string) => void;
  /** Optional: surfaces may report the pick/bank commit for telemetry. */
  noteConfirmed: () => void;
}

/** Mirror a machine phase into React state, tagged with the offer version it
 * belongs to. Always through a microtask, so no transition ever writes state
 * inside an effect body (transitions fire synchronously from effects and from
 * async continuations alike); microtask order preserves transition order. */
function mirrorPhase(
  setSnapshot: (update: (prev: DraftPhaseSnapshot) => DraftPhaseSnapshot) => void,
  key: string | null,
  phase: DraftPhase,
) {
  queueMicrotask(() =>
    setSnapshot((prev) => (prev.key === key && prev.phase === phase ? prev : { key, phase })),
  );
}

export function useDraftSequence(opts: UseDraftSequenceOptions): DraftSequenceHandle {
  const { offerKey, animationsBusy, onClock, decisionMs = 20_000 } = opts;
  const [snapshot, setSnapshot] = useState<DraftPhaseSnapshot>(IDLE_DRAFT_SNAPSHOT);
  const seqRef = useRef<DraftSequence | null>(null);
  const keyRef = useRef<string | null>(null);
  // Latest values readable from stable callbacks without effect churn.
  // Synced in an effect (never during render); declared BEFORE the machine
  // effect below so the sync always runs first in the same commit.
  const busyRef = useRef(animationsBusy);
  const onClockRef = useRef(onClock);
  const optsRef = useRef(opts);
  useEffect(() => {
    busyRef.current = animationsBusy;
    onClockRef.current = onClock;
    optsRef.current = opts;
  });
  // whenIdle-style listeners waiting for the busy flag to drop.
  const idleWaitersRef = useRef<(() => void)[]>([]);
  // The cards-ready handshake for the current offer version, with the latch
  // that makes an early report (child effects before parent effects) safe.
  const gateRef = useRef(new CardsReadyGate());

  // Notify idle waiters whenever the busy flag drops.
  useEffect(() => {
    if (animationsBusy) return;
    const waiters = idleWaitersRef.current;
    idleWaitersRef.current = [];
    for (const w of waiters) w();
  }, [animationsBusy]);

  // Drive the machine for the current offer key. The extra seqRef check
  // matters under React StrictMode's simulated unmount/remount in dev: the
  // unmount cleanup disposes the machine while keyRef (a ref) survives, so a
  // bare key-equality guard would leave the draft with no machine at all.
  // A matching key with a missing machine rebuilds it instead.
  useEffect(() => {
    if (offerKey === keyRef.current && (offerKey == null || seqRef.current != null)) return;
    const prevKey = keyRef.current;
    keyRef.current = offerKey;
    const gate = gateRef.current;
    gate.retarget(offerKey);

    if (offerKey == null) {
      // Draft resolved (or gone): walk the tail and retire the machine.
      const seq = seqRef.current;
      if (seq) {
        seq.to("RETURNING_TO_GAME");
        seq.to("DRAFT_COMPLETE");
        seq.dispose();
        seqRef.current = null;
      }
      // Tagged with the offer version that just FINISHED, not with null: the
      // parent may still be holding that offer for a beat (a pick's flight, a
      // server echo), and an untagged DRAFT_COMPLETE there is indistinguishable
      // from "a new draft the machine has not started", which would flash the
      // overlay straight back open. Queued last, so it wins over the tail
      // transitions above.
      mirrorPhase(setSnapshot, prevKey, "DRAFT_COMPLETE");
      return;
    }

    const armPreparation = (seq: DraftSequence) => {
      optsRef.current.onPrepStart?.();
      // Cards-ready signal for THIS offer version, capped so a lost report
      // (overlay unmounted mid-deal, animation error) can never park the
      // draft in preparation forever. An overlay that mounted in this very
      // commit may already have reported: the gate latched it and resolves
      // the signal now.
      const ready = new Promise<void>((resolve) => {
        probe(`arm:${gate.arm(offerKey, resolve)}`);
      });
      seq.track("cards-ready", ready, CARDS_READY_CAP_MS);
      void seq.advanceWhenSettled("CARDS_READY").then((ok) => {
        if (!ok || seqRef.current !== seq) return;
        // The full decision window opens NOW, after every animation. An
        // offer already running on the player's clock gets no new window.
        if (!onClockRef.current) {
          const deadline = seq.startDecision(optsRef.current.decisionMs ?? decisionMs);
          if (deadline != null) optsRef.current.onDecisionStart(deadline);
        } else {
          seq.to("DRAFT_DECIDING");
        }
      });
    };

    if (prevKey != null && seqRef.current) {
      // Reroll / re-dealt offer: same draft moment, fresh presentation and a
      // fresh full window once the new cards are ready.
      const seq = seqRef.current;
      seq.restartPreparation();
      armPreparation(seq);
      return;
    }

    // Brand-new draft: fresh machine.
    const seq = new DraftSequence({
      onPhase: (p) => mirrorPhase(setSnapshot, keyRef.current, p),
      onStall: (label, kind) => {
        // Diagnostics only: the sequence already recovered by design.
        probe(`stall:${label}:${kind}`);
        console.warn(`[draft-sequence] ${label} ${kind}; continuing`);
      },
    });
    seqRef.current = seq;
    seq.to("ANIMATIONS_PLAYING");

    if (onClockRef.current) {
      // Restored mid-expiry: the compact pending panel must appear at once.
      seq.to("CARDS_PREPARING");
      armPreparation(seq);
      return;
    }

    // Wait for the board's spectacles to finish before the overlay mounts.
    // Real signal: the signature queue's busy flag dropping; the cap keeps a
    // stuck queue from ever blocking the draft. A quiet board (the common
    // case) proceeds synchronously so the overlay never flashes a hold — and
    // `deriveDraftPhase` predicted exactly this during the render that led to
    // this commit, so the overlay is already on screen.
    if (!busyRef.current) {
      seq.to("CARDS_PREPARING");
      armPreparation(seq);
      return;
    }
    const idle = new Promise<void>((resolve) => {
      idleWaitersRef.current.push(resolve);
    });
    seq.track("board-animations", idle, ANIMATIONS_SETTLE_CAP_MS);
    void seq.advanceWhenSettled("CARDS_PREPARING").then((ok) => {
      if (!ok || seqRef.current !== seq) return;
      armPreparation(seq);
    });
  }, [offerKey, decisionMs]);

  // Unmount: never leave watchdogs running.
  useEffect(
    () => () => {
      seqRef.current?.dispose();
      seqRef.current = null;
    },
    [],
  );

  const reportCardsReady = (key: string) => {
    probe(`ready:${gateRef.current.report(key)}`);
  };

  const noteConfirmed = () => {
    seqRef.current?.to("DRAFT_CONFIRMING");
    seqRef.current?.to("SELECTION_ANIMATING");
  };

  // The machine's phase when it owns this offer version, predicted from the
  // same inputs it will use when it does not own it yet (C49: that prediction
  // is what puts the overlay in the board's own commit).
  const phase = deriveDraftPhase(snapshot, offerKey, animationsBusy, onClock);

  return {
    phase,
    overlayVisible: isDraftOverlayPhase(phase),
    reportCardsReady,
    noteConfirmed,
  };
}
