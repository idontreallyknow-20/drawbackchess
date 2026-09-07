"use client";

import Link from "next/link";
import { LinkButton } from "@/components/ui/Button";

// Route-level error boundary: any client exception in a page renders this
// panel inside the normal layout instead of white-screening the site.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="plate w-full max-w-sm p-6 text-center">
        {/* 12px is the design system's absolute floor for a label; 11px was
            under it. Nothing else about the line changes. */}
        <div className="text-[12px] text-parchment-400">Well, that broke</div>
        <h1 className="font-display text-2xl text-parchment mt-1">Something went wrong</h1>
        <p className="mt-2 text-sm text-parchment-300">
          The page hit an unexpected error. Your game state is saved locally.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <LinkButton tone="ghost"
            href="/"
            className="px-3 py-2 text-[13px] tracking-wide [@media(pointer:fine)]:min-h-0">
            Back to the game
          </LinkButton>
          <button
            onClick={reset}
            className="inline-flex min-h-[44px] items-center justify-center px-3 py-2 border border-[color:var(--edge-strong)] bg-[color:var(--bg-raised)] text-gold-leaf hover:bg-[color:var(--bg-raised)] transition text-[13px] font-display font-semibold tracking-wide [@media(pointer:fine)]:min-h-0"
          >
            Reload
          </button>
        </div>
      </div>
    </main>
  );
}
