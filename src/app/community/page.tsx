"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Eye, Swords, Trophy, Tv, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ClubIcon } from "@/components/ClubIcon";
import { ModeBadge } from "@/components/ModeBadge";
import { useLobbySnapshot } from "@/lib/lobbyClient";
import { AccountUser, fetchMe } from "@/lib/authClient";
import { DEFAULT_CATEGORY, getCategory, isRatingCategoryId } from "@/lib/ratingCategories";
import { isProvisionalRd } from "@/lib/ratingDisplay";
import { countdownLabel, modeLabel } from "@/lib/tournaments";
import type { MPLobbyGame } from "@/lib/multiplayer";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

// The community hub: friends who are around, who you have just played, the
// latest games, and the doors to clubs, tournaments, and the ladder. Every
// section is drawn only when its data source exists, so nothing is faked.

interface TopPlayer {
  username: string;
  avatar?: string | null;
  rating: number;
  rd: number;
  games: number;
  guest?: boolean;
}

interface ActivePlayer {
  username: string;
  avatar: string | null;
  games: number;
}

interface RecentGame {
  id: string;
  whiteName: string;
  blackName: string;
  winner: "w" | "b" | "draw" | null;
  reason: string;
  rated: boolean;
  category: string;
  completedAt: number;
}

interface Club {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  owner_name: string;
  members: number;
  joined: number;
}

interface Tournament {
  id: string;
  name: string;
  mode: string;
  players: number;
  starts_at: number | null;
  phase: "upcoming" | "ongoing" | "finished";
}

interface Friend {
  id: string;
  username: string;
  rating: number | null;
  avatar: string | null;
}

interface OpponentGame {
  id: string;
  white_name: string;
  black_name: string;
  white_user_id: string | null;
  black_user_id: string | null;
  completed_at: number;
}

interface Opponent {
  username: string;
  gameId: string;
  at: number;
}

