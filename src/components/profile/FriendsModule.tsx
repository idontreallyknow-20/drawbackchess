"use client";

// The profile's Friends module, in two skins driven by `isOwner`:
//
//   Owner  - the signed-in player looking at their OWN profile. Full social
//            surface off /api/friends: incoming requests to answer, the accepted
//            list sorted by who is reachable RIGHT NOW (presence-first), a
//            per-row Challenge / Watch, a kebab with Remove friend (inline
//            confirm), a filter box past eight friends, and a collapsed
//            outgoing-requests section you can cancel from.
//   Public - anyone else's profile. Read-only off /api/users/<name>/friends:
//            just the count and the roster (mutual friends surfaced first with a
//            "Mutual" tag), Watch beside anyone currently playing. Never any
//            requests, never the owner's pending state. A private list collapses
//            to one quiet line.
//
// Live status is read from the ONE shared lobby snapshot (useLobbyFeed): every
// row derives its presence from that single poll via derivePresence, so the
// module opens no socket and starts no timer of its own no matter how long the
// roster is. Loading renders skeleton rows (never spinner text); a failed fetch
// offers Retry.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  Eye,
  MoreVertical,
  RotateCw,
  Search,
  Swords,
  Users,
  X,
} from "lucide-react";
import { PlayerAvatar } from "../PlayerAvatar";
import { PlayerLink } from "../PlayerLink";
import { PresenceBadge } from "../PresenceBadge";
import { EmptyState } from "../EmptyState";
import { derivePresence, useLobbyFeed, type Presence, type PresenceState } from "@/lib/presence";
import type { MPLobby } from "@/lib/multiplayer";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

// ---- Shared shapes ----------------------------------------------------------

// A row's public card, common to both endpoints. The owner endpoint carries a
// stable `id` (used as the React key); the public endpoint keys on username.
interface FriendCard {
  username: string;
  avatar: string | null;
  rating: number | null;
}

// /api/friends rows (owner variant): accepted friends + pending, either way.
interface OwnerFriend extends FriendCard {
  id: string;
  status: "pending" | "accepted";
  direction: "incoming" | "outgoing" | null;
  since: number;
}

interface OwnerData {
  friends: OwnerFriend[];
  incoming: OwnerFriend[];
  outgoing: OwnerFriend[];
}

// /api/users/<name>/friends (public variant): visible roster OR a private stub.
type PublicData =
  | { friends: FriendCard[]; count: number; mutual: { username: string; avatar: string | null }[] }
  | { private: true; count: number; mutual: { username: string; avatar: string | null }[] };

// Presence sort key: reachable-now first, then by rating within a tier.
const PRESENCE_RANK: Record<PresenceState, number> = {
  "in-game": 0,
  searching: 1,
  online: 2,
  offline: 3,
};

// ---- Public entry point -----------------------------------------------------

export function FriendsModule({ username, isOwner }: { username: string; isOwner: boolean }) {
  return isOwner ? <OwnerFriends /> : <PublicFriends username={username} />;
}

// ---- Owner variant ----------------------------------------------------------

