"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { clearSavedAiGame } from "@/lib/gamePersistence";
import { SiteHeader } from "@/components/SiteHeader";
import { useSharedMode } from "@/lib/modeState";
import {
  FIRST_GAME_TOUR_HREF,
  TUTORIAL_DONE_KEY,
  TUTORIAL_NUDGE_DISMISSED_KEY,
} from "@/components/tutorial/tourState";
import { Button } from "@/components/ui/Button";

const TIME_STEPS_SEC = [
  30,
  45,
  60,
  90,
  120,
  150,
  180,
  ...range(5 * 60, 10 * 60, 60),
  15 * 60, // the 15+10 preset's base falls between the coarser ranges
  ...range(12 * 60, 30 * 60, 2 * 60),
  ...range(35 * 60, 2 * 60 * 60, 5 * 60),
].sort((a, b) => a - b);

// One-tap time controls: a preset sets both sliders (base + increment); the
// sliders stay for fine-tuning.
const TIME_PRESETS: { label: string; baseSec: number; incrementSec: number }[] = [
  { label: "1+0", baseSec: 60, incrementSec: 0 },
  { label: "3+2", baseSec: 3 * 60, incrementSec: 2 },
  { label: "5+0", baseSec: 5 * 60, incrementSec: 0 },
  { label: "10+0", baseSec: 10 * 60, incrementSec: 0 },
  { label: "15+10", baseSec: 15 * 60, incrementSec: 10 },
];

// Rough Elo of each bot level, mirroring BOT_ELO in the game view so the
// strength pills carry the same estimates the board header shows.
const BOT_ELO: Record<"easy" | "medium" | "hard", number> = {
  easy: 1100,
  medium: 1500,
  hard: 1900,
};

export default function PlayPage() {
  // useSharedMode reads useSearchParams (the ?mode= deep link), which needs a
  // Suspense boundary to prerender. Same pattern as /lobby, /game and /tv.
  return (
    <Suspense fallback={<main className="min-h-screen pb-16" aria-busy="true" />}>
      <PlayInner />
    </Suspense>
  );
}

