"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The four things every full-screen overlay in this app needs and, before
 * this hook, mostly did not have. FilterSheet was the only overlay that locked
 * body scroll; nothing but the draft overlay handled Escape.
 *
 * 1. BODY SCROLL LOCK — without it a touch drag on the backdrop scrolls the
 *    page behind the modal, so closing it lands the reader somewhere else.
 * 2. ESCAPE — `aria-modal="true"` promises keyboard dismissal.
 * 3. A GHOST-CLICK GUARD (`dismissArmed`) — on touch, the tap that CAUSES a
 *    modal to mount also fires a trailing synthesized mouse event at the same
 *    coordinates a moment later. Landing on a freshly-mounted full-bleed
 *    backdrop, that closes the modal the instant it appears. Board.tsx
 *    documents and fixes exactly this for its promotion picker; the game-over
 *    screen had the same hazard (the winning move commits on pointerdown, the
 *    result screen mounts in the same frame, and a finishing tap outside the
 *    centred panel dismissed it immediately). Gate backdrop dismissal on
 *    `dismissArmed` and the ghost event is ignored while a real tap-away,
 *    which arrives later, still works.
 * 4. A FOCUS TRAP (`attachDialog`) — the other half of the `aria-modal="true"`
 *    promise, and the half this hook was missing. Without it, Tab walks a
 *    keyboard user straight out of the dialog and into the page behind, which
 *    is still rendered and still focusable but is visually covered and
 *    inert-looking. They then tab through a page they cannot see, with no way
 *    back except Escape, which they have no reason to believe will work.
 *    design-system.md section 10 states the contract: "modals trap focus and
 *    close on Escape". Half of that was true.
 *
 * Scroll locking is reference-counted so nested overlays (a confirm on top of
 * a panel) restore the page exactly once, in the right order. The focus trap
 * is stacked for the same reason: only the TOPMOST open dialog traps, so a
 * confirm layered over a settings panel does not fight it for focus, and
 * closing the confirm hands focus back to the panel rather than to the page.
 */

let scrollLocks = 0;
let savedOverflow = "";
let savedPaddingRight = "";

/**
 * The stack of currently-trapping dialogs, innermost last. A dialog only
 * enforces the trap while it is the last entry, which is what makes nesting
 * behave: the outer dialog stays mounted and focusable, it just stops
 * policing Tab until the inner one unmounts.
 */
const trapStack: HTMLElement[] = [];

/**
 * The last few elements that held focus, most recent first.
 *
 * A dialog cannot simply read `document.activeElement` when it opens and
 * restore to that on close, because the thing that opened it is frequently
 * already gone by then. The settings panel is the proof: the header's
 * quick-settings popover calls `setOpen(false)` and `onOpenPreferences()` in
 * one click handler, React commits both in the same pass, and by the time the
 * panel's effects run the "All preferences" button has been unmounted. There
 * is nothing left to remember, and focus lands on `<body>`, which means the
 * user's next Tab restarts at the top of the document.
 *
 * Keeping a short history fixes it without any call site having to
 * cooperate: the popover's own trigger (still on the page) is one step
 * further back in the list, so closing the panel returns the keyboard to the
 * control the user actually came from.
 *
 * Detached entries are not pruned eagerly; they are filtered on use and
 * pushed out by ordinary focus movement, so the list holds at most a handful
 * of stale nodes at any moment.
 */
const RECENT_FOCUS_DEPTH = 8;
const recentFocus: HTMLElement[] = [];

if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el === document.body) return;
      const at = recentFocus.indexOf(el);
      if (at >= 0) recentFocus.splice(at, 1);
      recentFocus.unshift(el);
      if (recentFocus.length > RECENT_FOCUS_DEPTH) recentFocus.length = RECENT_FOCUS_DEPTH;
    },
    true,
  );
}

/**
 * Elements that can hold focus. `[tabindex]` catches the roving-tabindex and
 * `tabindex="-1"` cases, which are filtered out below by reading the resolved
 * `tabIndex` property rather than trusting the attribute string.
 */
