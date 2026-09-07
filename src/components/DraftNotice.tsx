"use client";

import type { Buff, BuffInstance } from "@/engine/buff";
import { BUFF_BY_ID } from "@/engine/buffs/library";
import { cardFaceIcon } from "@/lib/cardIcon";
import { useEffect, useRef, useState } from "react";
import { GlossaryText } from "@/components/GlossaryText";

interface Notice {
  key: number;
  text: string;
  /** The picked card's rule text, shown under the headline when the card's
   * identity is public (every game now: full transparency). */
  detail?: string;
  /** The named card, so the notice can stamp its face icon. */
  card?: Buff;
  leaving: boolean;
}

/**
 * Floating notice for draft games: announces the opponent's public draft
 * actions (a new held buff, a banked draft, a used buff) the moment they
 * happen, then fades after a few seconds. Driven purely by diffing the
 * opponent's buff list and bank flag between renders, so the bot game and
 * the online view can both feed it their opponent's PlayerBuffState fields.
 * With `hidden` set (the default visibility model) the notices never name
 * a card: "Opponent drafted a buff", "Opponent banked their draft",
 * "Opponent used a buff". Render inside a relatively positioned wrapper
 * near the board.
 */
export function DraftNotice({
  buffs,
  banked,
  hidden,
  cardNoun = "buff",
}: {
  buffs: BuffInstance[];
  banked: boolean;
  /** Never name cards (hidden held-buff visibility model). */
  hidden?: boolean;
  /** What the cards are called ("buff", or "boon" in nerf mode). */
  cardNoun?: string;
}) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextKey = useRef(0);
  const prevCount = useRef(buffs.length);
  const prevBanked = useRef(banked);
  const prevSpent = useRef(buffs.filter((b) => b.spent).length);
  const timers = useRef<number[]>([]);
  const count = buffs.length;
  const spentCount = buffs.filter((b) => b.spent).length;

  useEffect(() => {
    const active = timers.current;
    return () => active.forEach((id) => window.clearTimeout(id));
  }, []);

  useEffect(() => {
    const items: { text: string; detail?: string; card?: Buff }[] = [];
    let arrivedSpent = 0;
    if (count > prevCount.current) {
      for (const inst of buffs.slice(prevCount.current)) {
        if (inst.spent) arrivedSpent += 1;
        // Full transparency: name the card and spell out what it does. The
        // `hidden` prop survives only for exotic callers that still want the
        // generic line.
        const def = !hidden ? BUFF_BY_ID[inst.id] : undefined;
        if (def) {
          items.push({ text: `Opponent drafted ${def.name}`, detail: def.description, card: def });
        } else {
          items.push({ text: `Opponent drafted a ${cardNoun}` });
        }
      }
    }
    prevCount.current = count;
    if (banked && !prevBanked.current) items.push({ text: "Opponent banked their draft" });
    prevBanked.current = banked;
    // A held card flipping to spent (beyond instants that arrive spent) means
    // the opponent fired an activated buff.
    if (spentCount - prevSpent.current - arrivedSpent > 0) {
      items.push({ text: `Opponent used a ${cardNoun}` });
    }
    prevSpent.current = spentCount;
    if (items.length === 0) return;
    const fresh = items.map(({ text, detail, card }) => ({ key: nextKey.current++, text, detail, card, leaving: false }));
    const keys = new Set(fresh.map((n) => n.key));
    setNotices((cur) => [...cur, ...fresh]);
    timers.current.push(
      window.setTimeout(() => {
        setNotices((cur) => cur.map((n) => (keys.has(n.key) ? { ...n, leaving: true } : n)));
      }, 3200),
      window.setTimeout(() => {
        setNotices((cur) => cur.filter((n) => !keys.has(n.key)));
      }, 3600),
    );
    // The engine mutates the buffs array in place, so its length (not its
    // identity) is the render-to-render signal that the opponent drafted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, banked, spentCount]);

  if (notices.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      // Floats just ABOVE the board's top edge (bottom-full), never over the
      // squares: an announcement must not cover the position it announces.
      className="pointer-events-none absolute inset-x-0 bottom-full z-30 mb-1.5 flex flex-col items-center gap-1"
    >
      {notices.map((n) => {
        const Icon = n.card ? cardFaceIcon(n.card.id, n.card.category, n.card.icon) : undefined;
        return (
          <div
            key={n.key}
            className={
              "glass-chip max-w-[min(20rem,calc(100vw-1.5rem))] border border-gold/40 px-4 py-2 " +
              "transition-opacity duration-300 " +
              (n.leaving ? "opacity-0" : "opacity-100")
            }
          >
            <div className="flex items-center gap-2 font-display text-xs font-semibold text-parchment">
              {Icon ? (
                <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-gold-leaf" strokeWidth={2.2} />
              ) : (
                <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 bg-gold-leaf" />
              )}
              {n.text}
            </div>
            {n.detail && (
              <p className="mt-0.5 text-[12px] font-normal leading-snug text-parchment-300"><GlossaryText text={n.detail} /></p>
            )}
          </div>
        );
      })}
    </div>
  );
}