function PlayInner() {
  const router = useRouter();
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [color, setColor] = useState<"w" | "b" | "random">("random");
  // Time control in seconds; base = 0 means unlimited (no clock).
  const [baseSec, setBaseSec] = useState<number>(10 * 60);
  const [incrementSec, setIncrementSec] = useState<number>(0);
  // One shared mode for the whole page (Buff default, ?mode= override, last
  // choice remembered): the top mode cards and the bot setup both read it, so
  // the two selectors can never disagree. This page is bot practice only; the
  // shared mode still persists site-wide so the lobby opens on the same choice.
  const [gameMode, setSharedMode] = useSharedMode();
  // Plain chess (no nerfs, no buffs) only exists against the bot; it is a
  // deliberate bot-only override of the shared mode, never a page mode.
  const [plainBot, setPlainBot] = useState(false);
  const botMode: "nerf" | "buff" | "plain" = plainBot ? "plain" : gameMode;
  // "New here? Take the tour" chip: shown only to players who have neither
  // finished (or skipped) the first-game tour nor dismissed the chip itself.
  const [tourNudge, setTourNudge] = useState(false);
  useEffect(() => {
    // localStorage is client-only; defer the paint off the synchronous effect
    // body so it doesn't cascade a render inline.
    queueMicrotask(() => {
      try {
        if (
          window.localStorage.getItem(TUTORIAL_DONE_KEY) == null &&
          window.localStorage.getItem(TUTORIAL_NUDGE_DISMISSED_KEY) == null
        ) {
          setTourNudge(true);
        }
      } catch {
        // Storage unavailable: never nag.
      }
    });
  }, []);

  // Selecting a mode anywhere on the page updates the one shared mode: the
  // online queue, friend link, and bot ruleset all follow. Picking Buff or
  // Nerf also clears a Plain-chess bot override.
  const selectMode = (m: "nerf" | "buff") => {
    setSharedMode(m);
    setPlainBot(false);
  };

  // Practice against the computer is ALWAYS casual: a local, offline AI game
  // that never touches the account or leaderboard rating (rated:"0"). There is
  // deliberately no rated bot path here anymore -- computer games are practice,
  // so a win or loss against a bot can never move a player's rating.
  const start = () => {
    clearSavedAiGame();
    const params = new URLSearchParams({
      difficulty,
      color,
      t: String(baseSec),
      inc: String(incrementSec),
      rated: "0",
      // buff | nerf | plain. Plain is a normal no-nerf, no-buff game vs the bot.
      mode: botMode,
    });
    router.push(`/game?${params.toString()}`);
  };

  return (
    <main className="min-h-screen">
      <SiteHeader />

      <section className="max-w-2xl mx-auto px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Play the computer</h1>
            <p className="mt-1.5 text-[13px] text-parchment-300">
              Buff, Nerf, or plain chess. Casual, never rated.
            </p>
          </div>
        </div>

        {tourNudge && (
          <div
            role="note"
            className="mt-4 flex items-center gap-3 plate border-gold/30 bg-gold/5 px-4 py-2.5"
          >
            <span className="min-w-0 text-[13px] text-parchment-200">
              New here?{" "}
              <Link
                href={FIRST_GAME_TOUR_HREF}
                className="font-semibold text-gold-leaf underline decoration-gold/50 underline-offset-2 hover:decoration-gold"
              >
                Take the tour
              </Link>
              <span className="hidden sm:inline">: a guided first game, about 3 minutes.</span>
            </span>
            <button
              type="button"
              aria-label="Dismiss tour suggestion"
              onClick={() => {
                setTourNudge(false);
                try {
                  window.localStorage.setItem(TUTORIAL_NUDGE_DISMISSED_KEY, "1");
                } catch {
                  // Storage unavailable: it just hides for this visit.
                }
              }}
              className="ml-auto grid h-7 w-7 shrink-0 place-items-center text-parchment-400 transition hover:bg-white/10 hover:text-parchment-100"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* This page is bot practice only. Anyone who came here wanting a real
            opponent gets a prominent door into the online lobby up top, so no
            one lands here and gets stuck. */}
        <Link
          href="/lobby"
          className="mt-4 plate group flex items-center gap-3 border-mode-buff/40 bg-mode-buff/5 p-3 no-underline transition-colors hover:border-mode-buff/70 hover:bg-mode-buff/10"
        >
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center border border-mode-buff/50 bg-mode-buff/10 text-mode-buffGlow"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-semibold text-parchment-50">Play online</span>
            <span className="block text-[13px] leading-snug text-parchment-300">
              Find a real opponent in the lobby.
            </span>
          </span>
          <span
            aria-hidden
            className="shrink-0 font-display text-sm font-semibold text-gold-leaf motion-safe:transition-transform motion-safe:duration-200 group-hover:translate-x-0.5"
          >
            &rarr;
          </span>
        </Link>

        <div className="mt-6 plate p-6 sm:p-7 space-y-6">
          <div>
            <Group label="Game type">
              <Pill selected={botMode === "buff"} onClick={() => selectMode("buff")}>Buff</Pill>
              <Pill selected={botMode === "nerf"} onClick={() => selectMode("nerf")}>Nerf</Pill>
              <Pill selected={botMode === "plain"} onClick={() => setPlainBot(true)}>Plain chess</Pill>
            </Group>
            <p className="mt-2 text-[12px] text-parchment-400">
              {botMode === "plain"
                ? "Ordinary chess. No cards."
                : botMode === "buff"
                  ? "Draft buffs to outbuild the bot."
                  : "A secret nerf, revealed when the game ends."}
            </p>
          </div>

          <Group label="Bot strength">
            {(["easy", "medium", "hard"] as const).map((d) => (
              <Pill key={d} selected={difficulty === d} onClick={() => setDifficulty(d)}>
                {d[0].toUpperCase() + d.slice(1)}
                <span className="ml-1.5 font-mono text-[12px] opacity-70">~{BOT_ELO[d]}</span>
              </Pill>
            ))}
          </Group>

          <Group label="Your color">
            <Pill selected={color === "w"} onClick={() => setColor("w")}>White</Pill>
            <Pill selected={color === "random"} onClick={() => setColor("random")}>Random</Pill>
            <Pill selected={color === "b"} onClick={() => setColor("b")}>Black</Pill>
          </Group>

          <div className="space-y-4">
            <Group label="Time control">
              {TIME_PRESETS.map((p) => (
                <Pill
                  key={p.label}
                  selected={baseSec === p.baseSec && incrementSec === p.incrementSec}
                  onClick={() => {
                    setBaseSec(p.baseSec);
                    setIncrementSec(p.incrementSec);
                  }}
                >
                  {p.label}
                </Pill>
              ))}
            </Group>
            <TimeSlider
              label="Time per Side"
              value={baseSec}
              values={[0, ...TIME_STEPS_SEC]}
              display={baseSec === 0 ? "Unlimited" : formatTimeControl(baseSec)}
              formatEdgeLabel={formatTimeControl}
              onChange={setBaseSec}
            />
            <TimeSlider
              label="Increment (Seconds)"
              value={incrementSec}
              values={range(0, 30, 1)}
              display={String(incrementSec)}
              disabled={baseSec === 0}
              onChange={setIncrementSec}
            />
          </div>

          <Button tone="leaf"
            onClick={start}
            className="w-full py-3.5 text-lg flex">
            Start game
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Button>
        </div>
      </section>
    </main>
  );
}

function range(start: number, end: number, step: number) {
  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    values.push(value);
  }
  return values;
}

function formatTimeControl(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  return `${minutes}:${remainingSec.toString().padStart(2, "0")}`;
}

function TimeSlider({
  label,
  value,
  values,
  display,
  disabled = false,
  formatEdgeLabel = String,
  onChange,
}: {
  label: string;
  value: number;
  values: number[];
  display: string;
  disabled?: boolean;
  formatEdgeLabel?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const index = Math.max(0, values.indexOf(value));

  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] text-parchment-400">{label}</div>
        <div className="font-mono text-sm text-gold-leaf tabular-nums">{display}</div>
      </div>
      <input
        type="range"
        min={0}
        max={values.length - 1}
        step={1}
        value={index}
        disabled={disabled}
        onChange={(e) => onChange(values[Number(e.target.value)])}
        className="w-full accent-gold-leaf disabled:cursor-not-allowed"
      />
      <div className="mt-1 flex justify-between font-mono text-[12px] text-parchment-400">
        <span>{formatEdgeLabel(values[0])}</span>
        <span>{formatEdgeLabel(values[values.length - 1])}</span>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[12px] text-parchment-400">{label}</div>
      {/* Options fill the row edge to edge (Lichess's setup dialog), never a
          cluster of small pills floating in the left of a wide card. */}
      <div className="grid grid-flow-col auto-cols-fr gap-2">{children}</div>
    </div>
  );
}

function Pill({
  selected,
  onClick,
  children,
}: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={
        "inline-flex min-h-[44px] w-full items-center justify-center border px-3 py-2 font-display text-[14px] font-medium transition-colors duration-150 " +
        (selected
          ? "border-gold bg-gold/20 text-gold-leaf"
          : "border-[color:var(--edge)] bg-[color:var(--bg-raised)] text-parchment-200 hover:border-[color:var(--edge-strong)] hover:text-parchment-50")
      }
    >
      {children}
    </button>
  );
}
