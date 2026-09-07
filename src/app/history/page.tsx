"use client";

import { SiteHeader } from "@/components/SiteHeader";
import { EmptyState } from "@/components/EmptyState";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CompletedGame,
  GameOutcome,
  loadGameHistory,
  speedLabel,
  timeControlLabel,
} from "@/lib/gameHistory";

import { TIER_LABEL } from "@/lib/tiers";
import { useModalChrome } from "@/lib/useModalChrome";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

type Filter = "all" | GameOutcome;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All games" },
  { id: "win", label: "Wins" },
  { id: "loss", label: "Losses" },
  { id: "draw", label: "Draws" },
];

const OUTCOME_STYLE: Record<GameOutcome, { badge: string; text: string; edge: string; label: string }> = {
  win: { badge: "border-verdigris-glow/50 bg-verdigris/15 text-verdigris-glow", text: "text-verdigris-glow", edge: "border-l-verdigris-glow", label: "Win" },
  loss: { badge: "border-oxblood-glow/50 bg-oxblood/15 text-oxblood-glow", text: "text-oxblood-glow", edge: "border-l-oxblood-glow", label: "Loss" },
  draw: { badge: "border-bruise-glow/40 bg-bruise/10 text-bruise-glow", text: "text-bruise-glow", edge: "border-l-parchment-500", label: "Draw" },
};

// The game's venue, shown as a small mode chip on each row.
const VENUE_LABEL: Record<CompletedGame["mode"], string> = {
  ai: "Bot",
  friend: "Friend",
  online: "Online",
};

