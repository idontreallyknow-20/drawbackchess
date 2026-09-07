"use client";

// ---------------------------------------------------------------------------
// The in-game dock, redesigned around progressive disclosure.
//
// Reading order, top to bottom:
//   1. "Now"          — one line: when the next draft lands (DockNow).
//   2. "Against you"  — a compact chip strip of every constraint currently
//                       limiting YOUR play, each chip one tap from its full
//                       explanation (DockAgainstYou). Always visible when
//                       non-empty: what is hurting you outranks everything.
//   3. The hand       — ONE list under a You · Them filter (replacing the old
//                       three-tab set): collapsed one-line rows, live cards
//                       first, spent ones under a "Used" rule. Your view is
//                       the default; the newest card flashes as it lands.
//   4. "Recent plays" — the opponent's play ledger, folded behind a collapsed
//                       disclosure at the foot instead of owning a tab.
//
// Held-buff visibility: FULLY PUBLIC HANDS (owner rule). The hidden-card
// machinery (hideOpponentCards, masked instances) is kept working rather than
// deleted so an old server frame or a future hidden mode degrades gracefully.
// ---------------------------------------------------------------------------

import { draftCardNoun } from "@/engine/buff";
import { BUFF_BY_ID } from "@/engine/buffs/library";
import { NerfGame, buffNextTarget } from "@/engine/game";
import { Color } from "@/engine/types";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useDockHotkeys, useDockView } from "@/lib/dockView";
import { ScrollText } from "lucide-react";
import { useState } from "react";
import { OppPlaysDockSection, type OppPlay } from "../OppPlaysLog";
// Shares the dock pocket flash keyframes (and nothing else) with the overlay.
import "../DraftOverlay.css";
import { againstYouRows } from "./againstYou";
import { DockSectionHeader, UsedDivider, useFinePointer } from "./bits";
import { DockAgainstYou } from "./DockAgainstYou";
import { DockNow } from "./DockNow";
import { DockRow } from "./DockRow";

interface Props {
  game: NerfGame;
  myColor: Color;
  /** Activation is only allowed on your turn while the game is live. */
  canAct: boolean;
  /** Use clicked: the page starts on-board targeting (useBuffTargeting). */
  onStartUse: (index: number) => void;
  /** Bot games: mask the opponent's held cards locally (the online server
   * already sends them masked). Revealed instances still show face-up. */
  hideOpponentCards?: boolean;
  /** Everything the opponent has played this game: after each play's stay in
   * the top-right feed, this dock section is its permanent home. */
  plays?: OppPlay[];
}

