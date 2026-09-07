"use client";

import Link from "next/link";
import { createElement, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Lock, Trophy } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { fetchMe } from "@/lib/authClient";
import { achievementIcon } from "@/lib/achievementIcons";
import { RARITY_ASC, RARITY_THEME } from "@/lib/achievementTheme";
import { achievementToastsDisabled, setAchievementToastsDisabled } from "@/components/AchievementToast";
import {
  ACHIEVEMENTS,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CATEGORY_TAGLINE,
  RARITY_LABEL,
  RARITY_RANK,
  type AchievementCategory,
  type AchievementRarity,
} from "@/lib/achievements";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

interface AchievementView {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: AchievementRarity;
  category: AchievementCategory;
  goal: number;
  progress: number;
  unlocked: boolean;
  unlockedAt: number | null;
}

interface AchievementsResponse {
  username: string;
  unlockedCount: number;
  total: number;
  achievements: AchievementView[];
}

type RarityFilter = "all" | AchievementRarity;

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// A thin progress bar for locked milestone cards. Track uses an edge tone; the
// fill takes the card's rarity color.
function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-none"
      style={{ background: "var(--edge)" }}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className="h-full rounded-none transition-[width] duration-300"
        style={{ width: `${pct}%`, background: color ?? "var(--sun-glow)" }}
      />
    </div>
  );
}

// The header progress bar, color-segmented by rarity contribution: four
// stacked segments (common through legendary) in the shared rarity colors.
function RaritySegmentedBar({ wall, total }: { wall: AchievementView[]; total: number }) {
  const earned = wall.filter((a) => a.unlocked).length;
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-none"
      style={{ background: "var(--edge)" }}
      role="progressbar"
      aria-valuenow={earned}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`${earned} of ${total} achievements earned`}
    >
      {RARITY_ASC.map((r) => {
        const count = wall.filter((a) => a.rarity === r && a.unlocked).length;
        if (count === 0 || total === 0) return null;
        return (
          <div
            key={r}
            className="h-full transition-[width] duration-300"
            style={{ width: `${(count / total) * 100}%`, background: RARITY_THEME[r].color }}
          />
        );
      })}
    </div>
  );
}

