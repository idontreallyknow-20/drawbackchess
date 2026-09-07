"use client";

// Post-game thumbs from players, aggregated per card. Nerfs and buffs differ
// only in which library resolves a row's name and tier, so both feed the same
// table. The card libraries are lazy-loaded: the ~26k-line engine stays out of
// the /mod bundle until a moderator actually opens one of these sections.
//
// The verdict column is new. A raw score of -12 means nothing on its own; what a
// balance pass needs to know is whether players dislike a card ENOUGH, relative
// to how often it is voted on, to be worth touching.

import type { Buff } from "@/engine/buff";
import type { Nerf } from "@/engine/nerf";
import { useEffect, useState } from "react";
import { Empty, FilterChip, Loading, Pill, SectionHead } from "./ui";

type FeedbackTotal = { up: number; down: number; last_at: number };
type NerfFeedbackTotal = FeedbackTotal & { nerf_id: string };
type BuffFeedbackTotal = FeedbackTotal & { buff_id: string };
type FeedbackVote = { vote: number; username: string | null; created_at: number };
type NerfFeedbackVote = FeedbackVote & { nerf_id: string };
type BuffFeedbackVote = FeedbackVote & { buff_id: string };

export function NerfFeedbackSection() {
  const [totals, setTotals] = useState<NerfFeedbackTotal[] | null>(null);
  const [recent, setRecent] = useState<NerfFeedbackVote[]>([]);
  const [nerfs, setNerfs] = useState<Nerf[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mod/nerf-feedback")
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ totals: NerfFeedbackTotal[]; recent: NerfFeedbackVote[] }>)
          : null,
      )
      .then((data) => {
        if (cancelled || !data) return;
        setTotals(data.totals);
        setRecent(data.recent);
      })
      .catch(() => {});
    import("@/engine/nerfs/library").then((m) => {
      if (!cancelled) setNerfs(m.ALL_NERFS);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!totals || !nerfs) return <Loading what="nerf verdicts" />;

  const find = (id: string) => nerfs.find((n) => n.id === id);
  return (
    <FeedbackTable
      label="Nerf"
      emptyHint="Votes appear once players start rating their rule post-game."
      rows={totals.map((t) => ({
        id: t.nerf_id,
        name: find(t.nerf_id)?.name ?? t.nerf_id,
        tier: find(t.nerf_id)?.tier ?? null,
        up: t.up,
        down: t.down,
        last_at: t.last_at,
      }))}
      recent={recent.map((v) => ({
        id: v.nerf_id,
        name: find(v.nerf_id)?.name ?? v.nerf_id,
        vote: v.vote,
        username: v.username,
        created_at: v.created_at,
      }))}
    />
  );
}

export function BuffFeedbackSection() {
  const [totals, setTotals] = useState<BuffFeedbackTotal[] | null>(null);
  const [recent, setRecent] = useState<BuffFeedbackVote[]>([]);
  const [buffs, setBuffs] = useState<Record<string, Buff> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mod/buff-feedback")
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ totals: BuffFeedbackTotal[]; recent: BuffFeedbackVote[] }>)
          : null,
      )
      .then((data) => {
        if (cancelled || !data) return;
        setTotals(data.totals);
        setRecent(data.recent);
      })
      .catch(() => {});
    import("@/engine/buffs/library").then((m) => {
      if (!cancelled) setBuffs(m.BUFF_BY_ID);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!totals || !buffs) return <Loading what="buff verdicts" />;

  return (
    <FeedbackTable
      label="Buff"
      emptyHint="Votes appear once players start rating their buffs post-game."
      rows={totals.map((t) => ({
        id: t.buff_id,
        name: buffs[t.buff_id]?.name ?? t.buff_id,
        tier: buffs[t.buff_id]?.tier ?? null,
        up: t.up,
        down: t.down,
        last_at: t.last_at,
      }))}
      recent={recent.map((v) => ({
        id: v.buff_id,
        name: buffs[v.buff_id]?.name ?? v.buff_id,
        vote: v.vote,
        username: v.username,
        created_at: v.created_at,
      }))}
    />
  );
}

// ---------------- shared table ----------------

type FeedbackRow = {
  id: string;
  name: string;
  tier: number | null;
  up: number;
  down: number;
  last_at: number;
};