function timeAgo(at: number): string {
  const s = Math.max(1, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function resultLabel(winner: "w" | "b" | "draw" | null): string {
  if (winner === "w") return "1-0";
  if (winner === "b") return "0-1";
  if (winner === "draw") return "½-½";
  return "-";
}

// Module-level so the clock read is not an impure call inside a component's
// render (matches timeAgo above).
function startsInLabel(startsAt: number): string {
  return countdownLabel(startsAt - Date.now());
}

export default function CommunityPage() {
  const [me, setMe] = useState<AccountUser | null | undefined>(undefined);
  const [top, setTop] = useState<TopPlayer[] | null>(null);
  const [active, setActive] = useState<ActivePlayer[] | null>(null);
  const [recent, setRecent] = useState<RecentGame[] | null>(null);
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [opponents, setOpponents] = useState<Opponent[] | null>(null);
  // Per-panel error flags. A settled fetch clears its flag; a failed one raises
  // it so the panel renders the section 8.3 error state (plain sentence + Retry)
  // instead of sitting on its skeleton forever.
  const [err, setErr] = useState<Record<string, boolean>>({});
  const lobby = useLobbySnapshot();

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // One loader per data source. Clears any prior error, drops the panel back to
  // its skeleton, then resolves to data (or raises the panel's error flag).
  // Retry buttons call the same loader, so a recovered network fills the panel.
  const runLoad = useCallback(
    <T,>(key: string, url: string, set: (v: T | null) => void, pick: (raw: unknown) => T) => {
      setErr((e) => (e[key] ? { ...e, [key]: false } : e));
      set(null);
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`${key} ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (mountedRef.current) set(pick(data));
        })
        .catch(() => {
          if (mountedRef.current) setErr((e) => ({ ...e, [key]: true }));
        });
    },
    [],
  );

  const loadTop = useCallback(
    () => runLoad<TopPlayer[]>("top", `/api/leaderboard?category=${DEFAULT_CATEGORY}`, setTop, (d) => (d as { players: TopPlayer[] }).players),
    [runLoad],
  );
  const loadActive = useCallback(
    () => runLoad<ActivePlayer[]>("active", "/api/community/active", setActive, (d) => (d as { players: ActivePlayer[] }).players),
    [runLoad],
  );
  const loadRecent = useCallback(
    () => runLoad<RecentGame[]>("recent", "/api/community/recent", setRecent, (d) => (d as { games: RecentGame[] }).games),
    [runLoad],
  );
  const loadClubs = useCallback(
    () => runLoad<Club[]>("clubs", "/api/clubs", setClubs, (d) => (d as { clubs: Club[] }).clubs),
    [runLoad],
  );
  const loadTournaments = useCallback(
    () => runLoad<Tournament[]>("tournaments", "/api/tournaments", setTournaments, (d) => (d as { tournaments: Tournament[] }).tournaments),
    [runLoad],
  );
  const loadFriends = useCallback(
    () => runLoad<Friend[]>("friends", "/api/friends", setFriends, (d) => (d as { friends: Friend[] }).friends),
    [runLoad],
  );

  useEffect(() => {
    let cancelled = false;
    // Deferred a microtask so each loader's synchronous reset (clear error, drop
    // to skeleton) runs after mount rather than cascading during the effect.
    queueMicrotask(() => {
      if (cancelled) return;
      loadTop();
      loadActive();
      loadRecent();
      loadClubs();
      loadTournaments();
    });

    fetchMe().then((user) => {
      if (cancelled) return;
      setMe(user);
      if (user && !user.isGuest) {
        loadFriends();
        fetch(`/api/users/${encodeURIComponent(user.username)}/games?limit=20`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (cancelled || !data) return;
            const games = (data as { games: OpponentGame[] }).games ?? [];
            const seen = new Set<string>();
            const list: Opponent[] = [];
            for (const g of games) {
              const iAmWhite = g.white_user_id === user.id;
              const oppName = iAmWhite ? g.black_name : g.white_name;
              const oppId = iAmWhite ? g.black_user_id : g.white_user_id;
              const key = oppName.toLowerCase();
              // Only real accounts (they have a profile to challenge); skip
              // anonymous seats and any accidental self-match.
              if (!oppId || oppId === user.id || seen.has(key)) continue;
              seen.add(key);
              list.push({ username: oppName, gameId: g.id, at: g.completed_at });
              if (list.length >= 6) break;
            }
            setOpponents(list);
          })
          .catch(() => {});
      } else {
        setFriends([]);
        setOpponents([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadTop, loadActive, loadRecent, loadClubs, loadTournaments, loadFriends]);

  const onlineCount = lobby ? lobby.players.length + lobby.anonymous : null;
  const topBoard = getCategory(DEFAULT_CATEGORY);
  const signedIn = !!me && !me.isGuest;

  // Cross-reference friends with the live lobby snapshot for presence and a
  // Watch link when they are in a game right now.
  const lobbyStatus = new Map(lobby?.players.map((p) => [p.name.toLowerCase(), p.status]) ?? []);
  const lobbyGame = new Map<string, MPLobbyGame>();
  for (const g of lobby?.games ?? []) {
    lobbyGame.set(g.players.w.name.toLowerCase(), g);
    lobbyGame.set(g.players.b.name.toLowerCase(), g);
  }
  const rankPresence = (name: string): number => {
    const s = lobbyStatus.get(name.toLowerCase());
    return s === "playing" ? 0 : s === "searching" ? 1 : s === "online" ? 2 : 3;
  };
  const sortedFriends = friends
    ? [...friends].sort((a, b) => rankPresence(a.username) - rankPresence(b.username))
    : null;

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader active="/community" />

      <section className="mx-auto max-w-5xl px-5 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="page-title">Community</h1>
          {/* One status pill, same border-chip treatment the lobby uses. */}
          <span
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] px-3 py-1.5 text-xs text-parchment-300"
          >
            <span
              aria-hidden
              className={
                "h-1.5 w-1.5 shrink-0 rounded-full " +
                (onlineCount === null ? "bg-parchment-500" : "bg-verdigris motion-safe:animate-flicker")
              }
            />
            <span className="tabular-nums">
              {onlineCount === null
                ? "Connecting to the lobby…"
                : `${onlineCount} player${onlineCount === 1 ? "" : "s"} online`}
            </span>
          </span>
        </div>

        {/* Guests: a compact sign-in nudge, then straight to the live content. */}
        {me !== undefined && !signedIn && (
          <div className="mt-5 plate flex flex-col gap-3 border-gold/25 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-parchment-200">
              Sign in to add friends, join clubs, and track who you have played.
            </p>
            <LinkButton tone="leaf" href="/login" className="shrink-0 px-4 py-2 text-sm font-semibold">
              Sign in
            </LinkButton>
          </div>
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Main column: your people and the latest games. */}
          <div className="min-w-0 space-y-4">
            {signedIn && (
              <SectionCard title="Friends" icon={<Users size={16} />} tint="mint">
                {err.friends ? (
                  <SectionError onRetry={loadFriends} />
                ) : !sortedFriends ? (
                  <RailSkeleton rows={3} />
                ) : sortedFriends.length === 0 ? (
                  <InlineEmpty
                    title="No friends yet"
                    body="Add players from their profile to see when they are online and watch their live games."
                    action={{ href: "/leaderboard", label: "Find players" }}
                  />
                ) : (
                  <ul className="mt-1 divide-y divide-[color:var(--edge)]">
                    {sortedFriends.map((friend) => {
                      const status = lobbyStatus.get(friend.username.toLowerCase());
                      const game = status === "playing" ? lobbyGame.get(friend.username.toLowerCase()) : undefined;
                      return (
                        <li key={friend.id} className="flex min-h-[44px] items-center gap-2 py-2">
                          <PresenceDot status={status} />
                          <Link
                            href={`/u/${encodeURIComponent(friend.username)}`}
                            className="flex min-w-0 flex-1 items-center gap-2 text-parchment-100 transition-colors hover:text-gold-leaf"
                          >
                            <PlayerAvatar name={friend.username} avatar={friend.avatar} size={26} />
                            <span className="truncate font-medium">{friend.username}</span>
                            {friend.rating != null && (
                              <span className="font-mono text-xs tabular-nums text-parchment-400">{friend.rating}</span>
                            )}
                          </Link>
                          {game ? (
                            <LinkButton tone="ghost"
                              href={`/game/${game.id}${game.origin === "arena" ? "?src=arena" : ""}`}
                              className="shrink-0 px-3 py-1.5 text-[13px]">
                              <Eye size={13} aria-hidden />
                              Watch
                            </LinkButton>
                          ) : (
                            <span className="shrink-0 text-xs text-parchment-500">{presenceLabel(status)}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </SectionCard>
            )}

            {signedIn && opponents && opponents.length > 0 && (
              <SectionCard title="Recent opponents" icon={<Swords size={16} />} tint="coral">
                <ul className="mt-1 divide-y divide-[color:var(--edge)]">
                  {opponents.map((opp) => (
                    <li key={opp.username}>
                      <Link
                        href={`/u/${encodeURIComponent(opp.username)}`}
                        className="group flex min-h-[44px] items-center gap-2 py-2 transition-colors hover:text-gold-leaf"
                      >
                        <PlayerAvatar name={opp.username} avatar={null} size={26} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 truncate font-medium text-parchment-100 group-hover:text-gold-leaf">
                            {opp.username}
                          </span>
                          <span className="mt-0.5 block text-xs text-parchment-400">Last played {timeAgo(opp.at)}</span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-parchment-300 group-hover:text-gold-leaf">
                          <Swords size={13} aria-hidden />
                          Challenge
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}

            {/* Recent games: the latest finished games, each opening its replay. */}
            <SectionCard title="Recent games" icon={<Tv size={16} />} tint="coral">
              {err.recent ? (
                <SectionError onRetry={loadRecent} />
              ) : !recent ? (
                <RailSkeleton rows={5} />
              ) : recent.length === 0 ? (
                <InlineEmpty
                  title="No finished games yet"
                  body="Completed games land here the moment they end. Play one to break the ice."
                  action={{ href: "/lobby", label: "Find a match" }}
                />
              ) : (
                <ul className="mt-1 divide-y divide-[color:var(--edge)]">
                  {recent.map((game) => (
                    <RecentGameRow key={game.id} game={game} />
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {/* Rail: doors to the wider community. */}
          <aside className="space-y-4">
            <RailCard
              title="Top players"
              icon={<Trophy size={15} />}
              action={{ href: "/leaderboard", label: "Full board" }}
            >
              {err.top ? (
                <RailError onRetry={loadTop} />
              ) : !top ? (
                <RailSkeleton rows={5} />
              ) : top.length === 0 ? (
                <EmptyRail>
                  No {topBoard.label} ratings yet.{" "}
                  <Link href="/lobby" className="text-gold-leaf hover:underline">
                    Play a rated game
                  </Link>
                  .
                </EmptyRail>
              ) : (
                <ol className="mt-1 space-y-0.5">
                  {top.slice(0, 5).map((player, i) => (
                    <li key={player.guest ? `guest:${player.username}` : player.username}>
                      <Link
                        href={`/u/${encodeURIComponent(player.username)}`}
                        className="flex min-h-[40px] items-center gap-2 px-2 -mx-2 transition hover:bg-[var(--surface-hover)]"
                      >
                        <span className="w-4 shrink-0 font-mono text-xs tabular-nums text-parchment-400">{i + 1}</span>
                        <PlayerAvatar name={player.username} avatar={player.avatar} size={22} />
                        <span className="min-w-0 flex-1 truncate text-sm text-parchment-100">{player.username}</span>
                        <span className="shrink-0 font-mono text-sm tabular-nums text-parchment-200">
                          {Math.round(player.rating)}
                          {isProvisionalRd(player.rd) && <span className="text-parchment-400">?</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </RailCard>

            <RailCard title="Clubs" icon={<Users size={15} />} action={{ href: "/clubs", label: "All clubs" }}>
              {err.clubs ? (
                <RailError onRetry={loadClubs} />
              ) : !clubs ? (
                <RailSkeleton rows={3} />
              ) : clubs.length === 0 ? (
                <EmptyRail>
                  No clubs yet.{" "}
                  <Link href="/clubs" className="text-gold-leaf hover:underline">
                    Start one
                  </Link>
                  .
                </EmptyRail>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {clubs.slice(0, 5).map((club) => (
                    <li key={club.id}>
                      <Link
                        href={`/clubs/${club.slug}`}
                        className="flex min-h-[44px] items-center gap-2.5 px-2 -mx-2 transition hover:bg-[var(--surface-hover)]"
                      >
                        <ClubIcon icon={club.icon} name={club.name} size={30} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-parchment-100">
                          {club.name}
                        </span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-parchment-400">
                          {club.members} {club.members === 1 ? "member" : "members"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </RailCard>

            <RailCard
              title="Tournaments"
              icon={<Trophy size={15} />}
              action={{ href: "/tournaments", label: "All events" }}
            >
              <TournamentRail tournaments={tournaments} error={!!err.tournaments} onRetry={loadTournaments} />
            </RailCard>

            <RailCard title="Active this week" icon={<Swords size={15} />}>
              {err.active ? (
                <RailError onRetry={loadActive} />
              ) : !active ? (
                <RailSkeleton rows={4} />
              ) : active.length === 0 ? (
                <EmptyRail>No games in the last 7 days. Be the first.</EmptyRail>
              ) : (
                <ol className="mt-1 space-y-0.5">
                  {active.slice(0, 5).map((player, i) => (
                    <li key={player.username}>
                      <Link
                        href={`/u/${encodeURIComponent(player.username)}`}
                        className="flex min-h-[40px] items-center gap-2 px-2 -mx-2 transition hover:bg-[var(--surface-hover)]"
                      >
                        <span className="w-4 shrink-0 font-mono text-xs tabular-nums text-parchment-400">{i + 1}</span>
                        <PlayerAvatar name={player.username} avatar={player.avatar} size={22} />
                        <span className="min-w-0 flex-1 truncate text-sm text-parchment-100">{player.username}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-parchment-400">
                          {player.games} {player.games === 1 ? "game" : "games"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </RailCard>
          </aside>
        </div>
      </section>
    </main>
  );
}

const SECTION_TINTS = {
  mint: "border-mint/30 bg-mint/10 text-mint-glow",
  sun: "border-sun/30 bg-sun/10 text-brag",
  coral: "border-coral/30 bg-coral/10 text-coral-glow",
} as const;

function SectionCard({
  title,
  icon,
  tint,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tint: keyof typeof SECTION_TINTS;
  children: React.ReactNode;
}) {
  return (
    <div className="plate p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className={`grid h-8 w-8 shrink-0 place-items-center border ${SECTION_TINTS[tint]}`}>
          {icon}
        </span>
        <h2 className="font-display text-xl text-parchment">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function RailCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="rail-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-parchment-400">
            {icon}
          </span>
          <h2 className="font-display text-base text-parchment">{title}</h2>
        </div>
        {action && (
          <Link
            href={action.href}
            // The section "more" link. Same shape the home page and HeroTv
            // already carry: a 44px hit area on a finger, given back to the
            // layout with -my-2 so the header row keeps its height, and stepped
            // down behind `(pointer: fine)` — never `sm:`, since a 1024px
            // tablet is a coarse pointer. It measured 19.5px tall before.
            className="-my-2 inline-flex min-h-[44px] items-center gap-0.5 text-[13px] text-parchment-400 transition-colors hover:text-gold-leaf [@media(pointer:fine)]:my-0 [@media(pointer:fine)]:min-h-0"
          >
            {action.label}
            <ChevronRight size={12} aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function TournamentRail({
  tournaments,
  error,
  onRetry,
}: {
  tournaments: Tournament[] | null;
  error: boolean;
  onRetry: () => void;
}) {
  if (error) return <RailError onRetry={onRetry} />;
  if (!tournaments) return <RailSkeleton rows={3} />;
  const live = tournaments
    .filter((t) => t.phase !== "finished")
    .sort((a, b) => {
      if (a.phase !== b.phase) return a.phase === "ongoing" ? -1 : 1;
      return (a.starts_at ?? Infinity) - (b.starts_at ?? Infinity);
    })
    .slice(0, 4);
  if (live.length === 0) {
    return (
      <EmptyRail>
        No upcoming events.{" "}
        <Link href="/tournaments" className="text-gold-leaf hover:underline">
          Host one
        </Link>
        .
      </EmptyRail>
    );
  }
  return (
    <ul className="mt-1 space-y-0.5">
      {live.map((t) => (
        <li key={t.id}>
          <Link
            href={`/tournaments/${t.id}`}
            className="flex min-h-[44px] items-center gap-2 px-2 -mx-2 transition hover:bg-[var(--surface-hover)]"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-parchment-100">{t.name}</span>
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-parchment-400">
                <ModeBadge mode={t.mode === "nerf" || t.mode === "buff" ? t.mode : undefined} compact />
                {modeLabel(t.mode)} · {t.players} entered
              </span>
            </span>
            {t.phase === "ongoing" ? (
              <span className="inline-flex shrink-0 items-center gap-1 border border-verdigris/40 bg-verdigris/10 px-1.5 py-0.5 text-xs text-verdigris-glow">
                <span className="h-1.5 w-1.5 rounded-full bg-verdigris-glow" aria-hidden />
                Live
              </span>
            ) : t.starts_at != null ? (
              <span className="shrink-0 font-mono text-xs tabular-nums text-parchment-400">
                in {startsInLabel(t.starts_at)}
              </span>
            ) : (
              <span className="shrink-0 text-xs text-parchment-500">Soon</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RecentGameRow({ game }: { game: RecentGame }) {
  const category = getCategory(isRatingCategoryId(game.category) ? game.category : DEFAULT_CATEGORY);
  const Icon = category.icon;
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-parchment-100">
          <PlayerNameInline name={game.whiteName} />
          <span className="text-parchment-400">vs</span>
          <PlayerNameInline name={game.blackName} />
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-parchment-400">
          <Icon size={12} style={{ color: category.accent }} aria-hidden />
          {category.label} · {game.rated ? "Rated" : "Casual"} · {timeAgo(game.completedAt)}
        </span>
      </span>
      <Link
        href={`/game/${game.id}`}
        aria-label={`Replay ${game.whiteName} versus ${game.blackName}`}
        className="group inline-flex shrink-0 items-center gap-1.5 font-mono text-sm tabular-nums text-parchment-200 transition-colors hover:text-gold-leaf"
      >
        {resultLabel(game.winner)}
        <ChevronRight
          size={14}
          className="text-parchment-500 transition-all group-hover:translate-x-0.5 group-hover:text-gold-leaf"
          aria-hidden
        />
      </Link>
    </li>
  );
}

function PlayerNameInline({ name }: { name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Link href={`/u/${encodeURIComponent(name)}`} className="truncate hover:text-gold-leaf">
        {name}
      </Link>
    </span>
  );
}

function PresenceDot({ status }: { status?: "online" | "searching" | "playing" }) {
  const cls =
    status === "playing"
      ? "bg-coral"
      : status === "searching"
        ? "bg-sun"
        : status === "online"
          ? "bg-verdigris"
          : "bg-parchment-500";
  return <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

function presenceLabel(status?: "online" | "searching" | "playing"): string {
  if (status === "searching") return "Searching";
  if (status === "online") return "Online";
  return "Offline";
}

// A section-level empty state: one sentence and one action, sized to content
// (design system section 8), sitting flush inside its card without a nested plate.
function InlineEmpty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: { href: string; label: string };
}) {
  return (
    <div className="mt-2 flex flex-col items-start gap-2.5 py-4">
      <p className="text-sm leading-relaxed text-parchment-300">
        <span className="font-medium text-parchment-100">{title}.</span> {body}
      </p>
      <LinkButton tone="ghost" href={action.href} className="px-3 py-1.5 text-sm">
        {action.label}
      </LinkButton>
    </div>
  );
}

function EmptyRail({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm text-parchment-400">{children}</p>;
}

// Section-level error (design system 8.3): what failed in plain words, a Retry,
// and a way out. The page's nav and its other panels remain the way out, and a
// Back to lobby link makes it explicit for this larger region.
function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="mt-2 flex flex-col items-start gap-2.5 py-4">
      <p className="text-sm leading-relaxed text-parchment-300">
        This section could not load right now.
      </p>
      <div className="flex items-center gap-2">
        <Button tone="ghost" onClick={onRetry} className="px-3 py-1.5 text-sm">
          Retry
        </Button>
        <Link href="/lobby" className="text-sm text-parchment-400 transition-colors hover:text-gold-leaf">
          Back to lobby
        </Link>
      </div>
    </div>
  );
}

// Compact error for a rail panel: one line plus a Retry. The surrounding page
// keeps its own way out (nav and the other panels), so the rail stays tight.
function RailError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="mt-2 space-y-2">
      <p className="text-sm text-parchment-400">Could not load this list.</p>
      <Button tone="ghost" onClick={onRetry} className="px-3 py-1 text-[13px]">
        Retry
      </Button>
    </div>
  );
}

function RailSkeleton({ rows }: { rows: number }) {
  return (
    <div className="mt-3 space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-8" />
      ))}
    </div>
  );
}
