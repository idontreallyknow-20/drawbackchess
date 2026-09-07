"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { glossaryHref, lookupEntry } from "@/lib/glossary";

/**
 * A single inline glossary chip: a term carrying a subtle dotted underline that
 * reveals its definition on hover, keyboard focus, tap, or a long press — and
 * pins open on click into a richer popover (one-liner, detail, example, and a
 * "read more" link into the glossary page anchor).
 *
 * Design law: 1px corners, no gradient / glow / shadow, a hairline border, and
 * a coral-accent colour on hover (the term itself tints coral, plus its
 * underline) so it clearly reads as interactive. The only motion is a colour
 * transition on the trigger, gated behind motion-safe so reduced-motion users
 * get a still, instant reveal.
 *
 * Interaction model: hovering opens a transient popover that closes on mouse
 * leave; clicking (or Enter / Space, or holding a touch for LONG_PRESS_MS) PINS
 * it open so the pointer can travel into the popover and follow the read-more
 * link. Escape, an outside tap, or focus leaving the whole chip closes a pinned
 * popover. Accessible: the trigger is focusable, exposes expanded state via
 * aria-expanded / aria-controls, describes itself through aria-describedby while
 * open, and keeps a title as the no-JS fallback.
 *
 * The popover renders in a PORTAL, fixed-positioned from the trigger's measured
 * rect. It has to: the most valuable place to read a definition is on a card
 * inside the draft overlay, and that panel is a `overflow-y-auto
 * overflow-x-hidden` scroll box — an absolutely-positioned popover was simply
 * clipped away there, so the mobile tap appeared to do nothing at all.
 */

/** Touch hold that counts as "explain this", in ms. */
const LONG_PRESS_MS = 350;
/** Popover width, and the gap kept from the viewport edges. */
const POPOVER_W = 288;
const EDGE_PAD = 8;

