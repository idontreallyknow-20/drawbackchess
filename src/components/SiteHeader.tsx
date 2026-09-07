"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, History, LogIn, LogOut, Mail, Search, Settings, Shield, Swords, Trophy, User, UserPlus } from "lucide-react";
import "./SiteHeader.css";
import { Logo } from "@/components/Logo";
import { HeaderSettingsMenu, ZenExitButton } from "@/components/HeaderSettingsMenu";
import { MobileNavMenu } from "@/components/MobileNavMenu";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink, isLinkablePlayerName } from "@/components/PlayerLink";
import { PlayerSearch } from "@/components/PlayerSearch";
import { SettingsPanel } from "@/components/SettingsPanel";
import { AccountUser, ensureAccount, logout } from "@/lib/authClient";
import { playChallenge } from "@/lib/sounds";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

// Site-wide header, Lichess-style: main nav on the left; on the right a user
// search, incoming challenges, notifications, and the account menu.

type HeaderNotification = {
  id: string;
  type: string;
  actorName: string | null;
  text: string;
  href: string | null;
  at: number;
  read: boolean;
};

type HeaderChallenge = {
  id: string;
  from: string;
  timeSec: number;
  incrementSec: number;
  rated?: boolean;
  at: number;
};

type Menu = "search" | "challenges" | "bell" | "profile" | null;

type NavMenuItem = { href: string; label: string; className?: string };
type NavLink = { href: string; label: string; menu?: NavMenuItem[] };

const PLAY_MENU_LINKS: NavMenuItem[] = [
  { href: "/lobby", label: "Lobby" },
  { href: "/lobby?tab=friends", label: "Challenge a friend" },
  { href: "/play", label: "Practice vs computer" },
  { href: "/tournaments", label: "Tournaments" },
];

// Watch splits by mode: each TV entry wears its mode color and opens the TV
// page filtered to that pool's live games.
const WATCH_MENU_LINKS: NavMenuItem[] = [
  { href: "/tv?mode=nerf", label: "Nerf TV", className: "text-mode-nerfGlow" },
  { href: "/tv?mode=buff", label: "Buff TV", className: "text-mode-buffGlow" },
];

// Clubs and Tournaments live under Community: three social destinations
// grouped behind one label keeps the top bar readable at larger type.
const COMMUNITY_MENU_LINKS: NavMenuItem[] = [
  { href: "/community", label: "Community hub" },
  { href: "/clubs", label: "Clubs" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/guidelines", label: "Guidelines" },
];

const NAV_LINKS: NavLink[] = [
  { href: "/lobby", label: "Play", menu: PLAY_MENU_LINKS },
  { href: "/tv", label: "Watch", menu: WATCH_MENU_LINKS },
  { href: "/community", label: "Community", menu: COMMUNITY_MENU_LINKS },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/codex", label: "Rules" },
];

// Map any pathname to the top-level nav section it belongs to, so highlighting
// survives on subpaths (e.g. /tv/live, /clubs/x, /tournaments/y). Returns the
// section's nav href, or null when the page has no section in the top bar.
function sectionForPath(pathname: string | null): string | null {
  if (!pathname) return null;
  if (pathname === "/tv" || pathname.startsWith("/tv/") || pathname.startsWith("/tv?")) return "/tv";
  if (
    pathname === "/community" ||
    pathname.startsWith("/community/") ||
    pathname === "/clubs" ||
    pathname.startsWith("/clubs/") ||
    pathname === "/tournaments" ||
    pathname.startsWith("/tournaments/") ||
    pathname === "/guidelines" ||
    pathname.startsWith("/guidelines/")
  )
    return "/community";
  if (pathname === "/codex" || pathname.startsWith("/codex/")) return "/codex";
  if (
    pathname === "/lobby" ||
    pathname.startsWith("/lobby/") ||
    pathname === "/play" ||
    pathname.startsWith("/play/") ||
    pathname === "/friend" ||
    pathname.startsWith("/friend/")
  )
    return "/lobby";
  if (pathname === "/leaderboard" || pathname.startsWith("/leaderboard/")) return "/leaderboard";
  return null;
}

function clockLabel(timeSec: number, incrementSec: number): string {
  if (timeSec <= 0) return "No clock";
  if (timeSec < 60) return `${timeSec}s+${incrementSec}`;
  return `${Math.round(timeSec / 60)}+${incrementSec}`;
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

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center bg-oxblood-glow px-1 font-mono text-[12px] leading-[18px] text-white tabular-nums">
      {n > 9 ? "9+" : n}
    </span>
  );
}