export function BuffDock({ game, myColor, canAct, onStartUse, hideOpponentCards, plays }: Props) {
  const finePointer = useFinePointer();
  const reduceMotion = useReducedMotion();
  // Per-row expand/collapse, remembered for the whole game. Keyed by the
  // row's group key (owner + card + spent/nullified state, see groupRows),
  // which does not change while a countdown ticks.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  // Whose hand is on screen. One question, one control: the old dock's three
  // tabs (Yours / Theirs / Log) folded the play ledger in as a peer of the two
  // hands; it is a history, not a hand, so it now lives in its own collapsed
  // disclosure at the foot. The view is shared across every mounted dock and
  // flips with the y / t hotkeys.
  const [view, setView] = useDockView();
  useDockHotkeys();
  const [logOpen, setLogOpen] = useState(false);

  const bs = game.buffs;
  if (!bs) return null;
  const noun = draftCardNoun(bs.mode);
  const nounPlural = noun === "hex" ? "hexes" : `${noun}s`;
  const oppColor: Color = myColor === "w" ? "b" : "w";
  const mine = bs.players[myColor].buffs;
  const theirs = bs.players[oppColor].buffs;

  // Every drafted card stays in the dock for the whole game, used or not, so
  // nothing a player spent silently disappears.
  const mineAll = mine.map((inst, i) => ({ inst, i }));
  const theirsAll = theirs.map((inst, i) => ({ inst, i }));

  // Hidden opponent cards render nothing at all (owner call: no face-down
  // minis, no "N hidden" sign). Revealed and used cards keep their rows.
  const isHiddenOpp = (inst: (typeof theirs)[number]) =>
    !BUFF_BY_ID[inst.id] || (hideOpponentCards && !inst.spent && !inst.nullified);
  const theirsShown = theirsAll.filter(({ inst }) => !isHiddenOpp(inst));

  // Live cards sit at the top; used ones gather under a "Used" rule at the
  // foot of the same side's list, tier descending. Never merged across sides.
  const isDead = (inst: (typeof mine)[number]) => !!(inst.spent || inst.nullified || inst.usedActivation);
  const byTierDesc = (a: { inst: (typeof mine)[number] }, b: { inst: (typeof mine)[number] }) =>
    b.inst.tier - a.inst.tier;
  const mineLive = mineAll.filter(({ inst }) => !isDead(inst));
  const mineDead = mineAll.filter(({ inst }) => isDead(inst)).sort(byTierDesc);
  const theirsLive = theirsShown.filter(({ inst }) => !isDead(inst));
  const theirsDead = theirsShown.filter(({ inst }) => isDead(inst)).sort(byTierDesc);

  // Fold duplicates: the same card id in the same state renders as ONE row
  // wearing a "×N" count chip instead of N identical plates. The
  // representative keeps the first copy's index, so Use fires that copy, and
  // its status line stands for the group. The live status is deliberately NOT
  // part of the key: when one copy's countdown ticked the group split and the
  // expanded row's key changed, collapsing it under the player.
  const groupRows = <T extends { inst: (typeof mine)[number]; i: number }>(
    entries: T[],
    owner: "mine" | "opp",
  ) => {
    const seen = new Map<string, T & { count: number; key: string }>();
    const out: (T & { count: number; key: string })[] = [];
    for (const e of entries) {
      const k = [
        owner,
        e.inst.id,
        e.inst.tier,
        e.inst.spent ? 1 : 0,
        e.inst.nullified ? 1 : 0,
        e.inst.usedActivation ? 1 : 0,
      ].join("-");
      const g = seen.get(k);
      if (g) g.count += 1;
      else {
        const fresh = { ...e, count: 1, key: k };
        seen.set(k, fresh);
        out.push(fresh);
      }
    }
    return out;
  };
  const mineLiveRows = groupRows(mineLive, "mine");
  const mineDeadRows = groupRows(mineDead, "mine");
  const theirsLiveRows = groupRows(theirsLive, "opp");
  const theirsDeadRows = groupRows(theirsDead, "opp");

  const usableCount = mineLive.filter(
    ({ inst }) => BUFF_BY_ID[inst.id]?.kind === "activated",
  ).length;

  // Constraints currently running against me.
  const againstRows = againstYouRows(game, myColor);

  const renderSide = (owner: "mine" | "opp") => {
    const liveRows = owner === "mine" ? mineLiveRows : theirsLiveRows;
    const deadRows = owner === "mine" ? mineDeadRows : theirsDeadRows;
    const newestIndex = owner === "mine" ? mine.length - 1 : -1;
    if (liveRows.length + deadRows.length === 0) {
      return (
        <p className="text-[12px] text-parchment-400">
          {owner === "mine" ? "None yet." : `No ${nounPlural} revealed yet.`}
        </p>
      );
    }
    const row = (r: { inst: (typeof mine)[number]; i: number; count: number; key: string }) => {
      const key = r.key;
      return (
        <DockRow
          key={key}
          inst={r.inst}
          index={r.i}
          count={r.count}
          owner={owner}
          open={expanded[key] ?? false}
          onToggle={() => toggle(key)}
          usable={owner === "mine" && canAct}
          hasTarget={owner === "mine" && !!buffNextTarget(game, myColor, r.i, [])}
          onStartUse={onStartUse}
          finePointer={finePointer}
          reduceMotion={reduceMotion}
          flash={owner === "mine" && r.i === newestIndex}
        />
      );
    };
    return (
      // A thin spine brackets each side in its own hue — blue for yours,
      // coral for theirs — so ownership is unmistakable without a header.
      <div
        className={
          "space-y-1 border-l pl-2 " + (owner === "mine" ? "border-mode-buff/30" : "border-coral/30")
        }
      >
        {liveRows.map(row)}
        {deadRows.length > 0 && (
          <>
            <UsedDivider />
            {deadRows.map(row)}
          </>
        )}
      </div>
    );
  };

  return (
    <div data-buff-dock className="plate flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-inherit px-3 pb-2">
        <DockNow game={game} myColor={myColor} />

        {/* What is limiting you right now beats everything else in the dock:
            it stays pinned above both hands, in the alert accent. */}
        <DockAgainstYou rows={againstRows} />

        {/* The one hand filter. Segmented, not tabs-with-a-log: whose cards am
            I looking at is the only question this control answers. */}
        <div role="tablist" aria-label="Whose cards" className="flex gap-1 pt-1">
          {(
            [
              { id: "you", label: "You", key: "y", n: mine.length, badge: canAct ? usableCount : 0 },
              { id: "them", label: "Them", key: "t", n: theirsShown.length, badge: 0 },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={view === t.id}
              onClick={() => setView(t.id)}
              className={
                "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-1.5 font-display text-[12px] transition " +
                (view === t.id
                  ? "border-[color:var(--accent)] text-parchment-50"
                  : "border-transparent text-parchment-300 hover:text-parchment-100")
              }
            >
              {t.label}
              {t.n > 0 && <span className="tabular text-[12px] text-parchment-400">{t.n}</span>}
              {/* Hotkey hint, pointer devices only: a phone has no key. */}
              <kbd
                aria-hidden
                className="hidden rounded-[1px] border border-[color:var(--edge)] px-1 font-mono text-[12px] leading-4 text-parchment-400 [@media(hover:hover)]:inline"
              >
                {t.key}
              </kbd>
              {t.badge > 0 && (
                <span
                  title={`${t.badge} card${t.badge === 1 ? "" : "s"} you could use now`}
                  className="grid h-[17px] min-w-[17px] place-items-center rounded-[1px] bg-gold px-1 font-mono text-[12px] font-bold leading-none text-ink-950"
                >
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {renderSide(view === "you" ? "mine" : "opp")}

        {/* The opponent's play ledger: a history, folded by default. */}
        {(plays?.length ?? 0) > 0 && (
          <div className="border-t border-[color:var(--edge)] pt-2">
            <DockSectionHeader
              icon={ScrollText}
              label="Recent plays"
              count={plays?.length ?? 0}
              open={logOpen}
              onToggle={() => setLogOpen((v) => !v)}
            />
            {logOpen && <OppPlaysDockSection plays={plays!} />}
          </div>
        )}
      </div>
    </div>
  );
}
