"use client";

import { SiteHeader } from "@/components/SiteHeader";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerSearch } from "@/components/PlayerSearch";
import { EmptyState } from "@/components/EmptyState";
import { AccountUser, fetchMe } from "@/lib/authClient";
import { CategoryTabs } from "@/components/ratings/CategoryTabs";
import { DEFAULT_CATEGORY, getCategory, type RatingCategoryId } from "@/lib/ratingCategories";
import { isProvisionalRd, PROVISIONAL_RD } from "@/lib/ratingDisplay";
import { laurelTier } from "@/lib/laurels";
import { LaurelBadge } from "@/components/LaurelBadge";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

interface Row {
  username: string;
  avatar?: string | null;
  flair?: string | null;
  bio?: string | null;
  rating: number;
  rd: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  guest?: boolean;
}

type MeRow = Row & { rank: number };

// Standings are served top-250; the table pages through them 50 at a time.
const PAGE_SIZE = 50;

export default function LeaderboardPage() {
  const [category, setCategory] = useState<RatingCategoryId>(DEFAULT_CATEGORY);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meRow, setMeRow] = useState<MeRow | null>(null);
  const [me, setMe] = useState<AccountUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Jump-to-me: a bumped nonce triggers the scroll effect after the page state
  // settles; the target rank rides on a ref so the effect never calls setState.
  const [jumpNonce, setJumpNonce] = useState(0);
  const pendingRankRef = useRef<number | null>(null);

  // Clear stale rows the instant the query changes (React's sanctioned
  // adjust-state-on-change pattern) so the effect below only fetches. The page
  // and filter reset too, so switching ladders never lands on a stale page.
  const [prevQuery, setPrevQuery] = useState({ category, reloadKey });
  if (prevQuery.category !== category || prevQuery.reloadKey !== reloadKey) {
    setPrevQuery({ category, reloadKey });
    setRows(null);
    setMeRow(null);
    setError(null);
    setPage(0);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/leaderboard?category=${category}`);
        if (!res.ok) throw new Error("Could not load the leaderboard.");
        const data = (await res.json()) as { players: Row[]; me: MeRow | null };
        if (!cancelled) {
          setRows(data.players);
          setMeRow(data.me ?? null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the leaderboard.");
      }
      const user = await fetchMe();
      if (!cancelled) setMe(user ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [category, reloadKey]);

  const active = getCategory(category);
  const isMeName = (name: string) => !!me && name.toLowerCase() === me.username.toLowerCase();

  // True rank comes from the full-standings position, so a filtered view still
  // shows each player's real place on the board.
  const ranked = (rows ?? []).map((row, i) => ({ row, rank: i + 1 }));
  const filtered = ranked;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Tested against meRow (same fetch as the rows), not the later /me fetch:
  // until that resolved, a ranked viewer saw their row twice.
  const meVisible =
    !!meRow && pageRows.some(({ row }) => row.username.toLowerCase() === meRow.username.toLowerCase());
  // A signed-in, ranked viewer can jump to their row; guests have no rank.
  const canJump = !!meRow && !meRow.guest;

  // After a jump changes the page (or when the row was already visible), scroll
  // the target row into view once it renders. Mutating the ref, never setState,
  // keeps this effect free of cascading renders.
  useEffect(() => {
    const rank = pendingRankRef.current;
    if (rank == null) return;
    const el = document.getElementById(`lb-rank-${rank}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      pendingRankRef.current = null;
    }
  }, [jumpNonce, safePage, rows]);

  const jumpToMe = () => {
    if (!meRow) return;
    pendingRankRef.current = meRow.rank;
    const inList = meRow.rank <= (rows?.length ?? 0);
    setPage(inList ? Math.floor((meRow.rank - 1) / PAGE_SIZE) : pageCount - 1);
    setJumpNonce((n) => n + 1);
  };

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader active="/leaderboard" />

      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="page-title">Leaderboard</h1>

        {/* Ladder switch: the only two boards, Nerf and Buff. */}
        <CategoryTabs value={category} onChange={setCategory} className="mt-5" />

        {/* Controls: search and the jump-to-me shortcut. */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canJump && (
            <Button tone="ghost"
             
              onClick={jumpToMe}
              className="ml-auto px-3 py-1.5 text-[13px]">
              <Trophy size={13} aria-hidden />
              Jump to my rank
            </Button>
          )}
        </div>

        <div className="mt-4">
          <PlayerSearch className="max-w-sm" />
        </div>

        {/* Error / disconnected: plain words, a retry, and a way out. */}
        {error && (
          <div
            role="alert"
            className="mt-6 plate flex flex-col gap-3 border-oxblood-glow/60 bg-oxblood/15 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="text-sm text-parchment">{error}</span>
            <div className="flex shrink-0 items-center gap-2">
              <Button tone="leaf"
               
                onClick={() => setReloadKey((k) => k + 1)}
                className="px-4 py-2 text-sm font-semibold">
                Retry
              </Button>
              <LinkButton tone="ghost" href="/lobby" className="px-4 py-2 text-sm">
                Back to lobby
              </LinkButton>
            </div>
          </div>
        )}

        {/* Loading: skeleton in the final table geometry, no full-page spinner. */}
        {!rows && !error && <LeaderboardSkeleton />}

        {/* Empty: one sentence and one action, sized to content. */}
        {rows && rows.length === 0 && !error && (
          <EmptyState
            className="mt-8"
            icon={Trophy}
            title={`No ${active.label} ratings yet`}
            body={`Nobody has a rated ${active.label} game on the board. Play one to claim the top spot.`}
            action={{ href: "/lobby", label: `Play a rated ${active.label} game` }}
          />
        )}

        {rows && rows.length > 0 && (
          <>
            {/* The standings: an open list on hairline dividers (no heavy plate),
                so rank, name, and rating carry the hierarchy on their own. */}
            <div className="mt-6 overflow-hidden border-y border-[color:var(--edge)]">
              <div className="grid grid-cols-[2.25rem_1fr_4.5rem] items-center border-b border-[color:var(--edge)] px-3 py-3 text-xs text-parchment-400 sm:grid-cols-[3rem_1fr_6rem_5rem_7rem] sm:px-4">
                <span className="text-[12px]">#</span>
                <span className="text-[12px]">Player</span>
                <span className="text-right text-[12px]">{active.label}</span>
                <span className="hidden text-right text-[12px] sm:block">Games</span>
                <span className="hidden text-right text-[12px] sm:block">W / L / D</span>
              </div>

              {pageRows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-parchment-400">
                  No players on this board yet.
                </p>
              ) : (
                pageRows.map(({ row, rank }) => (
                  <LeaderboardRow
                    key={row.guest ? `guest:${row.username}` : row.username}
                    row={row}
                    rank={rank}
                    label={active.label}
                    mine={isMeName(row.username)}
                  />
                ))
              )}

              {/* Signed-in viewer whose row is not on this page: pin it so their
                  true rank is always in reach. */}
              {meRow && !meVisible && (
                <>
                  <div className="border-t border-[color:var(--edge)] px-4 py-1 text-center font-mono text-[12px] text-parchment-500">
                    ···
                  </div>
                  <LeaderboardRow row={meRow} rank={meRow.rank} label={active.label} mine />
                </>
              )}
            </div>

            {pageCount > 1 && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <Button tone="ghost"
                 
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="px-4 text-sm sm:min-h-0 sm:py-2">
                  Previous
                </Button>
                <span className="font-mono text-xs tabular-nums text-parchment-400">
                  Ranks {safePage * PAGE_SIZE + 1}
                  {"-"}
                  {Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} of {filtered.length}
                </span>
                <Button tone="ghost"
                 
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage>= pageCount - 1}
                  className="px-4 text-sm sm:min-h-0 sm:py-2" >
                  Next
                </Button>
              </div>
            )}

            {/* Eligibility footnote: the actual server rule. A player joins the
                board on their first rated game in this mode (user_ratings.games
                > 0), and a rating reads provisional until its deviation settles
                below PROVISIONAL_RD. The top ten wear the laurel. */}
            <p className="mt-4 flex items-start gap-1.5 text-xs leading-relaxed text-parchment-400">
              <LaurelBadge rank={1} size={13} title="Top-ten honors" className="mt-0.5 shrink-0" />
              <span>
                A player appears here after one rated {active.label} game; the rating shows a{" "}
                <span className="font-mono text-parchment-300">?</span> until its deviation settles
                below {PROVISIONAL_RD}. The top ten wear the laurel: a radiant crown for the
                champion, gold for second and third, silver-brass to tenth.
              </span>
            </p>
          </>
        )}
      </section>
    </main>
  );
}

