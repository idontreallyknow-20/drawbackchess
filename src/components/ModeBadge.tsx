import type { DraftMode } from "@/engine/buff";

// The mode color identity in pill form: Nerf mode reads slightly red, Buff
// mode blue, everywhere a game or seek is listed. Legacy entries without a
// mode render nothing.
export function ModeBadge({ mode, compact }: { mode: DraftMode | undefined; compact?: boolean }) {
  if (mode !== "nerf" && mode !== "buff") return null;
  // Flat: the word in the mode's colour, no wash and no chip border. It reads
  // as a label in a row, the way Lichess writes "Blitz" beside a game.
  const identity = mode === "nerf" ? "text-mode-nerfGlow" : "text-mode-buffGlow";
  const size = compact ? "text-[12px]" : "text-[12px]";
  return (
    <span className={`shrink-0 inline-flex items-center font-medium ${size} ${identity}`}>
      {mode === "nerf" ? "Nerf" : "Buff"}
    </span>
  );
}
