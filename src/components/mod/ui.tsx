"use client";

// The moderation console's control vocabulary. Every section builds from these
// so a "resolve", a "ban" and a "reset tier" read the same way wherever they
// appear. The controls are the site's own: metal buttons, the blue primary,
// the red danger, a round thumb switch, a segmented metal control. Nothing
// here paints its own material.
//
//   default  metal      navigation and reversible actions (Dismiss, Unmute)
//   primary  blue       the action that clears the item (Resolve, Apply)
//   danger   red        the action that takes something away (Ban, Flag)
//   quiet    text       inline text actions inside a row

import Link from "next/link";
import type { ReactNode } from "react";
import { Button, LinkButton, type ButtonSize as CoreSize } from "@/components/ui/Button";

export type ButtonTone = "default" | "primary" | "danger" | "quiet";
export type ButtonSize = "sm" | "md";

const SIZE: Record<ButtonSize, CoreSize> = { sm: "sm", md: "md" };

function quietClass(size: ButtonSize, extra?: string): string {
  return [
    "inline-flex items-center justify-center gap-1.5 text-parchment-300 transition-colors hover:text-parchment-50 disabled:cursor-not-allowed disabled:opacity-40",
    size === "sm" ? "min-h-[36px] px-2 text-[12px]" : "min-h-[40px] px-3 text-sm",
    extra ?? "",
  ].join(" ");
}

