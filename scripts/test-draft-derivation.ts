// Unit tests for the render-time half of the draft binding
// (src/lib/useDraftSequence.ts): `deriveDraftPhase` and `CardsReadyGate`.
//
// These pin the two hazards that make "open the overlay in the board's own
// commit" (backlog C49) safe, and they are deterministic by construction: the
// machine takes an injected clock and timer pair, so every wait here is a fake
// clock advance plus microtask flushes. No wall-clock sleeps anywhere.
//
//   TRAP 1  React runs a child's effects BEFORE its parent's, so an overlay
//           mounted in the same commit that hands the offer to the machine can
//           report `onCardsReady` before the machine has armed the signal.
//           Dropped, that report costs the full 12s CARDS_READY_CAP_MS before
//           the countdown arms. Latched, the machine reaches CARDS_READY at
//           once and no watchdog ever fires. Both are asserted below, the
//           unlatched behaviour as the counterfactual it is.
//
//   TRAP 2  DRAFT_COMPLETE is the phase BEFORE a draft opens and also the one
//           AFTER it resolves. A derivation on the phase alone flashes the
//           overlay back open after a pick, in the window before the parent
//           clears the offer, so the mirrored phase carries the offer version
//           it describes and only an unknown version may open the overlay.
//
// Run: npx tsx scripts/test-draft-derivation.ts
// (No npm script: package.json belongs to another owner this round.)

import assert from "node:assert/strict";
import { DraftSequence, type DraftPhase } from "../src/lib/draftSequence";
import {
  CardsReadyGate,
  IDLE_DRAFT_SNAPSHOT,
  deriveDraftPhase,
  isDraftOverlayPhase,
  type DraftPhaseSnapshot,
} from "../src/lib/useDraftSequence";

// --- tiny fake timer world (same shape as scripts/test-draft-sequence.ts) ----

class FakeClock {
  nowMs = 100_000;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private nextId = 1;
  now = () => this.nowMs;
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + Math.max(0, ms), fn });
    return id;
  };
  clearTimeout = (h: unknown): void => {
    this.timers.delete(h as number);
  };
  advance(ms: number) {
    const target = this.nowMs + ms;
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= target && t.at < dueAt) {
          dueAt = t.at;
          dueId = id;
        }
      }
      if (dueId == null) break;
      const t = this.timers.get(dueId)!;
      this.timers.delete(dueId);
      this.nowMs = Math.max(this.nowMs, t.at);
      t.fn();
    }
    this.nowMs = target;
  }
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

const CARDS_READY_CAP_MS = 12_000;

/**
 * The machine as the hook drives it, from a fresh offer on a quiet board up to
 * the cards-ready gate: exactly the sequence in `useDraftSequence`'s effect,
 * with the gate handed in so a test can choose the order of arm and report.
 */
