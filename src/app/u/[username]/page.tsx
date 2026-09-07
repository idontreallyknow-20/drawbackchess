"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  ChevronRight,
  Crown,
  Flag,
  Gamepad2,
  MessageSquare,
  MoreHorizontal,
  Share2,
  Swords,
  Trophy,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";
import { AccountUser, fetchMe } from "@/lib/authClient";
import { achievementIcon } from "@/lib/achievementIcons";
import { RARITY_THEME } from "@/lib/achievementTheme";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { PresenceBadge } from "@/components/PresenceBadge";
import { EmptyState } from "@/components/EmptyState";
import { ModeBadge } from "@/components/ModeBadge";
import { SiteHeader } from "@/components/SiteHeader";
import { PlayerStatsPanel } from "@/components/PlayerStatsPanel";
import type { PlayerStats } from "@/lib/playerStats";
import type { RatingPoint } from "@/components/RatingChart";
import {
  RatingHistoryPanel,
  type HistoryPoint,
} from "@/components/ratings/RatingHistoryPanel";
import { RatingRail } from "@/components/profile/RatingRail";
import { ProfileInfoBox } from "@/components/profile/ProfileInfoBox";
import { ActivityFeed } from "@/components/profile/ActivityFeed";
import { type RecentGameRow, viewerPlayedWhite } from "@/components/profile/RecentGameCard";
import { FriendsModule } from "@/components/profile/FriendsModule";
import { relativeTime } from "@/components/profile/relativeTime";
import { usePresence } from "@/lib/presence";
import { ACTIVE_RATING_CATEGORIES, MODE_RATING_CATEGORIES } from "@/lib/ratingCategories";
import { clockLabel } from "@/lib/tournaments";
import { placementTitle, type LaurelPlacement } from "@/lib/laurels";
import { LaurelBadge, useTopPlacements } from "@/components/LaurelBadge";
import { isHouseEditor, isRatingEditor } from "@/lib/godPanel";
import { fileToDataUrl } from "@/lib/imageUpload";
import type { DraftMode } from "@/engine/buff";
import { useModalChrome } from "@/lib/useModalChrome";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

type Relationship = "self" | "none" | "friends" | "incoming" | "outgoing";

interface ProfileUser {
  username: string;
  avatar?: string | null;
  rating: number;
  rd: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  createdAt: number;
  role: "user" | "mod" | "admin";
  bio: string | null;
  flair: string | null;
  // Extended privacy / social fields (profile-contracts.md).
  lastSeenAt: number | null;
  showOnline: boolean;
  friendsVisibility: "public" | "private";
  friendCount: number;
  clubs?: { slug: string; name: string }[];
}

interface CategoryRatingRow {
  rating: number;
  rd: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  peak: number;
}

type ProfileRatingPoint = RatingPoint & { category?: string | null };

interface ProfileData {
  user: ProfileUser;
  // The player's current live game, resolved server-side from the authoritative
  // live-seat index. Null (or absent, on an older API) when not playing.
  currentGame?: { gameId: string; mode?: "nerf" | "buff" } | null;
  games: unknown[];
  ratings?: Record<string, CategoryRatingRow>;
  ratingHistory: ProfileRatingPoint[];
  relationship: Relationship | null;
  mutualFriends: { username: string; avatar: string | null }[];
}

// useSearchParams (for the ?tab= state) must sit under a Suspense boundary, so
// the page shell renders SiteHeader immediately and defers the data-driven body.
export default function ProfilePage() {
  return (
    <main className="min-h-screen pb-16">
      <SiteHeader />
      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileContent />
      </Suspense>
    </main>
  );
}

