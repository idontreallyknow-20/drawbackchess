"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Swords } from "lucide-react";
import { AccountUser, ensureAccount, fetchMe } from "@/lib/authClient";
import { clearSnapshot, readSnapshot, writeSnapshot } from "@/lib/snapshotCache";
import { MPSession, saveOnlineSeat } from "@/lib/multiplayer";
import { getCategory, type RatingCategoryId } from "@/lib/ratingCategories";
import { useSharedMode } from "@/lib/modeState";
import type { DraftMode } from "@/engine/buff";
import { Button } from "@/components/ui/Button";

// Wire names must match QUEUE_POOLS in worker.ts.
const QUEUE_POOL_OPTIONS: { pool: string; label: string; speed: RatingCategoryId }[] = [
  { pool: "1+0", label: "1+0", speed: "bullet" },
  { pool: "2+1", label: "2+1", speed: "bullet" },
  { pool: "3+0", label: "3+0", speed: "blitz" },
  { pool: "3+2", label: "3+2", speed: "blitz" },
  { pool: "5+0", label: "5+0", speed: "blitz" },
  { pool: "5+3", label: "5+3", speed: "blitz" },
  { pool: "10+0", label: "10+0", speed: "rapid" },
  { pool: "10+5", label: "10+5", speed: "rapid" },
  { pool: "15+10", label: "15+10", speed: "rapid" },
];

const LAST_POOL_KEY = "dc:last-pool";