function armedDraft(gate: CardsReadyGate | null) {
  const clock = new FakeClock();
  const stalls: string[] = [];
  const phases: DraftPhase[] = [];
  const seq = new DraftSequence({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onPhase: (p) => phases.push(p),
    onStall: (label, kind) => stalls.push(`${label}:${kind}`),
  });
  seq.to("ANIMATIONS_PLAYING");
  seq.to("CARDS_PREPARING");
  let decisionArmed = false;
  const arm = (key: string) => {
    const ready = new Promise<void>((resolve) => {
      if (gate) gate.arm(key, resolve);
      else legacyResolve = resolve; // the pre-C49 shape, for the counterfactual
    });
    seq.track("cards-ready", ready, CARDS_READY_CAP_MS);
    void seq.advanceWhenSettled("CARDS_READY").then((ok) => {
      if (!ok) return;
      seq.startDecision(20_000);
      decisionArmed = true;
    });
  };
  let legacyResolve: (() => void) | null = null;
  return {
    seq,
    clock,
    stalls,
    phases,
    arm,
    /** The pre-C49 report: honoured only if the machine already adopted the
     * key AND armed the signal, dropped on the floor otherwise. */
    legacyReport: (adopted: boolean) => {
      if (!adopted) return "dropped";
      legacyResolve?.();
      legacyResolve = null;
      return "resolved";
    },
    get decisionArmed() {
      return decisionArmed;
    },
  };
}

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok: ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  FAIL: ${name}`);
    console.error(err);
  }
}

const snap = (key: string | null, phase: DraftPhase): DraftPhaseSnapshot => ({ key, phase });
/** The naive derivation the backlog warns about: phase alone, no offer tag. */
const naiveVisible = (phase: DraftPhase, offerKey: string | null, busy: boolean) =>
  offerKey != null && !busy && phase === "DRAFT_COMPLETE";

async function run() {
  console.log("deriveDraftPhase (trap 2: DRAFT_COMPLETE means two things):");

  await check("a brand-new offer on a quiet board is open in its FIRST render", () => {
    const phase = deriveDraftPhase(IDLE_DRAFT_SNAPSHOT, "0:0", false, false);
    assert.equal(phase, "CARDS_PREPARING");
    assert.ok(isDraftOverlayPhase(phase));
  });

  await check("a busy board still holds the overlay back", () => {
    const phase = deriveDraftPhase(IDLE_DRAFT_SNAPSHOT, "0:0", true, false);
    assert.equal(phase, "ANIMATIONS_PLAYING");
    assert.ok(!isDraftOverlayPhase(phase));
  });

  await check("an offer already on the player's clock opens even on a busy board", () => {
    // The machine skips the animation hold for these (the compact pending
    // panel must appear at once), so the prediction has to skip it too.
    assert.equal(deriveDraftPhase(IDLE_DRAFT_SNAPSHOT, "3:0", true, true), "CARDS_PREPARING");
  });

  await check("no offer means no overlay", () => {
    assert.equal(deriveDraftPhase(IDLE_DRAFT_SNAPSHOT, null, false, false), "DRAFT_COMPLETE");
    assert.ok(!isDraftOverlayPhase(deriveDraftPhase(snap("0:0", "DRAFT_COMPLETE"), null, false, false)));
  });

  await check("TRAP 2: a resolved offer the parent still holds does NOT reopen", () => {
    // The machine retired offer 0:0; the parent has not cleared it yet (a
    // pick's flight, a server echo). The naive phase-only rule reopens it.
    const finished = snap("0:0", "DRAFT_COMPLETE");
    assert.ok(naiveVisible("DRAFT_COMPLETE", "0:0", false), "the naive rule really does reopen");
    const phase = deriveDraftPhase(finished, "0:0", false, false);
    assert.equal(phase, "DRAFT_COMPLETE");
    assert.ok(!isDraftOverlayPhase(phase), "the tagged rule keeps it closed");
  });

  await check("the NEXT offer version still opens immediately", () => {
    const finished = snap("0:0", "DRAFT_COMPLETE");
    assert.equal(deriveDraftPhase(finished, "1:0", false, false), "CARDS_PREPARING");
  });

  await check("a reroll (new version, same draft) opens immediately", () => {
    const deciding = snap("2:0", "DRAFT_DECIDING");
    assert.equal(deriveDraftPhase(deciding, "2:1", false, false), "CARDS_PREPARING");
  });

  await check("once the machine owns the offer, its phase wins", () => {
    // A spectacle starting mid-draft must not close an open overlay, and a
    // machine still preparing must not be dragged forward by the prediction.
    assert.equal(deriveDraftPhase(snap("0:0", "CARDS_READY"), "0:0", true, false), "CARDS_READY");
    assert.equal(
      deriveDraftPhase(snap("0:0", "SELECTION_ANIMATING"), "0:0", true, false),
      "SELECTION_ANIMATING",
    );
    assert.equal(
      deriveDraftPhase(snap("0:0", "ANIMATIONS_PLAYING"), "0:0", false, false),
      "ANIMATIONS_PLAYING",
    );
  });

  await check("the overlay phases are exactly the documented five", () => {
    const visible = (
      [
        "MOVE_RESOLVING",
        "ANIMATIONS_PLAYING",
        "CARDS_PREPARING",
        "CARDS_READY",
        "DRAFT_DECIDING",
        "DRAFT_CONFIRMING",
        "SELECTION_ANIMATING",
        "RETURNING_TO_GAME",
        "DRAFT_COMPLETE",
      ] as DraftPhase[]
    ).filter(isDraftOverlayPhase);
    assert.deepEqual(visible, [
      "CARDS_PREPARING",
      "CARDS_READY",
      "DRAFT_DECIDING",
      "DRAFT_CONFIRMING",
      "SELECTION_ANIMATING",
    ]);
  });

  console.log("CardsReadyGate (trap 1: child effects run before parent effects):");

  await check("TRAP 1: a report that arrives BEFORE the arm is honoured", async () => {
    const gate = new CardsReadyGate();
    const d = armedDraft(gate);
    gate.retarget("0:0");
    // The overlay mounted in the same commit and reported first.
    assert.equal(gate.report("0:0"), "latched");
    // Now the machine's own effect runs and arms the signal.
    d.arm("0:0");
    await flush();
    assert.equal(d.seq.phase, "DRAFT_DECIDING", "cards ready and the window armed");
    assert.ok(d.decisionArmed);
    assert.deepEqual(d.stalls, [], "no watchdog fired");
    // And the 12s cap is not lurking: advancing past it changes nothing.
    d.clock.advance(CARDS_READY_CAP_MS + 5_000);
    await flush();
    assert.deepEqual(d.stalls, []);
  });

  await check("counterfactual: dropping that report costs the full 12s cap", async () => {
    const d = armedDraft(null); // pre-C49 handling
    assert.equal(d.legacyReport(false), "dropped", "the key was not adopted yet");
    d.arm("0:0");
    await flush();
    assert.equal(d.seq.phase, "CARDS_PREPARING", "stuck in preparation");
    assert.ok(!d.decisionArmed);
    d.clock.advance(CARDS_READY_CAP_MS);
    await flush();
    assert.deepEqual(d.stalls, ["cards-ready:timeout"], "the watchdog had to rescue it");
    assert.equal(d.seq.phase, "DRAFT_DECIDING");
  });

  await check("the ordinary order (arm, then report) still resolves directly", async () => {
    const gate = new CardsReadyGate();
    const d = armedDraft(gate);
    gate.retarget("0:0");
    d.arm("0:0");
    await flush();
    assert.equal(d.seq.phase, "CARDS_PREPARING", "nothing advances before the report");
    assert.equal(gate.report("0:0"), "resolved");
    await flush();
    assert.equal(d.seq.phase, "DRAFT_DECIDING");
    assert.deepEqual(d.stalls, []);
  });

  await check("a stale report from a replaced offer cannot satisfy the next one", async () => {
    const gate = new CardsReadyGate();
    gate.retarget("0:0");
    gate.report("0:0");
    // Reroll: the machine adopts 0:1, which drops the latch for 0:0.
    const d = armedDraft(gate);
    gate.retarget("0:1");
    d.arm("0:1");
    await flush();
    assert.equal(d.seq.phase, "CARDS_PREPARING", "the new cards are not ready yet");
    assert.equal(gate.report("0:1"), "resolved");
    await flush();
    assert.equal(d.seq.phase, "DRAFT_DECIDING");
  });

  await check("an arm for a version with no report waits, then the cap rescues it", async () => {
    const gate = new CardsReadyGate();
    const d = armedDraft(gate);
    gate.retarget("1:0");
    d.arm("1:0");
    await flush();
    assert.equal(d.seq.phase, "CARDS_PREPARING");
    d.clock.advance(CARDS_READY_CAP_MS);
    await flush();
    // The cap is fault recovery, not scheduling: it still cannot deadlock.
    assert.deepEqual(d.stalls, ["cards-ready:timeout"]);
    assert.equal(d.seq.phase, "DRAFT_DECIDING");
  });

  await check("a re-armed signal for the same cards (StrictMode) resolves at once", async () => {
    const gate = new CardsReadyGate();
    gate.retarget("0:0");
    gate.report("0:0");
    const first = armedDraft(gate);
    first.arm("0:0");
    await flush();
    assert.equal(first.seq.phase, "DRAFT_DECIDING");
    // The hook's effect ran again against a rebuilt machine (the simulated
    // remount) without the overlay re-reporting: the latch still covers it.
    const second = armedDraft(gate);
    second.arm("0:0");
    await flush();
    assert.equal(second.seq.phase, "DRAFT_DECIDING");
    assert.deepEqual(second.stalls, []);
  });

  console.log("");
  if (failures.length > 0) {
    console.error(`FAILED: ${failures.length} test(s): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`OK: ${passed} draft-derivation tests passed`);
}

void run();