export function ModButton({
  tone = "default",
  size = "md",
  className,
  children,
  ...rest
}: {
  tone?: ButtonTone;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  if (tone === "quiet") {
    return (
      <button type="button" className={quietClass(size, className)} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <Button tone={tone} size={SIZE[size]} className={className} {...rest}>
      {children}
    </Button>
  );
}

/** Same shape as ModButton, for the links that behave like actions. */
export function ModLinkButton({
  href,
  tone = "default",
  size = "md",
  className,
  children,
}: {
  href: string;
  tone?: ButtonTone;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  if (tone === "quiet") {
    return (
      <Link href={href} className={quietClass(size, className) + " no-underline"}>
        {children}
      </Link>
    );
  }
  return (
    <LinkButton href={href} tone={tone} size={SIZE[size]} className={className}>
      {children}
    </LinkButton>
  );
}

/** A real switch: the round thumb carries the state even without colour, and
 *  the word beside it says what it is. Used by every site control. */
export function ModToggle({
  on,
  busy,
  disabled,
  onToggle,
  label,
}: {
  on: boolean | null;
  busy?: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  const unknown = on === null;
  return (
    <span className="inline-flex items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-label={label}
        disabled={unknown || busy || disabled}
        onClick={onToggle}
        title={unknown ? "Loading…" : on ? `${label} is on. Click to turn off.` : `${label} is off. Click to turn on.`}
        className="settings-toggle"
      >
        <span aria-hidden className="settings-toggle__thumb" />
      </button>
      <span className={"text-[12px] " + (unknown ? "text-parchment-400" : on ? "text-parchment-100" : "text-parchment-400")}>
        {unknown ? "…" : busy ? "Saving…" : on ? "On" : "Off"}
      </span>
    </span>
  );
}

/** Mutually exclusive choice as one connected metal control. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  className,
}: {
  value: T;
  options: { value: T; label: string; tone?: "danger" }[];
  onChange: (next: T) => void;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <div role="group" className={"flex w-full sm:inline-flex sm:w-auto " + (className ?? "")}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={
              "flex-1 border border-[color:var(--edge)] text-center transition-colors [&+&]:border-l-0 sm:flex-none " +
              (size === "sm" ? "min-h-[36px] px-3 text-[12px]" : "min-h-[40px] px-4 text-sm") +
              " " +
              (active
                ? opt.tone === "danger"
                  ? "bg-oxblood text-white"
                  : "bg-[color:var(--bg-raised)] text-parchment-50"
                : "bg-[color:var(--bg-panel)] text-parchment-400 hover:text-parchment-100")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Scope narrowing above a list (Open / All, Members / Guests). */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "min-h-[32px] border px-3 text-[13px] transition-colors " +
        (active
          ? "border-[color:var(--edge)] bg-[color:var(--bg-raised)] text-parchment-50"
          : "border-transparent text-parchment-400 hover:text-parchment-100")
      }
    >
      {children}
    </button>
  );
}

/** A count that only draws the eye when it is non-zero. */
export function CountBadge({ n, tone = "warn" }: { n: number; tone?: "warn" | "neutral" }) {
  if (!n) return null;
  return (
    <span
      className={
        "ml-auto shrink-0 px-1.5 py-px font-mono text-[12px] tabular-nums " +
        (tone === "warn" ? "bg-oxblood text-white" : "bg-[color:var(--bg-raised)] text-parchment-200")
      }
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warn" | "mute" | "good" | "gold";
}) {
  const style =
    tone === "warn"
      ? "text-oxblood-glow"
      : tone === "mute"
        ? "text-parchment-400"
        : tone === "good"
          ? "text-verdigris-glow"
          : tone === "gold"
            ? "text-brag"
            : "text-parchment-300";
  return <span className={`shrink-0 text-[12px] uppercase tracking-[0.05em] ${style}`}>{children}</span>;
}

export type StatItem = {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "warn" | "good";
};

function valueTone(tone?: "warn" | "good"): string {
  return tone === "warn" ? "text-oxblood-glow" : tone === "good" ? "text-verdigris-glow" : "text-parchment-50";
}

/** One number with its label: a dense tile, Lichess's stat register. */
export function StatCard({ label, value, sub, tone }: StatItem) {
  return (
    <div className="px-3.5 py-3">
      <div className={"font-display text-[22px] leading-none tabular-nums " + valueTone(tone)}>{value}</div>
      <div className="mt-1 text-[12px] uppercase tracking-[0.05em] text-parchment-400">{label}</div>
      {sub && <div className="mt-0.5 text-[12px] leading-snug text-parchment-400">{sub}</div>}
    </div>
  );
}

/** A strip of numbers in one box, split by hairlines. Phones stack them as
 *  label-left / value-right rows so eight numbers fit in one glance. */
export function StatGrid({ items, cols = 4 }: { items: StatItem[]; cols?: 3 | 4 | 5 }) {
  const grid = cols === 5 ? "sm:grid-cols-3 lg:grid-cols-5" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4";
  return (
    <>
      <div className="plate divide-y divide-[color:var(--edge)] sm:hidden">
        {items.map((it) => (
          <div key={it.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span className="min-w-0 text-[12px] leading-tight text-parchment-400">{it.label}</span>
            <span className="shrink-0 text-right">
              <span className={"font-display text-lg tabular-nums " + valueTone(it.tone)}>{it.value}</span>
              {it.sub && <span className="block text-[12px] leading-tight text-parchment-400">{it.sub}</span>}
            </span>
          </div>
        ))}
      </div>
      <div className={`plate hidden divide-x divide-[color:var(--edge)] sm:grid ${grid}`}>
        {items.map((it) => (
          <StatCard key={it.label} {...it} />
        ))}
      </div>
    </>
  );
}

/** Heading for a block inside a section, with optional right-aligned controls. */
export function SectionHead({
  title,
  blurb,
  actions,
  actionsInline,
}: {
  title: string;
  blurb?: ReactNode;
  actions?: ReactNode;
  actionsInline?: boolean;
}) {
  const heading = <h2 className="text-[13px] uppercase tracking-[0.05em] text-parchment-300">{title}</h2>;
  const prose = blurb && <p className="mt-1 max-w-2xl text-[12px] leading-snug text-parchment-400">{blurb}</p>;

  if (actionsInline) {
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          {heading}
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {prose}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        {heading}
        {prose}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A horizontal proportion bar: the whole width is 100%, `at` marks a
 *  reference (the fair 50%, a tier average). Text carries the number too. */
export function RateBar({ pct, at, tone }: { pct: number; at?: number; tone?: "warn" | "good" }) {
  const fill = tone === "warn" ? "bg-oxblood" : tone === "good" ? "bg-verdigris" : "bg-parchment-400";
  return (
    <span className="relative block h-2 w-full bg-[color:var(--bg-raised)]" aria-hidden>
      <span className={"absolute inset-y-0 left-0 " + fill} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      {at != null && <span className="absolute inset-y-[-2px] w-px bg-parchment-100" style={{ left: `${at}%` }} />}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="plate px-4 py-8 text-center text-sm text-parchment-400">{children}</div>;
}

export function Loading({ what }: { what: string }) {
  return <p className="text-sm text-parchment-400">Loading {what}…</p>;
}

export function RoleBadge({ role }: { role: string }) {
  return <Pill tone="gold">{role === "admin" ? "Admin" : "Moderator"}</Pill>;
}

// ---------------- formatting ----------------

export function when(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** The list-row timestamp: the day and the minute; the full value stays in a
 *  title attribute wherever it is used. */
export function whenShort(ts: number): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
}

const FOREVER_MS = 50 * 365 * 24 * 60 * 60 * 1000;

export function untilLabel(ts: number | null): string {
  if (!ts || ts <= Date.now()) return "";
  return ts > Date.now() + FOREVER_MS ? "permanently" : `until ${when(ts)}`;
}

export function untilShort(ts: number | null): string {
  if (!ts || ts <= Date.now()) return "";
  return ts > Date.now() + FOREVER_MS ? "permanently" : `until ${whenShort(ts)}`;
}

export function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "-";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

export async function postJson(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, error: data.error };
}
