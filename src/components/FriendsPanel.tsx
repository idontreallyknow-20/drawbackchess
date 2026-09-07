"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Eye, MoreHorizontal, Swords, UserPlus, X } from "lucide-react";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerLink } from "./PlayerLink";
import { PresenceBadge } from "./PresenceBadge";
import { derivePresence, useLobbyFeed, type Presence, type PresenceState } from "@/lib/presence";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

// Friends list + add-a-friend + incoming/outgoing requests, with a one-tap
// Challenge that deep-links into the friend-game flow (/friend?challenge=name),
// which notifies the target and starts the game when they accept. Self-
// contained: fetches /api/friends and posts actions there. Live presence is
// read from the one shared lobby snapshot, so every row shows whether a friend
// is online / searching / in a game (with a Watch link) without opening a
// socket of its own. Dungeon-materials pass: riveted plate, rune divider
// between the add form and the list, carved input, online-count rune badge,
// and presence-sorted rows (reachable friends surface first).

interface Friend {
  id: string;
  username: string;
  rating: number | null;
  avatar: string | null;
  status: "pending" | "accepted";
  direction: "incoming" | "outgoing" | null;
  since: number;
}

interface FriendsData {
  friends: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
}

// Presence sort order: friends you can act on (watch, challenge while they're
// at the board) rise to the top; offline sinks. Ties break alphabetically so
// the list is stable between polls.
const PRESENCE_RANK: Record<PresenceState, number> = {
  "in-game": 0,
  searching: 1,
  online: 2,
  offline: 3,
};

// The name filter only appears once the list is long enough to need it.
const FILTER_THRESHOLD = 6;

// How many rows each list shows before it folds behind a "Show all N" toggle
// (same pattern as profile/FriendsModule). Filtering always scans the whole
// roster; only the unfiltered view is paged.
const PAGE_SIZE = 12;

// Below this panel width (px) the row's Remove button folds into an overflow
// menu so the name column keeps room; above it the X stays inline.
const NARROW_PX = 320;

const OFFLINE: Presence = { state: "offline" };

// Applies the page window to a list and reports what a toggle should say.
function page<T>(items: T[], expanded: boolean): { shown: T[]; hidden: number } {
  const shown = expanded ? items : items.slice(0, PAGE_SIZE);
  return { shown, hidden: items.length - shown.length };
}

