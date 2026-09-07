"use client";

// Site statistics, everything scope: every online game played on nerfchess,
// house-bot seats and the anonymous bot-game counter included.

import { RulesTable } from "@/components/mod/stats/RulesTable";
import { StatCard } from "@/components/mod/stats/StatCard";
import { StatsShell } from "@/components/mod/stats/StatsShell";
import { useSiteStats } from "@/components/mod/stats/useSiteStats";
import { ModLinkButton } from "@/components/mod/ui";

export default function AllStatsPage() {
  return (
    <StatsShell
      title="Site statistics: all games"
      subtitle="Every online game played on nerfchess, bots included."
    >
      <div className="mt-3 flex flex-wrap gap-2">
        <ModLinkButton href="/mod/stats" size="sm" tone="quiet">
          ← Stats home
        </ModLinkButton>
        <ModLinkButton href="/mod/stats/humans" size="sm">
          Humans only →
        </ModLinkButton>
      </div>

      <AllStats />
    </StatsShell>
  );
}

// Mounted only once the shell's mod check passes, so the fetch waits for it.
function AllStats() {
  const { stats, failed } = useSiteStats();

  if (failed) {
    return (
      <div className="mt-8 plate p-6 text-parchment-300">
        Stats are unavailable right now. Try again in a minute.
      </div>
    );
  }
  if (!stats) return <div className="mt-8 text-parchment-400">Loading…</div>;

  return (
    <>
      <div className="plate mt-5 grid grid-cols-2 divide-x divide-y divide-[color:var(--edge)] sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
        <StatCard label="Games played" value={stats.games.total + (stats.games.vsBots ?? 0)} />
        <StatCard label="Games vs bots" value={stats.games.vsBots ?? 0} />
        <StatCard label="Games today" value={stats.games.today} />
        <StatCard label="Rated games" value={stats.games.rated} />
        <StatCard label="Players" value={stats.players.total} />
      </div>

      <RulesTable rows={stats.topNerfs} />
    </>
  );
}