export function GlossaryTerm({ term, definition }: { term: string; definition: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A long press already opened the popover, so the click that follows the
  // touch release must not immediately toggle it shut again.
  const heldOpen = useRef(false);
  // The rich entry behind the matched text (resolves aliases and plurals).
  // Data-only import, so the client bundle stays free of server code.
  const entry = lookupEntry(term);

  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const width = Math.min(POPOVER_W, window.innerWidth - EDGE_PAD * 2);
    // Prefer left-aligned under the term, then pull back inside the viewport.
    const left = Math.min(Math.max(EDGE_PAD, r.left), window.innerWidth - width - EDGE_PAD);
    // The VISUAL viewport, not the layout one: on phones the on-screen
    // keyboard shrinks visualViewport without firing a window resize, and the
    // popover must not open underneath it.
    const viewH = window.visualViewport?.height ?? window.innerHeight;
    // Flip above the term when there is not enough room below it, and cap the
    // panel so a long detail+example never overflows a small screen: at most
    // 60% of the viewport, and never more than the room on the chosen side of
    // the anchor (the panel scrolls internally past that).
    const h = popRef.current?.offsetHeight ?? 0;
    const below = r.bottom + 4;
    const spaceBelow = viewH - below - EDGE_PAD;
    const spaceAbove = r.top - 4 - EDGE_PAD;
    const flip = h > 0 && h > spaceBelow && spaceAbove > spaceBelow;
    const maxH = Math.max(64, Math.min(viewH * 0.6, flip ? spaceAbove : spaceBelow));
    const top = flip ? Math.max(EDGE_PAD, r.top - 4 - Math.min(h, maxH)) : below;
    setPos({ left, top, maxH });
  }, []);

  const cancelHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);

  const show = useCallback(
    (pin: boolean) => {
      place();
      setOpen(true);
      if (pin) setPinned(true);
    },
    [place],
  );

  const hide = useCallback(() => {
    setOpen(false);
    setPinned(false);
  }, []);

  // Measure once mounted (the first pass has no height to flip against) and
  // keep the popover attached to its term while the page moves under it. The
  // draft panel scrolls, so without this the definition would drift off its word.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || popRef.current?.contains(target)) return;
      hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    // Any scroll or resize re-measures; `capture` so a scrolling ancestor
    // (the draft panel, the codex list) is heard, not just the window.
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    // The phone keyboard (and pinch zoom) resizes/pans the VISUAL viewport
    // without any window resize; re-measure on those too where supported.
    const vv = window.visualViewport;
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
    };
  }, [open, hide, place]);

  useEffect(() => cancelHold, [cancelHold]);

  return (
    <span
      ref={ref}
      className="relative inline"
      // React's onBlur is focusout under the hood, so it bubbles here from the
      // trigger AND the popover link: close only when focus leaves the chip
      // entirely, so tabbing into "read more" never slams the popover shut.
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!ref.current?.contains(next) && !popRef.current?.contains(next)) hide();
      }}
    >
      <span
        ref={triggerRef}
        tabIndex={0}
        role="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-describedby={open ? id : undefined}
        // title is the graceful fallback when styling or JS is unavailable; it
        // does not fire on touch, hence the tap-toggled popover below.
        title={definition}
        onMouseEnter={() => show(false)}
        onMouseLeave={() => {
          if (!pinned) setOpen(false);
        }}
        onFocus={() => show(false)}
        // Touch and pen only: a hold explains the word without the tap having
        // to compete with the card underneath. Mouse keeps hover + click.
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          // A press on the term is the term's alone: inside the draft overlay
          // the card underneath must not see this pointerdown and start its
          // own press/drag while the definition is being held open.
          e.stopPropagation();
          heldOpen.current = false;
          cancelHold();
          holdTimer.current = setTimeout(() => {
            heldOpen.current = true;
            show(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerMove={(e) => {
          // Treat a drag as scrolling, not a hold.
          if (e.pointerType !== "mouse" && holdTimer.current) cancelHold();
        }}
        onClick={(e) => {
          // A tap on the term must not click through to a parent card button.
          e.stopPropagation();
          cancelHold();
          // The long press already opened it; swallow the trailing click.
          if (heldOpen.current) {
            heldOpen.current = false;
            return;
          }
          // Unpinned (closed or hover-open): pin the popover open. Pinned:
          // close and release it.
          if (pinned) hide();
          else show(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (pinned) hide();
            else show(true);
          }
        }}
        className="cursor-help underline decoration-dotted decoration-parchment-500 underline-offset-2 outline-none hover:text-coral hover:decoration-coral/80 focus-visible:text-coral focus-visible:decoration-coral/80 motion-safe:transition-colors motion-safe:duration-150"
      >
        {term}
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            id={id}
            ref={popRef}
            // Fixed + portalled so no scrolling ancestor can clip it. z-[70]
            // clears the draft overlay's z-[55], which is the one place this
            // most needs to be readable.
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              width: Math.min(POPOVER_W, (typeof window !== "undefined" ? window.innerWidth : 400) - EDGE_PAD * 2),
              // Capped by place() to the room on the anchor's side of the
              // viewport (never more than 60% of it): a long detail+example
              // scrolls inside the panel instead of overflowing a small phone.
              maxHeight: pos?.maxH,
            }}
            className="fixed z-[70] block overflow-y-auto overscroll-contain rounded-none border border-[color:var(--edge)] bg-ink-800 px-3 py-2.5 text-left text-[12px] font-body font-normal normal-case leading-snug text-parchment-100 shadow-plate"
          >
            {entry && (
              <span className="block font-display text-[13px] tracking-wide text-parchment">
                {entry.term}
              </span>
            )}
            <span className={entry ? "mt-1 block" : "block"}>{definition}</span>
            {entry?.detail && (
              <span className="mt-1.5 block text-parchment-200">{entry.detail}</span>
            )}
            {entry?.example && (
              <span className="mt-1.5 block italic text-parchment-400">{entry.example}</span>
            )}
            {entry && (
              <Link
                href={glossaryHref(entry)}
                onClick={(e) => e.stopPropagation()}
                className="mt-2 block text-coral hover:text-coral hover:underline"
              >
                Read more in the glossary →
              </Link>
            )}
          </span>,
          document.body,
        )}
    </span>
  );
}
