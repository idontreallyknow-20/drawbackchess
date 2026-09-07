"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import { AccountUser, fetchMe } from "@/lib/authClient";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/Button";

type MobileNavItem = { href: string; label: string; className?: string };
type MobileNavGroup = { header: string; items: MobileNavItem[] };

// Grouped destinations mirror the desktop header sections (Play / Watch /
// Community) plus a "You" group for personal pages. Every destination the old
// flat list reached stays reachable; friend challenges now route through the
// lobby friends tab, matching the desktop Play menu.
function buildGroups(user: AccountUser | null | undefined): MobileNavGroup[] {
  return [
    {
      header: "Play",
      items: [
        { href: "/lobby", label: "New game" },
        { href: "/play", label: "Practice vs computer" },
        { href: "/lobby?tab=friends", label: "Challenge a friend" },
        { href: "/tournaments", label: "Tournaments" },
      ],
    },
    {
      header: "Watch",
      items: [
        { href: "/tv?mode=nerf", label: "Nerf TV", className: "text-mode-nerfGlow" },
        { href: "/tv?mode=buff", label: "Buff TV", className: "text-mode-buffGlow" },
      ],
    },
    {
      header: "Community",
      items: [
        { href: "/community", label: "Community hub" },
        { href: "/clubs", label: "Clubs" },
        { href: "/leaderboard", label: "Leaderboard" },
      ],
    },
    {
      header: "You",
      items: [
        { href: user ? `/u/${encodeURIComponent(user.username)}` : "/login", label: "Profile" },
        { href: "/history", label: "Game history" },
        ...(user ? [{ href: "/inbox", label: "Inbox" }] : []),
        { href: "/achievements", label: "Achievements" },
        { href: "/analysis", label: "Analysis board" },
        { href: "/codex", label: "Rules" },
        { href: "/tutorial", label: "How to play" },
      ],
    },
  ];
}

// An item highlights when the current path matches its base path (or a subpath
// of it). Query-variant entries (e.g. the two TV modes) share a base path, so
// pathname alone cannot tell them apart; they never self-highlight rather than
// lighting up together and reading as ambiguous.
function itemActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  const [path, query] = href.split("?");
  if (query) return false;
  return pathname === path || pathname.startsWith(path + "/");
}

/**
 * Mobile-only (below `sm`) hamburger for the top bar. The per-page navs keep
 * their inline text links on desktop but hide them on phones, where they
 * overflowed narrow screens (the nav row was the site's horizontal-scroll
 * culprit); this puts every destination plus the account entry behind one
 * fixed-width button instead.
 */
