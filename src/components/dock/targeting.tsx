"use client";

// Buff targeting: activated buffs target on the REAL board. useBuffTargeting
// owns the pick chain, the page paints targeting.target.squares through the
// Board's pickSquares prop, and clicking a highlighted square advances the
// chain. Only enemy-buff-list targets (which have no board representation)
// fall back to the EnemyBuffModal. Moved verbatim from the old BuffDock.

import { BuffPick, BuffTarget } from "@/engine/buff";
import { BUFF_BY_ID } from "@/engine/buffs/library";
import { NerfGame, activateBuff, buffNextTarget } from "@/engine/game";
import { Color } from "@/engine/types";
import { Tier } from "@/engine/nerf";
import { TIER_ROMAN } from "@/lib/tiers";
import { playCardUse } from "@/lib/sounds";
import { useModalChrome } from "@/lib/useModalChrome";
import { useEffect, useRef, useState } from "react";
import { BuffCard } from "../BuffCard";

export interface BuffTargeting {
  buffIndex: number;
  picks: BuffPick[];
  target: BuffTarget;
}

export function useBuffTargeting({
  game,
  myColor,
  active,
  onChanged,
  onUse,
}: {
  game: NerfGame | null;
  myColor: Color;
  /** Targeting cancels itself the moment acting stops being legal. */
  active: boolean;
  onChanged?: () => void;
  /** Online games: send the activation to the server instead of applying it
   * locally. Targets are still computed from the local replica. */
  onUse?: (buffIndex: number, picks: BuffPick[]) => void;
}) {
  const [targeting, setTargeting] = useState<BuffTargeting | null>(null);
  const finishRef = useRef<(() => void) | null>(null);

  // Deactivating cancels any in-progress targeting; adjust during render rather
  // than in an effect so the panel never shows a stale targeting frame.
  if (!active && targeting) setTargeting(null);

  useEffect(() => {
    if (!targeting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTargeting(null);
      // Enter mirrors the Done button on a finishable step (keyboard parity
      // with the banner controls; ignored while typing in an input).
      if (
        e.key === "Enter" &&
        targeting.target.kind === "square" &&
        targeting.target.finishable &&
        !(e.target instanceof HTMLElement && /^(input|textarea|select)$/i.test(e.target.tagName))
      ) {
        finishRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [targeting]);

  const start = (index: number) => {
    if (!game) return;
    const target = buffNextTarget(game, myColor, index, []);
    if (!target) {
      // No targeting needed: fire immediately. The card-used voice marks the
      // activation itself; the effect's own voice (shield, freeze, explosion...)
      // follows separately when it lands.
      const usedId = game.buffs?.players[myColor]?.buffs[index]?.id;
      if (onUse) {
        onUse(index, []);
        playCardUse(usedId);
      } else if (activateBuff(game, myColor, index, [])) {
        onChanged?.();
        playCardUse(usedId);
      }
      return;
    }
    setTargeting({ buffIndex: index, picks: [], target });
  };

  const pick = (p: BuffPick) => {
    if (!targeting || !game) return;
    const picks = [...targeting.picks, p];
    const next = buffNextTarget(game, myColor, targeting.buffIndex, picks);
    if (!next) {
      if (onUse) onUse(targeting.buffIndex, picks);
      else {
        activateBuff(game, myColor, targeting.buffIndex, picks);
        onChanged?.();
      }
      // Last target picked: the card is now cast. One card-used voice per use.
      playCardUse(game.buffs?.players[myColor]?.buffs[targeting.buffIndex]?.id);
      setTargeting(null);
    } else {
      setTargeting({ ...targeting, picks, target: next });
    }
  };

  /** Stop early on a finishable step (Warp Sovereign and friends): the picks
   * so far already form a complete effect, so fire with what we have. */
  const finish = () => {
    if (!targeting || !game) return;
    if (targeting.target.kind !== "square" || !targeting.target.finishable) return;
    if (onUse) onUse(targeting.buffIndex, targeting.picks);
    else {
      activateBuff(game, myColor, targeting.buffIndex, targeting.picks);
      onChanged?.();
    }
    // Finished early on a finishable step: the picks so far are cast now.
    playCardUse(game.buffs?.players[myColor]?.buffs[targeting.buffIndex]?.id);
    setTargeting(null);
  };

  const cancel = () => setTargeting(null);

  // Keep the keydown handler's Enter shortcut pointed at the CURRENT finish
  // closure without re-subscribing the listener on every pick. Written from
  // an effect (never during render) per the react-hooks refs rule.
  useEffect(() => {
    finishRef.current = finish;
  });

  return { targeting, start, pick, cancel, finish };
}

/** Floating chip over the board while a buff is picking its square targets:
 * names the buff and step, offers cancel (Escape works too). */
export function TargetingBanner({
  game,
  myColor,
  targeting,
  onCancel,
  onFinish,
  invalidKey,
}: {
  game: NerfGame;
  myColor: Color;
  targeting: BuffTargeting;
  onCancel: () => void;
  /** Finishable steps (the picks so far are a complete effect) show a Done
   * button that fires the buff early instead of picking further targets. */
  onFinish?: () => void;
  /** Bumped by the host whenever a tap lands on a NON-eligible square
   * (Board.onInvalidPick). Each bump flashes a one-line hint naming what is
   * targetable, then it fades on its own. */
  invalidKey?: number;
}) {
  const inst = game.buffs?.players[myColor].buffs[targeting.buffIndex];
  const name = (inst && BUFF_BY_ID[inst.id]?.name) ?? "Buff";
  const empty = targeting.target.kind === "square" && targeting.target.squares.length === 0;
  const finishable = targeting.target.kind === "square" && !!targeting.target.finishable;
  const picked = targeting.picks.length;
  // Transient invalid-tap hint: each bump of invalidKey shows the line
  // immediately (derived during render), and a timer marks that bump as
  // expired ~2.2s later so it fades on its own.
  const [expiredInvalidKey, setExpiredInvalidKey] = useState(0);
  useEffect(() => {
    if (!invalidKey) return;
    const t = window.setTimeout(() => setExpiredInvalidKey(invalidKey), 2200);
    return () => window.clearTimeout(t);
  }, [invalidKey]);
  const showInvalid = !!invalidKey && expiredInvalidKey !== invalidKey;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-full z-30 mt-1.5 flex flex-col items-center gap-1 px-2">
      {/* Your card is mid-use: a frosted glass chip with the card name, the
          current step, a picked-so-far counter, and clear Done / Cancel. Sits
          just BELOW the board's bottom edge so it never hides the squares the
          player is aiming at. Blue marks the active card (yours — your buff),
          coral the back-out. */}
      <div className="glass-chip pointer-events-auto flex max-w-full items-center gap-2.5 border border-mode-buff/40 px-3.5 py-2">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-mode-buffGlow" />
        <span className="min-w-0 truncate font-display text-xs font-semibold text-parchment">
          <span className="text-mode-buffGlow">{name}</span>
          <span className="text-parchment-400"> · </span>
          {empty ? "no valid targets right now" : targeting.target.label}
        </span>
        {picked > 0 && (
          <span
            className="shrink-0 rounded-[1px] border border-[color:var(--edge-strong)] bg-white/[0.08] px-2 py-0.5 font-mono text-[12px] tabular-nums text-parchment-200"
            title={`${picked} target${picked === 1 ? "" : "s"} picked so far`}
          >
            {picked} picked
          </span>
        )}
        {finishable && onFinish && (
          <button
            onClick={onFinish}
            className="shrink-0 touch-manipulation inline-flex items-center justify-center min-h-[44px] sm:min-h-0 rounded-[1px] border border-mode-buff/60 bg-mode-buff/20 px-3 py-1 font-display text-[14px] sm:text-[13px] font-bold tracking-wide text-mode-buffGlow transition hover:bg-mode-buff/30"
            title="Fire now with the targets picked so far (the rest are forfeited)"
          >
            Done
          </button>
        )}
        <button
          onClick={onCancel}
          className="shrink-0 touch-manipulation inline-flex items-center justify-center min-h-[44px] sm:min-h-0 rounded-[1px] border border-coral/40 bg-coral/10 px-3 py-1 font-display text-[14px] sm:text-[13px] font-semibold tracking-wide text-coral-glow transition hover:bg-coral/20"
        >
          Cancel <span className="text-coral-glow">Esc</span>
        </button>
      </div>
      {/* Invalid-tap hint: one line naming what IS targetable, flashed after
          a tap on a non-eligible square, self-fading. Oxblood alert accent. */}
      {showInvalid && (
        <div
          role="status"
          className="glass-chip max-w-full border border-oxblood-glow/50 px-3 py-1 text-xs font-display font-semibold text-oxblood-glow"
        >
          {empty
            ? "No valid targets right now"
            : `Not a valid target · ${targeting.target.label}`}
        </div>
      )}
    </div>
  );
}

/** Fallback picker for enemy-buff-list targets only: those have no board
 * representation, so the modal list remains. Masked cards show as hidden. */
export function EnemyBuffModal({
  game,
  myColor,
  targeting,
  onPick,
  onCancel,
}: {
  game: NerfGame;
  myColor: Color;
  targeting: BuffTargeting;
  onPick: (pick: BuffPick) => void;
  onCancel: () => void;
}) {
  const { target } = targeting;
  // Hooks must run before any early return.
  const { attachDialog } = useModalChrome(true, onCancel);
  if (target.kind !== "enemy-buff") return null;
  const inst = game.buffs?.players[myColor].buffs[targeting.buffIndex];
  const buffName = (inst && BUFF_BY_ID[inst.id]?.name) ?? "Buff";
  return (
    // Scroll-locked while the target picker is up (see useModalChrome); it has
    // no backdrop dismissal of its own, so the lock, Escape and the focus trap
    // apply. The trap matters more here than on most overlays: every option is
    // a button, and without it Tab walks straight past Cancel into the board
    // behind, which is covered and not meant to be reachable while a pick is
    // pending.
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/80 px-4 py-6">
      <div
        ref={attachDialog}
        role="dialog"
        aria-modal="true"
        aria-label={target.label}
        className="plate w-full max-w-md p-5 max-h-[90dvh] overflow-y-auto"
      >
        <div className="text-[12px] text-parchment-400">{buffName}</div>
        <div className="font-display text-lg text-parchment mt-0.5">{target.label}</div>

        {target.options.length === 0 ? (
          <p className="mt-3 text-sm text-parchment-300">No valid targets right now.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {target.options.map((opt) => {
              const def = BUFF_BY_ID[opt.name];
              return (
                <button
                  key={opt.index}
                  onClick={() => onPick({ buffIndex: opt.index })}
                  className="block w-full text-left"
                >
                  {def ? (
                    <BuffCard buff={def} tier={opt.tier as 1} compact />
                  ) : (
                    <span className="flex items-center justify-between border border-[color:var(--edge)] bg-white/[0.03] px-3 py-2 text-sm text-parchment">
                      Hidden buff
                      <span className="font-display text-xs text-parchment-400">
                        Tier {TIER_ROMAN[opt.tier as Tier]}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={onCancel}
          className="mt-4 w-full rounded-[1px] border border-coral/40 bg-coral/10 px-3 py-2 font-display text-[14px] sm:text-[13px] font-semibold tracking-wide text-coral-glow transition hover:bg-coral/20"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
