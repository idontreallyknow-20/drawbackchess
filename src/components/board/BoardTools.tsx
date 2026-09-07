"use client";

// The two board-surface controls the match pages were missing, plus the keymap
// binding for the surface they sit on.
//
// FLIP: `settings.flipBoard` has always existed and both match pages already
// derive `orientation` from it, but the only way to reach it was three levels
// into the settings panel. /analysis has had a flip button on the board since
// it shipped, which left the game surface as the odd one out. This is that
// button, plus `f`, both writing the same setting (boardKeymap.ts) so the
// panel, the button and the key can never disagree.
//
// SHORTCUTS: `?` and a button onto the sheet listing every binding, rendered
// from the same table the keys are bound from.
//
// The keys are bound here rather than in Board.tsx on purpose: Board also
// renders on /analysis (which owns a LOCAL flip), on the history replay and in
// the dev lab, and none of those should be writing a global preference out
// from under the player. A surface adopts the keymap by mounting this, or by
// calling useBoardKeys itself.

import { useState } from "react";
import { FlipVertical2, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useBoardKeys, useFlipBoard, type PlyNav } from "@/lib/boardKeymap";
import { ShortcutsDialog } from "./ShortcutsDialog";

export function BoardTools({
  onPlyNav,
  className = "",
}: {
  /** History scrubbing for `k`/`j`/`0`/`$`/Home/End. Omit where there is no
   *  history to scrub and those keys go quiet. */
  onPlyNav?: (to: PlyNav) => void;
  className?: string;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const { flipped, toggleFlip } = useFlipBoard();
  useBoardKeys({ onHelp: () => setHelpOpen((open) => !open), onPlyNav });

  return (
    <div className={"flex items-center gap-1 " + className}>
      <Button
        tone="default"
        size="sm"
        iconOnly
        aria-label="Flip board"
        aria-pressed={flipped}
        title="Flip board (f)"
        onClick={toggleFlip}
      >
        <FlipVertical2 size={15} aria-hidden />
      </Button>
      <Button
        tone="default"
        size="sm"
        iconOnly
        aria-label="Keyboard shortcuts"
        aria-haspopup="dialog"
        title="Keyboard shortcuts (?)"
        onClick={() => setHelpOpen(true)}
      >
        <Keyboard size={15} aria-hidden />
      </Button>
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
