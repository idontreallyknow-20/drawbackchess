"use client";

// Every archived game with at least one HUMAN seat (member, guest, or an
// anonymous seat) — so human-vs-house-bot games count and bot-vs-bot filler
// doesn't. Newest first; the most recent human game is pinned on top. Rows link
// to /game/{id}, the archive replay viewer.

import Link from "next/link";
import { useEffect, useState } from "react";
import { ModeBadge } from "@/components/ModeBadge";
import type { GamesStats, ModGame, ModGameSeat, SeatKind } from "./types";
import {
  Empty,
  Loading,
  ModButton,
  ModLinkButton,
  Pill,
  StatGrid,
  fmtDuration,
  when,
  whenShort,
} from "./ui";

function tcLabel(baseSec: number, incSec: number): string {
  if (baseSec <= 0) return "∞";
  const base = baseSec < 60 ? `${baseSec}s` : `${Math.round(baseSec / 60)}`;
  return `${base}+${incSec}`;
}

function resultLabel(winner: ModGame["winner"]): string {
  return winner === "w" ? "1–0" : winner === "b" ? "0–1" : winner === "draw" ? "½–½" : "-";
}

function ratingDelta(seat: ModGameSeat): string | null {
  if (seat.ratingBefore === null || seat.ratingAfter === null) return null;
  const d = Math.round(seat.ratingAfter) - Math.round(seat.ratingBefore);
  return `${d >= 0 ? "+" : ""}${d}`;
}

// Small identity pill after a seat's name: who (or what) was sitting there.
// Registered members get no pill — they are the default. Guests are shown by
// their real guest username (moderator surface; public surfaces already show
// these names too), just marked as guests.
function SeatBadge({ kind }: { kind: SeatKind }) {
  if (kind === "member") return null;
  if (kind === "house")
    return (
      <span className="shrink-0 rounded-none border border-bruise-glow/40 px-1.5 py-px text-[12px] text-bruise-glow">
        house bot
      </span>
    );
  return <Pill>{kind === "guest" ? "guest" : "anon"}</Pill>;
}

function Seat({ seat }: { seat: ModGameSeat }) {
  const linkable = seat.kind === "member" || seat.kind === "guest";
  return (
    <>
      <span className="font-display font-semibold text-parchment-50">
        {linkable ? (
          <Link href={`/u/${seat.name}`} className="hover:underline">
            {seat.name}
          </Link>
        ) : (
          seat.name
        )}
      </span>
      <SeatBadge kind={seat.kind} />
    </>
  );
}

export function GamesSection() {
  const [stats, setStats] = useState<GamesStats | null>(null);
  const [games, setGames] = useState<ModGame[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mod/games/stats")
      .then((res) => (res.ok ? (res.json() as Promise<GamesStats>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {});
    fetch("/api/mod/games")
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ games: ModGame[]; nextBefore: number | null }>)
          : Promise.reject(),
      )
      .then((data) => {
        if (cancelled) return;
        setGames(data.games);
        setNextBefore(data.nextBefore);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = async () => {
    if (nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/mod/games?before=${nextBefore}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { games: ModGame[]; nextBefore: number | null };
      setGames((prev) => [...(prev ?? []), ...data.games]);
      setNextBefore(data.nextBefore);
    } catch {
      // Leave the cursor as-is so the button can be tried again.
    } finally {
      setLoadingMore(false);
    }
  };

  if (failed) return <Empty>Could not load the game archive. Try again in a minute.</Empty>;

  return (
    <div className="space-y-6">
      {stats && (
        <StatGrid
          cols={3}
          items={[
            {
              label: "Human games today",
              value: String(stats.today.total),
              sub: `${stats.today.humanVsHuman} vs humans · ${stats.today.humanVsHouse} vs house`,
            },
            {
              label: "This week",
              value: String(stats.week.total),
              sub: `${stats.week.humanVsHuman} vs humans · ${stats.week.humanVsHouse} vs house`,
            },
            {
              label: "Avg. game (7d)",
              value: stats.averageGame.moves !== null ? `${stats.averageGame.moves} moves` : "-",
              sub: fmtDuration(stats.averageGame.durationMs),
            },
            {
              label: "Most played mode (7d)",
              value: stats.topMode ? stats.topMode.label : "-",
              sub: stats.topMode ? `${stats.topMode.games} games` : undefined,
            },
            {
              label: "Humans today",
              value: `${stats.humansToday.members + stats.humansToday.guests}`,
              sub: `${stats.humansToday.members} members · ${stats.humansToday.guests} guests${
                stats.humansToday.anonSeatGames > 0
                  ? ` · ${stats.humansToday.anonSeatGames} anon-seat games`
                  : ""
              }`,
            },
            ...(stats.guestsCreated
              ? [
                  {
                    label: "Guests created",
                    value: `${stats.guestsCreated.today} today`,
                    sub: `${stats.guestsCreated.week} this week`,
                  },
                ]
              : []),
            {
              label: "Last human game",
              value: stats.lastHumanGame ? whenShort(stats.lastHumanGame.completedAt) : "none yet",
            },
          ]}
        />
      )}

      {!games ? (
        <Loading what="the archive" />
      ) : games.length === 0 ? (
        <Empty>No human games recorded yet.</Empty>
      ) : (
        <>
          <div className="space-y-2">
            {games.map((g, i) => (
              <div key={g.id} className={`plate p-4 ${i === 0 ? "border border-[color:var(--edge-strong)]" : ""}`}>
                {i === 0 && <div className="text-[12px] text-parchment-50">Last human game</div>}
                <div className={`flex flex-wrap items-center gap-2 text-sm ${i === 0 ? "mt-1" : ""}`}>
                  <Seat seat={g.white} />
                  <span className="font-mono tabular-nums text-parchment-200">
                    {resultLabel(g.winner)}
                  </span>
                  <Seat seat={g.black} />
                  <ModeBadge
                    mode={g.category === "nerf" || g.category === "buff" ? g.category : undefined}
                  />
                  <Pill>{g.rated ? "rated" : "casual"}</Pill>
                  <span
                    className="w-full text-xs text-parchment-400 sm:ml-auto sm:w-auto"
                    title={when(g.completedAt)}
                  >
                    {whenShort(g.completedAt)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-parchment-400">
                  <span>{g.reason}</span>
                  <span>{tcLabel(g.timeSec, g.incrementSec)}</span>
                  <span>{g.moveCount} moves</span>
                  <span>{fmtDuration(g.durationMs)}</span>
                  {ratingDelta(g.white) && (
                    <span className="font-mono tabular-nums">
                      {g.white.name} {ratingDelta(g.white)}
                    </span>
                  )}
                  {ratingDelta(g.black) && (
                    <span className="font-mono tabular-nums">
                      {g.black.name} {ratingDelta(g.black)}
                    </span>
                  )}
                  {g.replayable ? (
                    <ModLinkButton href={`/game/${g.id}`} size="sm" tone="quiet" className="ml-auto">
                      Replay ↗
                    </ModLinkButton>
                  ) : (
                    <span
                      className="ml-auto text-parchment-500"
                      title="This game was archived without its move list."
                    >
                      no moves stored
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {nextBefore !== null && (
            <ModButton disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? "Loading…" : "Load older games"}
            </ModButton>
          )}
        </>
      )}
    </div>
  );
}
