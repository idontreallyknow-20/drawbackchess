"use client";

import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";

// A compact "N watching" pill shown to the two seated players so they can see
// who is spectating their game. Collapsed it shows just the count; clicking it
// expands a short list of the signed-in watchers' names (anonymous watchers are
// only counted, never named). Kept deliberately quiet to match the house style:
// 1px corners, no gradient, no glow, no emoji, a single coral accent. Renders
// nothing when nobody is watching.
export function SpectatorPill({ n, names }: { n: number; names: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close the name list on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Collapse automatically once the last watcher leaves (adjust state on the
  // change during render rather than in an effect).
  const [prevN, setPrevN] = useState(n);
  if (prevN !== n) {
    setPrevN(n);
    if (n === 0) setOpen(false);
  }

  if (n <= 0) return null;

  const named = names.slice(0, 12);
  const anonymous = Math.max(0, n - named.length);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${n} watching`}
        title={`${n} watching`}
        className="inline-flex items-center gap-1.5 border border-coral/40 bg-coral/10 px-2 py-1 text-[13px] text-coral-glow transition-colors hover:bg-coral/15"
      >
        <Eye size={13} aria-hidden />
        <span className="tabular-nums">{n}</span>
        <span className="hidden sm:inline">watching</span>
      </button>
      {open && (
        <div
          role="list"
          className="absolute right-0 z-30 mt-1 min-w-[10rem] max-w-[16rem] border border-white/15 bg-ink-900/95 p-2 text-parchment shadow-none"
        >
          {named.length === 0 ? (
            <div className="px-1 py-0.5 text-xs text-parchment-400">
              {n} anonymous {n === 1 ? "viewer" : "viewers"}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {named.map((name) => (
                <li
                  key={name}
                  role="listitem"
                  className="truncate px-1 py-0.5 text-xs text-parchment-100"
                >
                  {name}
                </li>
              ))}
              {anonymous > 0 && (
                <li className="px-1 py-0.5 text-xs text-parchment-400">+ {anonymous} anonymous</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