// Compact difficulty filter chips: All plus one chip per rarity, each showing
// its earned/total count. Filters every category section below.
function RarityFilterRow({
  wall,
  filter,
  onChange,
}: {
  wall: AchievementView[];
  filter: RarityFilter;
  onChange: (next: RarityFilter) => void;
}) {
  return (
    <div role="group" aria-label="Filter achievements by difficulty" className="mt-4 flex flex-wrap gap-1.5">
      <button
        type="button"
        aria-pressed={filter === "all"}
        onClick={() => onChange("all")}
        className={
          // A filter button's label is interactive text, so 13px, not the
          // 12px caption size. The 32px height was also below the 44px touch
          // floor at every width; it now clears 44 on a finger and tightens to
          // its dense size once there is a pointer (not once the viewport is
          // wide: a touchscreen laptop still has fingers).
          // A one-word chip ("All") is 34.5px wide inside px-2.5 however tall it is.
          "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-none border px-2.5 text-[13px] transition-colors [@media(pointer:fine)]:min-h-[32px] [@media(pointer:fine)]:min-w-0 " +
          (filter === "all"
            ? "border-[color:var(--edge-strong)] bg-[color:var(--bg-raised)] text-parchment-100"
            : "border-[color:var(--edge)] text-parchment-400 hover:border-[color:var(--edge-strong)] hover:text-parchment-200")
        }
      >
        All
      </button>
      {RARITY_ASC.map((r) => {
        const theme = RARITY_THEME[r];
        const total = wall.filter((a) => a.rarity === r).length;
        const earned = wall.filter((a) => a.rarity === r && a.unlocked).length;
        const on = filter === r;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? "all" : r)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-none border px-2.5 text-[13px] transition-colors [@media(pointer:fine)]:min-h-[32px]"
            style={
              on
                ? { borderColor: theme.border, background: theme.softBg, color: theme.color }
                : { borderColor: "var(--edge)", color: "var(--paper-dim)" }
            }
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: theme.color, opacity: on ? 1 : 0.55 }}
            />
            {RARITY_LABEL[r]}
            <span className="font-mono tabular-nums" style={{ opacity: 0.85 }}>
              {earned}/{total}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AchievementCard({ a }: { a: AchievementView }) {
  const icon = achievementIcon(a.icon);
  const theme = RARITY_THEME[a.rarity];
  const showProgress = !a.unlocked && a.goal > 1;
  const legendaryUnlocked = a.unlocked && a.rarity === "legendary";

  // Legendary unlocked cards trade the flat plate border for a subtle gradient
  // rim: the plate surface is rebuilt as padding-box layers under a border-box
  // gold gradient, so nothing else about the plate changes.
  const cardStyle: React.CSSProperties | undefined = legendaryUnlocked
    ? {
        border: "1px solid transparent",
        background: [
          "linear-gradient(180deg, rgba(255,255,255,0.028), transparent 26%, rgba(0,0,0,0.1) 100%) padding-box",
          "linear-gradient(var(--surface-panel), var(--surface-panel)) padding-box",
          `linear-gradient(150deg, rgb(${theme.rgb} / 0.55), rgb(${theme.rgb} / 0.10) 45%, rgba(255,217,126,0.45)) border-box`,
        ].join(", "),
        boxShadow: `0 0 24px -12px ${theme.glow}, 0 12px 40px -24px rgba(0,0,0,0.7)`,
      }
    : a.unlocked
      ? { borderColor: theme.border }
      : undefined;

  return (
    <div
      className="plate plate-hover relative flex flex-col gap-2.5 overflow-hidden p-3 transition-colors"
      style={cardStyle}
    >
      {/* Faint oversized ghost of the icon behind the content, for depth. */}
      {a.unlocked && (
        <div aria-hidden className="pointer-events-none absolute -bottom-7 -right-6">
          {createElement(icon, {
            className: "h-28 w-28",
            style: { color: theme.color, opacity: 0.05 },
            strokeWidth: 1.25,
          })}
        </div>
      )}

      <div className="relative flex items-start gap-2.5">
        {/* Icon medallion: unlocked = radial rarity gradient with a colored
            ring and soft glow; locked = dimmed embossed disc with a small
            lock badge on the corner. */}
        <div
          className="relative grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full border"
          style={
            a.unlocked
              ? {
                  borderColor: theme.border,
                  background: `radial-gradient(circle at 32% 28%, rgb(${theme.rgb} / 0.32), rgb(${theme.rgb} / 0.07) 72%)`,
                  boxShadow: `0 0 14px -3px ${theme.glow}, inset 0 1px 0 rgb(${theme.rgb} / 0.25)`,
                }
              : {
                  borderColor: "var(--edge)",
                  background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.05), rgba(0,0,0,0.16) 78%)",
                  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.45), inset 0 -1px 0 rgba(255,255,255,0.04)",
                }
          }
        >
          {createElement(icon, {
            className: "h-6 w-6" + (a.unlocked ? "" : " opacity-40"),
            style: { color: a.unlocked ? theme.color : "var(--paper-dim)" },
            strokeWidth: 2,
          })}
          {!a.unlocked && (
            <span
              aria-label="Locked"
              title="Locked"
              className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border"
              style={{
                borderColor: "var(--edge-strong)",
                background: "var(--surface-hover)",
              }}
            >
              <Lock className="h-2.5 w-2.5 text-parchment-500" strokeWidth={2.5} />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="font-display text-[15px] leading-tight"
            style={{ color: a.unlocked ? "#f0e6cf" : undefined }}
          >
            {a.name}
          </div>
          <span
            className="mt-1 inline-block rounded-none border px-1.5 py-0.5 text-[12px] leading-none"
            style={{
              color: theme.color,
              borderColor: theme.border,
              background: theme.softBg,
              opacity: a.unlocked ? 1 : 0.7,
            }}
          >
            {RARITY_LABEL[a.rarity]}
          </span>
        </div>
      </div>

      {/* The achievement's description is the card's content, not a label on
          it: a sentence the reader is meant to read. Section 3 puts body copy
          at 13px and reserves 12px for captions and labels, so this is 13px
          while the rarity chip above and the "Earned"/progress captions below
          stay at 12px. */}
      <p
        className={
          "relative text-[13px] leading-snug " +
          (a.unlocked ? "text-parchment-200" : "text-parchment-400")
        }
      >
        {a.description}
      </p>

      {a.unlocked && a.unlockedAt != null && (
        <div className="relative mt-auto flex items-center gap-1.5 text-[12px]" style={{ color: theme.color }}>
          <Trophy className="h-3.5 w-3.5" strokeWidth={2} />
          <span className="tabular-nums">Earned {fmtDate(a.unlockedAt)}</span>
        </div>
      )}

      {showProgress && (
        <div className="relative mt-auto space-y-1">
          <div className="flex items-center justify-between text-[12px] text-parchment-400">
            <span>Progress</span>
            <span className="font-mono tabular-nums text-parchment-300">
              {a.progress}/{a.goal}
            </span>
          </div>
          <ProgressBar value={a.progress} max={a.goal} color={theme.color} />
        </div>
      )}
    </div>
  );
}

function CategorySection({
  category,
  items,
}: {
  category: AchievementCategory;
  items: AchievementView[];
}) {
  const [open, setOpen] = useState(true);
  const earned = items.filter((a) => a.unlocked).length;
  // Difficulty ascending (common to legendary); unlocked before locked within
  // the same rarity. The stable sort keeps catalog order otherwise.
  const sorted = useMemo(
    () =>
      [...items].sort(
        (x, y) =>
          RARITY_RANK[x.rarity] - RARITY_RANK[y.rarity] ||
          Number(y.unlocked) - Number(x.unlocked),
      ),
    [items],
  );
  const panelId = `cat-${category}`;
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 border-b py-2 text-left"
        style={{ borderColor: "var(--edge)" }}
      >
        <div className="min-w-0">
          <h2 className="font-display text-[19px] leading-tight text-parchment-50">
            {CATEGORY_LABEL[category]}
          </h2>
          {/* A sentence describing the category, inside the disclosure button:
              body copy in an interactive row, so 13px. */}
          <p className="mt-0.5 truncate text-[13px] text-parchment-400">
            {CATEGORY_TAGLINE[category]}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="font-mono text-[13px] tabular-nums">
            <span className={earned > 0 ? "text-brag" : "text-parchment-300"}>{earned}</span>
            <span className="text-parchment-500">/{items.length}</span>
          </span>
          <ChevronDown
            className={"h-4 w-4 text-parchment-400 transition-transform " + (open ? "" : "-rotate-90")}
            strokeWidth={2}
          />
        </div>
      </button>
      {open && (
        <div
          id={panelId}
          className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4"
        >
          {sorted.map((a) => (
            <AchievementCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </section>
  );
}

// The full catalog with everything locked: what signed-out visitors (and error
// states) see, so the trophy wall is always browsable.
function lockedWall(): AchievementView[] {
  return ACHIEVEMENTS.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    icon: a.icon,
    rarity: a.rarity,
    category: a.category,
    goal: a.goal,
    progress: 0,
    unlocked: false,
    unlockedAt: null,
  }));
}

function CardSkeleton() {
  return <div className="plate h-[132px] animate-pulse p-3" aria-hidden />;
}

function AchievementsContent() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("u");
  const [data, setData] = useState<AchievementsResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signin" | "error">("loading");
  const [filter, setFilter] = useState<RarityFilter>("all");
  // Bumped by Retry to re-run the fetch effect (same recovery pattern as the
  // homepage's LiveActivity, without a full page reload).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let username = requested;
      if (!username) {
        const me = await fetchMe();
        if (cancelled) return;
        if (!me) {
          setState("signin");
          return;
        }
        username = me.username;
      }
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}/achievements`);
        if (cancelled) return;
        if (!res.ok) {
          setState("error");
          return;
        }
        const body = (await res.json()) as AchievementsResponse;
        if (cancelled) return;
        setData(body);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requested, reloadKey]);

  // The wall always renders the whole catalog in catalog order; signed-in data
  // overlays progress and unlocks by id.
  const wall = useMemo<AchievementView[]>(() => {
    if (state !== "ready" || !data) return lockedWall();
    const byId = new Map(data.achievements.map((a) => [a.id, a]));
    return ACHIEVEMENTS.map((a) => {
      const fetched = byId.get(a.id);
      return fetched
        ? { ...fetched, category: a.category }
        : {
            id: a.id,
            name: a.name,
            description: a.description,
            icon: a.icon,
            rarity: a.rarity,
            category: a.category,
            goal: a.goal,
            progress: 0,
            unlocked: false,
            unlockedAt: null,
          };
    });
  }, [state, data]);

  const total = ACHIEVEMENTS.length;
  const earnedCount = wall.filter((a) => a.unlocked).length;

  const viewingOther = state === "ready" && !!requested && !!data;

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader />
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {/* Compact header with overall progress. */}
        <header>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div>Trophy wall</div>
              <h1 className="mt-1 font-display text-[26px] leading-none sm:text-[32px]">
                {viewingOther && data ? `${data.username}'s achievements` : "Achievements"}
              </h1>
            </div>
            <div className="shrink-0 text-right">
              <div className="flex items-center justify-end gap-2 font-mono text-2xl tabular-nums text-parchment-50">
                <Trophy className="h-5 w-5 text-brag" strokeWidth={2} />
                {state === "ready" ? earnedCount : 0}
                <span className="text-base text-parchment-400">/{total}</span>
              </div>
              <div className="text-[12px] text-parchment-400">Earned</div>
            </div>
          </div>
          <div className="mt-3">
            <RaritySegmentedBar wall={state === "ready" ? wall : lockedWall()} total={total} />
          </div>
          <p className="mt-3 text-[13px] text-parchment-300">
            {viewingOther
              ? "What they have unlocked across the board."
              : "Feats you unlock across Nerf and Buff, from first steps to the top of the ladder."}
          </p>
          <RarityFilterRow wall={wall} filter={filter} onChange={setFilter} />
        </header>

        {/* Guest, error, and popup-toggle states. */}
        {state === "signin" && (
          <div className="mt-5 plate flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-parchment-300">
              Wins, comebacks, king captures, rating climbs. Browse the wall, then start your own.
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <LinkButton tone="leaf" href="/lobby" className="whitespace-nowrap px-4 py-2 text-[13px]">
                Find a match
              </LinkButton>
              <Link
                href="/login?next=/achievements"
                // 41.3x19.5: the one call to action on the signed-out banner.
                className="-my-3 inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-[13px] text-gold-leaf hover:underline [@media(pointer:fine)]:my-0 [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:min-w-0"
              >
                Sign in
              </Link>
            </div>
          </div>
        )}
        {state === "error" && (
          <div className="mt-5 plate flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-parchment-300">
              Your progress could not load, so the wall shows everything locked.
            </p>
            <Button tone="ghost"
             
              onClick={() => {
                setState("loading");
                setData(null);
                setReloadKey((k) => k + 1);
              }}
              className="shrink-0 px-4 py-2 text-[13px]">
              Retry
            </Button>
          </div>
        )}

        {state === "loading" ? (
          <div className="mt-8 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="mt-8 space-y-9">
            {/* Category sections, filtered by the selected difficulty. */}
            {CATEGORY_ORDER.map((category) => {
              const items = wall.filter(
                (a) => a.category === category && (filter === "all" || a.rarity === filter),
              );
              if (!items.length) return null;
              return (
                <CategorySection key={`${category}-${filter}`} category={category} items={items} />
              );
            })}

            {!viewingOther && <UnlockPopupToggle />}
          </div>
        )}
      </section>
    </main>
  );
}