function ProfileContent() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const username = String(params.username ?? "");

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [me, setMe] = useState<AccountUser | null>(null);
  const [missing, setMissing] = useState(false);
  // A network / server failure on the primary profile fetch (distinct from a
  // 404, which is `missing`): without this a dropped request left the page
  // stuck on the skeleton forever. Surfaces a visible error + Retry instead.
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [reporting, setReporting] = useState(false);
  // Set only when the viewer is the designated house editor (ilovenewjeans) AND
  // this profile is a house bot: carries the bot's persona id and the pickable
  // avatar catalog so the inline editor can rename it, swap its pfp, or set its
  // bio. Null for everyone else, so house-bot status stays invisible to others.
  const [houseEdit, setHouseEdit] = useState<{ userId: string; avatars: string[] } | null>(null);
  // Friend button state machine, seeded from the payload relationship and driven
  // locally by the header's Add / Accept / Remove actions.
  const [rel, setRel] = useState<Relationship | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);

  // Client-side profile->profile navigation re-renders this component without a
  // remount: clear the previous player's state during render (React's sanctioned
  // reset-on-key-change) so stale data never sticks to the new username while the
  // fetch below is in flight.
  const [seenUser, setSeenUser] = useState(username);
  if (seenUser !== username) {
    setSeenUser(username);
    setMissing(false);
    setLoadError(false);
    setProfile(null);
    setStats(null);
    setHouseEdit(null);
    setRel(null);
    setFriendBusy(false);
    setReporting(false);
  }

  // Load the profile payload, stats, the signed-in account, and (house editor
  // only) the persona roster.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let data: ProfileData;
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setMissing(true);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const payload = (await res.json()) as ProfileData & { redirectTo?: string };
        // Renamed account: the API resolved this old name to a current profile.
        // Forward to the canonical /u/<currentName> (replace, so Back does not
        // bounce through the dead old name).
        if (payload.redirectTo && payload.redirectTo.toLowerCase() !== username.toLowerCase()) {
          router.replace(`/u/${encodeURIComponent(payload.redirectTo)}`);
          return;
        }
        data = payload;
      } catch {
        // Network drop or 5xx: show a retryable error instead of an endless
        // skeleton. A 404 is handled above as "not found".
        if (!cancelled) setLoadError(true);
        return;
      }
      if (cancelled) return;
      setProfile(data);
      setRel(data.relationship);

      fetch(`/api/users/${encodeURIComponent(username)}/stats`)
        .then((r) => (r.ok ? (r.json() as Promise<{ stats: PlayerStats }>) : null))
        .then((s) => {
          if (!cancelled && s) setStats(s.stats);
        })
        .catch(() => {});

      const account = await fetchMe();
      if (cancelled) return;
      setMe(account ?? null);
      // House editor (ilovenewjeans only): learn whether this profile is a bot
      // and, if so, load its persona id + the pickable avatar catalog. The
      // personas endpoint is authorized for this account and 403s for everyone
      // else, so a non-editor never even learns the roster.
      if (account && isHouseEditor(account.username)) {
        try {
          const res2 = await fetch("/api/mod/house/personas");
          if (!res2.ok || cancelled) return;
          const payload = (await res2.json()) as {
            personas: { userId: string; effective: { username: string } }[];
            avatars: string[];
          };
          const match = payload.personas.find(
            (p) => p.effective.username.toLowerCase() === data.user.username.toLowerCase(),
          );
          if (match && !cancelled) setHouseEdit({ userId: match.userId, avatars: payload.avatars });
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
    // reloadTick re-runs the primary fetch when the user taps Retry after a
    // load error. Every other value the body touches (setState updaters,
    // fetchMe, isHouseEditor) is a stable import or setter, so the two reactive
    // inputs below are the complete dependency set. router is Next's stable
    // App Router instance (used only for the renamed-account redirect).
  }, [username, reloadTick, router]);

  // Live presence for the game module and the header badge.
  const presence = usePresence(username);

  // The game id a finished live game reported, so the module can swap to the
  // recent-game card without a reload even though the profile payload still
  // carries the (now stale) currentGame id.

  const isOwner = profile?.relationship === "self";

  // Current top-10 leaderboard honors, derived from the cached standings the
  // leaderboard endpoint already serves. Empty for the unlaurelled.
  const placements = useTopPlacements(profile?.user.username);

  const tab: "activity" | "games" = searchParams.get("tab") === "games" ? "games" : "activity";
  const setTab = (next: "activity" | "games") => {
    router.replace(`/u/${encodeURIComponent(username)}${next === "games" ? "?tab=games" : ""}`, {
      scroll: false,
    });
  };

  if (missing) {
    return (
      <section className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
        <h1 className="page-title">Player not found</h1>
        <p className="mt-3 text-parchment-200">No account with that name.</p>
        <LinkButton tone="leaf" href="/lobby" className="mt-6 px-4 py-2 text-sm font-semibold">
          Back to the lobby
        </LinkButton>
      </section>
    );
  }

  if (loadError && !profile) {
    return (
      <section className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
        <div className="plate flex flex-col items-center gap-3 p-8 text-center">
          <h1 className="font-display text-2xl">Could not load this profile</h1>
          <p className="text-sm text-parchment-300">
            Something went wrong reaching the server. Check your connection and try again.
          </p>
          <Button tone="ghost"
           
            onClick={() => {
              setLoadError(false);
              setReloadTick((t) => t + 1);
            }}
            className="px-5 text-sm font-semibold">
            Retry
          </Button>
        </div>
      </section>
    );
  }

  if (!profile) return <ProfileSkeleton />;

  const user = profile.user;
  // Authoritative current rating: the ACTIVE (most-played) live mode bucket,
  // ties broken by the higher number — the same rule as bestLiveRatingSql and
  // the profile API's top-level `rating` (itself derived the same way, with
  // the frozen legacy column only as a last resort for bucket-less accounts).
  let bestLiveRow: CategoryRatingRow | null = null;
  for (const c of MODE_RATING_CATEGORIES) {
    const r = profile.ratings?.[c.id];
    if (r && (!bestLiveRow || r.games > bestLiveRow.games || (r.games === bestLiveRow.games && r.rating > bestLiveRow.rating))) {
      bestLiveRow = r;
    }
  }
  const bestLiveRating = bestLiveRow?.rating ?? (user.rating || null);
  // Highest maintained peak across the live buckets, for the stats panel's
  // "Highest rating" card (the games scan alone can undercount).
  const peakRating = MODE_RATING_CATEGORIES.reduce<number | null>((max, c) => {
    const peak = profile.ratings?.[c.id]?.peak;
    return peak != null && peak > (max ?? 0) ? peak : max;
  }, null);
  const ratingHistory = profile.ratingHistory as HistoryPoint[];
  const currentRatings: Record<string, number | undefined> = Object.fromEntries(
    ACTIVE_RATING_CATEGORIES.map((c) => [c.id, profile.ratings?.[c.id]?.rating]),
  );

  // Presence chip is suppressed entirely when the player hides their online
  // status and the viewer is not the owner (spec 2.2 / section 5).
  const showPresence = user.showOnline || isOwner;

  // The presence feed only sees players on the lobby socket, so an owner
  // browsing their own profile derives as "offline" ("Last seen 15s ago" while
  // they are literally looking at the page). They are demonstrably here:
  // upgrade offline to online for the owner's own badge. Other viewers keep
  // the raw feed state.
  const headerPresenceState =
    isOwner && presence.state === "offline" ? "online" : presence.state;

  // Live game id for the "Playing right now" module. The profile payload's
  // currentGame (resolved server-side from the DO's authoritative live-seat
  // index) is the primary signal; the lobby-feed presence is the fallback for
  // an older API payload. A game the card already reported ended is retired so
  // the recent-game module can take over without a reload.
  const apiLiveId = profile.currentGame?.gameId ?? null;
  const presenceLiveId =
    presence.state === "in-game" ? (presence.gameId ?? presence.game?.id ?? null) : null;
  const liveGameIdRaw = apiLiveId ?? presenceLiveId;
  const liveGameId = liveGameIdRaw || null;
  const liveGameMode = profile.currentGame?.mode ?? presence.game?.mode ?? null;
  // The lobby entry adds metadata (time control, rated, watchers) but only when
  // it describes the SAME game; a mismatched entry means one side is stale.
  const liveLobbyEntry = presence.game && presence.game.id === liveGameId ? presence.game : null;

  const addFriend = async () => {
          setFriendBusy(true);
          setRel("outgoing");
          try {
            const r = await fetch("/api/friends", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "request", username: user.username }),
            });
            if (!r.ok) setRel("none");
          } catch {
            setRel("none");
          } finally {
            setFriendBusy(false);
          }
  };
  const acceptFriend = async () => {
          setFriendBusy(true);
          const prev = rel;
          setRel("friends");
          try {
            const r = await fetch("/api/friends", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "accept", username: user.username }),
            });
            if (!r.ok) setRel(prev);
          } catch {
            setRel(prev);
          } finally {
            setFriendBusy(false);
          }
  };
  const removeFriend = async () => {
          setFriendBusy(true);
          const prev = rel;
          setRel("none");
          try {
            const r = await fetch("/api/friends", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "remove", username: user.username }),
            });
            if (!r.ok) setRel(prev);
          } catch {
            setRel(prev);
          } finally {
            setFriendBusy(false);
          }
  };

  const totalGames = user.games;
  const gamesLabel = `${totalGames.toLocaleString()} ${totalGames === 1 ? "Game" : "Games"}`;

  return (
    <section className="mx-auto w-full max-w-[1300px] px-3 pt-4 sm:px-5 lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-4">
      {/* Left rail: one row per rated mode, Lichess's perf list. */}
      <aside className="order-2 mt-4 lg:order-1 lg:mt-0">
        <RatingRail ratings={profile.ratings} history={ratingHistory} placements={placements} />
        {/* Statistics live in the rail, under the ratings, where Lichess keeps
            a player's numbers; the main column stays for the chart, the
            activity and the games. */}
        {stats && (
          <div className="mt-4 border-t border-[color:var(--edge)] px-3 pt-4 lg:border-t-0 lg:pt-2">
            <h2 className="text-[12px] uppercase tracking-[0.06em] text-parchment-400">Statistics</h2>
            <div className="mt-2">
              <PlayerStatsPanel stats={stats} peakRating={peakRating} compact />
            </div>
          </div>
        )}
      </aside>

      <div className="order-1 min-w-0 lg:order-2">
        <div className="plate">
      <ProfileHeader
            user={user}
            liveGameId={liveGameId}
            isOwner={isOwner}
            me={me}
            rel={rel}
            friendBusy={friendBusy}
            placements={placements}
            presenceMode={presence.game?.mode ?? null}
            presenceState={headerPresenceState}
            showPresence={showPresence}
            ratings={profile.ratings}
            onAddFriend={addFriend}
            onAcceptFriend={acceptFriend}
            onRemoveFriend={removeFriend}
            onReport={() => setReporting(true)}
          />

          {/* The action bar. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[color:var(--edge)] px-4 py-3 sm:px-5">
            <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-center">
              <StatCell value={totalGames} label={totalGames === 1 ? "Game" : "Games"} />
              <StatCell value={user.wins} label="Wins" />
              <StatCell value={user.losses} label="Losses" />
              <StatCell value={user.draws} label="Draws" />
            </dl>
            <div className="ml-auto">
              <HeaderActions
                user={user}
                isOwner={isOwner}
                me={me}
                rel={rel}
                friendBusy={friendBusy}
                onAddFriend={addFriend}
                onAcceptFriend={acceptFriend}
                onRemoveFriend={removeFriend}
                onReport={() => setReporting(true)}
              />
            </div>
          </div>

          {/* Chart on the left, the facts on the right. */}
          <div className="grid border-t border-[color:var(--edge)] lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 p-3 sm:p-4">
              {ratingHistory.length > 0 ? (
                <RatingHistoryPanel key={user.username} points={ratingHistory} currentRatings={currentRatings} />
              ) : (
                <p className="px-1 py-6 text-[13px] text-parchment-400">
                  {isOwner ? "Play a rated game and your rating history appears here." : "No rated games yet."}
                </p>
              )}
            </div>
            <div className="border-t border-[color:var(--edge)] p-4 lg:border-l lg:border-t-0 sm:p-5">
              <ProfileInfoBox
                createdAt={user.createdAt}
                lastSeenAt={user.lastSeenAt}
                online={headerPresenceState !== "offline"}
                showPresence={showPresence}
                stats={stats}
                friendCount={user.friendCount}
                clubs={user.clubs ?? []}
                role={user.role}
              />
              {liveGameId && (
                <Link
                  href={`/game/${encodeURIComponent(liveGameId)}`}
                  className="mt-4 flex items-center gap-2 text-[13px] no-underline"
                >
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--pos-rgb))]" />
                  <span className="text-parchment-100">Playing right now</span>
                  {liveGameMode && <ModeBadge mode={liveGameMode} compact />}
                  <span className="ml-auto text-gold-leaf">Watch</span>
                </Link>
              )}
            </div>
          </div>

          {/* Box tabs, Lichess's: two equal halves on a hairline. */}
          <div
            role="tablist"
            aria-label="Profile sections"
            className="grid grid-cols-2 border-t border-[color:var(--edge)]"
          >
            <TabButton id="activity" label="Activity" active={tab === "activity"} onSelect={() => setTab("activity")} />
            <TabButton id="games" label={gamesLabel} active={tab === "games"} onSelect={() => setTab("games")} />
          </div>

          <div role="tabpanel" id="panel-activity" aria-labelledby="tab-activity" hidden={tab !== "activity"}>
            <ActivityFeed username={user.username} active={tab === "activity"} />
            <div className="border-t border-[color:var(--edge)] px-4 py-4 sm:px-5">
              <AchievementsStrip username={user.username} />
            </div>
          </div>

          <div role="tabpanel" id="panel-games" aria-labelledby="tab-games" hidden={tab !== "games"} className="px-2 pb-2 sm:px-4">
            <GamesTab
              username={user.username}
              user={user}
              playingNow={presence.state === "in-game"}
              active={tab === "games"}
            />
          </div>
        </div>

      {/* House-bot inline editor (house editor only); everyone else sees the
          read-only bio rendered inside the header component. Folded behind a
          disclosure: it is a rarely-used admin tool, not profile content. */}
      {houseEdit && (
        <EditorFold id="fold-house-editor" label="House bot editor">
        <HouseBotEditor
          userId={houseEdit.userId}
          avatars={houseEdit.avatars}
          username={user.username}
          avatar={user.avatar ?? null}
          bio={user.bio}
          rating={bestLiveRating}
          onIdentity={(nextName, nextAvatar) => {
            if (nextName.toLowerCase() !== user.username.toLowerCase()) {
              router.push(`/u/${encodeURIComponent(nextName)}`);
            } else {
              setProfile((p) => (p ? { ...p, user: { ...p.user, avatar: nextAvatar } } : p));
            }
          }}
          onBio={(bio) => setProfile((p) => (p ? { ...p, user: { ...p.user, bio } } : p))}
          onRating={(rating) =>
            setProfile((p) =>
              p ? { ...p, user: { ...p.user, rating }, ratings: ratingsWithAllSet(p.ratings, rating) } : p,
            )
          }
        />
        </EditorFold>
      )}

      {/* Rating editor (ilovenewjeans only): overwrite every rating bucket for
          this player at once. Server re-verifies the gate; this is UX only.
          Hidden on house-bot profiles (houseEdit is set only there): a bot's
          rating is edited from the House bot menu above instead, which persists
          it as an override the engine resync respects. Folded behind a
          disclosure like the house editor: a mod tool, not profile content. */}
      {isRatingEditor(me?.username) && !houseEdit && (
        <EditorFold id="fold-rating-editor" label="Rating editor">
        <RatingEditor
          key={user.username}
          username={user.username}
          current={bestLiveRating}
          onApplied={(appliedUsername, rating) => {
            setProfile((p) => {
              // Ignore a stale save that resolved after the viewer navigated to a
              // different profile (the callback still targets the old username).
              if (!p || p.user.username.toLowerCase() !== appliedUsername.toLowerCase()) return p;
              return { ...p, user: { ...p.user, rating }, ratings: ratingsWithAllSet(p.ratings, rating) };
            });
          }}
        />
        </EditorFold>
      )}


        <div className="mt-4">
          <FriendsModule username={user.username} isOwner={isOwner} />
        </div>
      </div>

      {reporting && <ReportModal username={user.username} onClose={() => setReporting(false)} />}
    </section>
  );
}

