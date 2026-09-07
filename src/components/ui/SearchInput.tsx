"use client";

import { Search, X } from "lucide-react";

// The one search field.
//
// Four pages each hand-rolled a search box (the club directory, the codex
// browser, the mod player list, the mod card list) and no two agreed on the
// geometry. Measured at 360 in a touch context they came out at 19.5px, 40.5px,
// 37px and 31.5px tall against docs/design-system.md §10's 44px floor, and the
// clear button, where a page had one, was a 12px word or a 28px glyph.
//
// Two things are worth saying about how the height is built here.
//
// 1. The MIN-HEIGHT IS ON THE INPUT, not on the wrapper. The wrapper carries no
//    vertical padding at all. A 44px box around a 19.5px field is not a 44px
//    target: the pixels above and below the text belong to the wrapper and do
//    not focus the field. (This is also exactly what the sweep's "filled by
//    row" exemption tests for, and why the club box failed it.)
// 2. The step-down is `[@media(pointer:fine)]`, never `sm:`/`md:`/`lg:`. A
//    1024px tablet is a coarse pointer. A width breakpoint here would look
//    correct in a 360px audit and hand every tablet a 36px field.
//
// Sizes are literal pixels, not `h-11`: the interface root is 14px, so Tailwind's
// rem spacing resolves to 87.5% of nominal and `h-11` renders 38.5px.

export type SearchInputProps = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Accessible name. Rendered as aria-label; there is no visible label. */
  label: string;
  id?: string;
  /**
   * "field" is the bordered control on the page ground (the codex browser).
   * "plate" is the raised panel treatment (the club directory, mod lists).
   */
  variant?: "field" | "plate";
  autoFocus?: boolean;
  /** Extra classes for the OUTER box: widths, margins, responsive caps. */
  className?: string;
};

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  id,
  variant = "field",
  autoFocus,
  className = "",
}: SearchInputProps) {
  return (
    <div
      className={[
        "flex min-w-0 items-center gap-2.5 px-3",
        variant === "plate"
          ? "plate"
          : "rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-base)]",
        // The field has no focus ring of its own (focus:outline-none below), so
        // the ring is painted on the box that actually surrounds it.
        "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--accent)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Search size={16} aria-hidden className="shrink-0 text-parchment-400" />
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        className="min-h-[44px] w-full min-w-0 flex-1 bg-transparent py-0 text-[14px] text-parchment placeholder:text-parchment-500 focus:outline-none [@media(pointer:fine)]:min-h-[36px]"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="grid h-[44px] w-[44px] shrink-0 place-items-center text-parchment-400 transition-colors hover:text-parchment-100 [@media(pointer:fine)]:h-[28px] [@media(pointer:fine)]:w-[28px]"
        >
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}
