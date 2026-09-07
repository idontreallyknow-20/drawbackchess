"use client";

// The live half of a codex card page: aggregate gameplay stats and runtime
// moderator changes, fetched from /api/cards/insights. Supplemental by
// design: the page's crawlable content is all server-rendered, so this panel
// renders nothing while loading and nothing at all on failure, and the
// section heading only appears once data has landed (no layout jump into an
// empty box).

import { useEffect, useState } from "react";
import { TIER_ROMAN } from "@/lib/tiers";

interface StatSegment {
  dealt: number;
  offered: number;
  picked: number;
  decided: number;
  wins: number;
  recent30d: number;
}
interface CardStats {
  human: StatSegment;
  bots: StatSegment;
  tierRank?: { rank: number; of: number };
  tierAvgWinRate?: number;
}
interface OverrideEvent {
  field: string;
  old_value: string | null;
  new_value: string | null;
  at: number;
}
interface Insights {
  effective: { tier: number; enabled: boolean; renamed: boolean };
  stats: CardStats | null;
  events: OverrideEvent[];
}

// Below this many decided games a win rate is small-sample noise, so the
// panel shows counts but refuses to put a percentage on them.
const MIN_DECIDED = 20;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
function pct(wins: number, decided: number): string {
  return `${Math.round((wins / decided) * 100)}%`;
}

function eventText(e: OverrideEvent): string {
  switch (e.field) {
    case "tier":
      return `Tier moved from ${e.old_value ?? "the code tier"} to ${e.new_value ?? "the code tier"} by the moderators.`;
    case "enabled":
      return e.new_value === "0"
        ? "Disabled by the moderators: not currently dealt in drafts."
        : "Re-enabled by the moderators.";
    case "name":
      if (e.new_value == null) return "Name override removed; the original name is back.";
      if (e.old_value == null) return `Renamed to "${e.new_value}" by the moderators.`;
      return `Renamed from "${e.old_value}" to "${e.new_value}" by the moderators.`;
    case "description":
      return "Description rewritten by the moderators.";
    case "flavor":
      return "Flavor text rewritten by the moderators.";
    case "reset":
      return "Reset to its code definition by the moderators.";
    default:
      return "Card metadata adjusted by the moderators.";
  }
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-none border border-[color:var(--edge)] px-3 py-2">
      <div className="font-mono text-xl text-parchment-50 tabular-nums">{value}</div>
      <div className="mt-0.5 text-[12px] text-parchment-400">{label}</div>
      {sub && <div className="mt-0.5 text-[12px] text-parchment-400">{sub}</div>}
    </div>
  );
}

export function CardInsights({
  kind,
  id,
  codeTier,
  noun,
}: {
  kind: "buff" | "nerf";
  id: string;
  codeTier: number;
  noun: string;
}) {
  const [data, setData] = useState<Insights | null>(null);

  useEffect(() => {
    let cancelled = false;
    // no-store skips the private browser cache (so a moderator change shows
    // on the next visit) while the response's s-maxage still lets the shared
    // edge cache absorb the traffic.
    fetch(`/api/cards/insights?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Insights>) : Promise.reject()))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  if (!data) return null;

  const { effective, stats, events } = data;
  const human = stats?.human;
  const bots = stats?.bots;
  const isNerf = kind === "nerf";
  const humanVolume = human ? (isNerf ? human.dealt : human.picked) : 0;
  const botVolume = bots ? (isNerf ? bots.dealt : bots.picked) : 0;
  const hasGames = humanVolume + botVolume + (human?.offered ?? 0) + (bots?.offered ?? 0) > 0;
  const verb = isNerf ? "carried" : "picked";

  // Collapsed by default (playtest feedback: the card page buried the rule
  // under stat noise). Native <details>, so no extra client state; the numbers
  // are one tap away and the disabled/tier-moved banners still surface on the
  // summary row via the note chip.
  const noteChip = !effective.enabled
    ? "disabled"
    : effective.tier !== codeTier
      ? `tier ${effective.tier}`
      : null;

  return (
    <details className="plate group">
      <summary className="cursor-pointer list-none p-6 outline-none focus-visible:text-coral sm:p-7 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5">
            <span className="display-3 text-parchment">In play</span>
            {noteChip && (
              <span className="rounded-none border border-sun/30 bg-sun/5 px-1.5 py-px text-[12px] text-parchment-200">
                {noteChip}
              </span>
            )}
          </span>
          <span
            aria-hidden
            className="shrink-0 text-parchment-400 motion-safe:transition-transform group-open:rotate-90"
          >
            &#9656;
          </span>
        </span>
      </summary>
      <div className="space-y-3 px-6 pb-6 text-[15px] leading-relaxed text-parchment-200 sm:px-7 sm:pb-7">
        {!effective.enabled && (
          <p className="rounded-none border border-sun/30 bg-sun/5 px-4 py-2 text-sm text-parchment-200">
            Currently disabled by the moderators: it is not being dealt.
          </p>
        )}
        {effective.enabled && effective.tier !== codeTier && (
          <p className="rounded-none border border-sun/30 bg-sun/5 px-4 py-2 text-sm text-parchment-200">
            Currently dealt at Tier {effective.tier} (moved by the moderators).
          </p>
        )}

        {!hasGames ? (
          <p className="text-sm text-parchment-400">No online games recorded with this card yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {isNerf ? (
                <StatTile label="Games carried" value={humanVolume.toLocaleString()} />
              ) : (
                <>
                  <StatTile label="Seen in offers" value={(human?.offered ?? 0).toLocaleString()} />
                  <StatTile
                    label="Times picked"
                    value={humanVolume.toLocaleString()}
                    sub={
                      human && human.offered > 0
                        ? `${pct(human.picked, human.offered)} of offers seen`
                        : undefined
                    }
                  />
                </>
              )}
              <StatTile
                label="Holder win rate"
                value={human && human.decided >= MIN_DECIDED ? pct(human.wins, human.decided) : "–"}
                sub={
                  human && human.decided >= MIN_DECIDED
                    ? stats?.tierAvgWinRate !== undefined
                      ? `tier average ${Math.round(stats.tierAvgWinRate * 100)}%`
                      : undefined
                    : "too few games to rate"
                }
              />
              <StatTile label="Last 30 days" value={(human?.recent30d ?? 0).toLocaleString()} sub={verb} />
            </div>

            {stats?.tierRank && (
              <p className="text-sm text-parchment-300">
                #{stats.tierRank.rank} of {stats.tierRank.of} Tier {TIER_ROMAN[codeTier]} {noun}s by
                games {verb} against other players.
              </p>
            )}
            <p className="text-xs text-parchment-400">
              Counted from finished online games. Offers are only visible when a player picked from
              them, so banked offers are not counted.
            </p>
          </>
        )}

        {events.length > 0 && (
          <div className="pt-2">
            <div className="text-[12px] text-parchment-400">Moderator changes</div>
            <ol className="mt-2 space-y-2">
              {events.map((e, i) => (
                <li key={i} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                  <span className="text-[12px] text-parchment-400 sm:w-32 sm:shrink-0 sm:pt-0.5">
                    {formatDate(e.at)}
                  </span>
                  <span className="text-sm text-parchment-100">{eventText(e)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </details>
  );
}
