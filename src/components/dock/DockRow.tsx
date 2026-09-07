"use client";

// One card row, shared by both hands. Collapsed to a single line (chevron,
// name, state chips, tier numeral); tap to open the detail body with the full
// rule text and — for your own activatable cards — the one Use button. The old
// dock rendered your rows and the opponent's from two near-identical inline
// closures; this is that pair merged, with `owner` driving the differences
// (Use affordances for yours, a notch larger name for theirs).

import { BuffInstance, turnCost } from "@/engine/buff";
import { BUFF_BY_ID } from "@/engine/buffs/library";
import { TIER_ROMAN } from "@/lib/tiers";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TurnCostBadge } from "../TurnCostBadge";
import { PassiveChip, StatusChip, UsedBadge, pliesTitle } from "./bits";

export function DockRow({
  inst,
  index,
  count,
  owner,
  open,
  onToggle,
  usable,
  hasTarget,
  onStartUse,
  finePointer,
  reduceMotion,
  flash,
}: {
  inst: BuffInstance;
  index: number;
  count: number;
  owner: "mine" | "opp";
  open: boolean;
  onToggle: () => void;
  /** Mine only: this activated card can fire right now. */
  usable?: boolean;
  /** Mine only: activating this card asks for a board target. A drag onto
   *  the board only makes sense then; a zero-target card fires the instant
   *  it is armed, so its drag start is refused and the click path plays it. */
  hasTarget?: boolean;
  onStartUse?: (index: number) => void;
  finePointer?: boolean;
  reduceMotion?: boolean;
  /** The newest card in the hand wears the pocket flash once as it lands. */
  flash?: boolean;
}) {
  const def = BUFF_BY_ID[inst.id];
  // usedActivation retires an activated card the same as spent for the Use
  // button and the "Used" stamp, but a spendOnUse:false card is NOT spent, so
  // it stays in the list running its rider. Keep its live status line visible
  // (only spent/nullified cards truly go silent).
  const dead = !!(inst.spent || inst.nullified || inst.usedActivation);
  const status = def && !(inst.spent || inst.nullified) ? def.status?.(inst) ?? null : null;

  // Three separate lifecycle beats, each its own class so none can swallow
  // another:
  //   arrive   the card lands in the hand (flash prop: newest card). Plays on
  //            the row itself, independent of the usable styling, so a card
  //            that is usable the moment it lands still gets its entrance.
  //   used     the row just went from live to spent/used (or a keep-alive
  //            rider fired and changed its status line). A one-shot burst,
  //            detected here from the prop flip so both hands get it.
  //   live     the card is doing something right now: a status line is
  //            running (countdown, armed rider). A slow breath on the tier
  //            edge and a live dot next to the chip, until it ends.
  // Hooks sit above the missing-definition return below so their order never
  // changes between renders.
  const [prevDead, setPrevDead] = useState(dead);
  const [prevStatus, setPrevStatus] = useState(status);
  const [burst, setBurst] = useState(0);
  const [bursting, setBursting] = useState(false);
  if (prevDead !== dead || prevStatus !== status) {
    setPrevDead(dead);
    setPrevStatus(status);
    // Only a flip INTO the used state, or a rider firing on a live card,
    // counts as a use. Going from nothing to a status is the card arming
    // (that is the arrival), not a use.
    if ((!prevDead && dead) || (prevStatus != null && status != null && prevStatus !== status)) {
      setBurst((b) => b + 1);
      setBursting(true);
    }
  }
  // The burst layer unmounts itself after its animation; the timer callback
  // is the only place this effect writes state.
  useEffect(() => {
    if (burst === 0) return;
    const id = window.setTimeout(() => setBursting(false), 900);
    return () => window.clearTimeout(id);
  }, [burst]);

  if (!def) return null;
  const activatable = owner === "mine" && def.kind === "activated" && !dead;
  const canUse = !!usable && activatable;
  const inEffect = !dead && !!status;

  return (
    <motion.div
      // Gated: ungated, every dock row slid in from x:-20 under OS reduced
      // motion (and under Settings > Animations: Off).
      initial={reduceMotion ? false : { opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.25 }}
      className={
        "dock-card relative w-full overflow-hidden rounded-[1px] border transition-colors duration-200 " +
        (flash ? "dock-pocket-flash dock-arrive " : "") +
        (bursting ? "dock-used-burst " : "") +
        (inEffect ? "dock-live " : "") +
        (dead
          ? "border-[color:var(--edge)] bg-white/[0.012] "
          : canUse
            ? "border-verdigris-glow/40 bg-verdigris/[0.06] "
            : "border-[color:var(--edge)] bg-white/[0.02] ")
      }
    >
      {/* Usable accent: a solid left edge marks the rows you can act on right
          now; spent rows a muted grey edge; live-but-not-usable rows wear
          their tier color on the same anchor. */}
      {canUse && <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] bg-verdigris-glow/80" />}
      {dead && <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] bg-white/15" />}
      {!canUse && !dead && <span aria-hidden className={`dock-tier-edge tier-bg-${inst.tier}`} />}
      {/* Arrival sheen: a tier-coloured band crosses the row once as it lands.
          Its own layer, so it plays over usable and idle rows alike. */}
      {flash && <span aria-hidden className={`dock-arrive-sheen tier-bg-${inst.tier}`} />}
      {/* Use burst: a bright ring that blooms and fades the moment the card
          fires. Mounted only for the burst so nothing idles. */}
      {bursting && <span aria-hidden className={`dock-used-ring tier-bg-${inst.tier}`} />}
      {/* Idle foil shimmer on high-tier holdings (tier 6+), the dock's quiet
          echo of the draft cards' holo finish. */}
      {!dead && inst.tier >= 6 && <span aria-hidden className="dock-shimmer" />}
      {/* Collapsed header: one line, click to toggle. A usable card also gets
          its Use button right here as a SIBLING of the toggle (never nested,
          a button inside a button is invalid), so a collapsed row can be
          played without expanding it first. */}
      <div className="flex items-stretch">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? undefined : def.description}
        className={"flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left " + (canUse ? "pl-3" : "")}
      >
        <ChevronRight
          aria-hidden
          size={12}
          strokeWidth={2.4}
          className={"shrink-0 text-parchment-400 transition-transform duration-150 " + (open ? "rotate-90" : "")}
        />
        <span
          className={
            "min-w-[3.5rem] flex-1 truncate font-display font-semibold leading-tight " +
            // The opponent's held cards read a notch LARGER than your own:
            // what threatens you is the thing worth seeing clearly at a glance.
            (owner === "opp" ? "text-[13px] " : "text-[12px] ") +
            (dead
              ? "text-parchment-200 line-through decoration-1 decoration-parchment-500"
              : `tier-${inst.tier}`)
          }
        >
          {def.name}
        </span>
        {count > 1 && (
          <span
            title={`${count} copies, same state`}
            className="shrink-0 rounded-[1px] border border-[color:var(--edge-strong)] bg-white/[0.08] px-1 py-px font-mono text-[12px] tabular-nums text-parchment-200"
          >
            ×{count}
          </span>
        )}
        {def.kind === "passive" && !dead && <PassiveChip />}
        {/* Collapsed rows carry the live countdown/status right on the
            one-liner; the detail body repeats it in full. */}
        {inEffect && <span aria-hidden className={`dock-live-dot tier-bg-${inst.tier}`} title="In effect" />}
        {!open && status && <StatusChip status={status} />}
        {/* A passive card already wears PassiveChip; its turn cost IS "passive",
            so both chips used to say the same word in the same row. One says
            it. */}
        {def.kind !== "passive" && <TurnCostBadge cost={turnCost(def)} short />}
        {dead && <UsedBadge nullified={!!inst.nullified} />}
        <span
          className={`shrink-0 rounded-[1px] border px-1.5 py-px font-display text-[12px] font-bold tier-bg-${inst.tier} tier-${inst.tier}`}
        >
          {TIER_ROMAN[inst.tier]}
        </span>
      </button>
      {canUse && (
        <div className="flex shrink-0 items-center pr-2">
          <Button
            tone="leaf"
            size="xs"
            // Second input path (additive): drag the usable card onto a
            // highlighted board square to pick it. Native HTML5 drag is
            // separate from the board's pointer-drag, so the click flow is
            // untouched. Drag-to-board is a desktop affordance: on touch
            // browsers a draggable element swallows taps (held as a
            // potential drag), which blocked this button on mobile.
            draggable={finePointer}
            onDragStart={(e) => {
              // Arming a zero-target card activates it on the spot, so a
              // drag that merely began would already have played it. Refuse
              // the drag and let the click handle it.
              if (!hasTarget) {
                e.preventDefault();
                return;
              }
              e.dataTransfer.setData("application/x-nerf-card", String(index));
              e.dataTransfer.effectAllowed = "move";
              onStartUse?.(index);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onStartUse?.(index);
            }}
            title={def.description}
            className="touch-manipulation px-2.5 py-1 text-[12px] font-semibold tracking-wide max-sm:min-h-[36px] sm:cursor-grab sm:active:cursor-grabbing"
          >
            Use
          </Button>
        </div>
      )}
      </div>
      {open && (
        <div className="px-2 pb-1.5">
          {count > 1 && (
            <div className="mb-1 text-[12px] text-parchment-400">
              {count} identical copies{owner === "mine" ? " · Use plays one at a time" : ""}
            </div>
          )}
          {status && (
            <div title={pliesTitle(status)} className="mb-1 truncate text-[12px] text-gold">
              {status}
            </div>
          )}
          {/* Full description, always readable without hovering. */}
          <p className="text-[12px] leading-snug text-parchment-300">{def.description}</p>
          {/* A usable row already carries its Use button in the header, so
              the body only explains why an activatable card cannot fire yet.
              Thumb-sized below sm (44px is the touch floor). */}
          {activatable && !canUse && (
            <button
              type="button"
              disabled
              title="Your turn only"
              className="mt-1.5 cursor-not-allowed rounded-[1px] border border-[color:var(--edge)] bg-white/[0.03] px-2.5 py-1 font-display text-[13px] tracking-wide text-parchment-400 max-sm:min-h-[44px] max-sm:w-full max-sm:px-4 max-sm:text-[14px]"
            >
              Use
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
