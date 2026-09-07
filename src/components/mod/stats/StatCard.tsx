"use client";

// The stats pages' number tile, the console's dense register: figure first,
// uppercase label under it. Place several inside one `.plate` grid.

export function StatCard({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="px-3.5 py-3">
      <div className="font-display text-[22px] leading-none tabular-nums text-parchment-50">
        {value.toLocaleString()}
        {suffix && <span className="text-sm text-parchment-400">{suffix}</span>}
      </div>
      <div className="mt-1 text-[12px] uppercase tracking-[0.05em] text-parchment-400">{label}</div>
    </div>
  );
}
