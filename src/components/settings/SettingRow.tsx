"use client";

import type { ReactNode } from "react";

/**
 * A single settings row: label + optional hint on the left, a control on the
 * right, at a comfortable 44px minimum height. When `stacked` is set (e.g. the
 * board-theme grid) the control drops onto its own full-width line below the
 * label. When `grow` is set (sliders) the control side takes the remaining row
 * width instead of hugging the right edge at a fixed size.
 */
export function SettingRow({
  label,
  hint,
  control,
  stacked = false,
  grow = false,
}: {
  label: string;
  hint?: string;
  control: ReactNode;
  stacked?: boolean;
  grow?: boolean;
}) {
  const text = (
    <div className="min-w-0">
      <span className="block truncate text-[14px] font-medium leading-tight text-parchment-100 sm:text-[13px]">
        {label}
      </span>
      {hint && (
        <p className="mt-0.5 text-[13px] leading-snug text-parchment-400">{hint}</p>
      )}
    </div>
  );

  if (stacked) {
    return (
      <div className="py-2.5">
        {text}
        <div className="mt-2">{control}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[44px] items-center justify-between gap-4 py-2">
      {text}
      <div className={grow ? "flex min-w-0 flex-1 justify-end" : "shrink-0"}>{control}</div>
    </div>
  );
}
