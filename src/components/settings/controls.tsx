"use client";

// Reusable, presentational controls for the settings menu. None of these hold
// application state — they take a value and an onChange. The carved-recess
// styling (tracks, thumbs, hit areas) lives in SettingsPanel.css.

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Forged toggle: a carved recess in the stone with a gem thumb that lights
 *  with the accent energy when on. The visual stays 44x24; the CSS ::before
 *  pads the touch target to 44px tall. */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="settings-toggle"
    >
      <span aria-hidden className="settings-toggle__thumb" />
    </button>
  );
}

/** Range slider in a carved stone channel with a monospace readout on the
 *  right. Fills the space its row offers (the row caps the width). */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  disabled = false,
  format,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange?: (next: number) => void;
  disabled?: boolean;
  format?: (v: number) => string;
  label?: string;
}) {
  return (
    <div
      className={
        "flex w-full min-w-[8.5rem] max-w-[16rem] items-center gap-2.5 " +
        (disabled ? "opacity-40" : "")
      }
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange?.(parseFloat(e.target.value))}
        // `.settings-range` sets height:24px, which measured 24px tall at 360
        // on both settings surfaces. min-height wins over height in the box
        // model, so this lifts the coarse-pointer target to the §10 floor
        // without touching the stylesheet's track and thumb geometry (both are
        // pseudo-elements, vertically centred in whatever box they are given).
        // The row it sits in is already min-h-[44px], so nothing moves.
        className="settings-range min-h-[44px] w-full accent-gold-leaf [@media(pointer:fine)]:min-h-[24px]"
      />
      <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-parchment-400">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

/** Native select carved into the stone (the shared .input-rune recess). */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
        // 44px on a finger, 36px once there is a pointer: the same rule
        // ui/Button applies to every size, and for the same reason. It used to
        // be a flat 36px, which measured 36px tall at 360 on the settings page
        // and in the panel alike, under the §10 floor. `(pointer: fine)`, never
        // `sm:` — a tablet is a touch device on the far side of `sm`.
        className="input-rune min-h-[44px] cursor-pointer appearance-none py-1.5 pl-3 pr-8 text-[13px] font-medium text-parchment-200 [&>option]:bg-ink-800 [@media(pointer:fine)]:min-h-[36px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-parchment-400" />
    </div>
  );
}

/** Small secondary action button (e.g. Reset, Apply, Remove). */
export function GhostButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <Button tone="ghost"
     
      onClick={onClick}
      className="shrink-0 px-3 py-1.5 text-[13px] font-medium">
      {label}
    </Button>
  );
}