export function MobileNavMenu({
  align = "right",
  hideAt = "sm",
}: {
  // Which edge the dropdown anchors to. Use "left" when the button sits at the
  // far left of the bar (e.g. left of the logo) so the panel opens on-screen.
  align?: "left" | "right";
  // Hide the hamburger at and above this breakpoint. Match it to the sibling
  // desktop nav's breakpoint so there is never a width with neither visible.
  // "none" keeps the trigger visible at every width -- used by the compact
  // game top bar, where the collapsed menu is the ONLY nav (no inline links),
  // so it must stay reachable on desktop too.
  hideAt?: "sm" | "md" | "none";
} = {}) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (!cancelled) setUser(me);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Static class strings (Tailwind cannot see interpolated class names).
  const hideClass = hideAt === "none" ? "" : hideAt === "md" ? "md:hidden" : "sm:hidden";

  // The panel is PORTALLED to document.body and positioned from the trigger's
  // rect, rather than absolutely positioned inside the header.
  //
  // Why: an ancestor with a z-index traps the whole subtree in its stacking
  // context, and `!z-50` on the panel only orders it WITHIN that context. Two
  // places broke on this. In-game the nav is `sticky top-0 z-20`, below the
  // z-40 drawer bars — so the bottom of a tall menu (and its backdrop) rendered
  // underneath them, and tapping down there hit the drawer instead of the menu
  // item. On the lobby the header sits inside `main`, which globals.css pins at
  // z-index 2, while QuickMatch's sticky CTA is itself portalled to the body at
  // z-40 — so "Find game" covered the lower menu entries and a tap there
  // started matchmaking. Escaping to the body removes the whole class of bug.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left?: number; right?: number } | null>(
    null,
  );
  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 8px gap below the trigger, matching the old `mt-2`.
    const top = r.bottom + 8;
    setPanelPos(
      align === "left"
        ? { top, left: Math.max(12, r.left) }
        : { top, right: Math.max(12, window.innerWidth - r.right) },
    );
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    // Deferred a microtask so the first measurement is not a synchronous
    // setState in the effect body (same pattern as the rest of the codebase);
    // a microtask still lands before paint, so there is no visible jump.
    queueMicrotask(measure);
    window.addEventListener("resize", measure);
    // `true`: catch scrolls in any ancestor, not just the page, so a sticky
    // header that moves under the menu keeps it anchored.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  // Escape closes, matching every other dismissible surface.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Empty groups (all items conditional and absent) render nothing, not a
  // stray header. Each group also carries a running item offset so the
  // per-item entrance stagger (--i) is cumulative across groups — a fixed
  // stride would collide once a group holds more items than the stride.
  const visibleGroups = buildGroups(user).filter((group) => group.items.length > 0);
  const groups = visibleGroups.map((group, gi) => ({
    ...group,
    offset: visibleGroups.slice(0, gi).reduce((n, g) => n + g.items.length, 0),
  }));

  return (
    <div className={"relative " + hideClass}>
      <Button tone="ghost"
        ref={triggerRef}
       
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="h-11 w-11">
        {open ? <X size={18} /> : <Menu size={18} />}
      </Button>
      {open && panelPos &&
        createPortal(
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[60] cursor-default bg-black/40"
            />
            {/* A plain dropdown box, the same surface the header's other
                popovers use: panel fill, one hairline, 7px corners. Fixed and
                lifted above the bar; max-h + internal scroll so a short
                landscape viewport never traps the lower destinations. */}
            <div
              style={{
                top: panelPos.top,
                left: panelPos.left,
                right: panelPos.right,
                background: "var(--bg-panel)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--ui-roundness)",
              }}
              data-testid="mobile-nav-panel"
              className="!fixed !z-[61] max-h-[calc(100dvh-4.5rem)] w-60 max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] shadow-xl"
            >
            <Link
              href={user ? `/u/${encodeURIComponent(user.username)}` : "/login"}
              onClick={() => setOpen(false)}
              className="flex min-h-[44px] items-center gap-2.5 px-4 py-2.5 font-display text-sm text-gold-leaf hover:bg-[color:var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--edge-strong)]"
            >
              {user ? (
                <>
                  <PlayerAvatar name={user.username} avatar={user.avatar} size={22} className="rounded-full" />
                  <span className="min-w-0 truncate">{user.username}</span>
                  {/* Live displayed rating (best mode bucket), matching the
                      header chip and profile, not the frozen legacy column. */}
                  <span className="ml-auto shrink-0 font-mono text-xs text-parchment-400">
                    {Math.round(user.displayRating ?? user.rating)}
                  </span>
                </>
              ) : (
                "Sign in"
              )}
            </Link>
            {groups.map((group) => (
              <div key={group.header}>
                <div className="mx-3 mb-1 mt-2 h-px bg-[color:var(--bg-raised)]" />
                <div className="px-4 pb-1 pt-0.5 text-[12px] text-parchment-400">{group.header}</div>
                {group.items.map((item, ii) => {
                  const activeItem = itemActive(item.href, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={activeItem ? "page" : undefined}
                      style={{ ["--i" as string]: group.offset + ii }}
                      className={
                        "flex min-h-[44px] items-center border-l-2 py-2.5 pr-4 text-sm font-medium hover:bg-[color:var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--edge-strong)] " +
                        (activeItem ? "border-gold-leaf bg-[color:var(--bg-raised)] pl-[calc(1rem-2px)] font-semibold " : "border-transparent pl-[calc(1rem-2px)] ") +
                        (activeItem ? "text-gold-leaf" : item.className ?? "text-parchment-100")
                      }
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