// One number over one word, the stats strip under the profile header.
function StatCell({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dd className="text-[15px] font-semibold tabular-nums text-parchment-50">{value.toLocaleString()}</dd>
      <dt className="text-[12px] text-parchment-400">{label}</dt>
    </div>
  );
}

// ---- Header -----------------------------------------------------------------

function ProfileHeader({
  user,
  liveGameId,
  isOwner,
  placements,
  presenceState,
  showPresence,
}: {
  user: ProfileUser;
  liveGameId: string | null;
  isOwner: boolean;
  me: AccountUser | null;
  rel: Relationship | null;
  friendBusy: boolean;
  placements: LaurelPlacement[];
  presenceMode: DraftMode | null;
  presenceState: ReturnType<typeof usePresence>["state"];
  showPresence: boolean;
  ratings?: Record<string, CategoryRatingRow>;
  onAddFriend: () => void;
  onAcceptFriend: () => void;
  onRemoveFriend: () => void;
  onReport: () => void;
}) {
  // Lichess's header line: presence dot, name, flair, then the trophy on the
  // far right for a top-ten placement. No watermark, no rings, no crowns.
  const online = showPresence && presenceState !== "offline";
  const avatar = <PlayerAvatar name={user.username} avatar={user.avatar} size={48} />;
  return (
    <div className="flex items-start gap-4 px-4 pb-4 pt-5 sm:px-5">
      {isOwner ? (
        <Link
          href="/profile/edit"
          title="Edit your profile picture"
          aria-label="Edit your profile picture"
          className="group relative shrink-0 self-start no-underline"
        >
          {avatar}
        </Link>
      ) : (
        <div className="shrink-0 self-start">{avatar}</div>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 font-display text-[26px] font-normal leading-tight text-parchment-50">
          {showPresence && (
            <span
              aria-label={online ? "Online" : "Offline"}
              title={online ? "Online" : "Offline"}
              className={"inline-block h-3 w-3 shrink-0 rounded-full " + (online ? "bg-[rgb(var(--pos-rgb))]" : "bg-parchment-500")}
            />
          )}
          <span className="min-w-0 break-words">{user.username}</span>
          {user.flair && (
            <span className="text-[22px]" aria-hidden="true">
              {user.flair}
            </span>
          )}
          {liveGameId && (
            <Link href={`/game/${encodeURIComponent(liveGameId)}`} className="text-[13px] text-gold-leaf no-underline hover:underline">
              playing now
            </Link>
          )}
        </h1>
        {user.bio && <BioText bio={user.bio} />}
        {!user.bio && isOwner && (
          <Link href="/profile/edit" className="mt-1 inline-block text-[13px] text-[color:var(--accent)] no-underline hover:underline">
            Add a bio
          </Link>
        )}
      </div>
      {placements.length > 0 && (
        <Link href="/leaderboard" title={placementTitle(placements[0])} className="shrink-0 no-underline">
          <LaurelBadge rank={placements[0].rank} title={placementTitle(placements[0])} size={36} />
        </Link>
      )}
    </div>
  );
}

// The header bio, clamped to three lines when long with a quiet "More"
// expander so a wordy bio never pushes the rating cards below the fold. Short
// bios render exactly as before.
function BioText({ bio }: { bio: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = bio.length > 220 || bio.split("\n").length > 3;
  return (
    <div className="mt-1.5 max-w-prose">
      <p
        className={
          "whitespace-pre-wrap text-[13px] text-parchment-300 " +
          (long && !expanded ? "line-clamp-3" : "")
        }
      >
        {bio}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[13px] text-gold-leaf hover:underline"
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

function HeaderActions({
  user,
  isOwner,
  me,
  rel,
  friendBusy,
  onAddFriend,
  onAcceptFriend,
  onRemoveFriend,
  onReport,
}: {
  user: ProfileUser;
  isOwner: boolean;
  me: AccountUser | null;
  rel: Relationship | null;
  friendBusy: boolean;
  onAddFriend: () => void;
  onAcceptFriend: () => void;
  onRemoveFriend: () => void;
  onReport: () => void;
}) {
  const router = useRouter();

  if (isOwner) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <LinkButton tone="ghost"
          href="/profile/edit"
          className="px-4 text-sm">
          Edit profile
        </LinkButton>
        <ShareButton username={user.username} />
      </div>
    );
  }

  // Signed out: no actions (Challenge needs an account).
  if (!me) return null;

  const signedInNonGuest = !me.isGuest;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button tone="leaf"
       
        onClick={() => router.push(`/friend?challenge=${encodeURIComponent(user.username)}`)}
        className="px-4 text-sm font-semibold">
        <Swords size={15} strokeWidth={2.3} aria-hidden />
        Challenge
      </Button>

      {/* Friend button state machine (only for real accounts, not guests). */}
      {signedInNonGuest && rel === "none" && (
        <Button tone="ghost"
         
          onClick={onAddFriend}
          disabled={friendBusy}
          className="px-4 text-sm disabled:opacity-60">
          <UserPlus size={15} strokeWidth={2.2} aria-hidden />
          Add friend
        </Button>
      )}
      {signedInNonGuest && rel === "outgoing" && (
        <span className="inline-flex min-h-[44px] items-center gap-1.5 rounded-none border border-[color:var(--edge)] px-4 font-display text-sm text-parchment-400">
          <Check size={15} strokeWidth={2.2} aria-hidden />
          Request sent
        </span>
      )}
      {signedInNonGuest && rel === "incoming" && (
        <Button tone="leaf"
         
          onClick={onAcceptFriend}
          disabled={friendBusy}
          className="px-4 text-sm font-semibold disabled:opacity-60">
          <Check size={15} strokeWidth={2.3} aria-hidden />
          Accept request
        </Button>
      )}
      {signedInNonGuest && rel === "friends" && (
        <span className="inline-flex min-h-[44px] items-center gap-1.5 rounded-none border border-verdigris-glow/40 bg-verdigris/10 px-4 font-display text-sm text-verdigris-glow">
          <UserCheck size={15} strokeWidth={2.2} aria-hidden />
          Friends
        </span>
      )}

      {/* Overflow: Share, Message, Report, and Remove friend (when friends).
          The header row keeps at most two primary buttons (Challenge plus the
          friend action); everything else folds in here. */}
      {signedInNonGuest && (
        <OverflowMenu
          username={user.username}
          showRemove={rel === "friends"}
          friendBusy={friendBusy}
          onRemoveFriend={onRemoveFriend}
          onReport={onReport}
        />
      )}
    </div>
  );
}

// Share via the Web Share API, falling back to a clipboard copy. Returns true
// when the fallback copied the link (so the caller can flash "Link copied");
// false when the share sheet handled it or nothing could be done quietly.
async function shareProfile(username: string): Promise<boolean> {
  const url =
    typeof window !== "undefined"
      ? window.location.origin + `/u/${encodeURIComponent(username)}`
      : "";
  const title = `${username} on Nerf Chess`;
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, url });
      return false;
    } catch {
      // Cancelled or unsupported: fall through to the clipboard copy.
    }
  }
  try {
    await navigator.clipboard?.writeText(url);
    return true;
  } catch {
    // No clipboard access: nothing else we can do quietly.
    return false;
  }
}

