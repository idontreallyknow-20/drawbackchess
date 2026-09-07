"use client";

// Site statistics, humans scope: human-vs-human archive rows only. No house
// seats, no anonymous bot counter, so these are the numbers that describe what
// real opponents are doing to each other.

import { RulesTable } from "@/components/mod/stats/RulesTable";
import { StatCard } from "@/components/mod/stats/StatCard";
import { StatsShell } from "@/components/mod/stats/StatsShell";
import { useSiteStats } from "@/components/mod/stats/useSiteStats";
import { ModLinkButton } from "@/components/mod/ui";

export default function HumanStatsPage() {
  return (
    <StatsShell
      title="Site statistics: humans only"
      subtitle="Human vs human games only: no house bots, no casual bot games."
    >
      <div className="mt-3 flex flex-wrap gap-2">
        <ModLinkButton href="/mod/stats" size="sm" tone="quiet">
          ← Stats home
        </ModLinkButton>
        <ModLinkButton href="/mod/stats/all" size="sm">
          All numbers →
        </ModLinkButton>
      </div>

      <HumanStats />
    </StatsShell>
  );
}

// Mounted only once the shell's mod check passes, so the fetch waits for it.
function HumanStats() {
  const { stats, failed } = useSiteStats();

  if (failed) {
    return (
      <div className="mt-8 plate p-6 text-parchment-300">
        Stats are unavailable right now. Try again in a minute.
      </div>
    );
  }
  if (!stats) return <div className="mt-8 text-parchment-400">Loading…</div>;

  const h = stats.humans;

  return (
    <>
      <div className="plate mt-5 grid grid-cols-2 divide-x divide-y divide-[color:var(--edge)] sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
        <StatCard label="Games" value={h.games.total} />
        <StatCard label="Games today" value={h.games.today} />
        <StatCard label="Rated games" value={h.games.rated} />
        <StatCard label="Avg. game length" value={h.games.averageMoves} suffix=" moves" />
        <StatCard label="Players with a game" value={h.players.withGames} />
      </div>

      <RulesTable rows={h.topNerfs} />
    </>
  );
}
