"use client";

// The moderation console's frame: the ordinary site header, then a Lichess
// mod-zone layout: a sticky rail of grouped sections on the left, the open
// section on the right, and Ctrl+K for jumping anywhere or looking up a
// player. Every /mod page mounts this so the console reads as one place.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { NAV_GROUPS, SECTION_TITLE, type NavItem, type SectionId } from "@/components/mod/nav";
import { CountBadge } from "@/components/mod/ui";

export function ModShell({
  title,
  current,
  isAdmin,
  openReports = 0,
  chatFlags = 0,
  onGo,
  onInspectPlayer,
  children,
}: {
  title: string;
  /** The open console section, when this is the console page. */
  current?: SectionId;
  isAdmin: boolean;
  openReports?: number;
  chatFlags?: number;
  /** Section navigation, when on the console page; standalone pages link. */
  onGo?: (id: SectionId) => void;
  onInspectPlayer?: (username: string) => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.adminOnly || isAdmin),
  })).filter((g) => g.items.length > 0);

  const badgeFor = (item: NavItem) =>
    item.kind === "section" && item.badge ? (item.badge === "reports" ? openReports : chatFlags) : 0;

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto w-full max-w-[1300px] px-3 pb-12 pt-4 sm:px-5 lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-5">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between lg:block">
            <h1 className="page-title">Moderation</h1>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="mt-0 flex items-center gap-2 border border-[color:var(--edge)] bg-[color:var(--bg-panel)] px-2.5 py-1.5 text-[12px] text-parchment-400 transition-colors hover:text-parchment-100 lg:mt-3 lg:w-full"
              title="Jump to a section or a player (Ctrl+K)"
            >
              <Search size={14} strokeWidth={1.6} aria-hidden />
              <span>Jump to…</span>
              <kbd className="ml-auto font-mono text-[12px] text-parchment-500">Ctrl K</kbd>
            </button>
          </div>
          <nav aria-label="Moderation sections" className="mt-3 hidden lg:block">
            {groups.map((group) => (
              <div key={group.title} className="mb-4">
                <div className="px-2 text-[12px] uppercase tracking-[0.06em] text-parchment-500">{group.title}</div>
                <ul className="mt-1">
                  {group.items.map((item) => (
                    <li key={item.kind === "section" ? item.id : item.href}>
                      <NavEntry
                        item={item}
                        active={item.kind === "section" ? item.id === current : item.href === pathname}
                        badge={badgeFor(item)}
                        onGo={onGo}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          {/* Phones: a scrolling row of the same entries. */}
          <div className="-mx-3 mt-3 flex gap-1 overflow-x-auto border-b border-[color:var(--edge)] px-3 pb-2 lg:hidden">
            {groups.flatMap((g) => g.items).map((item) => (
              <NavEntry
                key={item.kind === "section" ? item.id : item.href}
                item={item}
                active={item.kind === "section" ? item.id === current : item.href === pathname}
                badge={badgeFor(item)}
                onGo={onGo}
                compact
              />
            ))}
          </div>
        </aside>

        <div className="min-w-0 mt-4 lg:mt-0">
          <h2 className="mb-3 border-b border-[color:var(--edge)] pb-2 text-[13px] uppercase tracking-[0.05em] text-parchment-300">
            {title}
          </h2>
          {children}
        </div>
      </section>

      {paletteOpen && (
        <Palette
          groups={groups}
          onClose={() => setPaletteOpen(false)}
          onGo={onGo}
          onInspectPlayer={onInspectPlayer}
        />
      )}
    </main>
  );
}

function NavEntry({
  item,
  active,
  badge,
  onGo,
  compact,
}: {
  item: NavItem;
  active: boolean;
  badge: number;
  onGo?: (id: SectionId) => void;
  compact?: boolean;
}) {
  const cls =
    "flex items-center gap-2 whitespace-nowrap text-[13px] no-underline transition-colors " +
    (compact ? "min-h-[36px] px-2.5" : "w-full px-2 py-1.5") +
    " " +
    (active
      ? "bg-[color:var(--bg-panel)] text-parchment-50"
      : "text-parchment-300 hover:bg-[color:var(--bg-panel)] hover:text-parchment-50");
  const inner = (
    <>
      <span>{item.label}</span>
      {item.kind === "section" && !compact && <CountBadge n={badge} />}
      {item.kind === "section" && compact && badge > 0 && (
        <span className="bg-oxblood px-1 font-mono text-[12px] text-white">{badge}</span>
      )}
    </>
  );
  if (item.kind === "link" || !onGo) {
    const href = item.kind === "link" ? item.href : `/mod#${item.id}`;
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => onGo(item.id)} aria-current={active ? "page" : undefined} className={cls}>
      {inner}
    </button>
  );
}

// Ctrl+K: type to filter sections and standalone pages; anything that matches
// no entry is offered as a player lookup.
function Palette({
  groups,
  onClose,
  onGo,
  onInspectPlayer,
}: {
  groups: { title: string; items: NavItem[] }[];
  onClose: () => void;
  onGo?: (id: SectionId) => void;
  onInspectPlayer?: (username: string) => void;
}) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = groups.flatMap((g) => g.items.map((item) => ({ group: g.title, item })));
    const hits = needle ? all.filter((r) => r.item.label.toLowerCase().includes(needle)) : all;
    const list: { key: string; label: string; hint: string; run: () => void }[] = hits.map((r) => ({
      key: r.item.kind === "section" ? r.item.id : r.item.href,
      label: r.item.label,
      hint: r.group,
      run: () => {
        if (r.item.kind === "section") {
          if (onGo) onGo(r.item.id);
          else window.location.assign(`/mod#${r.item.id}`);
        } else {
          window.location.assign(r.item.href);
        }
        onClose();
      },
    }));
    if (needle && /^[a-z0-9_-]{2,32}$/i.test(needle)) {
      list.unshift({
        key: "player:" + needle,
        label: `Look up player "${q.trim()}"`,
        hint: "Players",
        run: () => {
          if (onInspectPlayer) onInspectPlayer(q.trim());
          else window.location.assign(`/mod#players`);
          onClose();
        },
      });
    }
    return list;
  }, [q, groups, onGo, onInspectPlayer, onClose]);

  const safeCursor = Math.min(cursor, Math.max(0, rows.length - 1));

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(rows.length - 1, c + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        rows[safeCursor]?.run();
      }
    },
    [rows, safeCursor],
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-4 pt-[12vh]" onMouseDown={onClose} role="dialog" aria-label="Jump to">
      <div className="plate plate-raised mx-auto w-full max-w-lg" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[color:var(--edge)] px-3">
          <Search size={16} strokeWidth={1.6} className="text-parchment-400" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Section or player name"
            className="min-h-[44px] w-full bg-transparent text-[14px] text-parchment-50 placeholder:text-parchment-500 focus:outline-none"
          />
          <kbd className="font-mono text-[12px] text-parchment-500">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {rows.length === 0 && <li className="px-3 py-3 text-[13px] text-parchment-400">Nothing matches.</li>}
          {rows.map((r, i) => (
            <li key={r.key}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={r.run}
                className={
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] " +
                  (i === safeCursor ? "bg-[color:var(--bg-panel)] text-parchment-50" : "text-parchment-200")
                }
              >
                <span>{r.label}</span>
                <span className="text-[12px] uppercase tracking-[0.05em] text-parchment-500">{r.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export { SECTION_TITLE };