function LeaderboardRow({
  row,
  rank,
  label,
  mine,
}: {
  row: Row;
  rank: number;
  label: string;
  mine: boolean;
}) {
  const tier = laurelTier(rank); // champion | gold | silver | null (top 10 only)
  // Clean hierarchy: the top ten keep the laurel and a gem chip on the rank
  // numeral (gold for the podium, ember for 4-10); everything else is a quiet
  // hairline row. The old gold washes and left-edge bands are gone — rank,
  // name, and rating do the talking, and hover is a flat surface tint.
  const topTen = tier !== null;
  const podium = rank <= 3;
  const honored = rank <= 100;

  const rowClass =
    "grid grid-cols-[2.25rem_1fr_4.5rem] items-center border-b border-[color:var(--edge)] px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-hover)] sm:grid-cols-[3rem_1fr_6rem_5rem_7rem] sm:px-4 min-h-[44px]" +
    (mine ? " bg-[color:var(--bg-raised)]" : "");

  // The rank numeral: the top ten wear it in a small gem chip — gold for the
  // podium, ember for 4-10 — everyone else a plain tabular figure.
  const chip = podium ? "--energy-gold-rgb" : "--energy-ember-rgb";
  const rankCell = topTen ? (
    <span className="font-mono tabular-nums">
      <span
        className="inline-grid h-[22px] min-w-[22px] place-items-center border px-1 text-[12px] leading-none"
        style={{
          borderColor: `rgb(var(${chip}) / 0.5)`,
          background: `rgb(var(${chip}) / 0.12)`,
          color: podium ? "var(--sun-glow)" : `rgb(var(${chip}))`,
        }}
      >
        {rank}
      </span>
    </span>
  ) : (
    <span
      className={
        "font-mono tabular-nums " + (honored ? "text-parchment-300" : "text-parchment-400")
      }
    >
      {rank}
    </span>
  );

  const content = (
    <>
      {rankCell}
      <span className="flex min-w-0 items-center gap-2">
        <PlayerAvatar name={row.username} avatar={row.avatar} flair={row.flair} size={24} />
        <span className={"truncate font-medium " + (mine ? "text-gold-leaf" : "text-parchment-100")}>
          {row.username}
        </span>
        {tier && (
          <LaurelBadge rank={rank} title={`#${rank} on the ${label} board`} size={14} className="shrink-0" />
        )}
        {row.guest && <MetaChip>Guest</MetaChip>}
        {mine && (
          <span className="shrink-0 border border-[color:var(--edge-strong)] px-1.5 py-0.5 text-xs uppercase tracking-[0.06em] text-gold-leaf">
            You
          </span>
        )}
      </span>
      {/* Provisional ratings render dimmed with the site-wide "?" marker, so a
          two-game 2894 reads as "still settling", not as a glitched number. */}
      <span
        className={
          "text-right font-mono tabular-nums " +
          (isProvisionalRd(row.rd) ? "text-parchment-400" : "text-parchment-100")
        }
        title={
          isProvisionalRd(row.rd)
            ? `Provisional: rating deviation above ${PROVISIONAL_RD}`
            : undefined
        }
      >
        {Math.round(row.rating)}
        {isProvisionalRd(row.rd) && <span>?</span>}
      </span>
      <span className="hidden text-right font-mono tabular-nums text-parchment-400 sm:block">{row.games}</span>
      <span className="hidden text-right font-mono text-xs tabular-nums text-parchment-400 sm:block sm:text-sm">
        {row.wins}/{row.losses}/{row.draws}
      </span>
    </>
  );

  if (row.guest) {
    return (
      <div id={`lb-rank-${rank}`} className={rowClass}>
        {content}
      </div>
    );
  }
  return (
    <Link id={`lb-rank-${rank}`} href={`/u/${row.username}`} className={rowClass}>
      {content}
    </Link>
  );
}


function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 border border-[color:var(--edge)] px-1.5 py-0.5 text-xs uppercase tracking-[0.06em] text-parchment-400">
      {children}
    </span>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="mt-8 overflow-hidden border-y border-[color:var(--edge)]" aria-hidden>
      <div className="border-b border-[color:var(--edge)] px-4 py-3">
        <div className="skeleton h-3 w-40" />
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-[color:var(--edge)] px-4 py-2.5">
          <div className="skeleton h-4 w-5" />
          <div className="skeleton h-6 w-6 rounded-full" />
          <div className="skeleton h-4 flex-1" style={{ maxWidth: 160 }} />
          <div className="skeleton h-4 w-12" />
        </div>
      ))}
    </div>
  );
}