// `bounded` caps the roster's height and scrolls inside it, for rails (the
// profile page) where a 150-friend list would otherwise push the page down.
// The lobby's Friends tab lays the panel out unbounded.
export function FriendsPanel({ bounded = false }: { bounded?: boolean } = {}) {
  const [data, setData] = useState<FriendsData | null>(null);
  // undefined = still checking, false = signed out, true = signed in.
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  // Distinguishes "initial load in flight" (show a skeleton) from "initial load
  // failed" (show a retry), so a 5xx / offline first fetch never hangs on a
  // blank panel or an endless skeleton.
  const [loadFailed, setLoadFailed] = useState(false);
  const [addName, setAddName] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedIncoming, setExpandedIncoming] = useState(false);
  const [expandedOutgoing, setExpandedOutgoing] = useState(false);
  const lobby = useLobbyFeed();

  // Panel width, for folding the row's Remove button into an overflow menu on
  // a narrow rail. The root element differs between the loading, signed-out
  // and loaded branches, so a callback ref (state) re-arms the observer when
  // the loaded panel mounts rather than a plain ref that only reads once.
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    if (!panelEl) return;
    const measure = () => setNarrow(panelEl.clientWidth < NARROW_PX);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(panelEl);
    return () => ro.disconnect();
  }, [panelEl]);

  // Live presence for every name in the panel, derived once per lobby snapshot
  // rather than inside the sort comparator and again per row (which cost
  // O(n log n + n) lobby scans for a large roster on every poll).
  const presenceOf = useMemo(() => {
    const map = new Map<string, Presence>();
    if (!data) return map;
    for (const f of [...data.friends, ...data.incoming, ...data.outgoing]) {
      map.set(f.username, derivePresence(lobby, f.username));
    }
    return map;
  }, [data, lobby]);
  const presenceFor = (f: Friend): Presence => presenceOf.get(f.username) ?? OFFLINE;

  // Resolves true when the roster loaded (or the user is signed out), false
  // when the request failed; callers refreshing after an action use that to
  // surface a note, since loadFailed only renders before hydration.
  const load = useCallback(async (): Promise<boolean> => {
    setLoadFailed(false);
    try {
      // Every outcome below ends in exactly one of signed-out / failed /
      // loaded. The timeout maps a hung request (proxy blackhole, stalled
      // connection) to the failure state instead of an endless skeleton.
      const res = await fetch("/api/friends", { signal: AbortSignal.timeout(10_000) });
      if (res.status === 401) {
        setSignedIn(false);
        return true;
      }
      if (!res.ok) {
        // Non-401 error (e.g. 5xx) on the initial load: surface a retry
        // instead of leaving signedIn undefined (an endless skeleton).
        setLoadFailed(true);
        return false;
      }
      // Parse before flipping signedIn, so a truncated/invalid body lands in
      // the failure state rather than "signed in with no data".
      const body = (await res.json()) as FriendsData;
      setSignedIn(true);
      setData(body);
      return true;
    } catch {
      // Offline / timeout / bad body: keep any last snapshot, but if we have
      // none yet, show a retry.
      setLoadFailed(true);
      return false;
    }
  }, []);

  useEffect(() => {
    // `load` only sets state after awaiting the fetch (never synchronously),
    // so this is the sanctioned fetch-on-mount pattern; the rule can't see
    // through the useCallback's await boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const act = async (action: string, username: string) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, username }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; status?: string } | null;
      if (!res.ok) {
        setNote({ kind: "err", text: body?.error ?? "Something went wrong." });
      } else if (action === "request") {
        setAddName("");
        setNote({
          kind: "ok",
          text: body?.status === "accepted" ? `You are now friends with ${username}.` : `Request sent to ${username}.`,
        });
      }
      const refreshed = await load();
      // The action itself went through; only the follow-up refresh failed, so
      // say so without clobbering an action error.
      if (!refreshed && res.ok) {
        setNote({ kind: "err", text: "Saved, but the list could not be refreshed. Reload to see it." });
      }
    } catch {
      setNote({ kind: "err", text: "Network error. Try again." });
    } finally {
      setBusy(false);
    }
  };

  if (signedIn === undefined) {
    // Initial load. A network/5xx failure gets a retry; otherwise a themed
    // skeleton that mirrors the roster rows (no blank panel, no spinner text).
    return (
      <div className="plate p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-parchment">Friends</h2>
        </div>
        {loadFailed ? (
          <div className="mt-4 text-sm text-parchment-300">
            <p>Could not load your friends.</p>
            <Button tone="ghost"
             
              onClick={() => void load()}
              className="mt-2 px-3 text-sm">
              Try again
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[color:var(--bg-raised)] motion-reduce:animate-none" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3.5 w-1/3 animate-pulse rounded bg-[color:var(--bg-raised)] motion-reduce:animate-none" />
                  <div className="h-2.5 w-1/4 animate-pulse rounded bg-white/[0.07] motion-reduce:animate-none" />
                </div>
                <div className="ml-auto h-8 w-16 shrink-0 animate-pulse rounded-none bg-[color:var(--bg-raised)] motion-reduce:animate-none" />
              </div>
            ))}
            <span className="sr-only">Loading friends</span>
          </div>
        )}
      </div>
    );
  }
  if (!signedIn) {
    return (
      <div className="plate p-4">
        <h2 className="font-display text-lg text-parchment">Friends</h2>
        <p className="mt-1 text-sm text-parchment-300">
          <Link href="/login" className="text-gold-leaf hover:underline">
            Sign in
          </Link>{" "}
          to add friends and challenge them in one tap.
        </p>
      </div>
    );
  }

  const friends = data?.friends ?? [];
  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];
  const empty = friends.length === 0 && incoming.length === 0 && outgoing.length === 0;

  // Reachable friends first (in-game > searching > online > offline), then
  // alphabetical so the order is stable between presence polls.
  const sorted = [...friends].sort((a, b) => {
    const ra = PRESENCE_RANK[presenceFor(a).state];
    const rb = PRESENCE_RANK[presenceFor(b).state];
    return ra !== rb ? ra - rb : a.username.localeCompare(b.username);
  });
  const onlineCount = friends.filter((f) => presenceFor(f).state !== "offline").length;

  // Client-side name filter, only offered once the list outgrows a glance.
  // Below the threshold the input is hidden and any stale query is ignored.
  const showFilter = friends.length > FILTER_THRESHOLD;
  const query = showFilter ? filter.trim().toLowerCase() : "";
  const matched = query ? sorted.filter((f) => f.username.toLowerCase().includes(query)) : sorted;
  // A search always shows every match; only the unfiltered roster is paged.
  const { shown: visible, hidden: hiddenFriends } = page(matched, expanded || query.length > 0);
  const { shown: visibleIncoming, hidden: hiddenIncoming } = page(incoming, expandedIncoming);
  const { shown: visibleOutgoing, hidden: hiddenOutgoing } = page(outgoing, expandedOutgoing);

  return (
    <div ref={setPanelEl} className="plate p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg text-parchment">Friends</h2>
        {friends.length > 0 && (
          <span
            className="rune-badge tabular-nums"
            style={
              {
                "--badge-rgb": onlineCount > 0 ? "var(--energy-teal-rgb)" : "var(--energy-ember-rgb)",
              } as React.CSSProperties
            }
          >
            {onlineCount} of {friends.length} online
          </span>
        )}
      </div>

      {/* Incoming requests answer first: a raised accent-edged strip above
          everything else, because they are the most actionable thing here. */}
      {incoming.length > 0 && (
        <div className="mt-4 space-y-2 rounded-none border border-[color:var(--edge-strong)] bg-gold/[0.07] p-2.5">
          <div className="text-gold-leaf">Requests ({incoming.length})</div>
          {visibleIncoming.map((f) => (
            <div key={f.id} className="flex items-center gap-3">
              <Identity f={f} presence={presenceFor(f)} />
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => void act("accept", f.username)}
                  disabled={busy}
                  aria-label={`Accept ${f.username}`}
                  className="grid h-[44px] w-[44px] place-items-center rounded-none border border-verdigris-glow/50 bg-verdigris/20 text-verdigris-glow transition hover:bg-verdigris/30 disabled:opacity-40"
                >
                  <Check size={16} strokeWidth={2.4} aria-hidden />
                </button>
                <button
                  onClick={() => void act("decline", f.username)}
                  disabled={busy}
                  aria-label={`Decline ${f.username}`}
                  className="grid h-[44px] w-[44px] place-items-center rounded-none border border-[color:var(--edge)] text-parchment-400 transition hover:border-oxblood-glow/50 hover:text-oxblood-glow disabled:opacity-40"
                >
                  <X size={16} strokeWidth={2.4} aria-hidden />
                </button>
              </div>
            </div>
          ))}
          <ShowAllToggle
            total={incoming.length}
            hidden={hiddenIncoming}
            expanded={expandedIncoming}
            onToggle={() => setExpandedIncoming((v) => !v)}
          />
        </div>
      )}

      {/* Add a friend by username. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const name = addName.trim();
          if (name && !busy) void act("request", name);
        }}
        className="mt-4 flex items-center gap-2"
      >
        <input
          value={addName}
          onChange={(e) => setAddName(e.target.value)}
          placeholder="Add a friend by username"
          aria-label="Friend's username"
          maxLength={24}
          className="input-rune min-h-[44px] min-w-0 flex-1 px-3 text-[16px] sm:text-sm"
        />
        <Button tone="leaf"
          type="submit"
          disabled={busy || !addName.trim()}
          className="shrink-0 px-4 text-sm font-semibold">
          <UserPlus size={15} strokeWidth={2.2} aria-hidden />
          Add
        </Button>
      </form>
      {note && (
        <p className={"mt-2 text-[12px] " + (note.kind === "ok" ? "text-verdigris-glow" : "text-oxblood-glow")}>
          {note.text}
        </p>
      )}

      <div className="my-4" aria-hidden />

      {/* Accepted friends, presence-sorted, each with a one-tap action. */}
      {empty ? (
        <div className="empty-vault">
          <p className="text-[13px]">Add friends by username to challenge them in one tap.</p>
          <LinkButton tone="ghost"
            href="/lobby"
            className="px-4 text-[13px] sm:min-h-9">
            Find players
          </LinkButton>
        </div>
      ) : (
        friends.length > 0 && (
          <div className={"space-y-2" + (bounded ? " max-h-[60vh] overflow-y-auto" : "")}>
            {showFilter && (
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name"
                aria-label="Filter friends by name"
                className="input-rune min-h-[44px] w-full px-3 text-[16px] sm:min-h-9 sm:text-sm"
              />
            )}
            {visible.length === 0 ? (
              <p className="py-2 text-[13px] text-parchment-400">No friends match “{filter.trim()}”.</p>
            ) : (
              visible.map((f) => (
                <FriendRow
                  key={f.id}
                  f={f}
                  presence={presenceFor(f)}
                  narrow={narrow}
                  busy={busy}
                  onRemove={() => void act("remove", f.username)}
                />
              ))
            )}
            <ShowAllToggle
              total={matched.length}
              hidden={hiddenFriends}
              expanded={expanded}
              onToggle={() => setExpanded((v) => !v)}
            />
          </div>
        )
      )}

      {/* Outgoing pending, quietly at the foot. */}
      {outgoing.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t pt-3" style={{ borderColor: "var(--edge)" }}>
          <div>Pending</div>
          {visibleOutgoing.map((f) => (
            <div key={f.id} className="flex items-center gap-3 text-sm text-parchment-400">
              <PlayerAvatar name={f.username} avatar={f.avatar} size={24} />
              <PlayerLink name={f.username} className="min-w-0 flex-1 hover:text-parchment-100" />
              <span className="shrink-0 text-[12px] text-parchment-500">Requested</span>
              <button
                onClick={() => void act("decline", f.username)}
                disabled={busy}
                aria-label={`Cancel request to ${f.username}`}
                className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-none text-parchment-500 transition hover:text-oxblood-glow disabled:opacity-40"
              >
                <X size={16} strokeWidth={2.2} aria-hidden />
              </button>
            </div>
          ))}
          <ShowAllToggle
            total={outgoing.length}
            hidden={hiddenOutgoing}
            expanded={expandedOutgoing}
            onToggle={() => setExpandedOutgoing((v) => !v)}
          />
        </div>
      )}
    </div>
  );
}

