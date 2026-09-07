"use client";

import Link from "next/link";
import { createElement, type CSSProperties, type MouseEvent } from "react";
import { ChevronRight, Link2, Sparkles, type LucideIcon } from "lucide-react";
import { cardFaceIcon, nerfFaceIcon } from "@/lib/cardIcon";
import { TIER_LABEL, TIER_ROMAN } from "@/lib/tiers";
import { entryPath, type CodexEntry } from "./codexData";

function entryIcon(e: CodexEntry): LucideIcon {
  const ic =
    e.kind === "nerf"
      ? nerfFaceIcon(e.card.id, e.card.icon)
      : cardFaceIcon(e.card.id, e.card.category, e.card.icon);
  return ic ?? Sparkles;
}

// A compact 44px list row: face icon, name, tier chip (via the shared .tier-*
// classes), and a one-line description ellipsis. The whole row is a real link
// to the card's detail page, so a modified click (or middle click) opens the
// page in the usual way; a plain click expands the full card in place instead.
// content-visibility + contain-intrinsic-size keep off-screen rows out of
// layout and paint so the page stays cheap even with hundreds of rows mounted.
export function CodexRow({
  entry,
  expanded,
  copied,
  onToggle,
  onCopy,
}: {
  entry: CodexEntry;
  expanded: boolean;
  copied: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  const { card } = entry;
  const tier = card.tier;
  const Icon = entryIcon(entry);
  const path = entryPath(entry);
  // Real number of difficulty tiers, derived from the shared tier table
  // (index 0 is a filler, so subtract it) rather than hardcoded. Covers the
  // normal 1..8 bands plus Apex (9) and Mythic (10).
  const tierTotal = TIER_ROMAN.length - 1;

  const onRowClick = (e: MouseEvent) => {
    // Let modified / non-primary clicks navigate to the stable URL as normal
    // (new tab, background, etc.); a plain click expands the row in place.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onToggle();
  };

  const rowStyle: CSSProperties = { contentVisibility: "auto", containIntrinsicSize: "auto 48px" };

  // The Copy button is a SIBLING of the card link, not a child: nesting one
  // interactive control inside another is invalid and lets a Copy click also
  // trigger the link. The bordered row surface, hover, and expanded styling
  // therefore live on this wrapper; the link keeps its own focus ring.
  return (
    <div
      style={rowStyle}
      className={`group flex min-h-[44px] items-stretch gap-2.5 rounded-none border px-2.5 transition ${
        expanded
          ? "border-[color:var(--edge-strong)] bg-[color:var(--bg-zebra)]"
          : "border-[color:var(--edge)] bg-[color:var(--bg-zebra)] hover:bg-[color:var(--surface-hover)]"
      }`}
    >
      <Link
        href={path}
        onClick={onRowClick}
        aria-expanded={expanded}
        // The link fills the row's full height rather than just wrapping its
        // text, which measured 24.5px inside a 44px row: half the row looked
        // clickable and was not. Section 10: "interactive rows are fully
        // clickable, not just their text."
        //
        // Stretching alone was not enough. The wrapper's own py-2 shrank the
        // content box the link stretches INTO, so the link topped out at 28px
        // and the padding stayed dead space inside a row that measured 44.
        // The vertical padding therefore moves off the wrapper and onto the
        // link, where it is part of the hit area instead of a moat around it.
        className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch rounded-none py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
      >
        <span
          aria-hidden
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-none border tier-bg-${tier} tier-${tier}`}
        >
          {createElement(Icon, { size: 15, strokeWidth: 1.8 })}
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-display text-[14px] leading-tight text-parchment-100 sm:flex-none sm:max-w-[16rem]">
            {card.name}
          </span>
          <span
            className={`shrink-0 rounded-none border px-1.5 py-px font-display text-[12px] font-bold tier-bg-${tier} tier-${tier}`}
            title={`Tier ${TIER_ROMAN[tier]} of ${tierTotal}: ${TIER_LABEL[tier]}`}
          >
            {TIER_ROMAN[tier]}
          </span>
          {/* The card's description is the row's content, not a label on it,
              so it sits at the 13px body floor. The tier chip above stays at
              12px: a roman numeral in a bordered pill is a label. The row's
              height is set by the 14px name, so this does not grow it. */}
          <span className="hidden min-w-0 flex-1 truncate text-[13px] text-parchment-400 sm:block">
            {card.description}
          </span>
        </span>
      </Link>

      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy link to ${card.name}`}
        // "Copy" is a button label: interactive text, so 13px. The fixed 32px
        // height is now a floor that clears 44px on touch and tightens only
        // behind (pointer: fine). The `sm:` here gates VISIBILITY, which is a
        // layout call and stays; it is not standing in for "has a mouse", and
        // the tablets that do see this control are touch devices.
        className="hidden min-h-[44px] shrink-0 self-center items-center gap-1 rounded-none px-2 text-[13px] text-parchment-400 hover:bg-[color:var(--bg-raised)] hover:text-parchment-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)] sm:inline-flex [@media(pointer:fine)]:min-h-[32px]"
      >
        <Link2 size={14} aria-hidden />
        {copied ? "Copied" : "Copy"}
      </button>
      <ChevronRight
        size={16}
        aria-hidden
        className={`shrink-0 self-center text-parchment-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
      />
    </div>
  );
}