const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]",
  "[tabindex]",
].join(",");

/**
 * The focusable descendants of `root`, in tab order.
 *
 * Queried fresh on every Tab rather than cached at mount: dialog content in
 * this app changes while open (the settings panel drills into sub-pages, the
 * clip studio swaps panels, a targeting picker repopulates as the board
 * changes), and a cached list would trap focus against elements that no
 * longer exist.
 *
 * `offsetParent === null` is the cheap, reliable test for "not rendered":
 * it covers `display: none` on the element or any ancestor, which is how this
 * codebase hides things (globals.css sets `[hidden]` and the zen-mode and
 * `data-anim` kill switches all resolve to `display: none`). It does NOT
 * catch `visibility: hidden`, so that is checked separately.
 */
function focusables(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))) {
    if (el.hasAttribute("disabled")) continue;
    if (el.getAttribute("aria-hidden") === "true") continue;
    // Negative tabindex means "focusable by script, not by Tab", so it is
    // correctly excluded from the cycle even though it matched the selector.
    if (el.tabIndex < 0) continue;
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    out.push(el);
  }
  return out;
}

function lockScroll() {
  if (typeof document === "undefined") return;
  if (scrollLocks++ > 0) return;
  const body = document.body;
  savedOverflow = body.style.overflow;
  savedPaddingRight = body.style.paddingRight;
  // Compensate for the scrollbar the lock removes, so the page behind does not
  // visibly jump sideways on desktop. Zero on overlay-scrollbar platforms.
  const gap = window.innerWidth - document.documentElement.clientWidth;
  if (gap > 0) body.style.paddingRight = `${gap}px`;
  body.style.overflow = "hidden";
}

function unlockScroll() {
  if (typeof document === "undefined") return;
  if (--scrollLocks > 0) return;
  scrollLocks = 0;
  document.body.style.overflow = savedOverflow;
  document.body.style.paddingRight = savedPaddingRight;
}

export interface ModalChrome {
  /** False for the first frames after mount; gate backdrop dismissal on it. */
  dismissArmed: boolean;
  /** Attach to the backdrop: dismisses only once armed. */
  onBackdropPointerDown: (e: { target: unknown; currentTarget: unknown }) => void;
  /**
   * Attach to the dialog PANEL (the element carrying `role="dialog"` and
   * `aria-modal="true"`), not to the backdrop. Focus moves inside it on open,
   * Tab cycles within it, and the element that was focused before it opened
   * gets focus back on close.
   *
   * Optional: a call site that does not attach it keeps every other behaviour
   * and simply does not trap, which is how this shipped before the trap
   * existed. Attaching it is the fix.
   *
   * A CALLBACK ref rather than an object ref, for two reasons. It is what
   * makes the trap effect re-run when the panel element actually attaches
   * (a plain ref's `.current` mutating does not re-run an effect, so a dialog
   * whose panel mounts a frame late would never get trapped), and reading
   * `chrome.attachDialog` during render is a ref-value access that the React
   * Compiler lint rejects, correctly.
   */
  attachDialog: (el: HTMLElement | null) => void;
}

/**
 * @param active whether the overlay is currently shown.
 * @param onClose dismissal callback (Escape and an armed backdrop press).
 * @param opts.armDelayMs how long to ignore backdrop presses after mount.
 *   250ms comfortably outlives the ~300ms-max synthesized-click window on the
 *   platforms that still emit one, without being noticeable to a real user.
 * @param opts.trap set false for an overlay that deliberately leaves the page
 *   behind it operable, where trapping focus would take away a control the
 *   player still needs. Nothing sets it today; it exists because the board's
 *   square-targeting flow is exactly that shape (the overlay dims the screen
 *   while the player picks on the live board underneath), and if that flow
 *   ever grows a panel of its own this is the switch it needs.
 */