export function SiteHeader({ active }: { active?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  // Explicit `active` prop wins (existing callers); otherwise derive the
  // highlighted section from the current path so subpaths light up too.
  const activeSection = active ?? sectionForPath(pathname);
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [menu, setMenu] = useState<Menu>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifications, setNotifications] = useState<HeaderNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [challenges, setChallenges] = useState<HeaderChallenge[]>([]);
  const rightRef = useRef<HTMLDivElement | null>(null);
  // Challenge IDs already seen by this header instance: a challenge that
  // arrives while the page is open gets the lichess challenge sound. Null
  // until the first poll so a pending challenge never dings on page load.
  const knownChallengesRef = useRef<Set<string> | null>(null);

  const refreshSocial = useCallback(async () => {
    try {
      const [notifRes, chalRes] = await Promise.all([fetch("/api/notifications"), fetch("/api/challenges")]);
      if (notifRes.ok) {
        const data = (await notifRes.json()) as { notifications: HeaderNotification[]; unread: number };
        setNotifications(data.notifications);
        setUnread(data.unread);
      }
      if (chalRes.ok) {
        const data = (await chalRes.json()) as { challenges: HeaderChallenge[] };
        const known = knownChallengesRef.current;
        if (known && data.challenges.some((c) => !known.has(c.id))) playChallenge();
        knownChallengesRef.current = new Set(data.challenges.map((c) => c.id));
        setChallenges(data.challenges);
      }
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    let interval: number | null = null;
    // First visit mints an instant guest account so everyone can play rated
    // games right away; registering later upgrades the same account.
    ensureAccount().then((me) => {
      if (cancelled) return;
      setUser(me ?? null);
      if (me) {
        refreshSocial();
        interval = window.setInterval(refreshSocial, 30000);
      }
    });
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [refreshSocial]);

  // Any click outside the right-hand cluster closes whichever menu is open.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!rightRef.current?.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const toggle = (m: Exclude<Menu, null>) => {
    const opening = menu !== m;
    setMenu(opening ? m : null);
    if ((m === "bell" || m === "challenges") && user) {
      if (m === "bell" && opening) {
        // Opening the bell clears everything automatically: refresh first so
        // the dropdown still shows what was new (rows keep their unread look
        // for this viewing), then mark all read server-side and drop the
        // badge optimistically. If the mark-read request fails, refetch so
        // the badge shows the TRUE unread state again instead of lying.
        void (async () => {
          await refreshSocial();
          setUnread(0);
          try {
            const res = await fetch("/api/notifications", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            if (!res.ok) await refreshSocial();
          } catch {
            await refreshSocial();
          }
        })();
      } else {
        refreshSocial();
      }
    }
  };

  const openNotification = async (n: HeaderNotification) => {
    setMenu(null);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [n.id] }),
      });
    } catch {}
    setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setUnread((c) => Math.max(0, c - (n.read ? 0 : 1)));
    if (n.href) router.push(n.href);
  };

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {}
    setNotifications((list) => list.map((x) => ({ ...x, read: true })));
    setUnread(0);
  };

  const respondChallenge = async (challenge: HeaderChallenge, action: "accepted" | "declined") => {
    let ok = false;
    try {
      const res = await fetch(`/api/challenges/${encodeURIComponent(challenge.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      ok = res.ok;
    } catch {}
    if (!ok) {
      await refreshSocial();
      return;
    }
    setChallenges((list) => list.filter((c) => c.id !== challenge.id));
    if (action === "accepted") {
      setMenu(null);
      router.push(`/friend?code=${encodeURIComponent(challenge.id)}`);
    }
  };

  const handleSignOut = async () => {
    setMenu(null);
    await logout();
    window.location.assign("/");
  };

  const iconButton =
    "nav-icon-btn relative grid h-11 w-11 place-items-center text-parchment-400 hover:bg-[color:var(--bg-hover)] hover:text-parchment-50";

  // Lichess's tall header: 60px, the wordmark and nav left, the icon cluster
  // right, one hairline underneath.
  return (
    <nav className="site-nav relative z-[60] flex min-h-[48px] items-center justify-between gap-2 px-2 sm:min-h-[60px] sm:gap-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-1 sm:gap-2">
        {/* Mobile hamburger, left of the wordmark: opens every destination on
            phones and tablets, where the inline nav below is hidden. */}
        <MobileNavMenu align="left" hideAt="md" />
        <Logo />
        <div className="ml-2 hidden items-center font-body md:flex">
          {NAV_LINKS.map((link) =>
            link.menu ? (
              // Lichess-style: the label is still a link, and hovering it (or
              // tabbing into it) reveals a dropdown of sub-destinations.
              <div key={link.href} className="group relative">
                <Link
                  href={link.href}
                  data-active={activeSection === link.href}
                  className="site-nav-link block px-3.5 py-[1.3rem]"
                >
                  {link.label}
                </Link>
                {/* No opacity fade: the menu pops in fully solid so the labels
                    never read as half-transparent text mid-transition. */}
                <div className="invisible absolute left-0 top-full z-40 w-56 group-focus-within:visible group-hover:visible">
                  <div className="site-nav-pop py-1 shadow-xl">
                    {link.menu.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={
                          "block px-4 py-2 text-[14px] transition-colors hover:bg-[color:var(--bg-hover)] " +
                          (item.className ?? "text-parchment-200 hover:text-parchment-50")
                        }
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                data-active={activeSection === link.href}
                className="site-nav-link relative block px-3.5 py-[1.3rem]"
              >
                {link.label}
              </Link>
            )
          )}
        </div>
      </div>

      <div ref={rightRef} className="relative flex items-center gap-0.5 sm:gap-1">
        {/* Search: lichess-style. The icon stays put and the field rolls out to
            its LEFT, floating over the nav links; results drop below the field. */}
        <div className="relative">
          <button
            type="button"
            aria-label="Search players"
            title="Search players"
            aria-expanded={menu === "search"}
            className={iconButton + (menu === "search" ? " bg-[color:var(--bg-raised)] text-parchment-50" : "")}
            onClick={() => toggle("search")}
          >
            <Search size={22} strokeWidth={1.6} />
          </button>
          {menu === "search" && (
            // Below lg: a full-width dropdown UNDER the bar (fixed inset-x/top),
            // so the field can never roll off the left edge or cover the inline
            // nav links (which appear at md and would sit under a leftward
            // rollout at tablet widths). Wide desktop (lg+): the lichess-style
            // field that rolls out to the LEFT of the search icon.
            <div className="header-search-panel fixed inset-x-3 top-[3.9rem] z-40 [&_input]:bg-ink-800 [&_input]:shadow-2xl sm:top-[3.9rem] lg:absolute lg:inset-x-auto lg:right-full lg:top-1/2 lg:mr-1 lg:-translate-y-1/2">
              <PlayerSearch autoFocus />
            </div>
          )}
        </div>

        {user && (
          <>
            {/* Incoming challenges */}
            <button
              type="button"
              aria-label="Incoming challenges"
              title="Incoming challenges"
              className={iconButton}
              onClick={() => toggle("challenges")}
            >
              <Swords size={22} strokeWidth={1.6} />
              <Badge n={challenges.length} />
            </button>
            {menu === "challenges" && (
              <div className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-1.5rem)] site-nav-pop shadow-xl">
                <div className="border-b border-[color:var(--edge)] px-4 py-2.5 text-[12px] text-parchment-400">
                  Challenges
                </div>
                {challenges.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-parchment-400">No incoming challenges right now.</p>
                ) : (
                  <ul className="divide-y divide-[color:var(--edge)]">
                    {challenges.map((challenge) => (
                      <li key={challenge.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                        <div className="min-w-0">
                          <PlayerLink
                            name={challenge.from}
                            className="text-sm text-parchment-100 hover:text-gold-leaf"
                          />
                          <div className="text-[12px] text-parchment-400">
                            {challenge.rated ? "Rated" : "Casual"} · {clockLabel(challenge.timeSec, challenge.incrementSec)} · {timeAgo(challenge.at)}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <Button tone="leaf"
                            onClick={() => respondChallenge(challenge, "accepted")}
                            className="px-3 text-xs font-semibold">
                            Accept
                          </Button>
                          <Button tone="ghost"
                            onClick={() => respondChallenge(challenge, "declined")}
                            className="px-3 text-xs">
                            Decline
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Notifications: an account-only feed (friend requests, replies,
                mod notices) that never populates for a throwaway guest, so it
                is hidden entirely rather than shown as a dead bell. */}
            {!user.isGuest && (
              <>
            <button
              type="button"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
              title="Notifications"
              className={iconButton + (unread > 0 ? " relic-unread" : "")}
              onClick={() => toggle("bell")}
            >
              <Bell size={22} strokeWidth={1.6} />
              {unread > 0 && <span aria-hidden className="relic-orbit" />}
              <Badge n={unread} />
            </button>
            {menu === "bell" && (
              <div className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-1.5rem)] site-nav-pop shadow-xl">
                <div className="flex items-center justify-between border-b border-[color:var(--edge)] px-4 py-2.5">
                  <span className="text-[12px] text-parchment-400">Notifications</span>
                  {unread > 0 && (
                    <button onClick={markAllRead} className="text-xs text-parchment-400 hover:text-parchment-100">
                      Mark all read
                    </button>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-parchment-400">Nothing here yet.</p>
                ) : (
                  <ul className="max-h-96 divide-y divide-[color:var(--edge)] overflow-y-auto">
                    {notifications.map((n) => (
                      <li key={n.id}>
                        {/* A div (not a button) so the actor's profile link
                            inside the copy is valid: an <a> may not nest in a
                            <button>. role/tabIndex/onKeyDown keep it a
                            keyboard-operable row; the inner link's
                            stopPropagation keeps it from opening the row. */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => openNotification(n)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openNotification(n);
                            }
                          }}
                          className={
                            "block w-full cursor-pointer px-4 py-2.5 text-left transition-colors hover:bg-[color:var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--edge-strong)] " +
                            (n.read ? "opacity-60" : "")
                          }
                        >
                          <div className="text-sm leading-snug text-parchment-100">
                            <NotificationText text={n.text} actorName={n.actorName} />
                          </div>
                          <div className="mt-0.5 text-[12px] text-parchment-400">{timeAgo(n.at)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
              </>
            )}
          </>
        )}

        {/* Quick settings (the lichess "dasher"): background, board, pieces,
            board size, sound and zen mode, applied live. */}
        <HeaderSettingsMenu onOpen={() => setMenu(null)} onOpenPreferences={() => setSettingsOpen(true)} />

        {/* Account */}
        {user === undefined ? (
          <span className="h-9 w-24" />
        ) : !user ? (
          <Link
            href="/login"
            className="ml-1 px-3 py-2 text-[13px] uppercase tracking-[0.05em] text-parchment-300 no-underline transition-colors hover:text-parchment-50"
          >
            Sign in
          </Link>
        ) : (
          <>
            <div className="ml-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggle("profile")}
                aria-label={user.isGuest ? "Guest account menu" : "Account menu"}
                title={user.isGuest ? "Guest account menu" : "Account menu"}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 px-2 py-1.5 text-[14px] text-parchment-200 transition-colors hover:bg-[color:var(--bg-hover)] hover:text-parchment-50"
                aria-haspopup="menu"
                aria-expanded={menu === "profile"}
              >
                {/* The name is dead weight at phone widths and can collide with
                    the wordmark; the avatar alone opens the menu there. Guests
                    show a plain "Sign in" affordance beside the name so the
                    header reads as signed-out, never as a registered account. */}
                <span className="hidden items-center gap-1.5 sm:inline-flex">
                  {user.isGuest && (
                    <span className="text-[12px] text-parchment-400">Guest</span>
                  )}
                  <span className={user.isGuest ? "text-parchment-200" : undefined}>{user.username}</span>
                </span>
                <PlayerAvatar name={user.username} avatar={user.avatar} size={24} />
              </button>
              {/* Guest sign-in affordance, reading "<name> · Sign in". Links to
                  the same /login flow used by the signed-out button and the
                  in-menu items. Hidden on phones (like the name) to keep the
                  compact mobile header intact; the menu still offers Sign in. */}
              {user.isGuest && (
                <>
                  <span aria-hidden className="hidden text-parchment-500 sm:inline">·</span>
                  <Link
                    href="/login"
                    className="hidden px-2 py-1.5 text-[13px] uppercase tracking-[0.05em] text-gold-leaf no-underline transition-colors hover:text-parchment-50 sm:inline-flex"
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
            {menu === "profile" && (
              <div className="absolute right-0 top-full z-40 mt-2 w-56 site-nav-pop py-1 shadow-xl">
                {user.isGuest && (
                  <>
                    <div className="px-4 pb-1 pt-2 text-[12px] leading-snug text-parchment-400">
                      You are playing as a guest. Register to keep this name and rating on any
                      device.
                    </div>
                    <MenuItem
                      icon={<UserPlus size={16} strokeWidth={1.6} />}
                      label="Create account"
                      onClick={() => {
                        setMenu(null);
                        router.push("/login?upgrade=1");
                      }}
                    />
                    <MenuItem
                      icon={<LogIn size={16} strokeWidth={1.6} />}
                      label="Sign in"
                      onClick={() => {
                        setMenu(null);
                        router.push("/login");
                      }}
                    />
                    <div className="my-1 border-t border-[color:var(--edge)]" />
                  </>
                )}
                <MenuItem
                  icon={<User size={16} strokeWidth={1.6} />}
                  label="Profile"
                  onClick={() => {
                    setMenu(null);
                    router.push(`/u/${encodeURIComponent(user.username)}`);
                  }}
                />
                <MenuItem
                  icon={<History size={16} strokeWidth={1.6} />}
                  label="Game history"
                  onClick={() => {
                    setMenu(null);
                    router.push("/history");
                  }}
                />
                <MenuItem
                  icon={<Trophy size={16} strokeWidth={1.6} />}
                  label="Achievements"
                  onClick={() => {
                    setMenu(null);
                    router.push("/achievements");
                  }}
                />
                {/* Private messages are account-only: a guest has no inbox
                    worth opening, so the row is hidden for them. */}
                {!user.isGuest && (
                  <MenuItem
                    icon={<Mail size={16} strokeWidth={1.6} />}
                    label="Inbox"
                    onClick={() => {
                      setMenu(null);
                      router.push("/inbox");
                    }}
                  />
                )}
                <MenuItem
                  icon={<Settings size={16} strokeWidth={1.6} />}
                  label="Preferences"
                  onClick={() => {
                    setMenu(null);
                    setSettingsOpen(true);
                  }}
                />
                {(user.role === "mod" || user.role === "admin") && (
                  <MenuItem
                    icon={<Shield size={16} strokeWidth={1.6} />}
                    label="Moderation"
                    onClick={() => {
                      setMenu(null);
                      router.push("/mod");
                    }}
                  />
                )}
                {/* Guests get no Sign out: it only ever destroyed their
                    progress. Sign in / Create account (above) are their
                    doors; a real account signs out normally. */}
                {!user.isGuest && (
                  <>
                    <div className="my-1 border-t border-[color:var(--edge)]" />
                    <MenuItem icon={<LogOut size={16} strokeWidth={1.6} />} label="Sign out" onClick={handleSignOut} />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <ZenExitButton />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {user?.nameFlagged && <RenameBanner onRenamed={(name) => setUser({ ...user, username: name, nameFlagged: false })} />}
    </nav>
  );
}

// Compact top-bar variant for game surfaces (design system §9: game pages may
// COMPACT the top nav, never replace it). The wordmark, the collapsed nav menu
// (the MobileNavMenu trigger, kept visible on desktop too via hideAt="none", so
// every global destination stays one tap away), and an optional game status
// line. Plain links only, no confirm traps: nothing here can drop a live game
// by accident, and everything the full header reaches is still reachable.
export function CompactSiteHeader({ status }: { status?: React.ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <nav className="site-nav relative z-[60] flex min-h-[44px] items-center gap-2 px-2 sm:min-h-[60px] sm:gap-3 sm:px-5">
      <MobileNavMenu align="left" hideAt="none" />
      <Logo />
      {status && (
        <div className="ml-auto flex min-w-0 items-center gap-x-3 text-[12px] text-parchment-400">
          {status}
        </div>
      )}
      {/* Same quick settings the full header carries, so a player never has to
          leave the game to change the board, the sound or zen mode. */}
      <div className={status ? "shrink-0" : "ml-auto shrink-0"}>
        <HeaderSettingsMenu onOpenPreferences={() => setSettingsOpen(true)} />
      </div>
      <ZenExitButton />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </nav>
  );
}

// Shown when a moderator flagged this account's username: the account (and
// its ratings, games, achievements) is intact, but a new name is required.
// Inline so the fix is one field away instead of a support ticket.
function RenameBanner({ onRenamed }: { onRenamed: (name: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; username?: string };
      if (!res.ok || !data.username) {
        setError(data.error ?? "Could not rename right now.");
      } else {
        onRenamed(data.username);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="alert"
      className="absolute inset-x-0 top-full z-30 border-y border-oxblood-glow/50 bg-[color:var(--bg-base)] px-4 py-2.5"
    >
      <form onSubmit={submit} className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 text-parchment-200">
          A moderator flagged your username. Pick a new name to continue; your rating, games,
          and achievements are kept.
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="New username"
          aria-label="New username"
          className="input-rune w-40 px-2 py-1.5 focus:outline-none"
        />
        <Button tone="leaf"
          type="submit"
          disabled={busy || !name.trim()}
          className="px-3 py-1.5 text-sm disabled:opacity-50">
          {busy ? "Renaming…" : "Rename"}
        </Button>
        {error && <span className="w-full text-xs text-oxblood-glow">{error}</span>}
      </form>
    </div>
  );
}

// A notification line with the actor's name turned into a profile link, while
// the rest of the line stays plain text inside the row's own button (the link's
// stopPropagation keeps the row's open-notification behavior working). Falls
// back to plain text when there is no linkable actor name in the copy.
function NotificationText({ text, actorName }: { text: string; actorName: string | null }) {
  const idx = actorName ? text.indexOf(actorName) : -1;
  if (!actorName || idx < 0 || !isLinkablePlayerName(actorName)) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, idx)}
      <PlayerLink name={actorName} className="align-baseline text-parchment-50 hover:text-gold-leaf" />
      {text.slice(idx + actorName.length)}
    </>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[40px] w-full items-center gap-2.5 px-4 py-2 text-left text-[14px] text-parchment-200 transition-colors hover:bg-[color:var(--bg-hover)] hover:text-parchment-50"
    >
      <span className="text-parchment-400">{icon}</span>
      {label}
    </button>
  );
}