// Quick-pairing entry point: the two rated queue pools, Nerf and Buff. Buff
// is preselected (it starts from normal chess, the easiest first game); a
// player can switch to Nerf, pick a time control, and the one button at the
// bottom starts the search. Each pool stakes its own rating. The mode
// preference is shared site-wide (see lib/modeState): an explicit `?mode=`
// query param wins, then the last choice this browser made, then Buff.
// Pages that already own a mode selector (e.g. /play) pass `mode` +
// `onModeChange` and hide the built-in cards so one state drives the page.
// Signed-out visitors queue as a guest (no login wall), with a small nudge
// to register so their rating sticks.
export function QueueButton({
  mode: controlledMode,
  onModeChange,
  showModeCards = true,
}: {
  mode?: DraftMode;
  onModeChange?: (mode: DraftMode) => void;
  showModeCards?: boolean;
} = {}) {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [modeRatings, setModeRatings] = useState<Partial<Record<DraftMode, number>>>({});
  const [state, setState] = useState<"idle" | "searching" | "paired">("idle");
  const [sharedMode, pickSharedMode] = useSharedMode();
  const mode = controlledMode ?? sharedMode;
  const [pool, setPool] = useState("3+2");
  const [error, setError] = useState<string | null>(null);
  // Seconds elapsed in the current search, so a waiting player sees the queue
  // is live and how long they have been in it (reset the moment searching ends).
  const [elapsed, setElapsed] = useState(0);
  const sessionRef = useRef<MPSession | null>(null);

  useEffect(() => {
    if (state !== "searching") {
      // Reset the counter the instant a search ends so a fresh queue starts at 0.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    // Instant paint: hydrate the last known account + ratings from the
    // session cache so the card renders its real controls immediately; the
    // live fetches below correct it a beat later (including sign-out).
    const cached = readSnapshot<{ user: AccountUser | null; ratings: Partial<Record<DraftMode, number>> }>(
      "nerfchess:queue-card",
    );
    if (cached) {
      queueMicrotask(() => {
        setUser(cached.user);
        setModeRatings(cached.ratings ?? {});
      });
    }
    fetchMe().then((me) => {
      if (cancelled) return;
      setUser(me);
      if (!me) {
        clearSnapshot("nerfchess:queue-card");
        return;
      }
      // Each pool shows the rating it stakes. The profile API returns every
      // rating bucket; a bucket the account has never touched falls back to
      // the legacy shared rating, which is exactly what would seed it.
      fetch(`/api/users/${encodeURIComponent(me.username)}`)
        .then((res) => (res.ok ? res.json() : null) as Promise<{ ratings?: Record<string, { rating: number }> } | null>)
        .then((data) => {
          if (cancelled || !data?.ratings) return;
          const ratings = {
            nerf: data.ratings.nerf ? Math.round(data.ratings.nerf.rating) : undefined,
            buff: data.ratings.buff ? Math.round(data.ratings.buff.rating) : undefined,
          };
          setModeRatings(ratings);
          writeSnapshot("nerfchess:queue-card", { user: me, ratings });
        })
        .catch(() => {});
    });
    // The pool preselect reads localStorage client-side; deferred a microtask
    // so it doesn't set state synchronously in the effect body. (The mode
    // preselect lives in useSharedMode.)
    queueMicrotask(() => {
      try {
        const saved = window.localStorage.getItem(LAST_POOL_KEY);
        if (saved && QUEUE_POOL_OPTIONS.some((o) => o.pool === saved)) setPool(saved);
      } catch {}
    });
    return () => {
      cancelled = true;
      sessionRef.current?.destroy();
      sessionRef.current = null;
    };
  }, []);

  const pickPool = (p: string) => {
    setPool(p);
    try {
      window.localStorage.setItem(LAST_POOL_KEY, p);
    } catch {}
  };

  const pickMode = (m: DraftMode) => {
    if (onModeChange) onModeChange(m);
    else pickSharedMode(m);
  };

  const startSearch = async (mode: DraftMode) => {
    setError(null);
    // Signed-out players queue as a guest (a throwaway account) so the server
    // can pair them: quick pairing needs an identity, but there is no login
    // wall. A guest's rating is throwaway until they register, so the game
    // plays out casual for them. Mint the guest before entering the searching
    // state so a cancel during the search can never strand a half-open queue.
    let me = user;
    if (!me) {
      me = await ensureAccount();
      if (me) setUser(me);
    }
    if (!me) {
      setError("Could not start a guest session. Please try again.");
      return;
    }
    setState("searching");
    const session = new MPSession();
    session.persistFriendSession = false;
    sessionRef.current = session;
    try {
      const paired = await session.queue(pool, mode);
      if (sessionRef.current !== session) return;
      setState("paired");
      saveOnlineSeat(paired.id, { color: paired.color, token: paired.token });
      session.destroy();
      sessionRef.current = null;
      router.push(`/game/${paired.id}`);
    } catch (e) {
      if (sessionRef.current !== session) return;
      session.destroy();
      sessionRef.current = null;
      setState("idle");
      setError(e instanceof Error ? e.message : "Could not reach the game server.");
    }
  };

  const cancelSearch = () => {
    sessionRef.current?.cancelQueue();
    sessionRef.current?.destroy();
    sessionRef.current = null;
    setState("idle");
  };

  const selected =
    QUEUE_POOL_OPTIONS.find((o) => o.pool === pool) ?? QUEUE_POOL_OPTIONS.find((o) => o.pool === "3+2")!;
  const ratingFor = (mode: DraftMode) =>
    modeRatings[mode] ?? (user ? Math.round(user.rating) : null);

  return (
    <div className="plate p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center border border-gold/40 bg-gold/10 text-gold-leaf"
        >
          <Swords size={15} />
        </span>
        <div className="font-display text-2xl text-parchment">Play online</div>
      </div>

      {state === "searching" ? (
        <div className="mt-4 border border-verdigris/30 bg-verdigris/[0.06] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2.5 text-sm text-parchment-100">
              {/* Themed loader: the rune ring turning is the "search is live"
                  signal, replacing the plain flicker dot. */}
              <span aria-hidden className="rune-loader shrink-0 text-[15px]" />
              <span>
                Finding a{" "}
                <span className={mode === "nerf" ? "text-mode-nerfGlow" : "text-mode-buffGlow"}>
                  {mode === "nerf" ? "Nerf" : "Buff"}
                </span>{" "}
                opponent… ({selected.label})
              </span>
            </span>
            <Button tone="ghost"
              onClick={cancelSearch}
              className="px-4 py-2 text-sm">
              Cancel
            </Button>
          </div>
          {/* Elapsed time so the queue never reads as a dead "Connecting…":
              the counter ticking is proof the search is live. */}
          <div
            className="mt-2.5 flex items-center gap-2 text-[12px] text-parchment-400"
            aria-live="polite"
          >
            <span>Searching</span>
            <span className="font-mono text-xs tabular-nums text-parchment-200">
              {formatElapsed(elapsed)}
            </span>
          </div>
        </div>
      ) : state === "paired" ? (
        <div className="mt-4 text-sm text-gold-leaf">Opponent found. Starting…</div>
      ) : (
        <>
          {/* Step 1: pick a mode. The two cards are a selection, color-coded
              (Nerf rose, Buff blue), each wearing the rating it stakes. Buff
              leads and is preselected: it starts from normal chess, the
              easiest first game. Nothing queues until the button below.
              Hidden when the page already owns a shared mode selector. */}
          {showModeCards && (
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              <ModeCard
                mode="buff"
                rating={ratingFor("buff")}
                selected={mode === "buff"}
                dimmed={mode !== "buff"}
                onClick={() => pickMode("buff")}
              />
              <ModeCard
                mode="nerf"
                rating={ratingFor("nerf")}
                selected={mode === "nerf"}
                dimmed={mode !== "nerf"}
                onClick={() => pickMode("nerf")}
              />
            </div>
          )}

          <div className="mt-4">
            <div>Time control</div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5 min-[380px]:grid-cols-5">
              {QUEUE_POOL_OPTIONS.map((option) => {
                const category = getCategory(option.speed);
                const Icon = category.icon;
                const isSelected = option.pool === pool;
                return (
                  <button
                    key={option.pool}
                    type="button"
                    onClick={() => pickPool(option.pool)}
                    title={`${category.label} · ${option.label}`}
                    aria-pressed={isSelected}
                    className={
                      "press flex flex-col items-center gap-0.5 border px-1 py-1.5 transition " +
                      (isSelected
                        ? "border-gold bg-gold/15 text-gold-leaf shadow-[0_0_14px_-8px_rgb(var(--accent-hi-rgb)/0.6)]"
                        : "border-[color:var(--edge)] bg-black/10 text-parchment-200 hover:border-[color:var(--edge-strong)] hover:bg-white/5")
                    }
                  >
                    <Icon size={14} style={{ color: category.accent }} aria-hidden />
                    <span className="font-mono text-sm tabular-nums">{option.label}</span>
                    <span className="text-[12px] uppercase tracking-[0.08em] text-parchment-400">{category.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* The one button that actually queues, at the bottom so the flow
              reads mode, clock, play. A mode is always selected (Buff by
              default), so it names the exact game it will find. */}
          <Button tone="slab"
            onClick={() => startSearch(mode)}
            // The forged mode slab: the shared .btn-slab physics with the
            // selected mode's energy core, so the matchmaking primary reads
            // as part of the dungeon control set while keeping its
            // Nerf-terracotta / Buff-sky identity.
            style={{ ["--slab-rgb" as string]: mode === "nerf" ? "196 120 95" : "91 155 212" }}
            className="cta-shine mt-4 w-full px-8 py-4 text-xl sm:text-2xl font-semibold">
            {`Find a ${selected.label} ${mode === "nerf" ? "Nerf" : "Buff"} Game`}
          </Button>

          {/* Signed-out or guest players can queue and play right away; this
              is a nudge, never a gate. Their rating is throwaway until they
              register. */}
          {user !== undefined && (!user || user.isGuest) && (
            <p className="mt-3 text-center text-xs text-parchment-400">
              Playing as a guest.{" "}
              <Link href="/login?next=/lobby" className="text-gold-leaf hover:underline">
                Sign in
              </Link>{" "}
              to keep your rating.
            </p>
          )}
        </>
      )}

      {error && (
        <div className="mt-3 p-3 border border-oxblood-glow/60 bg-oxblood/15 text-parchment text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

// mm:ss for the search-elapsed counter.
function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// One of the two mode selection cards. Each wears its color identity at all
// times (Nerf rose, Buff blue), deepens when selected, and shows the
// caller's rating in that pool. Selecting a card does not queue; the Play
// button below does.
function ModeCard({
  mode,
  rating,
  selected,
  dimmed = false,
  onClick,
}: {
  mode: DraftMode;
  rating: number | null;
  selected: boolean;
  dimmed?: boolean;
  onClick: () => void;
}) {
  const identity =
    mode === "nerf"
      ? {
          // Selected reads as border emphasis: the full mode-colored border,
          // an inset ring doubling it, a deeper fill, and a check badge, so
          // the chosen mode is unmistakable before Play.
          card: selected
            ? "border-mode-nerf bg-mode-nerf/20 ring-2 ring-inset ring-mode-nerf"
            : "border-mode-nerf/30 bg-mode-nerf/5 [@media(hover:hover)]:hover:border-mode-nerf/60 [@media(hover:hover)]:hover:bg-mode-nerf/10",
          title: "text-mode-nerfGlow",
          badge: "bg-mode-nerf",
        }
      : {
          card: selected
            ? "border-mode-buff bg-mode-buff/20 ring-2 ring-inset ring-mode-buff"
            : "border-mode-buff/30 bg-mode-buff/5 [@media(hover:hover)]:hover:border-mode-buff/60 [@media(hover:hover)]:hover:bg-mode-buff/10",
          title: "text-mode-buffGlow",
          badge: "bg-mode-buff",
        };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={
        "plate relative p-3.5 sm:p-5 text-left border transition-all duration-200 touch-manipulation " +
        identity.card +
        (dimmed ? " opacity-55 saturate-[0.85]" : "")
      }
    >
      {selected && (
        <span
          aria-hidden
          className={
            "absolute right-2 top-2 grid h-6 w-6 place-items-center text-white " +
            identity.badge
          }
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
      )}
      <div className="flex items-center gap-2">
        <div className={"font-display text-xl sm:text-3xl font-semibold " + identity.title}>
          {mode === "nerf" ? "Nerf" : "Buff"}
        </div>
        {mode === "buff" && (
          <span className="border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[12px] text-gold-leaf">
            Recommended
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] leading-snug text-parchment-300">
        {mode === "nerf"
          ? "Start with a secret handicap. Draft curses for your opponent."
          : "Start with normal chess. Draft powers for your own army."}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[12px] text-parchment-400">
          Your {mode === "nerf" ? "Nerf" : "Buff"} rating
        </span>
        <span className={"font-mono text-base tabular-nums " + identity.title}>
          {rating ?? "?"}
        </span>
      </div>
    </button>
  );
}
