"use client";

// The landing section of the console: what needs a decision right now, then how
// the site is doing, then the two numbers nothing else on the site can answer —
// whether the house bots are honestly rated, and whether any nerf is a free win.
//
// The house table is the reason this view exists. A bot advertising 1450 should
// score about half its games against humans; a tier scoring 80% is rated too low
// and one scoring 20% is rated too high. After the 2026-07 rating re-spread that
// question has teeth: the tiers above 2200 knowingly advertise more than the
// engine can back (see docs/house-bots.md), and this is where that shows up as
// a number.
//
// The overview payload is fetched once by the console shell (it also feeds the
// nav badges) and handed down, so opening the dashboard costs no extra request.

import type { Overview } from "./types";
import type { SectionId } from "./nav";
import { Empty, ModButton, Pill, RateBar, SectionHead, StatGrid, fmtDuration, pct } from "./ui";

/** How far a tier's score sits from a fair 50%, and whether that is worth
 *  flagging. A small sample says nothing, so it is never flagged. */
function tierVerdict(scorePct: number | null, played: number): { text: string; tone?: "warn" } {
  if (scorePct == null || played < 20) return { text: "too few games" };
  const drift = scorePct - 50;
  if (Math.abs(drift) <= 10) return { text: "about right" };
  return {
    text: drift > 0 ? `rated ~${Math.round(drift * 7)} too low` : `rated ~${Math.round(-drift * 7)} too high`,
    tone: "warn",
  };
}

