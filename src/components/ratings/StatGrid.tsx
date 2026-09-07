"use client";

// Detailed statistics for one category, rendered as a compact grid of labelled
// figures. Driven entirely by CategoryStats, so it works for any category.

import { getCategory, type RatingCategoryId } from "@/lib/ratingCategories";
import { formatWinRate, type CategoryStats } from "@/lib/ratings";

function Cell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] px-3 py-3">
      <div className="text-[12px] text-parchment-400">{label}</div>
      <div
        className="mt-1 font-display text-xl tabular-nums leading-none text-parchment"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

export function StatGrid({
  categoryId,
  stats,
}: {
  categoryId: RatingCategoryId;
  stats: CategoryStats;
}) {
  const c = getCategory(categoryId);
  const cells: { label: string; value: string; accent?: string }[] = [
    { label: "Current rating", value: String(Math.round(stats.rating)), accent: c.accent },
    { label: "Peak rating", value: String(Math.round(stats.peak)) },
    { label: "Games played", value: String(stats.games) },
    { label: "Win rate", value: formatWinRate(stats) },
    { label: "Wins", value: String(stats.wins) },
    { label: "Losses", value: String(stats.losses) },
    { label: "Draws", value: String(stats.draws) },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((cell) => (
        <Cell key={cell.label} {...cell} />
      ))}
    </div>
  );
}
