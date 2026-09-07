"use client";

// Segmented control for switching between rating categories. Data-driven from
// the registry, so it automatically reflects any future queue. Shared by the
// leaderboard and profile pages.

import { ACTIVE_RATING_CATEGORIES, type RatingCategoryId } from "@/lib/ratingCategories";

export function CategoryTabs({
  value,
  onChange,
  className = "",
}: {
  value: RatingCategoryId;
  onChange: (id: RatingCategoryId) => void;
  className?: string;
}) {
  // Underline tabs, the single tab treatment across the site (design system 7):
  // active = parchment-50 with an accent underline, inactive = parchment-300.
  // The per-category hue survives only on the icon so Nerf/Buff keep their
  // identity without reintroducing a boxed segmented control.
  return (
    <div
      role="tablist"
      aria-label="Rating category"
      className={"flex items-stretch gap-5 overflow-x-auto border-b border-[color:var(--edge)] " + className}
    >
      {ACTIVE_RATING_CATEGORIES.map((c) => {
        const Icon = c.icon;
        const selected = value === c.id;
        return (
          <button
            key={c.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(c.id)}
            className={
              // min-h-[44px] matches the lobby's tab row, which already had it. These
              // measured 33.8px, and an underline tab is still a tab: the
              // underline sits at the bottom edge, so the extra height goes above
              // it and the row reads the same.
              // Width, not height: see the lobby tabs, same shape and same miss.
              "-mb-px flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-1 pb-2.5 pt-1 text-[13px] font-medium transition-colors duration-150 [@media(pointer:fine)]:min-w-0 " +
              (selected
                ? "border-[color:var(--accent)] text-parchment-50"
                : "border-transparent text-parchment-300 hover:border-[color:var(--edge-strong)] hover:text-parchment-100")
            }
          >
            <Icon
              className="h-3.5 w-3.5"
              style={{ color: selected ? c.accent : undefined }}
              strokeWidth={2.2}
            />
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
