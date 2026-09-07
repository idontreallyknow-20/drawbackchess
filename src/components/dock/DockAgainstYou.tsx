"use client";

// The "Against you" strip: every constraint currently limiting your play,
// compressed to one wrapping row of tappable chips instead of the old stack of
// full-width rows. Each chip opens a small popover with the constraint's
// detail, its remaining time, and — via the glossary — a plain-language
// explanation of the effect kind, so no weird status is ever unexplained.
// This strip is also where victim-side receive animations land: a fresh
// constraint mounts its chip with the pocket flash (keys are stable while an
// effect holds, so the flash plays exactly once per new constraint).

import { Clock, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TIER_ROMAN } from "@/lib/tiers";
import { entryForSlug } from "@/lib/glossary";
import type { AgainstRow } from "./againstYou";
import { pliesTitle } from "./bits";

function AgainstChip({ row }: { row: AgainstRow }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  // Tap-away closes the popover (hover keeps working on fine pointers).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);
  const glossary = row.slug ? entryForSlug(row.slug) : undefined;
  const t = row.tier;
  return (
    <span
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-against-chip={row.key}
        className={
          "dock-pocket-flash inline-flex max-w-full items-center gap-1 rounded-[1px] border px-1.5 py-0.5 text-[12px] font-semibold " +
          (t
            ? `tier-bg-${t} tier-${t}`
            : "border-oxblood-glow/40 bg-oxblood/10 text-oxblood-glow")
        }
      >
        <span className="min-w-0 truncate">{row.name}</span>
        {row.temporary && <Clock aria-hidden size={10} strokeWidth={2.2} className="shrink-0 opacity-80" />}
      </button>
      {open && (
        <span
          role="tooltip"
          className="plate dropdown absolute left-0 top-full z-30 mt-1 block w-64 max-w-[74vw] p-2.5 shadow-2xl"
        >
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={
                "block font-display text-[12px] font-bold " + (t ? `tier-${t}` : "text-oxblood-glow")
              }
            >
              {row.name}
              {t && <span className="ml-1.5 text-parchment-400">{TIER_ROMAN[t]}</span>}
            </span>
            <span
              title={pliesTitle(row.left)}
              className="shrink-0 text-[12px] font-semibold text-parchment-300"
            >
              {row.left}
            </span>
          </span>
          <span className="mt-1 block text-[12px] font-normal normal-case leading-snug tracking-normal text-parchment-300">
            {row.detail}
          </span>
          {/* The glossary's one-liner: what this effect kind IS, in plain
              words, for anyone meeting a walnut or a leash for the first
              time. Face-up curses carry their own card text instead. */}
          {glossary && glossary.def !== row.detail && (
            <span className="mt-1 block border-t border-[color:var(--edge)] pt-1 text-[12px] italic leading-snug text-parchment-400">
              {glossary.def}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export function DockAgainstYou({ rows }: { rows: AgainstRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div data-against-you className="rounded-[1px] border border-oxblood-glow/30 bg-oxblood/[0.05] px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[1px] border border-oxblood-glow/45 bg-oxblood/15 text-oxblood-glow"
        >
          <ShieldAlert size={10} strokeWidth={2.4} />
        </span>
        <span className="text-[12px] text-oxblood-glow">Against you</span>
        <span className="ml-auto shrink-0 rounded-[1px] border border-[color:var(--edge)] bg-white/[0.05] px-1.5 py-px font-mono text-[12px] tabular-nums text-parchment-300">
          {rows.length}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {rows.map((row) => (
          <AgainstChip key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}