export function useModalChrome(
  active: boolean,
  onClose?: () => void,
  opts: {
    armDelayMs?: number;
    lockScroll?: boolean;
    escape?: boolean;
    trap?: boolean;
  } = {},
): ModalChrome {
  const {
    armDelayMs = 250,
    lockScroll: wantLock = true,
    escape = true,
    trap = true,
  } = opts;
  // The panel element, held in state rather than a ref so the trap effect
  // re-runs the moment it attaches or swaps.
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const attachDialog = useCallback((el: HTMLElement | null) => setPanel(el), []);
  const [dismissArmed, setDismissArmed] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Arm on a timer, never synchronously: a setState in the effect body would
  // cascade a render. Disarming is handled during render below (the standard
  // derived-state pattern) rather than in the cleanup.
  const [armedFor, setArmedFor] = useState<boolean | null>(null);
  if (armedFor !== active) {
    setArmedFor(active);
    if (dismissArmed) setDismissArmed(false);
  }
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setDismissArmed(true), armDelayMs);
    return () => window.clearTimeout(id);
  }, [active, armDelayMs]);

  useEffect(() => {
    if (!active || !wantLock) return;
    lockScroll();
    return unlockScroll;
  }, [active, wantLock]);

  useEffect(() => {
    if (!active || !escape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, escape]);

  // The focus trap. Runs only when the call site has attached `attachDialog`, so
  // this is inert at a site that has not opted in.
  useEffect(() => {
    if (!active || !trap || !panel) return;

    // Snapshot the focus history so it can be walked on close. Without a
    // restore, closing a dialog drops focus onto <body> and the next Tab
    // restarts at the top of the page, which for the settings panel means
    // tabbing the whole header again to get back to where you were.
    //
    // A snapshot of the whole list rather than just the front entry, because
    // the front entry is often already detached (see `recentFocus` above).
    const restoreCandidates = recentFocus.slice();

    trapStack.push(panel);

    // Move focus in. Prefer an element the author marked, then the first
    // natural stop, then the panel itself. The panel needs tabindex="-1" to
    // be focusable at all, and it is set here rather than demanded of every
    // call site.
    const preferred = panel.querySelector<HTMLElement>("[data-autofocus]");
    const first = preferred ?? focusables(panel)[0];
    if (first) {
      first.focus();
    } else {
      if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
      panel.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      // Only the innermost open dialog polices Tab.
      if (trapStack[trapStack.length - 1] !== panel) return;
      const items = focusables(panel);
      if (items.length === 0) {
        // Nothing to cycle between, so keep focus on the panel rather than
        // letting Tab escape to the page behind.
        e.preventDefault();
        panel.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      // Focus can sit outside the cycle legitimately (on the panel itself
      // after the empty-panel branch above, or on an element that was removed
      // and re-added). Pull it back to the right end rather than assuming it
      // is at one edge.
      if (!current || !panel.contains(current)) {
        e.preventDefault();
        (e.shiftKey ? lastItem : firstItem).focus();
        return;
      }
      if (e.shiftKey && current === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && current === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    // Capture phase, so a dialog whose content stops propagation on keydown
    // (the clip studio does this for its own shortcuts) cannot disable the
    // trap by accident.
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const at = trapStack.lastIndexOf(panel);
      if (at >= 0) trapStack.splice(at, 1);
      // Only restore if focus is still somewhere inside the dialog that is
      // closing. If the user has already clicked elsewhere, stealing focus
      // back would be the bug, not the fix.
      const now = document.activeElement;
      const inside = !now || now === document.body || panel.contains(now);
      if (!inside) return;
      // Most recent survivor wins. Entries inside the dialog that is closing
      // are skipped: they are about to be detached themselves, and restoring
      // to one would put focus on a node that is gone a frame later.
      for (const candidate of restoreCandidates) {
        if (!candidate.isConnected) continue;
        if (panel.contains(candidate)) continue;
        candidate.focus();
        return;
      }
    };
  }, [active, trap, panel]);

  return {
    dismissArmed,
    attachDialog,
    onBackdropPointerDown: (e) => {
      // Only a press that STARTED on the backdrop itself dismisses, so a drag
      // that began inside the panel and ended outside does not.
      if (e.target !== e.currentTarget) return;
      if (!dismissArmed) return;
      closeRef.current?.();
    },
  };
}