function OwnerFriends() {
  const [data, setData] = useState<OwnerData | null>(null);
  // "loading" until the first fetch settles; "error" only after it fails (so a
  // transient reload never flashes the error state over a good list).
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [showOutgoing, setShowOutgoing] = useState(false);
  const lobby = useLobbyFeed();

  const load = useCallback(async (initial = false) => {
    if (initial) setPhase("loading");
    try {
      const res = await fetch("/api/friends");
      // Signed out or otherwise unreadable: an owner should always be signed in
      // to reach their own profile, so treat this as an error with a retry.
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as OwnerData;
      setData(body);
      setPhase("ready");
    } catch {
      // Keep any prior snapshot; only surface the error screen on a cold load.
      setPhase((p) => (p === "loading" ? "error" : "ready"));
    }
  }, []);

  useEffect(() => {
    // `load` only mutates state after awaiting the fetch (never synchronously),
    // the sanctioned fetch-on-mount pattern; the lint rule can't see past the
    // useCallback's await boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
  }, [load]);

  // A friends mutation (accept / decline / cancel / remove). Reloads on settle.
  const act = useCallback(
    async (action: string, name: string) => {
      setBusy(true);
      try {
        await fetch("/api/friends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, username: name }),
        });
        await load();
      } catch {
        /* leave the current list; the row's control re-enables below */
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  // Memoized against the payload so the derived arrays keep a stable identity
  // between renders (a bare `data?.friends ?? []` would be a fresh array every
  // render and defeat the sort memo below).
  const friends = useMemo(() => data?.friends ?? [], [data]);
  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];

  // Sort accepted friends by live presence, then rating, using the single shared
  // snapshot. Memoized against the snapshot + list so a re-render without new
  // data does no work.
  const sorted = useMemo(() => sortByPresence(friends, lobby), [friends, lobby]);
  const [expanded, setExpanded] = useState(false);

  // The filter box only earns its place once the list is long; below that a
  // roster reads faster without it.
  const showFilter = friends.length > 8;
  const q = filter.trim().toLowerCase();
  const matched = q ? sorted.filter((f) => f.username.toLowerCase().includes(q)) : sorted;
  // Big rosters (house-friend cohorts run to 150) render a bounded page with an
  // expander instead of a 150-row rail; searching always scans the full list.
  const visible = expanded || q ? matched : matched.slice(0, 30);
  const hiddenCount = matched.length - visible.length;

  const title = `Friends (${friends.length})`;

  if (phase === "loading") return <Shell title="Friends"><SkeletonRows /></Shell>;
  if (phase === "error") {
    return (
      <Shell title="Friends">
        <ErrorRow onRetry={() => void load(true)} />
      </Shell>
    );
  }

  // Cold empty: no friends AND nothing pending in either direction.
  if (friends.length === 0 && incoming.length === 0 && outgoing.length === 0) {
    return (
      <Shell title="Friends (0)">
        <EmptyState
          icon={Users}
          title="No friends yet"
          body="Add players to line up challenges and quick rematches without hunting for them each time."
          action={{ href: "/lobby", label: "Find players" }}
        />
      </Shell>
    );
  }

  return (
    <Shell title={title}>
      <div className="space-y-5">
        {/* Incoming requests answer first: they are the only time-sensitive item. */}
        {incoming.length > 0 && (
          <div className="space-y-2">
            <div className="text-[12px] text-gold-leaf">
              Requests ({incoming.length})
            </div>
            {incoming.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded border border-[color:var(--edge-strong)] bg-gold/[0.06] p-2.5"
              >
                <Identity f={f} lobby={lobby} />
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <Button tone="leaf"
                   
                    onClick={() => void act("accept", f.username)}
                    disabled={busy}
                    className="px-3 text-[13px] font-semibold">
                    <Check size={15} strokeWidth={2.4} aria-hidden />
                    Accept
                  </Button>
                  <Button tone="ghost"
                   
                    onClick={() => void act("decline", f.username)}
                    disabled={busy}
                    className="px-3 text-[13px]">
                    <X size={15} strokeWidth={2.4} aria-hidden />
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Filter, only once the list is long enough to warrant it. */}
        {showFilter && (
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-parchment-500"
              aria-hidden
            />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter friends"
              aria-label="Filter friends by name"
              className="min-h-[44px] w-full rounded border border-[color:var(--edge)] bg-[color:var(--bg-base)] pl-9 pr-3 text-sm text-parchment placeholder:text-parchment-500 focus:border-[color:var(--edge-strong)] focus:outline-none"
            />
          </div>
        )}

        {/* Accepted roster, presence-sorted. */}
        <div className="space-y-2">
          {friends.length === 0 ? (
            <p className="text-sm text-parchment-400">
              No friends yet. Answer a request above or add players to challenge them any time.
            </p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-parchment-400">No friends match &ldquo;{filter.trim()}&rdquo;.</p>
          ) : (
            visible.map((f) => (
              <FriendRow key={f.id} f={f} lobby={lobby} busy={busy} onRemove={() => void act("remove", f.username)} />
            ))
          )}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-1 w-full min-h-[36px] border px-3 py-1.5 text-[13px] font-medium text-parchment-300 transition-colors hover:text-parchment-100"
              style={{ borderColor: "var(--edge)" }}
            >
              Show all {matched.length}
            </button>
          )}
        </div>

        {/* Outgoing requests: collapsed by default, cancel from within. */}
        {outgoing.length > 0 && (
          <div className="border-t border-[color:var(--edge)] pt-3">
            <button
              type="button"
              onClick={() => setShowOutgoing((v) => !v)}
              aria-expanded={showOutgoing}
              className="flex min-h-[44px] w-full items-center gap-2 text-left text-[12px] text-parchment-500 transition hover:text-parchment-300"
            >
              <ChevronDown
                size={14}
                className={"transition-transform motion-reduce:transition-none " + (showOutgoing ? "rotate-180" : "")}
                aria-hidden
              />
              Sent requests ({outgoing.length})
            </button>
            {showOutgoing && (
              <div className="mt-2 space-y-1.5">
                {outgoing.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 text-sm text-parchment-400">
                    <PlayerAvatar name={f.username} avatar={f.avatar} size={22} />
                    <PlayerLink name={f.username} className="min-w-0 flex-1 text-parchment-300" />
                    <span className="shrink-0 text-[12px] text-parchment-400">Requested</span>
                    <button
                      type="button"
                      onClick={() => void act("decline", f.username)}
                      disabled={busy}
                      className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded text-parchment-500 transition hover:text-oxblood-glow disabled:opacity-40"
                      title={`Cancel request to ${f.username}`}
                      aria-label={`Cancel request to ${f.username}`}
                    >
                      <X size={16} strokeWidth={2.2} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

// One accepted-friend row (owner variant): identity + presence-conditional
// Watch / Challenge + a kebab holding Remove friend behind an inline confirm.
function FriendRow({
  f,
  lobby,
  busy,
  onRemove,
}: {
  f: OwnerFriend;
  lobby: MPLobby | null;
  busy: boolean;
  onRemove: () => void;
}) {
  const presence = derivePresence(lobby, f.username);
  return (
    <div className="flex items-center gap-3 rounded border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] p-2.5">
      <Identity f={f} lobby={lobby} presence={presence} />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {presence.state === "in-game" && presence.gameId && (
          <LinkButton tone="ghost"
            href={`/game/${encodeURIComponent(presence.gameId)}`}
            className="px-3 text-[13px]">
            <Eye size={14} strokeWidth={2.2} aria-hidden />
            Watch
          </LinkButton>
        )}
        {presence.state === "online" && (
          <LinkButton tone="leaf"
            href={`/friend?challenge=${encodeURIComponent(f.username)}`}
            className="px-3 text-[13px] font-semibold">
            <Swords size={14} strokeWidth={2.3} aria-hidden />
            Challenge
          </LinkButton>
        )}
        <RowMenu username={f.username} busy={busy} onRemove={onRemove} />
      </div>
    </div>
  );
}

// The per-row kebab: a keyboard-accessible menu (Escape closes, click-outside
// closes, focus returns to the trigger) whose only item, Remove friend, swaps to
// an inline "Remove?" confirm rather than firing on the first click.
function RowMenu({ username, busy, onRemove }: { username: string; busy: boolean; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

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

  // Reset the confirm affordance whenever the menu closes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open) setConfirming(false);
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
        className="grid h-[44px] w-[44px] place-items-center rounded border border-[color:var(--edge)] text-parchment-400 transition hover:border-[color:var(--edge-strong)] hover:text-parchment-200"
      >
        <MoreVertical size={16} strokeWidth={2.2} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${username}`}
          className="absolute right-0 top-full z-40 mt-1.5 w-44 plate dropdown p-1 shadow-2xl"
        >
          {confirming ? (
            <div className="p-2">
              <p className="mb-2 text-[12px] leading-snug text-parchment-300">
                Remove {username} from your friends?
              </p>
              <div className="flex items-center gap-1.5">
                <Button tone="leaf"
                 
                  role="menuitem"
                  onClick={() => {
                    onRemove();
                    setOpen(false);
                  }}
                  disabled={busy}
                  className="flex-1 px-2 text-[13px] font-semibold">
                  Remove
                </Button>
                <Button tone="ghost"
                 
                  onClick={() => setConfirming(false)}
                  className="flex-1 px-2 text-[13px]">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setConfirming(true)}
              className="flex min-h-[44px] w-full items-center gap-2 rounded px-3 text-left font-display text-[13px] text-parchment-200 transition hover:bg-oxblood/15 hover:text-oxblood-glow"
            >
              <X size={15} strokeWidth={2.2} aria-hidden />
              Remove friend
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Public variant ---------------------------------------------------------

function PublicFriends({ username }: { username: string }) {
  const [data, setData] = useState<PublicData | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const lobby = useLobbyFeed();

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}/friends`);
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as PublicData);
      setPhase("ready");
    } catch {
      setPhase((p) => (p === "loading" ? "error" : "ready"));
    }
  }, [username]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Mutual friends surface first, tagged; within each group we keep the
  // endpoint's rating-desc order (a stable sort by the group key preserves it).
  const rows = useMemo(() => {
    if (!data || "private" in data) return [];
    const mutualNames = new Set(data.mutual.map((m) => m.username.toLowerCase()));
    const tagged = data.friends.map((f) => ({ ...f, mutual: mutualNames.has(f.username.toLowerCase()) }));
    return tagged
      .map((f, i) => ({ f, i }))
      .sort((a, b) => (a.f.mutual === b.f.mutual ? a.i - b.i : a.f.mutual ? -1 : 1))
      .map((x) => x.f);
  }, [data]);

  if (phase === "loading") return <Shell title="Friends"><SkeletonRows /></Shell>;
  if (phase === "error") {
    return (
      <Shell title="Friends">
        <ErrorRow onRetry={() => void load()} />
      </Shell>
    );
  }
  if (!data) return null;

  const title = `Friends (${data.count})`;

  // Private list: one quiet line, nothing else (mutuals are the viewer's own
  // friends, but keeping this variant to a single sentence matches the spec).
  if ("private" in data) {
    return (
      <Shell title={title}>
        <p className="text-sm text-parchment-400">Friends list is private.</p>
      </Shell>
    );
  }

  if (data.count === 0) {
    return (
      <Shell title="Friends (0)">
        <p className="text-sm text-parchment-400">No friends yet.</p>
      </Shell>
    );
  }

  return (
    <Shell title={title}>
      <div className="space-y-2">
        {rows.map((f) => {
          const presence = derivePresence(lobby, f.username);
          return (
            <div
              key={f.username}
              className="flex items-center gap-3 rounded border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] p-2.5"
            >
              <Identity f={f} lobby={lobby} presence={presence} tag={f.mutual ? "Mutual" : undefined} />
              {presence.state === "in-game" && presence.gameId && (
                <LinkButton tone="ghost"
                  href={`/game/${encodeURIComponent(presence.gameId)}`}
                  className="ml-auto shrink-0 px-3 text-[13px]">
                  <Eye size={14} strokeWidth={2.2} aria-hidden />
                  Watch
                </LinkButton>
              )}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

// ---- Shared row pieces -------------------------------------------------------

// Avatar + clickable name + rating + presence badge, truncating on narrow rows.
// `presence` is passed in when the caller already derived it (avoids a second
// derivation per row); otherwise it derives from the shared snapshot here.
function Identity({
  f,
  lobby,
  presence,
  tag,
}: {
  f: FriendCard;
  lobby: MPLobby | null;
  presence?: Presence;
  tag?: string;
}) {
  const p = presence ?? derivePresence(lobby, f.username);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <PlayerAvatar name={f.username} avatar={f.avatar} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <PlayerLink name={f.username} className="min-w-0 font-display text-[15px] text-parchment hover:text-gold-leaf" />
          {f.rating != null && (
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-parchment-400">{f.rating}</span>
          )}
          {tag && (
            <span className="shrink-0 rounded-none border border-verdigris-glow/40 bg-verdigris/10 px-1.5 py-px text-[12px] text-verdigris-glow">
              {tag}
            </span>
          )}
        </div>
        <PresenceBadge state={p.state} mode={p.game?.mode ?? null} className="mt-0.5" />
      </div>
    </div>
  );
}

// ---- Chrome (heading plate, skeletons, error) -------------------------------

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="plate p-5 sm:p-6">
      <h2 className="mb-4 font-display text-lg text-parchment">{title}</h2>
      {children}
    </div>
  );
}

// Skeleton rows (never spinner text): pulsing placeholders shaped like the real
// list so the layout never jumps when data lands. Static under reduced motion.
function SkeletonRows() {
  return (
    <div className="space-y-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] p-2.5">
          <div className="h-[34px] w-[34px] shrink-0 animate-pulse rounded-none bg-[color:var(--bg-raised)] motion-reduce:animate-none" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-1/3 animate-pulse rounded bg-[color:var(--bg-raised)] motion-reduce:animate-none" />
            <div className="h-2.5 w-1/4 animate-pulse rounded bg-white/[0.07] motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorRow({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <p className="text-sm text-parchment-300">Could not load friends.</p>
      <Button tone="ghost"
       
        onClick={onRetry}
        className="px-4 text-sm font-semibold">
        <RotateCw size={15} strokeWidth={2.2} aria-hidden />
        Retry
      </Button>
    </div>
  );
}

// ---- helpers ----------------------------------------------------------------

// Stable presence-then-rating sort: reachable-now friends float up (in-game >
// searching > online > offline), ties broken by rating desc, then name for a
// deterministic order. Reads presence from the passed-in shared snapshot.
function sortByPresence(friends: OwnerFriend[], lobby: MPLobby | null): OwnerFriend[] {
  return [...friends].sort((a, b) => {
    const ra = PRESENCE_RANK[derivePresence(lobby, a.username).state];
    const rb = PRESENCE_RANK[derivePresence(lobby, b.username).state];
    if (ra !== rb) return ra - rb;
    const rateA = a.rating ?? -1;
    const rateB = b.rating ?? -1;
    if (rateA !== rateB) return rateB - rateA;
    return a.username.localeCompare(b.username);
  });
}