type FeedbackRecentRow = {
  id: string;
  name: string;
  vote: number;
  username: string | null;
  created_at: number;
};

type SortKey = "name" | "tier" | "up" | "down" | "score" | "last";

/** Two thirds of a card's votes being negative, on a sample big enough to mean
 *  something, is the line where "some players grumbled" becomes "this card has
 *  a problem". Same threshold in reverse for the loved ones. */
function verdict(row: FeedbackRow): { text: string; tone: "warn" | "good" | "neutral" } {
  const votes = row.up + row.down;
  if (votes < 8) return { text: "too few votes", tone: "neutral" };
  const share = row.up / votes;
  if (share <= 0.34) return { text: "disliked", tone: "warn" };
  if (share >= 0.75) return { text: "loved", tone: "good" };
  return { text: "divisive", tone: "neutral" };
}

function FeedbackTable({
  label,
  rows,
  recent,
  emptyHint,
}: {
  label: string;
  rows: FeedbackRow[];
  recent: FeedbackRecentRow[];
  emptyHint: string;
}) {
  const [sort, setSort] = useState<SortKey>("score");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [tier, setTier] = useState<number | "all">("all");
  // "Needs a look" is the reason a moderator opens this at all, so it gets a
  // chip of its own rather than making them sort and eyeball the columns.
  const [onlyProblems, setOnlyProblems] = useState(false);

  if (rows.length === 0) return <Empty>No feedback yet. {emptyHint}</Empty>;

  const score = (r: FeedbackRow) => r.up - r.down;

  const tiers = Array.from(
    new Set(rows.map((r) => r.tier).filter((t): t is number => t !== null)),
  ).sort((a, b) => a - b);

  const filtered = rows
    .filter((r) => tier === "all" || r.tier === tier)
    .filter((r) => !onlyProblems || verdict(r).tone === "warn");

  const sorted = [...filtered].sort((a, b) => {
    let cmp: number;
    switch (sort) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "tier":
        cmp = (a.tier ?? 0) - (b.tier ?? 0);
        break;
      case "up":
        cmp = a.up - b.up;
        break;
      case "down":
        cmp = a.down - b.down;
        break;
      case "last":
        cmp = a.last_at - b.last_at;
        break;
      default:
        cmp = score(a) - score(b);
    }
    // Break ties on score so equal columns still land in a stable, useful order.
    if (cmp === 0) cmp = score(a) - score(b);
    return dir === "asc" ? cmp : -cmp;
  });

  const toggle = (key: SortKey) => {
    if (sort === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      // Names read best A–Z; numeric columns default to biggest-first.
      setDir(key === "name" ? "asc" : "desc");
    }
  };

  const arrow = (key: SortKey) => (sort === key ? (dir === "asc" ? " ↑" : " ↓") : "");
  const problems = rows.filter((r) => verdict(r).tone === "warn").length;

  return (
    <div className="space-y-6">
      <SectionHead
        title={`${label} verdicts`}
        blurb={`${rows.length} ${label.toLowerCase()}s have been voted on. A card is called out once at least eight players have weighed in and two thirds of them went one way.`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={!onlyProblems} onClick={() => setOnlyProblems(false)}>
          All
        </FilterChip>
        <FilterChip active={onlyProblems} onClick={() => setOnlyProblems(true)}>
          Needs a look ({problems})
        </FilterChip>
        {tiers.length > 0 && (
          <>
            <span className="ml-2 text-[12px] text-parchment-400">Tier</span>
            <FilterChip active={tier === "all"} onClick={() => setTier("all")}>
              Any
            </FilterChip>
            {tiers.map((t) => (
              <FilterChip key={t} active={tier === t} onClick={() => setTier(t)}>
                {t}
              </FilterChip>
            ))}
          </>
        )}
      </div>

      {/* Sorting on a phone, where there are no column headers to click. The
          four that matter; the desktop table keeps all six. */}
      <div className="flex flex-wrap items-center gap-2 sm:hidden">
        <span className="text-[12px] text-parchment-400">Sort</span>
        {(
          [
            ["score", "Score"],
            ["down", "Disliked"],
            ["up", "Liked"],
            ["last", "Recent"],
          ] as [SortKey, string][]
        ).map(([key, label]) => (
          <FilterChip
            key={key}
            active={sort === key}
            onClick={() => {
              setSort(key);
              setDir("desc");
            }}
          >
            {label}
          </FilterChip>
        ))}
      </div>

      {/* Phones get one row per card instead of a seven-column table: name and
          verdict on top, the vote counts underneath. Sorting still applies, so
          the chips and the desktop headers agree on what you are looking at. */}
      <ul className="plate divide-y divide-[color:var(--edge)] sm:hidden">
        {sorted.map((row) => {
          const v = verdict(row);
          return (
            <li key={row.id} className="px-3.5 py-2.5">
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-sm text-parchment-100">{row.name}</span>
                <Pill tone={v.tone === "warn" ? "warn" : v.tone === "good" ? "good" : "neutral"}>
                  {v.text}
                </Pill>
              </div>
              <div className="mt-1 flex items-center gap-3 font-mono text-[12px] tabular-nums">
                <span className="text-verdigris-glow">+{row.up}</span>
                <span className="text-oxblood-glow">-{row.down}</span>
                <span className="text-parchment-100">
                  {score(row) > 0 ? "+" : ""}
                  {score(row)}
                </span>
                <span className="ml-auto text-parchment-400">
                  {row.tier !== null ? `tier ${row.tier} · ` : ""}
                  {new Date(row.last_at).toLocaleDateString()}
                </span>
              </div>
            </li>
          );
        })}
        {sorted.length === 0 && (
          <li className="px-3.5 py-3 text-sm text-parchment-400">Nothing matches that filter.</li>
        )}
      </ul>

      <div className="plate hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[12px] text-parchment-400">
              <Header align="left" active={sort === "name"} onClick={() => toggle("name")}>
                {label}
                {arrow("name")}
              </Header>
              <Header align="right" active={sort === "tier"} onClick={() => toggle("tier")}>
                Tier{arrow("tier")}
              </Header>
              <Header align="right" active={sort === "up"} onClick={() => toggle("up")}>
                Liked{arrow("up")}
              </Header>
              <Header align="right" active={sort === "down"} onClick={() => toggle("down")}>
                Disliked{arrow("down")}
              </Header>
              <Header align="right" active={sort === "score"} onClick={() => toggle("score")}>
                Score{arrow("score")}
              </Header>
              <th className="px-4 py-2 text-left font-normal">Verdict</th>
              <Header align="right" active={sort === "last"} onClick={() => toggle("last")}>
                Last vote{arrow("last")}
              </Header>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--edge)]">
            {sorted.map((row) => {
              const v = verdict(row);
              return (
                <tr key={row.id}>
                  <td className="px-4 py-2 text-parchment-100">{row.name}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-parchment-300">
                    {row.tier ?? "-"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-verdigris-glow">
                    {row.up}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-oxblood-glow">
                    {row.down}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-parchment-100">
                    {score(row) > 0 ? "+" : ""}
                    {score(row)}
                  </td>
                  <td className="px-4 py-2">
                    <Pill tone={v.tone === "warn" ? "warn" : v.tone === "good" ? "good" : "neutral"}>
                      {v.text}
                    </Pill>
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-parchment-400">
                    {new Date(row.last_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-3 text-parchment-400">
                  Nothing matches that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {recent.length > 0 && (
        <div>
          <h3 className="text-xs text-parchment-400">Recent votes</h3>
          <ul className="plate mt-2 divide-y divide-[color:var(--edge)] text-sm">
            {recent.map((v, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0 truncate text-parchment-100">
                  <span className={v.vote > 0 ? "text-verdigris-glow" : "text-oxblood-glow"}>
                    {v.vote > 0 ? "+1" : "-1"}
                  </span>{" "}
                  {v.name}
                  <span className="text-parchment-400"> by {v.username ?? "unknown"}</span>
                </span>
                <span className="shrink-0 text-xs text-parchment-400">
                  {new Date(v.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Header({
  align,
  active,
  onClick,
  children,
}: {
  align: "left" | "right";
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <th className={`px-4 py-2 font-normal ${align === "left" ? "text-left" : "text-right"}`}>
      <button
        type="button"
        onClick={onClick}
        className={`transition hover:text-parchment-100 ${active ? "text-parchment-50" : ""}`}
      >
        {children}
      </button>
    </th>
  );
}
