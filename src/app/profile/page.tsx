"use client";

import { SiteHeader } from "@/components/SiteHeader";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { AccountUser, ensureAccount } from "@/lib/authClient";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { EmptyState } from "@/components/EmptyState";
import { FriendsPanel } from "@/components/FriendsPanel";
import { PlayerStatsPanel } from "@/components/PlayerStatsPanel";
import type { PlayerStats } from "@/lib/playerStats";
import { ModeRatingCard, type ModeRatingRow } from "@/components/ratings/ModeRatingCard";
import { MODE_RATING_CATEGORIES } from "@/lib/ratingCategories";
import { LinkButton } from "@/components/ui/Button";

// /profile: the public profile at /u/<username> is THE profile for registered
// players, so this route forwards them there. Guests keep a real profile shell
// HERE (their instant guest account is a full user row, but /u is built around
// the durable, shareable identity a sign-in provides): the same layout as /u
// fed by the guest identity, with a compact sign-in banner up top instead of a
// viewport-sized prompt (design system: no giant empty sections).
export default function ProfilePage() {
  const router = useRouter();
  // undefined = still resolving the session; afterwards the guest account (or
  // null when even guest creation failed, e.g. fully offline).
  const [account, setAccount] = useState<AccountUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    // ensureAccount (not fetchMe): the same call the nav uses, so this page
    // resolves the instant guest identity instead of racing its creation and
    // landing on a signed-out strip.
    ensureAccount().then((me) => {
      if (cancelled) return;
      if (me) {
        // Any resolved account, guest or registered: /u/<name> is THE profile
        // (guests are full user rows and their /u page renders completely).
        // replace (not push) so Back does not bounce straight back here. The
        // in-place shell below is only the no-account (offline) fallback.
        router.replace(`/u/${encodeURIComponent(me.username)}`);
        return;
      }
      // null (guest creation failed) or undefined (could not reach the server):
      // either way, fall through to the offline shell rather than the skeleton.
      setAccount(me ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader />
      {/* The skeleton had no heading, so for the two seconds before the guest
          identity resolves this page had no accessible name and no document
          outline. Measured: 8 of 12 samples over 3.4s. Rendered only on the
          skeleton branch, because GuestProfile brings its own visible h1 and
          two would be worse than none. */}
      {account === undefined && <h1 className="sr-only">Player profile</h1>}
      {account === undefined ? <GuestProfileSkeleton /> : <GuestProfile account={account} />}
    </main>
  );
}

// One user_ratings row (per mode bucket), as served by /api/users/[username].
type CategoryRatings = Record<string, ModeRatingRow>;

// The guest profile shell: same bones as /u (header, rating-card row, game
// module, Activity column, friends rail) fed by the local guest identity, so
// a guest's /profile is a real page rather than one sign-in sentence adrift in
// an empty viewport. `account` is null only when guest creation itself failed;
// the shell still renders with a neutral "You" identity so the page never
// collapses.
function GuestProfile({ account }: { account: AccountUser | null }) {
  const username = account?.username ?? null;
  const [ratings, setRatings] = useState<CategoryRatings | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [achievements, setAchievements] = useState<{ unlockedCount: number; total: number } | null>(
    null,
  );

  // Guest accounts are full user rows, so their ratings / stats / achievements
  // come from the same public endpoints /u uses. Every fetch degrades silently:
  // a fresh guest simply keeps the Unrated / empty states below.
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    fetch(`/api/users/${encodeURIComponent(username)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ ratings?: CategoryRatings }>) : null))
      .then((d) => {
        if (!cancelled && d) setRatings(d.ratings ?? {});
      })
      .catch(() => {});
    fetch(`/api/users/${encodeURIComponent(username)}/stats`)
      .then((r) => (r.ok ? (r.json() as Promise<{ stats: PlayerStats }>) : null))
      .then((d) => {
        if (!cancelled && d) setStats(d.stats);
      })
      .catch(() => {});
    fetch(`/api/users/${encodeURIComponent(username)}/achievements`)
      .then((r) => (r.ok ? (r.json() as Promise<{ unlockedCount: number; total: number }>) : null))
      .then((d) => {
        if (!cancelled && d) setAchievements(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username]);

  return (
    <section className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
      {/* Compact sign-in banner: one sentence + one action, sized to content. */}
      <div className="plate flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-parchment-300">
          You are playing as a guest. Sign in to keep your ratings, games, and achievements on a
          profile that follows you across devices.
        </p>
        <LinkButton tone="leaf"
          href="/login?next=/profile"
          className="shrink-0 px-5 text-sm font-semibold">
          Sign in
        </LinkButton>
      </div>

      {/* Header: the guest identity. */}
      <div className="mt-6 flex items-start gap-4">
        {account ? (
          <>
            <span className="sm:hidden">
              <PlayerAvatar name={account.username} avatar={account.avatar} size={56} />
            </span>
            <span className="hidden sm:block">
              <PlayerAvatar name={account.username} avatar={account.avatar} size={72} />
            </span>
          </>
        ) : (
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-[color:var(--edge-strong)] bg-[color:var(--bg-raised)] font-display text-2xl text-gold-leaf sm:h-[72px] sm:w-[72px]">
            Y
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 break-words page-title">
              {account ? account.username : "You"}
            </h1>
            <span
              className="rounded-none px-2 py-0.5 text-[12px] font-medium leading-none text-parchment-400"
              style={{ border: "1px solid var(--edge-strong)" }}
            >
              Guest
            </span>
          </div>
          <p className="mt-2 text-[13px] text-parchment-400">
            A temporary account on this device. Rated games still count while it lasts.
          </p>
        </div>
      </div>

      {/* Rating cards: the same compact mode row /u renders. */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODE_RATING_CATEGORIES.map((c) => (
          <ModeRatingCard key={c.id} category={c} row={ratings?.[c.id] ?? null} />
        ))}
      </div>

      {/* Game module: content-sized empty state until the guest has a game. */}
      {(stats?.totalGames ?? 0) === 0 && (
        <div className="mt-4">
          <EmptyState
            glyph={"♟"}
            title="You have not played online yet"
            body="Play a game to start a rating and fill in this profile."
            action={{ href: "/lobby", label: "Find a match" }}
          />
        </div>
      )}

      <div className="mt-8 xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-6">
        <div className="min-w-0">
          {/* Achievements strip, linking to the full wall. */}
          <Link
            href="/achievements"
            className="flex flex-wrap items-center justify-between gap-3 border-y py-3 transition hover:bg-[color:var(--bg-raised)]"
            style={{ borderColor: "var(--edge)" }}
          >
            <span className="flex items-center gap-2 font-display text-parchment-100">
              <Trophy className="h-4 w-4 text-brag" strokeWidth={2} aria-hidden /> Achievements
              {achievements && (
                <span className="font-mono text-sm tabular-nums text-parchment-300">
                  {achievements.unlockedCount}
                  <span className="text-parchment-500">/{achievements.total}</span>
                </span>
              )}
            </span>
            <span className="text-[12px] font-medium text-gold-leaf">View all</span>
          </Link>

          {/* Statistics: PlayerStatsPanel carries its own content-sized empty
              state for a zero-game account. */}
          <div className="mt-10">
            <div>Record</div>
            <h2 className="mt-1 font-display text-2xl">Statistics</h2>
            <div className="mt-3">
              {stats ? (
                <PlayerStatsPanel
                  stats={stats}
                  // Highest maintained peak across the live mode buckets, so
                  // the "Highest rating" card never undercuts user_ratings.peak.
                  peakRating={MODE_RATING_CATEGORIES.reduce<number | null>((max, c) => {
                    const peak = ratings?.[c.id]?.peak;
                    return peak != null && peak > (max ?? 0) ? peak : max;
                  }, null)}
                />
              ) : (
                <div className="plate p-4 text-sm text-parchment-300">
                  No online games recorded yet. Win your first game and the numbers start here.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Friends rail: FriendsPanel handles guest / signed-out states itself. */}
        <aside className="mt-8 xl:mt-0">
          <FriendsPanel bounded />
        </aside>
      </div>
    </section>
  );
}

// Skeleton in the final geometry (design system section 8): banner, header,
// two rating cards, the game module. Static under reduced motion via .skeleton.
function GuestProfileSkeleton() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
      <div className="plate p-4">
        <div className="skeleton h-5 w-2/3 rounded-none" style={{ borderRadius: 2 }} />
      </div>
      <div className="mt-6 flex items-center gap-4">
        <div className="skeleton h-[72px] w-[72px] shrink-0 rounded-full" style={{ borderRadius: "50%" }} />
        <div className="min-w-0">
          <div className="skeleton h-9 w-48 max-w-full rounded-none" style={{ borderRadius: 2 }} />
          <div className="skeleton mt-2 h-4 w-40 rounded-none" style={{ borderRadius: 2 }} />
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="plate p-4">
            <div className="skeleton h-4 w-16 rounded-none" style={{ borderRadius: 2 }} />
            <div className="skeleton mt-3 h-7 w-20 rounded-none" style={{ borderRadius: 2 }} />
          </div>
        ))}
      </div>
      <div className="plate mt-4 p-4">
        <div className="skeleton h-24 w-full rounded-none" style={{ borderRadius: 2 }} />
      </div>
    </section>
  );
}
