"use client";

// The board keymap: ONE table that is both the bindings and the help sheet.
//
// Lichess keeps its whole keymap in a single file (`modules/web/src/main/ui/
// help.scala`) and renders the `?` dialog straight out of it, which is why the
// two can never disagree. This is that file. `useBoardKeys` binds from the
// table, `ShortcutsDialog` renders from the table, and a binding that is not in
// the table does not exist.
//
// Three kinds of entry live here:
//
//   - Bound HERE (`match` non-empty): the hook owns them. `f` flips, `?` raises
//     the sheet, `k`/`j`/`0`/`$`/Home/End scrub the move history, `c` focuses
//     chat.
//   - Bound ELSEWHERE but documented here (`match` empty): the arrow keys and
//     Escape inside the move list (MoveList.tsx), `z` for zen (useZenMode.ts),
//     `y`/`t` for the card dock (dockView.ts), and everything the board's own
//     grid handler owns while it holds focus (Board.tsx). Listing them without
//     binding them is deliberate: binding a second listener for the same key
//     would fire the action twice.
//
// Surface-scoped on purpose: /analysis, /tv and /history/[id] can adopt this by
// calling useBoardKeys with the handlers they can honour, without Board.tsx
// having to know anything about them.

import { useCallback, useEffect, useRef, useState } from "react";
import { SETTINGS_CHANGED_EVENT, loadSettings, saveSettings } from "@/lib/settings";

/** True when the caret is somewhere a plain letter is text, not a shortcut.
 *  The same guard useZenMode and the card dock apply. */
export function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

/** Where a ply jump goes. The same four the move list's buttons offer. */
export type PlyNav = "prev" | "next" | "first" | "last";

export type BoardKeyAction =
  | "flip"
  | "help"
  | "plyPrev"
  | "plyNext"
  | "plyFirst"
  | "plyLast"
  | "chatFocus";

export interface KeyBinding {
  /** What this row does, or null when it is documentation for a key another
   *  module binds. */
  action: BoardKeyAction | null;
  /** The caps drawn on the sheet. */
  keys: string[];
  /** KeyboardEvent.key values this hook listens for. Empty means "documented
   *  here, bound somewhere else". */
  match: string[];
  what: string;
  /** Keys pressed TOGETHER ("Ctrl + Home") rather than alternatives. */
  chord?: boolean;
}

export interface KeyGroup {
  title: string;
  note?: string;
  bindings: KeyBinding[];
}

export const BOARD_KEYMAP: KeyGroup[] = [
  {
    title: "Playing a move",
    note: "Tab onto the board first. While it holds focus the board owns the arrow keys.",
    bindings: [
      { action: null, keys: ["Tab"], match: [], what: "Move focus onto the board, and off it again" },
      { action: null, keys: ["←", "↑", "→", "↓"], match: [], what: "Move the square cursor" },
      { action: null, keys: ["Home", "End"], match: [], what: "First or last square on the rank" },
      {
        action: null,
        keys: ["Ctrl", "Home"],
        match: [],
        chord: true,
        what: "Far corner of the board (Ctrl + End for the near one)",
      },
      { action: null, keys: ["Enter"], match: [], what: "Pick up the piece under the cursor, then play its move" },
      { action: null, keys: ["Space"], match: [], what: "The same as Enter" },
      { action: null, keys: ["Esc"], match: [], what: "Drop the selection" },
    ],
  },
  {
    title: "The board",
    bindings: [
      { action: "flip", keys: ["f"], match: ["f", "F"], what: "Flip the board" },
      { action: null, keys: ["z"], match: [], what: "Zen mode" },
      { action: "help", keys: ["?"], match: ["?"], what: "This sheet" },
    ],
  },
  {
    title: "Move history",
    note: "Active whenever the board does not hold focus. Scrolling over the board does the same.",
    bindings: [
      { action: "plyPrev", keys: ["←", "k"], match: ["k", "K"], what: "Step back one move" },
      { action: "plyNext", keys: ["→", "j"], match: ["j", "J"], what: "Step forward one move" },
      { action: "plyFirst", keys: ["↑", "0", "Home"], match: ["0", "Home"], what: "Jump to the start" },
      { action: "plyLast", keys: ["↓", "$", "End"], match: ["$", "End"], what: "Jump to the live position" },
      { action: null, keys: ["Esc"], match: [], what: "Return to the live position" },
    ],
  },
  {
    title: "Your cards",
    bindings: [
      { action: null, keys: ["y"], match: [], what: "Show your cards" },
      { action: null, keys: ["t"], match: [], what: "Show the opponent's" },
    ],
  },
  {
    title: "Chat",
    bindings: [
      { action: "chatFocus", keys: ["c"], match: ["c", "C"], what: "Focus the chat box" },
      { action: null, keys: ["Esc"], match: [], what: "Leave the chat box" },
    ],
  },
];