// "Show all N" under a paged list, flipping to "Show fewer" once open. Renders
// nothing while the list fits in one page, so short rosters never see it.
function ShowAllToggle({
  total,
  hidden,
  expanded,
  onToggle,
}: {
  total: number;
  hidden: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (hidden === 0 && !expanded) return null;
  if (total <= PAGE_SIZE) return null;
  return (
    <Button tone="ghost" onClick={onToggle} aria-expanded={expanded} className="mt-1 w-full px-3 text-[13px]">
      {expanded ? "Show fewer" : `Show all ${total}`}
    </Button>
  );
}

// One accepted-friend row: identity + presence, a Watch link when they are in
// a game, a Challenge when they are reachable, and a quiet Remove that only
// turns cursed-red on hover. Row hover warms the surface and lights an ember
// hairline — pointer devices only, so touch never gets a sticky hover.
function FriendRow({
  f,
  presence,
  narrow,
  busy,
  onRemove,
}: {
  f: Friend;
  presence: Presence;
  // Panel narrower than NARROW_PX: Remove folds into an overflow menu.
  narrow: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  // Labels compress to icon-only below sm so actions never wrap; the
  // aria-labels keep them readable. A narrow panel (a 280px profile rail on a
  // wide screen is still narrow) is icon-only regardless of viewport, tightens
  // the gaps and avatar, and moves Remove into the overflow menu, so the
  // 6rem name column always fits: 28 + 8 + 96 + 8 + 44 + 4 + 44 = 232px.
  const label = narrow ? "hidden" : "hidden sm:inline";
  return (
    <div
      className={
        "flex items-center rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] p-2 transition-[background-color,border-color] duration-200 [@media(hover:hover)]:hover:border-[color:rgb(var(--energy-ember-rgb)/0.45)] [@media(hover:hover)]:hover:bg-[color:var(--surface-hover)] " +
        (narrow ? "gap-2" : "gap-3")
      }
    >
      <Identity f={f} presence={presence} compact={narrow} />
      <div className={"ml-auto flex shrink-0 items-center " + (narrow ? "gap-1" : "gap-1.5")}>
        {presence.state === "in-game" && presence.gameId && (
          <LinkButton tone="ghost"
            href={`/game/${encodeURIComponent(presence.gameId)}`}
            aria-label={`Watch ${f.username}'s game`}
            className="min-w-[44px] px-3 text-[13px]">
            <Eye size={14} strokeWidth={2.2} aria-hidden />
            <span className={label}>Watch</span>
          </LinkButton>
        )}
        {presence.state !== "in-game" && (
          <LinkButton tone="leaf"
            href={`/friend?challenge=${encodeURIComponent(f.username)}`}
            aria-label={`Challenge ${f.username}`}
            className="min-w-[44px] px-3 text-[13px] font-semibold">
            <Swords size={14} strokeWidth={2.3} aria-hidden />
            <span className={label}>Challenge</span>
          </LinkButton>
        )}
        {narrow ? (
          <RowMenu username={f.username} busy={busy} onRemove={onRemove} />
        ) : (
          <button
            onClick={onRemove}
            disabled={busy}
            aria-label={`Remove ${f.username}`}
            className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-none text-parchment-500 transition hover:text-oxblood-glow disabled:opacity-40"
          >
            <X size={16} strokeWidth={2.2} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

// Overflow ("...") menu holding the row actions that do not fit inline on a
// narrow panel. Closes on outside pointerdown or Escape (focus returns to the
// trigger), same as the profile page's actions menu.
function RowMenu({ username, busy, onRemove }: { username: string; busy: boolean; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  // Opens upward when the trigger sits near the bottom of its scroll box (the
  // bounded rail clips overflow) or the viewport, so the last rows' menus are
  // reachable instead of cut off.
  const [flip, setFlip] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    let limit = window.innerHeight;
    for (let el = triggerRef.current.parentElement; el; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") {
        limit = Math.min(limit, el.getBoundingClientRect().bottom);
        break;
      }
    }
    setFlip(limit - rect.bottom < 64);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${username}`}
        className="grid h-[44px] w-[44px] place-items-center rounded-none text-parchment-500 transition hover:text-parchment-200 disabled:opacity-40"
      >
        <MoreHorizontal size={16} strokeWidth={2.2} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${username}`}
          className={"absolute right-0 z-40 w-44 plate dropdown p-1 shadow-2xl " + (flip ? "bottom-full mb-1" : "top-full mt-1")}
        >
          <Button
            tone="danger"
            size="sm"
            block
            align="start"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            <X size={15} strokeWidth={2.2} aria-hidden />
            Remove friend
          </Button>
        </div>
      )}
    </div>
  );
}

// Avatar + clickable name + rating + presence badge. The name column keeps a
// 6rem floor so the action cluster can never crush it to an ellipsis.
function Identity({ f, presence, compact = false }: { f: Friend; presence: Presence; compact?: boolean }) {
  const p = presence;
  return (
    <div className={"flex min-w-0 flex-1 items-center " + (compact ? "gap-2" : "gap-3")}>
      <PlayerAvatar name={f.username} avatar={f.avatar} size={compact ? 28 : 34} />
      <div className="min-w-[6rem] flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <PlayerLink
            name={f.username}
            className="min-w-0 truncate font-display text-[15px] text-parchment hover:text-gold-leaf"
          />
          {f.rating != null && (
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-parchment-400">{f.rating}</span>
          )}
        </div>
        <PresenceBadge state={p.state} mode={p.game?.mode ?? null} className="mt-0.5" />
      </div>
    </div>
  );
}
