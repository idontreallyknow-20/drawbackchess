/* Small labelled marker for provisional ratings. Replaces the bare trailing
   "?" that used to be appended to usernames/ratings, which read as if the
   name itself were uncertain. Renders next to the rating with an accessible
   label and a hover tooltip explaining what it means. */
export function ProvisionalMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={
        // 15px box: the mark carries 12px type now (the 11px it used to carry
        // was under the design system's caption floor), and a 13px box clipped
        // the glyph against its own border.
        "inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center border border-parchment-400/40 bg-[color:var(--bg-zebra)] align-middle text-[12px] font-bold leading-none text-parchment-400 " +
        className
      }
      title="Provisional rating: still settling after a few more rated games"
      aria-label="Provisional rating"
      role="img"
    >
      ?
    </span>
  );
}