export default function AchievementsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <AchievementsContent />
    </Suspense>
  );
}

// Desktop unlock popups (bottom-right toasts) on/off. The toast's "Disable
// these popups" button lands people here to turn them back on.
function UnlockPopupToggle() {
  const [off, setOff] = useState(false);
  // Read the stored preference after mount (deferred so the state write does
  // not land synchronously inside the effect); the server render stays at the
  // default to avoid a hydration mismatch.
  useEffect(() => {
    queueMicrotask(() => setOff(achievementToastsDisabled()));
  }, []);
  return (
    <div className="plate flex flex-wrap items-center justify-between gap-3 p-3">
      <span className="text-[13px] text-parchment-300">
        Unlock popups{" "}
        <span className="text-parchment-500">
          (a small card in the corner when you earn one, desktop only)
        </span>
      </span>
      <button
        type="button"
        onClick={() => {
          setAchievementToastsDisabled(!off);
          setOff(!off);
        }}
        aria-pressed={!off}
        className={
          "min-h-[44px] rounded-none border px-3 py-1 text-[13px] transition-colors [@media(pointer:fine)]:min-h-[36px] " +
          (off
            ? "border-[color:var(--edge)] text-parchment-400 hover:border-[color:var(--edge-strong)]"
            : "border-verdigris-glow/50 bg-verdigris/10 text-verdigris-glow")
        }
      >
        {off ? "Off, turn on" : "On, turn off"}
      </button>
    </div>
  );
}
