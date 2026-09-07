"use client";

// The keyboard-shortcut sheet, raised by `?` or the keyboard button beside the
// board. It is the discovery half of keyboard play: the board is fully
// operable from the keyboard now, and nothing on screen said so.
//
// Every row is rendered from BOARD_KEYMAP, the same table useBoardKeys binds
// from, so the sheet cannot drift out of step with the bindings.
//
// A real dialog on the shared chrome (useModalChrome): body-scroll lock,
// Escape, the ghost-click guard on the backdrop, and the focus trap. No
// motion: it is a reference card the reader stops on, and a static mount is
// the one behaviour that is identical under `data-anim="off"` and
// prefers-reduced-motion alike.

import { createPortal } from "react-dom";
import { BOARD_KEYMAP } from "@/lib/boardKeymap";
import { useModalChrome } from "@/lib/useModalChrome";
import { Button } from "@/components/ui/Button";

/** The arrow glyphs are drawn, not spelled, so a screen reader is handed the
 *  word instead of being left to guess at the character. */
const SPOKEN: Record<string, string> = {
  "←": "Left arrow",
  "→": "Right arrow",
  "↑": "Up arrow",
  "↓": "Down arrow",
};

function Keycap({ label }: { label: string }) {
  return (
    <kbd
      aria-label={SPOKEN[label]}
      className="inline-flex min-w-[1.75rem] items-center justify-center border border-[color:var(--edge-strong)] bg-[color:var(--bg-raised)] px-1.5 py-0.5 font-mono text-[12px] font-semibold text-parchment-200"
    >
      {label}
    </kbd>
  );
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Destructured at the top, not read as `chrome.x` down in the JSX: the
  // React Compiler lint treats a live hook result read during render as a ref
  // access. SettingsPanel and GameOver take the same shape.
  const { attachDialog, onBackdropPointerDown } = useModalChrome(open, onClose);
  if (!open) return null;

  // Portalled to the body, like SettingsPanel: the button that raises this
  // lives inside the match rail, which is an overflow-hidden grid cell, and a
  // full-screen overlay must not be a child of the thing it covers.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto overscroll-contain bg-black/70 p-4"
      onPointerDown={onBackdropPointerDown}
    >
      <div
        ref={attachDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-shortcuts-title"
        className="plate plate-raised relative flex max-h-[88dvh] w-full max-w-[34rem] flex-col overflow-hidden"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--edge)] px-4 py-3">
          <h2 id="board-shortcuts-title" className="font-display text-[15px] font-bold text-parchment-100">
            Keyboard shortcuts
          </h2>
          <Button tone="default" size="sm" onClick={onClose} data-autofocus>
            Close
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {BOARD_KEYMAP.map((group) => (
            <section key={group.title} className="mb-4 last:mb-0">
              <h3 className="font-display text-[13px] font-bold text-parchment-100">{group.title}</h3>
              {group.note && (
                <p className="mt-0.5 text-[12px] leading-snug text-parchment-400">{group.note}</p>
              )}
              <dl className="mt-1.5">
                {group.bindings.map((binding) => (
                  <div
                    key={binding.keys.join("+") + binding.what}
                    className="flex items-baseline justify-between gap-3 border-b border-[color:var(--edge)] py-1.5 last:border-b-0"
                  >
                    <dt className="flex shrink-0 flex-wrap items-center gap-1">
                      {binding.keys.map((key, i) => (
                        <span key={key + i} className="flex items-center gap-1">
                          {i > 0 && binding.chord && (
                            <span aria-hidden className="text-[12px] text-parchment-400">
                              +
                            </span>
                          )}
                          <Keycap label={key} />
                        </span>
                      ))}
                    </dt>
                    <dd className="text-right text-[13px] leading-snug text-parchment-300">
                      {binding.what}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          {/* Two NerfChess rules a Lichess player will not expect, and which
              are otherwise invisible: worth saying here rather than nowhere. */}
          <section className="mt-1 border-t border-[color:var(--edge)] pt-3">
            <h3 className="font-display text-[13px] font-bold text-parchment-100">Worth knowing</h3>
            <p className="mt-1 text-[13px] leading-snug text-parchment-300">
              A queued premove that would leave your own king in check is cancelled rather than
              played. Moving into check by hand stays legal.
            </p>
            <p className="mt-1.5 text-[13px] leading-snug text-parchment-300">
              A draft lands every 5 of your own moves, and the board is blocked until you resolve
              it.
            </p>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