export function DashboardSection({
  data,
  failed,
  onGo,
}: {
  data: Overview | null;
  failed: boolean;
  onGo: (section: SectionId) => void;
}) {
  if (failed) return <Empty>Could not load the overview. Try again in a minute.</Empty>;
  if (!data) return <p className="text-sm text-parchment-400">Loading overview…</p>;

  const { accounts, queue, games, endings, house, nerfBalance } = data;
  const queueTotal = queue.openReports + queue.unreviewedChatFlags;

  return (
    <div className="space-y-8">
      {/* Anything needing a human decision, first — and each tile's follow-up
          action right next to it, so the dashboard is a place to start work
          from rather than a place to read and then go hunting in the nav. */}
      <section>
        <SectionHead
          title="Needs attention"
          blurb={queueTotal === 0 ? "Queue is clear." : "Unresolved items waiting on a moderator."}
          actions={
            queueTotal > 0 ? (
              <>
                {queue.openReports > 0 && (
                  <ModButton tone="primary" size="sm" onClick={() => onGo("reports")}>
                    Work {queue.openReports} report{queue.openReports === 1 ? "" : "s"}
                  </ModButton>
                )}
                {queue.unreviewedChatFlags > 0 && (
                  <ModButton size="sm" onClick={() => onGo("chat")}>
                    Review {queue.unreviewedChatFlags} chat flag
                    {queue.unreviewedChatFlags === 1 ? "" : "s"}
                  </ModButton>
                )}
              </>
            ) : undefined
          }
        />
        <div className="mt-3">
          <StatGrid
            items={[
              { label: "Open reports", value: queue.openReports, tone: queue.openReports > 0 ? "warn" : "good" },
              {
                label: "Chat flags",
                value: queue.unreviewedChatFlags,
                sub: "unreviewed",
                tone: queue.unreviewedChatFlags > 0 ? "warn" : "good",
              },
              { label: "Active mutes", value: queue.activeMutes },
              { label: "Active bans", value: queue.activeBans },
            ]}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <ModButton size="sm" onClick={() => onGo("players")}>
            Look up a player
          </ModButton>
          <ModButton size="sm" onClick={() => onGo("log")}>
            Audit log · {queue.modActionsWeek} action{queue.modActionsWeek === 1 ? "" : "s"} this week
          </ModButton>
        </div>
      </section>

      {/* Real people, kept strictly separate from house accounts. */}
      <section>
        <SectionHead
          title="Humans"
          blurb={
            <>
              House accounts (<code>hp_</code>) and the retired seeded ones (<code>seed_</code>) are
              excluded from every number here.
            </>
          }
          actions={
            <ModButton size="sm" onClick={() => onGo("games")}>
              Browse the game archive
            </ModButton>
          }
        />
        <div className="mt-3 space-y-3">
          <StatGrid
            items={[
              { label: "Signups today", value: accounts.membersToday, sub: `${accounts.membersWeek} this week` },
              { label: "Guests today", value: accounts.guestsToday, sub: `${accounts.guestsWeek} this week` },
              { label: "Members, all time", value: accounts.membersTotal },
              { label: "Human games, 15 min", value: games.humanGamesLast15Min, sub: "finished recently" },
            ]}
          />
          <StatGrid
            items={[
              {
                label: "Human games today",
                value: games.today.total,
                sub: `${games.today.humanVsHuman} vs human · ${games.today.humanVsHouse} vs house`,
              },
              {
                label: "This week",
                value: games.week.total,
                sub: `${pct(games.week.humanVsHuman, games.week.total)} human-vs-human`,
              },
              { label: "Last 30 days", value: games.month.total },
              { label: "Average game", value: fmtDuration(games.avgDurationMs), sub: "this week" },
            ]}
          />
        </div>
      </section>

      {/* How games end: the abandon share is the loudest product signal here. */}
      <section>
        <SectionHead
          title="How human games ended"
          blurb={`Last 7 days, ${endings.total} games. A rising abandon share is the loudest signal that something mid-game is driving people off.`}
        />
        <div className="mt-3">
          <StatGrid
            cols={5}
            items={[
              { label: "Decided", value: pct(endings.decided, endings.total), sub: `${endings.decided} games` },
              { label: "Resigned", value: pct(endings.resigned, endings.total), sub: `${endings.resigned} games` },
              { label: "Flagged", value: pct(endings.flagged, endings.total), sub: `${endings.flagged} on time` },
              {
                label: "Abandoned",
                value: pct(endings.abandoned, endings.total),
                sub: `${endings.abandoned} games`,
                tone: endings.total > 20 && endings.abandoned / endings.total > 0.15 ? "warn" : undefined,
              },
              { label: "Drawn", value: pct(endings.drawn, endings.total), sub: `${endings.drawn} games` },
            ]}
          />
        </div>
      </section>

      {/* The house-bot honesty check. */}
      <section>
        <SectionHead
          title="House bots against humans"
          blurb={`Last ${house.windowDays} days, ${house.vsHumanGames} games where a house seat faced a human. Score counts a draw as half a point, so a fairly rated tier should sit near 50%. A tier well above that is rated too low for how it plays, and vice versa. The drift estimate is a rough Elo reading, not a calculation to act on blindly.`}
          actions={
            <ModButton size="sm" onClick={() => onGo("controls")}>
              Tune house strength
            </ModButton>
          }
        />
        {house.tiers.length === 0 ? (
          <p className="mt-3 text-[12px] text-parchment-400">
            No house-vs-human games archived in this window yet.
          </p>
        ) : (
          <>
            {/* Phones: one block per tier. The "Reading" column is the whole
                point of this section, and in a table at 390px it is exactly the
                column that falls off the right edge. */}
            <ul className="plate mt-3 divide-y divide-[color:var(--edge)] sm:hidden">
              {house.tiers.map((t) => {
                const v = tierVerdict(t.scorePct, t.played);
                return (
                  <li key={t.skill} className="px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm text-parchment-50">Tier {t.skill}</span>
                      <span className="font-mono text-sm tabular-nums text-parchment-100">
                        {t.scorePct == null ? "n/a" : `${t.scorePct}%`}
                      </span>
                      <span className="ml-auto">
                        <Pill tone={v.tone === "warn" ? "warn" : "neutral"}>{v.text}</Pill>
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[12px] tabular-nums text-parchment-400">
                      {t.played} games · {t.won} / {t.drawn} / {t.lost}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* From sm up this table gets 600px (640 viewport, less the shell's
                px-5), and its five columns want about 320px, so it fits without
                scrolling. The 34rem floor it used to carry could never bind at
                any width where the table is shown; overflow-x-auto stays as the
                safety net for a long "Reading" verdict. */}
            <div className="mt-3 hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-[13px]">
                <thead className="text-[12px] text-parchment-400">
                  <tr>
                    <th className="py-1.5 pr-3">Tier</th>
                    <th className="py-1.5 pr-3">Games</th>
                    <th className="py-1.5 pr-3">W / D / L</th>
                    <th className="py-1.5 pr-3">Score</th>
                    <th className="py-1.5">Reading</th>
                  </tr>
                </thead>
                <tbody className="text-parchment-100">
                  {house.tiers.map((t) => {
                    const verdict = tierVerdict(t.scorePct, t.played);
                    return (
                      <tr key={t.skill} className="border-t border-[color:var(--edge)]">
                        <td className="py-1.5 pr-3 font-mono tabular-nums">{t.skill}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{t.played}</td>
                        <td className="py-1.5 pr-3 tabular-nums text-parchment-300">
                          {t.won} / {t.drawn} / {t.lost}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {t.scorePct == null ? "n/a" : `${t.scorePct}%`}
                        </td>
                        <td
                          className={
                            "py-1.5 text-[12px] " +
                            (verdict.tone === "warn" ? "text-oxblood-glow" : "text-parchment-400")
                          }
                        >
                          {verdict.text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Nerf balance, which doubles as the balance dataset. */}
      {(nerfBalance.strongest.length > 0 || nerfBalance.weakest.length > 0) && (
        <section>
          <SectionHead
            title="Nerf win rates"
            blurb={`Last ${nerfBalance.windowDays} days, human games only, at least ${nerfBalance.minSample} picks. A nerf is a handicap, so a HIGH win rate means it is not costing its owner enough.`}
            actions={
              <ModButton size="sm" onClick={() => onGo("nerfs")}>
                Player verdicts
              </ModButton>
            }
          />
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {(
              [
                ["Least punishing", nerfBalance.strongest],
                ["Most punishing", nerfBalance.weakest],
              ] as const
            ).map(([label, rows]) => (
              <div key={label}>
                <div className="text-[12px] text-parchment-400">{label}</div>
                <ul className="plate mt-1.5 divide-y divide-[color:var(--edge)]">
                  {rows.map((r) => (
                    <li key={r.id} className="px-3 py-2 text-[13px]">
                      <div className="flex items-baseline justify-between gap-3">
                        <code className="truncate text-parchment-100">{r.id}</code>
                        <span className="shrink-0 tabular-nums text-parchment-300">
                          {r.winPct}% · {r.picks} picks
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <RateBar pct={r.winPct} at={50} tone={r.winPct > 58 ? "warn" : r.winPct < 42 ? "good" : undefined} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-[12px] text-parchment-500">
        Generated {new Date(data.generatedAt).toISOString()}.
      </p>
    </div>
  );
}
