"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AccountUser, ensureAccount, fetchMe } from "@/lib/authClient";
import { clearSnapshot, readSnapshot, writeSnapshot } from "@/lib/snapshotCache";
import { MPConnectionState, MPSession, saveOnlineSeat } from "@/lib/multiplayer";
import { getCategory, type RatingCategoryId } from "@/lib/ratingCategories";
import { useSharedMode } from "@/lib/modeState";
import type { DraftMode } from "@/engine/buff";
import { Button } from "@/components/ui/Button";

// The lobby's Quick Match panel: pick a mode (Buff recommended / Nerf), pick a
// time control, and one primary button finds a rated game against a real
// opponent. It owns the matchmaking socket (MPSession) and its searching state,
// and it stays mounted across lobby tab switches so an in-flight search (and
// its Cancel button) survives leaving and returning to Quick Play. This is a
// lobby-local reimplementation of the shared QueueButton, redesigned to the
// route contract: a segmented mode control, a flat grid of time-control tiles
// (the big time in the middle, the speed name beneath), one primary action, and
// a mobile sticky action bar carrying that same action.
//
// Buff is preselected (it starts from normal chess, the easiest first game);
// the mode preference is shared site-wide (lib/modeState): an explicit ?mode=
// query param wins, then the last choice this browser made, then Buff. Signed
// out visitors queue as a guest (no login wall), nudged to register so their
// rating sticks.

// Wire names must match QUEUE_POOLS in worker.ts. Nine pools lay out as a clean
// 3x3 grid (no orphaned final row).
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