// The owner's Share button (the non-owner share action lives in OverflowMenu),
// with a transient "Link copied" confirmation on the clipboard fallback.
function ShareButton({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const share = async () => {
    if (await shareProfile(username)) {
      setCopied(true);
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Button tone="ghost"
     
      onClick={share}
      className="px-4 text-sm">
      <Share2 size={15} strokeWidth={2.2} aria-hidden />
      {copied ? "Link copied" : "Share"}
    </Button>
  );
}

// A keyboard-accessible overflow menu (Escape / click-outside close, focus
// returns to the trigger) holding Share, Message, Report, and an optional
// Remove friend.
function OverflowMenu({
  username,
  showRemove,
  friendBusy,
  onRemoveFriend,
  onReport,
}: {
  username: string;
  showRemove: boolean;
  friendBusy: boolean;
  onRemoveFriend: () => void;
  onReport: () => void;
}) {
  const [open, setOpen] = useState(false);
  // "Link copied" flash for the Share item's clipboard fallback: the menu stays
  // open just long enough to confirm, then closes itself.
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const share = async () => {
    if (await shareProfile(username)) {
      setCopied(true);
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1200);
    } else {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${username}`}
        className="grid h-11 w-11 place-items-center rounded-none border border-[color:var(--edge)] text-parchment-400 transition hover:border-[color:var(--edge-strong)] hover:text-parchment-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
      >
        <MoreHorizontal size={18} strokeWidth={2.2} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${username}`}
          className="absolute right-0 top-full z-40 mt-1.5 w-48 plate dropdown p-1 shadow-2xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void share()}
            className="flex min-h-[44px] w-full items-center gap-2 rounded px-3 text-left font-display text-[13px] text-parchment-200 transition hover:bg-[color:var(--bg-raised)]"
          >
            <Share2 size={15} strokeWidth={2.2} aria-hidden />
            {copied ? "Link copied" : "Share"}
          </button>
          <Link
            role="menuitem"
            href={`/inbox/${encodeURIComponent(username)}`}
            className="flex min-h-[44px] items-center gap-2 rounded px-3 font-display text-[13px] text-parchment-200 transition hover:bg-[color:var(--bg-raised)]"
          >
            <MessageSquare size={15} strokeWidth={2.2} aria-hidden />
            Message
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onReport();
            }}
            className="flex min-h-[44px] w-full items-center gap-2 rounded px-3 text-left font-display text-[13px] text-parchment-200 transition hover:bg-oxblood/15 hover:text-oxblood-glow"
          >
            <Flag size={15} strokeWidth={2.2} aria-hidden />
            Report
          </button>
          {showRemove && (
            <button
              type="button"
              role="menuitem"
              disabled={friendBusy}
              onClick={() => {
                setOpen(false);
                onRemoveFriend();
              }}
              className="flex min-h-[44px] w-full items-center gap-2 rounded px-3 text-left font-display text-[13px] text-parchment-200 transition hover:bg-oxblood/15 hover:text-oxblood-glow disabled:opacity-50"
            >
              <UserX size={15} strokeWidth={2.2} aria-hidden />
              Remove friend
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Tabs -------------------------------------------------------------------

function TabButton({
  id,
  label,
  active,
  onSelect,
}: {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={active}
      aria-controls={`panel-${id}`}
      onClick={onSelect}
      className={
        "min-h-[44px] px-4 text-[14px] transition-colors " +
        (active
          ? "bg-[color:var(--bg-panel)] text-parchment-50"
          : "bg-[color:var(--bg-base)] text-parchment-300 hover:text-parchment-100")
      }
    >
      {label}
    </button>
  );
}

// ---- Games tab (spec 2.6) ---------------------------------------------------

type ModeFilter = "" | DraftMode;
type ResultFilter = "" | "win" | "loss" | "draw";
type RatedFilter = "" | "1" | "0";

function GamesTab({
  username,
  user,
  playingNow,
  active,
}: {
  username: string;
  user: ProfileUser;
  playingNow: boolean;
  active: boolean;
}) {
  const [mode, setMode] = useState<ModeFilter>("");
  const [result, setResult] = useState<ResultFilter>("");
  const [rated, setRated] = useState<RatedFilter>("");
  const [games, setGames] = useState<RecentGameRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  // Bumped by Retry so a failed load can be re-attempted without changing filters.
  const [reloadTick, setReloadTick] = useState(0);

  const query = (extra?: Record<string, string>) => {
    const qs = new URLSearchParams();
    if (mode) qs.set("mode", mode);
    if (result) qs.set("result", result);
    if (rated) qs.set("rated", rated);
    qs.set("limit", "30");
    for (const [k, v] of Object.entries(extra ?? {})) qs.set(k, v);
    return qs.toString();
  };

  useEffect(() => {
    // Lazy: fetch only while the Games tab is actually shown (and refetch on any
    // filter change, which can only happen while it is visible).
    if (!active) return;
    let cancelled = false;
    // Loading-then-fetch: the remaining setState calls all fire after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase("loading");
    fetch(`/api/users/${encodeURIComponent(username)}/games?${query()}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ games: RecentGameRow[]; hasMore: boolean }>) : Promise.reject()))
      .then((body) => {
        if (cancelled) return;
        setGames(body.games);
        setHasMore(body.hasMore);
        setPhase("ready");
      })
      .catch(() => {
        if (!cancelled) setPhase("error");
      });
    return () => {
      cancelled = true;
    };
    // query() reads mode/result/rated/username; re-run when any change (or on Retry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode, result, rated, username, reloadTick]);

  const loadMore = async () => {
    const last = games[games.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/users/${encodeURIComponent(username)}/games?${query({ before: String(last.completed_at) })}`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { games: RecentGameRow[]; hasMore: boolean };
      setGames((g) => [...g, ...body.games]);
      setHasMore(body.hasMore);
    } catch {
      /* keep what we have; the button re-enables below */
    } finally {
      setLoadingMore(false);
    }
  };

  const decided = user.wins + user.losses + user.draws;

  return (
    <div>
      {/* Summary: one stat tile per number, label above value, so the counts
          never run together into a single wrapping line. */}
      <div className="grid grid-cols-2 gap-3 border-b py-3 sm:grid-cols-4" style={{ borderColor: "var(--edge)" }}>
        <StatTile label="Games" value={user.games.toLocaleString()} />
        <StatTile label="Record" value={`${user.wins} W · ${user.losses} L · ${user.draws} D`} />
        {decided > 0 && (
          <StatTile
            label="Win rate"
            value={`${Math.round((user.wins / Math.max(1, user.wins + user.losses)) * 100)}%`}
          />
        )}
        {playingNow && (
          <StatTile
            label="Playing now"
            value={
              <span className="inline-flex items-center gap-2 text-[rgb(var(--pos-rgb))]">
                <span aria-hidden className="dot-live h-2 w-2 rounded-full bg-[rgb(var(--pos-rgb))]" />
                Live
              </span>
            }
          />
        )}
      </div>

      {/* Filters: the three groups share one row from sm up, split by a
          hairline, and stack below it. */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-y-2">
        <ChipGroup
          label="Mode"
          aria-label="Filter by mode"
          value={mode}
          onChange={(v) => setMode(v as ModeFilter)}
          options={[
            { value: "", label: "All" },
            { value: "buff", label: "Buff" },
            { value: "nerf", label: "Nerf" },
          ]}
        />
        <ChipGroup
          label="Result"
          divider
          aria-label="Filter by result"
          value={result}
          onChange={(v) => setResult(v as ResultFilter)}
          options={[
            { value: "", label: "All" },
            { value: "win", label: "Wins" },
            { value: "loss", label: "Losses" },
            { value: "draw", label: "Draws" },
          ]}
        />
        <ChipGroup
          label="Rated"
          divider
          aria-label="Filter by rated"
          value={rated}
          onChange={(v) => setRated(v as RatedFilter)}
          options={[
            { value: "", label: "All" },
            { value: "1", label: "Rated" },
            { value: "0", label: "Casual" },
          ]}
        />
      </div>

      {/* List */}
      <div className="mt-3">
        {phase === "loading" ? (
          <div className="plate p-3">
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded bg-[color:var(--bg-zebra)] motion-reduce:animate-none"
                />
              ))}
            </div>
          </div>
        ) : phase === "error" ? (
          <div className="plate flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-parchment-300">Could not load games.</p>
            <Button tone="ghost"
             
              onClick={() => {
                setPhase("loading");
                setReloadTick((t) => t + 1);
              }}
              className="px-5 text-sm font-semibold">
              Retry
            </Button>
          </div>
        ) : games.length === 0 ? (
          <div className="plate p-6 text-center text-sm text-parchment-400">
            {mode || result || rated ? "No games match these filters." : "No games yet."}
          </div>
        ) : (
          <>
            <div className="border-b" style={{ borderColor: "var(--edge)" }}>
              {games.map((g) => (
                <GameHistoryRow key={g.id} game={g} viewer={username} />
              ))}
            </div>
            {hasMore && (
              <div className="mt-3 text-center">
                <Button tone="ghost"
                 
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-5 text-sm disabled:opacity-60">
                  {loadingMore ? "Loading..." : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// One summary tile: a muted 12px label above a bold mono value.
function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded border border-[color:var(--edge)] px-3 py-2">
      <div className="text-[12px] text-parchment-400">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[15px] font-bold tabular-nums text-parchment-100">{value}</div>
    </div>
  );
}

// A labelled row of filter chips. `divider` draws the hairline that separates
// it from the previous group when the groups share a row (sm and up).
function ChipGroup({
  label,
  divider = false,
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
}: {
  label: string;
  divider?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  "aria-label": string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={
        "flex flex-wrap items-center gap-2" +
        (divider ? " sm:ml-2.5 sm:border-l sm:border-[color:var(--edge)] sm:pl-2.5" : "")
      }
    >
      <span className="w-12 shrink-0 text-[12px] text-parchment-400 sm:w-auto sm:pr-1">{label}</span>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value || "all"}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={
              "inline-flex h-[44px] items-center rounded-none border px-3 text-[14px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] sm:h-[36px] sm:text-[13px] " +
              (on
                ? "border-[color:var(--edge-strong)] bg-[color:var(--bg-raised)] text-gold-leaf"
                : "border-[color:var(--edge)] text-parchment-400 hover:border-[color:var(--edge-strong)] hover:text-parchment-200")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// One finished-game row for the Games tab. The whole row opens the replay via a
// stretched overlay Link that is a SIBLING of the inner opponent PlayerLink (the
// content is pointer-events-none so clicks fall through to the overlay, while
// PlayerLink re-enables pointer events for itself), so no anchors nest. From sm
// up it is a 48px three-column grid (outcome / opponent / meta on one line);
// below that it takes two lines, identity then meta.
function GameHistoryRow({ game, viewer }: { game: RecentGameRow; viewer: string }) {
  const viewerIsWhite = viewerPlayedWhite(game, viewer);
  const myColor: "w" | "b" = viewerIsWhite ? "w" : "b";
  const opponent = viewerIsWhite ? game.black_name : game.white_name;
  const oppRating = viewerIsWhite ? game.black_rating_before : game.white_rating_before;

  const outcome =
    game.winner === "draw" ? "Draw" : game.winner == null ? "Aborted" : game.winner === myColor ? "Won" : "Lost";
  const tone =
    outcome === "Won" ? "text-gold-leaf" : outcome === "Lost" ? "text-oxblood-glow" : "text-bruise-glow";

  const before = viewerIsWhite ? game.white_rating_before : game.black_rating_before;
  const after = viewerIsWhite ? game.white_rating_after : game.black_rating_after;
  const delta = before != null && after != null ? Math.round(after) - Math.round(before) : null;

  return (
    <div className="relative border-b border-[color:var(--edge)] last:border-b-0 transition hover:bg-[color:var(--bg-raised)]">
      <Link
        href={`/game/${game.id}`}
        aria-label={`View replay of the ${outcome.toLowerCase()} game vs ${opponent}`}
        className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--edge-strong)]"
      />
      <div className="pointer-events-none relative z-10 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 px-3 py-[12px] sm:h-[48px] sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:gap-x-3 sm:py-0">
        <span className={`font-display text-[14px] font-semibold sm:text-[13px] ${tone}`}>{outcome}</span>

        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-[12px] text-parchment-500">vs</span>
          <PlayerAvatar name={opponent} avatar={null} size={22} />
          <PlayerLink
            name={opponent}
            className="pointer-events-auto relative z-20 min-w-0 truncate font-display text-[14px] text-parchment-100 hover:text-gold-leaf sm:text-[13px]"
          />
          {oppRating != null && (
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-parchment-400">
              ({Math.round(oppRating)})
            </span>
          )}
          {game.mode ? <ModeBadge mode={game.mode} /> : null}
        </span>

        {/* Meta: one right-aligned line from sm up. Every item is nowrap and
            the delta chip has a fixed width, so the columns line up row to row. */}
        <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap text-[12px] text-parchment-400 sm:col-span-1 sm:flex-nowrap sm:justify-end">
          <span>{game.rated ? "Rated" : "Casual"}</span>
          <span className="font-mono tabular-nums">{clockLabel(game.time_sec, game.increment_sec)}</span>
          {delta != null ? (
            <span
              className={
                "inline-flex w-12 items-center justify-center rounded-none border px-1 py-px font-mono text-[12px] tabular-nums " +
                (delta > 0
                  ? "border-[color:var(--edge-strong)] bg-[color:var(--bg-raised)] text-gold-leaf"
                  : delta < 0
                    ? "border-oxblood-glow/40 bg-oxblood/10 text-oxblood-glow"
                    : "border-[color:var(--edge)] bg-[color:var(--bg-zebra)] text-parchment-400")
              }
            >
              {delta > 0 ? "+" : ""}
              {delta}
            </span>
          ) : (
            <span aria-hidden className="hidden w-12 sm:inline-block" />
          )}
          <span className="sm:w-[6rem] sm:truncate">{game.reason}</span>
          <span className="sm:w-[5.5rem] sm:truncate sm:text-right">{relativeTime(game.completed_at)}</span>
        </span>
      </div>
    </div>
  );
}

// ---- Activity: achievements + standings -------------------------------------

interface StripAchievement {
  id: string;
  name: string;
  icon: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  unlocked: boolean;
  unlockedAt: number | null;
}

// A one-row trophy shelf: the player's 3 rarest unlocked achievements as
// rarity-themed medallions plus their earned/total count. "See all" expands
// the full grid inline (the same payload already fetched), with the dedicated
// achievements wall still one link away inside the expanded view.
function AchievementsStrip({ username }: { username: string }) {
  const [data, setData] = useState<{
    unlockedCount: number;
    total: number;
    rarest: StripAchievement[];
    all: StripAchievement[];
  } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/users/${encodeURIComponent(username)}/achievements`)
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{
              unlockedCount: number;
              total: number;
              achievements: StripAchievement[];
            }>)
          : null,
      )
      .then((body) => {
        if (cancelled || !body) return;
        const rank = { legendary: 3, epic: 2, rare: 1, common: 0 } as const;
        // Rarest first; newest unlock breaks ties within a rarity. The full
        // grid keeps the same order with locked medallions sinking last.
        const byRarity = (x: StripAchievement, y: StripAchievement) =>
          rank[y.rarity] - rank[x.rarity] || (y.unlockedAt ?? 0) - (x.unlockedAt ?? 0);
        const unlocked = body.achievements.filter((a) => a.unlocked).sort(byRarity);
        const locked = body.achievements.filter((a) => !a.unlocked).sort(byRarity);
        setData({
          unlockedCount: body.unlockedCount,
          total: body.total,
          rarest: unlocked.slice(0, 3),
          all: [...unlocked, ...locked],
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [username]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="achievements-fold"
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-[40px] w-full flex-wrap items-center justify-between gap-3 py-1 text-left"
      >
        <span className="flex items-center gap-2 font-display text-parchment-100">
          <ChevronRight
            aria-hidden
            size={14}
            strokeWidth={2.4}
            className={
              "shrink-0 text-parchment-400 transition-transform duration-150 " +
              (expanded ? "rotate-90" : "")
            }
          />
          <Trophy className="h-4 w-4 text-brag" strokeWidth={2} /> Achievements
          {data && (
            <span className="font-mono text-sm tabular-nums text-parchment-300">
              {data.unlockedCount}
              <span className="text-parchment-500">/{data.total}</span>
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {data?.rarest.map((a) => {
            const Icon = achievementIcon(a.icon);
            const theme = RARITY_THEME[a.rarity];
            return (
              <span
                key={a.id}
                title={`${a.name} (${theme.label})`}
                className="grid h-9 w-9 place-items-center rounded-full border"
                style={{
                  borderColor: theme.border,
                  background: `radial-gradient(circle at 32% 28%, rgb(${theme.rgb} / 0.30), rgb(${theme.rgb} / 0.06) 72%)`,
                  boxShadow: `0 0 10px -3px ${theme.glow}`,
                }}
              >
                <Icon className="h-[18px] w-[18px]" style={{ color: theme.color }} strokeWidth={2} />
              </span>
            );
          })}
          <span className="text-[12px] text-gold-leaf">
            {expanded ? "Hide" : "See all"}
          </span>
        </span>
      </button>
      {expanded && (
        <div id="achievements-fold" className="pb-4">
          {!data ? (
            <p className="text-sm text-parchment-400">Loading achievements…</p>
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.all.map((a) => {
                  const Icon = achievementIcon(a.icon);
                  const theme = RARITY_THEME[a.rarity];
                  return (
                    <li
                      key={a.id}
                      title={`${a.name} (${theme.label}${a.unlocked ? "" : ", locked"})`}
                      className={
                        "flex min-w-0 items-center gap-2.5 border px-2.5 py-2 " +
                        (a.unlocked ? "" : "opacity-50")
                      }
                      style={{ borderColor: "var(--edge)" }}
                    >
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border"
                        style={
                          a.unlocked
                            ? {
                                borderColor: theme.border,
                                background: `radial-gradient(circle at 32% 28%, rgb(${theme.rgb} / 0.30), rgb(${theme.rgb} / 0.06) 72%)`,
                              }
                            : { borderColor: "var(--edge)" }
                        }
                      >
                        <Icon
                          className="h-4 w-4"
                          style={{ color: a.unlocked ? theme.color : undefined }}
                          strokeWidth={2}
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-parchment-100">{a.name}</span>
                        <span className="block text-[12px] text-parchment-400">
                          {a.unlocked ? theme.label : "Locked"}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3">
                <Link
                  href={`/achievements?u=${encodeURIComponent(username)}`}
                  className="text-[12px] text-gold-leaf transition-colors hover:text-brag"
                >
                  Open the achievements wall
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
      <div className="flex items-center gap-4">
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
            <div className="skeleton mt-3 h-3 w-32 rounded-none" style={{ borderRadius: 2 }} />
          </div>
        ))}
      </div>
      <div className="plate mt-4 p-4">
        <div className="skeleton h-24 w-full rounded-none" style={{ borderRadius: 2 }} />
      </div>
      <div className="plate mt-8 p-5">
        <div className="skeleton h-5 w-28 rounded-none" style={{ borderRadius: 2 }} />
        <div className="mt-4 space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-9 rounded-none" style={{ borderRadius: 2 }} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- House-bot editor (unchanged behavior) ----------------------------------

// Read-only bio helper reused by the house editor's editable variant. For a
// normal profile the bio renders read-only in the header; owners edit it at
// /profile/edit. The house editor still writes the bot's row inline.
function BioSection({
  bio,
  editable,
  onSaved,
  saveBio,
}: {
  bio: string | null;
  editable: boolean;
  onSaved: (bio: string | null) => void;
  saveBio?: (bio: string | null) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bio ?? "");
  const [saving, setSaving] = useState(false);

  if (!bio && !editable) return null;

  const save = async () => {
    setSaving(true);
    try {
      let next: string | null;
      if (saveBio) {
        next = await saveBio(draft.trim() || null);
      } else {
        const res = await fetch("/api/auth/bio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bio: draft.trim() || null }),
        });
        if (!res.ok) {
          setSaving(false);
          return;
        }
        next = ((await res.json()) as { bio: string | null }).bio;
      }
      onSaved(next);
      setDraft(next ?? "");
      setEditing(false);
    } catch {
      // Leave the editor open so the text isn't lost.
    }
    setSaving(false);
  };

  return (
    <div className="mt-4">
      {editing ? (
        <div className="plate p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 300))}
            rows={3}
            placeholder="Say something about this account..."
            className="w-full resize-none bg-transparent text-sm text-parchment-100 outline-none"
            autoFocus
          />
          <div className="mt-2 flex items-center gap-2 text-sm">
            <Button tone="ghost"
             
              onClick={save}
              disabled={saving}
              className="px-3 text-gold-leaf">
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button tone="ghost"
             
              onClick={() => setEditing(false)}
              className="px-3">
              Cancel
            </Button>
            <span className="ml-auto text-xs text-parchment-400">{draft.length}/300</span>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-parchment-200">
          {bio}
          {editable && (
            <button
              type="button"
              onClick={() => {
                setDraft(bio ?? "");
                setEditing(true);
              }}
              className="ml-2 text-gold-leaf hover:underline"
            >
              {bio ? "Edit" : "Add a bio"}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

// Optimistic ratings map after a hand-set edit: overwrite every bucket the
// player already has to `rating`, and ensure both visible mode cards (Nerf,
// Buff) render it even if the player was previously Unrated there. Shared by the
// standalone rating editor (real players) and the House bot menu (bots), which
// both set every category to one number. rd 90 is non-provisional (< 110), so
// the display matches the server's settled value with no "?" flicker.
function ratingsWithAllSet(
  ratings: Record<string, CategoryRatingRow> | undefined,
  rating: number,
): Record<string, CategoryRatingRow> {
  const next: Record<string, CategoryRatingRow> = { ...(ratings ?? {}) };
  for (const key of Object.keys(next)) {
    next[key] = {
      ...next[key],
      rating,
      rd: Math.min(next[key].rd ?? 90, 90),
      peak: Math.max(next[key].peak ?? rating, rating),
    };
  }
  for (const c of MODE_RATING_CATEGORIES) {
    if (!next[c.id]) {
      next[c.id] = { rating, rd: 90, games: 0, wins: 0, losses: 0, draws: 0, peak: rating };
    }
  }
  return next;
}

// Collapsed disclosure around the mod-only inline editors (RatingEditor,
// HouseBotEditor), following the DockSectionHeader pattern: the whole header
// is the toggle (aria-expanded, chevron rotates open). These tools are used
// rarely and only by one designated account, so they start folded and never
// crowd the profile for that viewer.
function EditorFold({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] items-center gap-1.5 text-left"
      >
        <ChevronRight
          aria-hidden
          size={13}
          strokeWidth={2.4}
          className={
            "shrink-0 text-parchment-400 transition-transform duration-150 " +
            (open ? "rotate-90" : "")
          }
        />
        <span className="rounded-none border border-[color:var(--edge-strong)] px-2 py-0.5 text-[12px] text-gold-leaf">
          {label}
        </span>
        {!open && <span className="text-xs text-parchment-400">Show tools</span>}
      </button>
      {open && <div id={id}>{children}</div>}
    </div>
  );
}

// Inline rating editor, shown on ANY non-bot profile ONLY to the designated
// rating editor (ilovenewjeans). Types a number and sets every rating bucket for
// the account to it in one save (via /api/mod/ratings), so the value updates
// identically across the profile cards, the header chip, the leaderboard, the
// lobby, and player search. The server re-verifies the ilovenewjeans gate; this
// control is a UX affordance only. (For house bots the same control is folded
// into the House bot menu — see HouseBotEditor.)
function RatingEditor({
  username,
  current,
  onApplied,
}: {
  username: string;
  current: number | null;
  onApplied: (username: string, rating: number) => void;
}) {
  const [value, setValue] = useState(current != null ? String(Math.round(current)) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Navigating profile->profile unmounts this editor (the parent falls back to
  // the skeleton while the next profile loads). An in-flight save must not touch
  // state or call back after that, or a slow save started on player A could land
  // on player B's now-mounted profile. Flipped false on unmount.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const save = async () => {
    // Re-entrancy guard: the Save button is disabled while saving, but Enter in
    // the input is not — without this a double-press fires duplicate POSTs.
    if (saving) return;
    const trimmed = value.trim();
    if (trimmed === "") return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setError("Enter a number.");
      return;
    }
    const rating = Math.round(parsed);
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/mod/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, rating }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; rating?: number } | null;
      if (!alive.current) return;
      setSaving(false);
      if (!res.ok) {
        setError(data?.error ?? "Could not save. Try again.");
        return;
      }
      const applied = data?.rating ?? rating;
      setValue(String(applied));
      setNote(`All ratings set to ${applied}.`);
      // Pass the username this save targeted so the parent can ignore a stale
      // callback that resolved after the viewer moved to a different profile.
      onApplied(username, applied);
    } catch {
      if (!alive.current) return;
      setSaving(false);
      setError("Could not save. Try again.");
    }
  };

  return (
    <div className="mt-5 plate border border-gold/25 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-none border border-[color:var(--edge-strong)] px-2 py-0.5 text-[12px] text-gold-leaf">
          Rating editor
        </span>
        <span className="text-xs text-parchment-400">
          Set this player&rsquo;s rating in every category at once.
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="rating-edit" className="w-16 text-xs text-parchment-400">
          Rating
        </label>
        <input
          id="rating-edit"
          type="number"
          inputMode="numeric"
          min={0}
          max={4000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          className="w-28 bg-transparent plate px-3 py-1.5 text-sm font-mono tabular-nums outline-none focus:border-[color:var(--edge-strong)]"
        />
        <Button tone="ghost"
         
          disabled={saving || value.trim() === ""}
          onClick={() => void save()}
          className="px-3 text-gold-leaf">
          {saving ? "Saving..." : "Set all ratings"}
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-oxblood-glow">{error}</p>}
      {note && !error && <p className="mt-2 text-xs text-verdigris-glow">{note}</p>}
    </div>
  );
}

// Inline editor for a house-bot account, shown on its profile ONLY to the
// designated house editor (ilovenewjeans). Renames it, swaps its picture, sets
// its bio, or sets its rating through the house-persona route. The rating field
// is the bot-side of the player rating editor, folded in here (bots are edited
// through this one menu); it persists as an override the engine resync respects.
function HouseBotEditor({
  userId,
  avatars,
  username,
  avatar,
  bio,
  rating,
  onIdentity,
  onBio,
  onRating,
}: {
  userId: string;
  avatars: string[];
  username: string;
  avatar: string | null;
  bio: string | null;
  rating: number | null;
  onIdentity: (username: string, avatar: string | null) => void;
  onBio: (bio: string | null) => void;
  onRating: (rating: number) => void;
}) {
  const [name, setName] = useState(username);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The rating field, seeded from the bot's current effective rating.
  const [ratingValue, setRatingValue] = useState(rating != null ? String(Math.round(rating)) : "");
  // Custom-upload flow: `preparing` covers the client-side decode/downscale;
  // `preview` holds the compressed square data URL awaiting confirmation, so the
  // editor can show it before committing (preview-before-save). The hidden file
  // input is driven by the "Upload image…" button (desktop click / mobile tap;
  // `accept` also lets a phone offer its camera).
  const [preparing, setPreparing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const post = async (body: Record<string, unknown>): Promise<boolean> => {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/mod/house/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...body }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setSaving(false);
      if (!res.ok) {
        setError(data?.error ?? "Could not save. Try again.");
        return false;
      }
      return true;
    } catch {
      setSaving(false);
      setError("Could not save. Try again.");
      return false;
    }
  };

  const dirty = name.trim() !== username;
  const ratingDirty = ratingValue.trim() !== (rating != null ? String(Math.round(rating)) : "");

  const saveName = async () => {
    const next = name.trim();
    if (next === username) return;
    if (await post({ username: next })) {
      setNote("Saved");
      onIdentity(next, avatar);
    }
  };

  // Set the bot's rating across every category. Persisted as a house override so
  // the engine resync never reverts it (unlike a plain user rating edit, which
  // is why this lives in the house menu rather than the standalone editor).
  const saveRating = async () => {
    if (saving) return;
    const trimmed = ratingValue.trim();
    if (trimmed === "") return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setError("Enter a number.");
      return;
    }
    const next = Math.round(parsed);
    if (await post({ rating: next })) {
      setRatingValue(String(next));
      setNote(`Rating set to ${next}.`);
      onRating(next);
    }
  };

  const pickAvatar = async (id: string) => {
    if (await post({ avatar: id })) {
      setNote("Saved");
      setPicking(false);
      onIdentity(username, id);
    }
  };

  // Read a chosen file, then downscale + center-crop it to a compact square data
  // URL on the client (256px, matching the site's round avatar shape) and hold
  // it as a preview. Nothing is persisted until the editor confirms below. The
  // server re-validates MIME / byte-size / pixel-dimensions on save
  // (validateImageDataUrl in the personas route), so these client-side checks
  // are convenience only and never trusted for authorization or acceptance.
  const onFile = async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    setNote(null);
    setPreparing(true);
    try {
      const dataUrl = await fileToDataUrl(file, { maxDim: 256, maxChars: 200_000, cover: true });
      setPreview(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that image.");
    } finally {
      setPreparing(false);
      // Clear the input so re-selecting the same file still fires onChange.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Commit the previewed upload as this bot's avatar (persisted immediately and
  // reflected everywhere the bot appears via onIdentity).
  const confirmUpload = async () => {
    if (!preview || saving) return;
    const dataUrl = preview;
    if (await post({ avatar: dataUrl })) {
      setNote("Saved");
      setPreview(null);
      setPicking(false);
      onIdentity(username, dataUrl);
    }
  };

  const saveBio = async (nextBio: string | null): Promise<string | null> => {
    const res = await fetch("/api/mod/house/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, bio: nextBio }),
    });
    if (!res.ok) throw new Error("save failed");
    const data = (await res.json()) as {
      personas?: { userId: string; effective: { bio: string | null } }[];
    };
    return data.personas?.find((p) => p.userId === userId)?.effective.bio ?? null;
  };

  return (
    <div className="mt-5 plate border border-gold/25 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-none border border-[color:var(--edge-strong)] px-2 py-0.5 text-[12px] text-gold-leaf">
          House bot
        </span>
        <span className="text-xs text-parchment-400">
          You can edit this account&rsquo;s name, picture, bio, and rating.
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="house-name" className="w-16 text-xs text-parchment-400">
          Username
        </label>
        <input
          id="house-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) saveName();
          }}
          maxLength={20}
          className="w-48 bg-transparent plate px-3 py-1.5 text-sm font-display font-semibold outline-none focus:border-[color:var(--edge-strong)]"
        />
        <Button tone="ghost"
         
          disabled={saving || !dirty}
          onClick={saveName}
          className="px-3 text-gold-leaf">
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="house-rating" className="w-16 text-xs text-parchment-400">
          Rating
        </label>
        <input
          id="house-rating"
          type="number"
          inputMode="numeric"
          min={0}
          max={4000}
          value={ratingValue}
          onChange={(e) => setRatingValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ratingDirty) void saveRating();
          }}
          className="w-28 bg-transparent plate px-3 py-1.5 text-sm font-mono tabular-nums outline-none focus:border-[color:var(--edge-strong)]"
        />
        <Button tone="ghost"
         
          disabled={saving || ratingValue.trim() === "" || !ratingDirty}
          onClick={() => void saveRating()}
          className="px-3 text-gold-leaf">
          {saving ? "Saving..." : "Set rating"}
        </Button>
        <span className="text-[12px] text-parchment-500">Both modes, engine-safe.</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="w-16 text-xs text-parchment-400">Picture</span>
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          title="Change picture"
          // The only child is the avatar, and a preset avatar is aria-hidden,
          // so without this the control announces as an unnamed button.
          aria-label={`Change ${username}'s picture`}
          className="shrink-0"
        >
          <PlayerAvatar name={username} avatar={avatar} size={40} />
        </button>
        <span className="text-xs text-parchment-400">
          {picking ? "Upload or pick one below" : "Click to change"}
        </span>
      </div>
      {picking && (
        <div className="mt-3">
          {/* Custom upload (from device/camera). Hidden input driven by the
              button so the control matches the site's styling on desktop and
              mobile alike. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          {preview ? (
            // Preview-before-save: show the cropped square exactly as it will
            // render, then confirm or discard.
            <div className="flex flex-wrap items-center gap-3">
              <PlayerAvatar name={username} avatar={preview} size={56} />
              <div className="flex flex-wrap items-center gap-2">
                <Button tone="ghost"
                 
                  disabled={saving}
                  onClick={confirmUpload}
                  className="px-3 text-gold-leaf">
                  {saving ? "Saving..." : "Use this picture"}
                </Button>
                <Button tone="ghost"
                 
                  disabled={saving}
                  onClick={() => fileRef.current?.click()}
                  className="px-3">
                  Choose another
                </Button>
                <Button tone="ghost"
                 
                  disabled={saving}
                  onClick={() => setPreview(null)}
                  className="px-3">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button tone="ghost"
               
                disabled={saving || preparing}
                onClick={() => fileRef.current?.click()}
                className="px-3 text-gold-leaf">
                {preparing ? "Preparing..." : "Upload image..."}
              </Button>
              <span className="text-[12px] text-parchment-500">
                PNG, JPEG, WebP, or GIF. Cropped to a square; max 1 MB after compression.
              </span>
            </div>
          )}
          {!preview && (
            <div className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
              {avatars.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={saving}
                  onClick={() => pickAvatar(id)}
                  title={id}
                  aria-label={`Use avatar ${id}`}
                  className={
                    "rounded-none border p-0.5 transition " +
                    (id === avatar ? "border-[color:var(--edge-strong)]" : "border-transparent hover:border-[color:var(--edge-strong)]")
                  }
                >
                  <PlayerAvatar name={username} avatar={id} size={28} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <BioSection bio={bio} editable onSaved={onBio} saveBio={saveBio} />

      {error && <p className="mt-2 text-xs text-oxblood-glow">{error}</p>}
      {note && !error && <p className="mt-2 text-xs text-verdigris-glow">{note}</p>}
    </div>
  );
}

// ---- Report modal (unchanged) -----------------------------------------------

const REPORT_REASONS = [
  ["cheating", "Cheating / outside assistance"],
  ["boosting", "Rating manipulation"],
  ["chat", "Offensive chat"],
  ["username", "Inappropriate username"],
  ["other", "Something else"],
] as const;

function ReportModal({ username, onClose }: { username: string; onClose: () => void }) {
  // Body scroll lock, Escape, and the ghost-click guard on the backdrop.
  const chrome = useModalChrome(true, onClose);
  const [reason, setReason] = useState<string>("cheating");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async () => {
    setStatus("sending");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, reason, description }),
      });
      if (res.ok) {
        setStatus("sent");
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not send the report.");
        setStatus("error");
      }
    } catch {
      // Offline or aborted: without this the button stayed on "Sending"
      // for good, with Cancel the only way out.
      setError("Could not reach the server. Check your connection and try again.");
      setStatus("error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/60 px-4 py-6"
      onPointerDown={chrome.onBackdropPointerDown}
    >
      <div
        className="plate w-full max-w-md max-h-[90dvh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {status === "sent" ? (
          <>
            <h2 className="font-display text-2xl">Report sent</h2>
            <p className="mt-2 text-sm text-parchment-200">Thanks, a moderator will take a look.</p>
            <Button tone="ghost"
             
              onClick={onClose}
              className="mt-4 px-4 text-sm">
              Close
            </Button>
          </>
        ) : (
          <>
            <h2 className="font-display text-2xl">
              Report <span className="text-gold-leaf">{username}</span>
            </h2>
            <div className="mt-4 space-y-2">
              {REPORT_REASONS.map(([value, label]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 text-sm text-parchment-100"
                >
                  <input
                    type="radio"
                    name="report-reason"
                    checked={reason === value}
                    onChange={() => setReason(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
              rows={4}
              placeholder="What happened? Include game links or examples."
              className="mt-4 w-full plate resize-none bg-transparent p-3 text-sm text-parchment-100 outline-none focus:border-[color:var(--edge-strong)]"
            />
            {status === "error" && <p className="mt-2 text-sm text-oxblood-glow">{error}</p>}
            <div className="mt-4 flex items-center gap-2">
              <Button tone="ghost"
               
                onClick={submit}
                disabled={status === "sending" || !description.trim()}
                className="px-4 text-sm text-oxblood-glow disabled:opacity-50">
                {status === "sending" ? "Sending..." : "Send report"}
              </Button>
              <Button tone="ghost"
               
                onClick={onClose}
                className="px-4 text-sm">
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