/** Flip the board through the normal settings write path, so the button, the
 *  key and the settings panel can never disagree. */
export function setFlipBoard(on: boolean) {
  const current = loadSettings();
  if (current.flipBoard === on) return;
  saveSettings({ ...current, flipBoard: on });
}

/** The live flip flag plus a toggle, kept in step with every other surface
 *  through the settings-changed event. Starts false so the server and the first
 *  client render agree (the reason useSettingsValue starts from the defaults). */
export function useFlipBoard(): { flipped: boolean; toggleFlip: () => void } {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    const sync = () => setFlipped(loadSettings().flipBoard);
    sync();
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
  }, []);
  const toggleFlip = useCallback(() => setFlipBoard(!loadSettings().flipBoard), []);
  return { flipped, toggleFlip };
}

/**
 * The chat box, addressed by its accessible name because ChatPanel is not this
 * module's to change. When the panel is collapsed its input is not mounted, so
 * the expander is pressed first and the focus happens on the next frame.
 */
function focusChat(): boolean {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Chat message"]');
  if (input) {
    input.focus();
    return true;
  }
  const expand = document.querySelector<HTMLElement>('[aria-label="Expand chat"]');
  if (!expand) return false;
  expand.click();
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>('input[aria-label="Chat message"]')?.focus();
  });
  return true;
}

export interface BoardKeyHandlers {
  /** Raise the shortcut sheet. */
  onHelp?: () => void;
  /** Scrub the game history. Omit on a surface with no history to scrub, and
   *  those keys simply do nothing there. */
  onPlyNav?: (to: PlyNav) => void;
  /** Set false on a surface with no chat. */
  chat?: boolean;
  /** Set false where the board's orientation is local rather than the setting
   *  (/analysis owns its own flip). */
  flip?: boolean;
}

/**
 * Bind every key the table says this module owns. One window listener,
 * ignored while typing and while a modifier is held, so nothing here can steal
 * a browser or OS shortcut.
 */
export function useBoardKeys(handlers: BoardKeyHandlers = {}) {
  // The handlers change identity every render (they close over host state); a
  // ref keeps the listener registered once instead of being torn down and
  // rebound on every keystroke elsewhere on the page.
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const run = (action: BoardKeyAction): boolean => {
      const h = ref.current;
      switch (action) {
        case "flip":
          if (h.flip === false) return false;
          setFlipBoard(!loadSettings().flipBoard);
          return true;
        case "help":
          if (!h.onHelp) return false;
          h.onHelp();
          return true;
        case "plyPrev":
        case "plyNext":
        case "plyFirst":
        case "plyLast": {
          if (!h.onPlyNav) return false;
          const to: PlyNav =
            action === "plyPrev"
              ? "prev"
              : action === "plyNext"
              ? "next"
              : action === "plyFirst"
              ? "first"
              : "last";
          h.onPlyNav(to);
          return true;
        }
        case "chatFocus":
          if (h.chat === false) return false;
          return focusChat();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      // Escape leaves the chat box. Checked before the typing guard, because
      // the caret being in the chat box is exactly the condition.
      if (e.key === "Escape") {
        const active = document.activeElement as HTMLElement | null;
        if (active?.getAttribute("aria-label") === "Chat message") {
          active.blur();
          e.preventDefault();
        }
        return;
      }
      if (typingInField(e.target)) return;
      for (const group of BOARD_KEYMAP) {
        for (const binding of group.bindings) {
          if (!binding.action || binding.match.length === 0) continue;
          if (!binding.match.includes(e.key)) continue;
          if (run(binding.action)) e.preventDefault();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
