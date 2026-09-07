"use client";

// The Activity tab, Lichess's: games grouped by day under a brass date, one
// row per mode ("Played 12 Nerf games  2140 ▲ 15") with win / draw / loss
// counts on the right. Built from the same games endpoint the Games tab reads.

import { useEffect, useState } from "react";
import { Swords } from "lucide-react";
import { type RecentGameRow, viewerPlayedWhite } from "@/components/profile/RecentGameCard";

interface DayGroup {
  key: string;
  label: string;
  rows: {
    mode: "nerf" | "buff" | "casual";
    games: number;
    wins: number;
    draws: number;
    losses: number;
    ratingAfter: number | null;
    delta: number | null;
  }[];
}

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function groupByDay(games: RecentGameRow[], viewer: string): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  const lower = viewer.toLowerCase();
  // Newest first; within a day the FIRST game seen is the newest, so its
  // rating-after is the day's closing rating, and the LAST game's
  // rating-before is the opening one.
  const opening = new Map<string, number | null>();
  for (const g of games) {
    const key = dayKey(g.completed_at);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: dayLabel(g.completed_at), rows: [] };
      groups.set(key, group);
    }
    const isWhite = viewerPlayedWhite(g, lower);
    const my: "w" | "b" = isWhite ? "w" : "b";
    const mode: DayGroup["rows"][number]["mode"] = g.rated && (g.mode === "nerf" || g.mode === "buff") ? g.mode : "casual";
    let row = group.rows.find((r) => r.mode === mode);
    if (!row) {
      row = { mode, games: 0, wins: 0, draws: 0, losses: 0, ratingAfter: null, delta: null };
      group.rows.push(row);
    }
    row.games += 1;
    if (g.winner === "draw") row.draws += 1;
    else if (g.winner === my) row.wins += 1;
    else if (g.winner != null) row.losses += 1;
    const after = isWhite ? g.white_rating_after : g.black_rating_after;
    const before = isWhite ? g.white_rating_before : g.black_rating_before;
    const rk = `${key}:${mode}`;
    if (row.ratingAfter == null && after != null) row.ratingAfter = Math.round(after);
    if (before != null) opening.set(rk, Math.round(before));
  }
  for (const group of groups.values()) {
    for (const row of group.rows) {
      const open = opening.get(`${group.key}:${row.mode}`);
      if (row.ratingAfter != null && open != null) row.delta = row.ratingAfter - open;
    }
  }
  return [...groups.values()];
}

export function ActivityFeed({ username, active }: { username: string; active: boolean }) {
  const [games, setGames] = useState<RecentGameRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch(`/api/users/${encodeURIComponent(username)}/games?limit=50`)
      .then((r) => (r.ok ? (r.json() as Promise<{ games: RecentGameRow[] }>) : Promise.reject()))
      .then((body) => {
        if (!cancelled) setGames(body.games);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [username, active]);

  if (failed) return <p className="px-4 py-6 text-[13px] text-parchment-400">Could not load recent activity.</p>;
  if (games === null) {
    return (
      <div className="space-y-3 px-4 py-5" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-8 w-full" />
        ))}
      </div>
    );
  }
  const days = groupByDay(games, username);
  if (days.length === 0) {
    return <p className="px-4 py-6 text-[13px] text-parchment-400">No games yet.</p>;
  }
  return (
    <div className="px-2 py-3 sm:px-4">
      {days.map((day) => (
        <section key={day.key} className="py-2">
          <h3 className="text-[15px] font-semibold uppercase tracking-[0.02em] text-brag">{day.label}</h3>
          <ul className="mt-1 border-l border-[color:var(--edge)]">
            {day.rows.map((r) => {
              const modeWord = r.mode === "nerf" ? "Nerf" : r.mode === "buff" ? "Buff" : "casual";
              return (
                <li key={r.mode} className="flex items-center gap-3 py-2 pl-4">
                  <span
                    aria-hidden
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[color:var(--edge)] bg-[color:var(--bg-raised)] text-parchment-300"
                  >
                    <Swords size={16} strokeWidth={1.6} />
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] text-parchment-100">
                    Played {r.games} <span className={r.mode === "nerf" ? "text-mode-nerfGlow" : r.mode === "buff" ? "text-mode-buffGlow" : ""}>{modeWord}</span>{" "}
                    {r.games === 1 ? "game" : "games"}
                    {r.ratingAfter != null && (
                      <span className="ml-2 tabular-nums text-parchment-300">
                        {r.ratingAfter}
                        {r.delta != null && r.delta !== 0 && (
                          <span className={"ml-1 " + (r.delta > 0 ? "text-verdigris-glow" : "text-oxblood-glow")}>
                            {r.delta > 0 ? "▲" : "▼"} {Math.abs(r.delta)}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[12px] text-parchment-300">
                    {r.wins > 0 && (
                      <span>
                        <b className="bg-verdigris px-1.5 py-px text-[12px] text-white">{r.wins}</b> {r.wins === 1 ? "win" : "wins"}
                      </span>
                    )}
                    {r.draws > 0 && (
                      <span>
                        <b className="bg-[color:var(--bg-raised)] px-1.5 py-px text-[12px] text-parchment-100">{r.draws}</b> {r.draws === 1 ? "draw" : "draws"}
                      </span>
                    )}
                    {r.losses > 0 && (
                      <span>
                        <b className="bg-oxblood px-1.5 py-px text-[12px] text-white">{r.losses}</b> {r.losses === 1 ? "loss" : "losses"}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