export function QuickMatch({ active = true }: { active?: boolean } = {}) {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [modeRatings, setModeRatings] = useState<Partial<Record<DraftMode, number>>>({});
  const [state, setState] = useState<"idle" | "searching" | "paired">("idle");
  const [sharedMode, pickSharedMode] = useSharedMode();
  const mode = sharedMode;
  const [pool, setPool] = useState("3+2");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Coarse socket health while searching, so a mid-queue drop shows a calm
  // "Reconnecting" note instead of silently stalling (system state 4).
  const [connection, setConnection] = useState<MPConnectionState>("connected");
  // The mobile sticky action bar is portalled to document.body so it pins to
  // the viewport rather than to the lobby column. Portalling requires the DOM,
  // so it only runs after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const sessionRef = useRef<MPSession | null>(null);

  // While searching, the panel's own searching UI and the sticky bar must not
  // both show a Cancel at once: an IntersectionObserver on the in-panel
  // searching block suppresses the bar whenever that block is on screen, so
  // exactly one Cancel is visible at a time (the bar returns when the panel
  // scrolls away). Defaults to "in view" so the bar never flashes before the
  // observer's first measurement.
  const searchPanelRef = useRef<HTMLDivElement | null>(null);
  const [searchPanelInView, setSearchPanelInView] = useState(true);
  useEffect(() => {
    if (state !== "searching") return;
    const node = searchPanelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setSearchPanelInView(entries[0]?.isIntersecting ?? true),
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      setSearchPanelInView(true);
    };
  }, [state]);

  // The sticky bar is fixed, so it takes no layout space of its own: mirror
  // its measured height into the document body's bottom padding while it is
  // rendered, so it never overlaps the last of the page content. The bar is
  // display:none from `sm` up, where its height measures 0 and the padding
  // collapses with it.
  const barRef = useRef<HTMLDivElement | null>(null);
  const showBar = mounted && active && (state !== "searching" || !searchPanelInView);
  useEffect(() => {
    if (!showBar) return;
    const node = barRef.current;
    if (!node) return;
    const apply = () => {
      document.body.style.paddingBottom = `${node.offsetHeight}px`;
    };
    apply();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(apply);
      observer.observe(node);
    }
    return () => {
      observer?.disconnect();
      document.body.style.paddingBottom = "";
    };
  }, [showBar]);

  useEffect(() => {
    if (state !== "searching") {
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
    // Instant paint from the session cache, corrected by the live fetch below.
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
    queueMicrotask(() => {
      try {
        const saved = window.localStorage.getItem(LAST_POOL_KEY);
        if (saved && QUEUE_POOL_OPTIONS.some((o) => o.pool === saved)) {
          setPool(saved);
        }
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

  const pickMode = (m: DraftMode) => pickSharedMode(m);

  const startSearch = async () => {
    setError(null);
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
    setConnection("connected");
    const session = new MPSession();
    session.persistFriendSession = false;
    sessionRef.current = session;
    session.onConnectionState((s) => {
      if (sessionRef.current === session) setConnection(s);
    });
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
    setConnection("connected");
  };

  const selected = QUEUE_POOL_OPTIONS.find((o) => o.pool === pool) ?? QUEUE_POOL_OPTIONS[3];
  // Per-mode ratings only: users.rating is the frozen legacy column, so an
  // unplayed bucket shows the "?" placeholder rather than a made-up figure.
  const ratingFor = (m: DraftMode) => modeRatings[m] ?? null;
  const modeLabel = mode === "nerf" ? "Nerf" : "Buff";
  const findLabel = `Find a ${selected.label} ${modeLabel} game`;

  return (
    <div className="plate p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[15px] font-bold text-parchment-50">Quick pairing</h2>
        {/* The mode selector: a two-option segmented control. The long
            descriptions ride on aria-label so the control stays one line while
            the accessible names still say what each mode does. */}
        <div role="group" aria-label="Game mode" className="flex items-stretch gap-1">
          <ModeSegment
            mode="buff"
            rating={ratingFor("buff")}
            selected={mode === "buff"}
            onClick={() => pickMode("buff")}
          />
          <ModeSegment
            mode="nerf"
            rating={ratingFor("nerf")}
            selected={mode === "nerf"}
            onClick={() => pickMode("nerf")}
          />
        </div>
      </div>

      {state === "searching" ? (
        <SearchingPanel
          rootRef={searchPanelRef}
          mode={mode}
          poolLabel={selected.label}
          elapsed={elapsed}
          connection={connection}
          onCancel={cancelSearch}
        />
      ) : state === "paired" ? (
        <div className="mt-4 text-sm text-gold-leaf" role="status" aria-live="polite">
          Opponent found. Starting your game…
        </div>
      ) : (
        <>
          {/* The time controls, one flat tile each: the time in the middle, the
              speed name beneath. Same nine pools as QUEUE_POOLS in worker.ts. */}
          <div id="qm-pool-grid" className="mt-3 grid grid-cols-3 gap-1.5">
            {QUEUE_POOL_OPTIONS.map((option) => (
              <TimeCell
                key={option.pool}
                option={option}
                selected={option.pool === pool}
                onClick={() => pickPool(option.pool)}
              />
            ))}
          </div>

          {/* The one primary action. Desktop renders it under the grid; on
              mobile it moves to the sticky bottom rail so it is always
              reachable. */}
          <Button
            tone="primary"
            size="lg"
            block
            onClick={startSearch}
            className="mt-3 hidden sm:inline-flex"
          >
            {findLabel}
          </Button>

          {user !== undefined && (!user || user.isGuest) && (
            <p className="mt-2.5 text-[13px] text-parchment-300">
              Playing as a guest.{" "}
              <Link href="/login?next=/lobby" className="font-semibold text-gold-leaf hover:underline">
                Sign in
              </Link>{" "}
              to keep your rating.
            </p>
          )}
        </>
      )}

      {error && (
        <div role="alert" className="mt-3 border border-oxblood-glow/60 bg-oxblood/15 p-3 text-sm text-parchment">
          {error}
        </div>
      )}

      {/* The mobile sticky action bar is portalled to the document body (see
          `mounted` above) and only while this tab is active, so it pins to the
          viewport rather than to this column. Hidden while the panel's own
          searching UI is on screen, so only one Cancel shows at a time. */}
      {mounted &&
        active &&
        createPortal(
          showBar ? (
            <div
              ref={barRef}
              className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--edge)] bg-[color:var(--bg-panel)] px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:hidden"
            >
              {state === "searching" ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-parchment-100">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-verdigris" />
                    <span>Searching</span>
                    <span className="font-mono text-sm tabular-nums text-parchment-200">
                      {formatElapsed(elapsed)}
                    </span>
                  </span>
                  <Button tone="default" onClick={cancelSearch}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button tone="primary" size="lg" block onClick={startSearch}>
                  {findLabel}
                </Button>
              )}
            </div>
          ) : null,
          document.body,
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

// The in-queue state, shown in place of the setup controls: a live indicator,
// the elapsed clock (proof the search is alive), a calm reconnect note if the
// socket drops, and an unmistakable Cancel. Estimated wait is intentionally
// omitted: the lobby snapshot carries no reliable basis to derive it.
function SearchingPanel({
  rootRef,
  mode,
  poolLabel,
  elapsed,
  connection,
  onCancel,
}: {
  rootRef?: React.Ref<HTMLDivElement>;
  mode: DraftMode;
  poolLabel: string;
  elapsed: number;
  connection: MPConnectionState;
  onCancel: () => void;
}) {
  const reconnecting = connection !== "connected";
  return (
    <div
      ref={rootRef}
      className="plate mt-3 border-[color:var(--accent)] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2.5 text-sm text-parchment-100">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-verdigris" />
          <span>
            Finding a{" "}
            <span className={mode === "nerf" ? "text-mode-nerfGlow" : "text-mode-buffGlow"}>
              {mode === "nerf" ? "Nerf" : "Buff"}
            </span>{" "}
            opponent ({poolLabel})
          </span>
        </span>
        <Button tone="default" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-parchment-400" aria-live="polite">
        <span>Searching</span>
        <span className="font-mono text-sm tabular-nums text-parchment-200">{formatElapsed(elapsed)}</span>
      </div>
      {reconnecting && (
        <div className="mt-2 flex items-center gap-2 text-xs text-brag" role="status" aria-live="polite">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-sun-glow" />
          Reconnecting to the game server. Your place in the queue is held.
        </div>
      )}
    </div>
  );
}

// One time-control tile: the big time in the middle, the speed name beneath.
// The shared <Button> primitive carries the material, so a selected tile is the
// accent fill and an unselected one the default box. Accessible name resolves
// to "3+2 blitz" (label + category), which the mode-defaults e2e spec relies on.
function TimeCell({
  option,
  selected,
  onClick,
}: {
  option: { pool: string; label: string; speed: RatingCategoryId };
  selected: boolean;
  onClick: () => void;
}) {
  const category = getCategory(option.speed);
  return (
    <Button
      tone="default"
      onClick={onClick}
      aria-pressed={selected}
      // Selected reads as a lit tile with a blue edge, not a second primary
      // button: the one blue fill on this panel is the Find-a-game button.
      className={
        "!min-h-[56px] flex-col !gap-0.5 !px-1 !py-2" +
        (selected ? " !border-2 !border-solid !border-[color:var(--accent)] text-[color:var(--accent)]" : "")
      }
    >
      <span className="font-mono text-lg leading-none tabular-nums">{option.label}</span>
      <span className={"text-[13px] " + (selected ? "opacity-90" : "text-parchment-400")}>
        {category.label}
      </span>
    </Button>
  );
}

// One half of the mode selector. The description rides on aria-label so the
// accessible names the mode-defaults e2e spec matches survive the compaction
// (buff: "...Start with normal chess..."; nerf: "Start with a secret
// handicap...").
function ModeSegment({
  mode,
  rating,
  selected,
  onClick,
}: {
  mode: DraftMode;
  rating: number | null;
  selected: boolean;
  onClick: () => void;
}) {
  const isNerf = mode === "nerf";
  const label = isNerf ? "Nerf" : "Buff";
  const description = isNerf
    ? "Nerf. Start with a secret handicap. Draft curses for your opponent."
    : "Buff. Start with normal chess. Draft powers for your own army.";
  return (
    <Button
      tone={selected ? "primary" : "default"}
      size="sm"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={description}
      title={description}
      className="font-semibold"
    >
      {label}
      <span className="font-mono text-[12px] font-normal tabular-nums opacity-80">
        {rating ?? "?"}
      </span>
    </Button>
  );
}