function formatWhen(endedAt: number): string {
  return new Date(endedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function HistoryPage() {
  // Loaded after mount: localStorage is client-only and this avoids any
  // hydration mismatch between server HTML and the stored list.
  const [games, setGames] = useState<CompletedGame[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<CompletedGame | null>(null);

  useEffect(() => {
    queueMicrotask(() => setGames(loadGameHistory()));
  }, []);

  const filtered = useMemo(() => {
    if (!games) return [];
    return filter === "all" ? games : games.filter((g) => g.outcome === filter);
  }, [games, filter]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, win: 0, loss: 0, draw: 0 };
    for (const g of games ?? []) {
      c.all++;
      c[g.outcome]++;
    }
    return c;
  }, [games]);

  return (
    <main className="min-h-screen">
      <SiteHeader active="/history" />

      <section className="max-w-3xl mx-auto px-5 sm:px-6 py-6 sm:py-8">
        <h1 className="page-title">Game history</h1>

        <div className="mt-6 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={
                "min-h-[44px] sm:min-h-0 px-4 py-2 border font-display text-[13px] transition " +
                (filter === f.id
                  ? "bg-[color:var(--bg-raised)] border-gold text-gold-leaf"
                  : "border-[color:var(--edge)] text-parchment-200 hover:border-[color:var(--edge-strong)] hover:bg-[color:var(--bg-raised)]")
              }
            >
              {f.label}
              <span className="ml-2 font-mono text-[12px] opacity-70 tabular-nums">
                {counts[f.id]}
              </span>
            </button>
          ))}
        </div>

        {games === null ? (
          <div className="mt-8 text-parchment-400">Loading…</div>
        ) : filtered.length === 0 ? (
          games.length === 0 ? (
            <EmptyState
              className="mt-8"
              glyph={"♜"}
              title="No games yet"
              body="Play a game to start the record."
              action={{ href: "/friend", label: "Play a Friend" }}
              secondary={{ href: "/play", label: "Play vs Bot" }}
            />
          ) : (
            <div className="mt-8 plate p-8 text-center">
              <p className="text-parchment-200">No games match this filter.</p>
            </div>
          )
        ) : (
          <ul className="mt-6 max-h-[70dvh] overflow-y-auto pr-1 space-y-2">
            {filtered.map((g) => (
              <li key={g.id}>
                <GameRow game={g} onSelect={() => setSelected(g)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && <GameSummary game={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

function GameRow({ game, onSelect }: { game: CompletedGame; onSelect: () => void }) {
  const style = OUTCOME_STYLE[game.outcome];
  const delta = game.ratingChange
    ? Math.round(game.ratingChange.after - game.ratingChange.before)
    : null;
  // Straight to the board: local move list replays at /history/{id}, online
  // games pull the archived copy at /game/{serverGameId}.
  const replayHref = game.moves?.length
    ? `/history/${game.id}`
    : game.serverGameId
      ? `/game/${game.serverGameId}`
      : null;
  return (
    <div className={`plate w-full flex items-stretch border-l-2 transition-colors duration-150 hover:bg-[color:var(--bg-raised)] ${style.edge}`}>
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 p-3 sm:p-4 flex items-center gap-3 sm:gap-4 text-left active:bg-[color:var(--bg-raised)]"
      >
      <span
        className={`shrink-0 grid h-10 w-10 place-items-center border font-display text-sm font-bold ${style.badge}`}
        aria-label={style.label}
      >
        {style.label[0]}
      </span>
      {/* Opponent identity unit: avatar + name. Every opponent renders the
          same way; only the venue chip (Bot = local practice) differs. */}
      <PlayerAvatar name={game.opponent} size={28} className="hidden shrink-0 sm:block" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="truncate font-display text-base text-parchment-50">
            {game.opponent}
          </span>
          <span className="border border-[color:var(--edge)] px-1.5 py-0.5 text-[12px] text-parchment-400">
            {VENUE_LABEL[game.mode]}
          </span>
          <span className="text-[12px] text-parchment-400">
            {game.rated ? "rated" : "casual"}
          </span>
        </span>
        <span className="mt-0.5 block text-[12px] text-parchment-300">
          {formatWhen(game.endedAt)} · {game.moveCount} moves
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-sm text-parchment-100 tabular-nums">
          {timeControlLabel(game.baseSec, game.incSec)}
        </span>
        <span className="block text-[12px] text-parchment-400">
          {speedLabel(game.baseSec)}
        </span>
      </span>
      {delta !== null && (
        <span
          className={
            "shrink-0 w-12 text-right font-mono text-sm tabular-nums " +
            (delta >= 0 ? "text-verdigris-glow" : "text-oxblood-glow")
          }
        >
          {delta >= 0 ? "+" : ""}
          {delta}
        </span>
      )}
      </button>
      {replayHref && (
        <Link
          href={replayHref}
          title="Step through this game move by move"
          className="shrink-0 grid place-items-center border-l border-[color:var(--edge)] px-3 text-[13px] text-parchment-400 hover:text-gold-leaf transition-colors"
        >
          Replay
        </Link>
      )}
    </div>
  );
}

function GameSummary({ game, onClose }: { game: CompletedGame; onClose: () => void }) {
  const style = OUTCOME_STYLE[game.outcome];

  // Escape (which this modal already had) plus the body scroll lock and
  // ghost-click guard it did not.
  const chrome = useModalChrome(true, onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Game summary"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto overscroll-contain bg-[#0a111e]/80 px-4 py-6"
      onPointerDown={chrome.onBackdropPointerDown}
    >
      <div
        className="plate w-[min(92vw,26rem)] p-6 sm:p-7"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] text-parchment-400">Game summary</p>
            <h2 className={`mt-1 font-display text-3xl font-bold ${style.text}`}>
              {style.label}
            </h2>
          </div>
          <Button tone="ghost"
           
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 text-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </Button>
        </div>

        <dl className="mt-5 space-y-2.5 text-sm">
          <SummaryRow label="Opponent" value={game.opponent} />
          <SummaryRow label="Played as" value={game.myColor === "w" ? "White" : "Black"} />
          <SummaryRow label="Ended" value={game.reason} />
          <SummaryRow label="Date" value={formatWhen(game.endedAt)} />
          <SummaryRow
            label="Time control"
            value={`${timeControlLabel(game.baseSec, game.incSec)} · ${speedLabel(game.baseSec)}`}
          />
          <SummaryRow label="Moves" value={String(game.moveCount)} />
          <SummaryRow label="Mode" value={game.rated ? "Rated" : "Casual"} />
          {game.ratingChange && (
            <SummaryRow
              label="Rating"
              value={`${Math.round(game.ratingChange.before)} → ${Math.round(game.ratingChange.after)}`}
            />
          )}
        </dl>

        {(game.myNerf || game.opponentNerf) && (
          <div className="mt-5 space-y-2">
            {game.myNerf && <RuleLine label="Your rule" nerf={game.myNerf} />}
            {game.opponentNerf && <RuleLine label="Opponent rule" nerf={game.opponentNerf} />}
          </div>
        )}

        {(game.moves?.length || game.serverGameId) && (
          <LinkButton tone="leaf"
            href={game.moves?.length ? `/history/${game.id}` : `/game/${game.serverGameId}`}
            className="mt-5 w-full px-5 py-2.5 text-sm font-semibold">
            Watch replay
          </LinkButton>
        )}

        <p className="mt-5 font-mono text-[12px] text-parchment-500 break-all">
          id {game.id}
        </p>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-[12px] text-parchment-400">{label}</dt>
      <dd className="text-right text-parchment-100">{value}</dd>
    </div>
  );
}

function RuleLine({
  label,
  nerf,
}: {
  label: string;
  nerf: NonNullable<CompletedGame["myNerf"]>;
}) {
  return (
    <div className={`border p-3 tier-bg-${nerf.tier}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-parchment-400">{label}</span>
        <span className={`text-[12px] tier-${nerf.tier}`}>
          {TIER_LABEL[nerf.tier] ?? ""}
        </span>
      </div>
      <div className={`mt-1 font-display text-base font-semibold leading-tight tier-${nerf.tier}`}>
        {nerf.name}
      </div>
      <p className="mt-1 text-xs leading-snug text-parchment-200">{nerf.description}</p>
    </div>
  );
}
