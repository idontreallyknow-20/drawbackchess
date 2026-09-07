"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Sparkles, User, Users, type LucideIcon } from "lucide-react";
import { HeroTv } from "@/components/HeroTv";
import { SiteHeader } from "@/components/SiteHeader";
import { SocialsRow } from "@/components/SocialsRow";
import { ModeBadge } from "@/components/ModeBadge";
// NOTE: the card libraries (ALL_BUFFS / ALL_NERFS) are NOT imported statically.
// They transitively pull the entire card engine (~12k lines) into the home
// page's client bundle just to show one card face. CardOfTheDay and
// HeroRatings lazy-import them so the engine never ships in this chunk.
import { TIER_ROMAN } from "@/lib/tiers";
import { useLobbySnapshot } from "@/lib/lobbyClient";
import { AccountUser, fetchMe } from "@/lib/authClient";
import { ActiveGame, loadActiveGame, clearActiveGame } from "@/lib/multiplayer";
import { UPDATES, formatUpdateDate } from "@/lib/updates";
import { LinkButton } from "@/components/ui/Button";

// The home page, laid out the way Lichess lays out its lobby: a feed on the
// left, the board in the middle, the ways in on the right, and a timeline of
// what changed underneath. One grid, plain boxes, no marketing bands.
export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <SiteHeader />

      <section className="mx-auto flex w-full max-w-[1300px] flex-col px-3 pt-4 sm:px-5 lg:grid lg:grid-cols-[250px_minmax(0,1fr)_320px] lg:gap-6">
        {/* Feed: what happened lately. Last on phones, first on desktop. */}
        <div className="order-3 mt-6 lg:order-1 lg:mt-0">
          <HomeFeed />
        </div>

        {/* The board. */}
        <div className="order-1 lg:order-2">
          <HeroTv />
        </div>

        {/* The ways in. */}
        <div className="order-2 mt-4 lg:order-3 lg:mt-0">
          <div className="flex items-start justify-between gap-3">
            {/* The page's H1. The sr-only tail gives search engines the "chess
                with power-ups" target phrase without changing the visible hero. */}
            <h1 className="font-display text-[15px] font-semibold text-parchment-50">
              Nerf Chess
              <span className="sr-only">: chess with power-ups, a free online chess variant</span>
            </h1>
            <HeroRatings />
          </div>

          <div className="mt-2 flex flex-col gap-2">
            <LinkButton tone="default" href="/lobby" block size="lg" align="start">
              <Users size={22} strokeWidth={1.6} aria-hidden className="shrink-0 text-parchment-300" />
              Create a game
            </LinkButton>
            <LinkButton tone="default" href="/lobby?tab=friends" block size="lg" align="start">
              <User size={22} strokeWidth={1.6} aria-hidden className="shrink-0 text-parchment-300" />
              Play with a friend
            </LinkButton>
            <LinkButton tone="default" href="/play" block size="lg" align="start">
              <Cpu size={22} strokeWidth={1.6} aria-hidden className="shrink-0 text-parchment-300" />
              Play with the computer
            </LinkButton>
          </div>

          <ReturnToGameBanner />
          <LiveNowStrip />

          {/* The two modes as two plain rows. ?mode= wins over the remembered
              choice in the lobby. */}
          <ul className="mt-5 divide-y divide-[color:var(--edge)] border-y border-[color:var(--edge)]">
            <li>
              <Link href="/lobby?mode=buff" className="group flex items-center justify-between gap-3 py-2 no-underline">
                <span className="min-w-0">
                  <span className="font-semibold text-mode-buffGlow">Buff mode</span>
                  <span className="ml-2 text-[13px] text-parchment-300">Stack powers onto your own army.</span>
                </span>
                <span className="btn-ghost inline-flex min-h-[36px] shrink-0 items-center px-4 text-[13px] uppercase tracking-[0.05em]">Play</span>
              </Link>
            </li>
            <li>
              <Link href="/lobby?mode=nerf" className="group flex items-center justify-between gap-3 py-2 no-underline">
                <span className="min-w-0">
                  <span className="font-semibold text-mode-nerfGlow">Nerf mode</span>
                  <span className="ml-2 text-[13px] text-parchment-300">Secret handicaps, hexes, and boons.</span>
                </span>
                <span className="btn-ghost inline-flex min-h-[36px] shrink-0 items-center px-4 text-[13px] uppercase tracking-[0.05em]">Play</span>
              </Link>
            </li>
          </ul>

          <p className="mt-4 text-[13px] leading-snug text-parchment-300">
            Every five moves you draft a card. In{" "}
            <span className="font-semibold text-mode-buffGlow">Buff</span> mode you stack powers
            onto your own army; in <span className="font-semibold text-mode-nerfGlow">Nerf</span>{" "}
            mode you start with a secret handicap and curse your opponent. Capture the king to win.
          </p>
        </div>
      </section>

      {/* Below the fold: the change log on the left, one card from the pool on
          the right, both in the same plain boxes. */}
      <section className="mx-auto mt-8 flex w-full max-w-[1300px] flex-col px-3 sm:px-5 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        <UpdatesTimeline />
        <div className="mt-6 lg:mt-0">
          <CardOfTheDay />
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

// The two-line live counter under the buttons, Lichess's "N players / N games
// in play". Rendered only once the first lobby snapshot resolves; never a
// fabricated number.
function LiveNowStrip() {
  const lobby = useLobbySnapshot(10000);
  if (!lobby) return null;
  const online = lobby.players.length + lobby.anonymous;
  const games = lobby.games.length;
  // 42px tall, two short of the minimum, purely from line-height: it is a
  // full-width block so only the height was ever in question. `flex-col`
  // rather than a bare `flex`, because the two spans are a stacked two-line
  // strip and a row would have put them side by side.
  return (
    <Link
      href="/lobby"
      className="mt-5 flex min-h-[44px] flex-col justify-center text-[13px] leading-6 text-parchment-300 no-underline [@media(pointer:fine)]:min-h-0"
    >
      <span className="block">
        <span className="font-semibold tabular-nums text-parchment-50">{online.toLocaleString()}</span>{" "}
        {online === 1 ? "player" : "players"}
      </span>
      <span className="block">
        <span className="font-semibold tabular-nums text-parchment-50">{games.toLocaleString()}</span>{" "}
        {games === 1 ? "game" : "games"} in play
      </span>
    </Link>
  );
}

// A signed-in player with mode ratings sees them beside the title; guests get
// nothing. Same reads the profile uses, no card engine.
function HeroRatings() {
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [ratings, setRatings] = useState<Partial<Record<"nerf" | "buff", number>>>({});

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      setUser(me);
      if (!me || me.isGuest) return;
      fetch(`/api/users/${encodeURIComponent(me.username)}`)
        .then((res) => (res.ok ? res.json() : null) as Promise<{ ratings?: Record<string, { rating: number }> } | null>)
        .then((data) => {
          if (cancelled || !data?.ratings) return;
          setRatings({
            nerf: data.ratings.nerf ? Math.round(data.ratings.nerf.rating) : undefined,
            buff: data.ratings.buff ? Math.round(data.ratings.buff.rating) : undefined,
          });
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user || user.isGuest) return null;
  const chips: { key: "nerf" | "buff"; label: string; value: number; tone: string }[] = [];
  if (ratings.nerf != null) chips.push({ key: "nerf", label: "Nerf", value: ratings.nerf, tone: "text-mode-nerfGlow" });
  if (ratings.buff != null) chips.push({ key: "buff", label: "Buff", value: ratings.buff, tone: "text-mode-buffGlow" });
  if (chips.length === 0) return null;
  return (
    <Link
      href={`/u/${encodeURIComponent(user.username)}`}
      title="Your profile"
      className="flex flex-wrap items-center justify-end gap-x-3 text-[13px] no-underline"
    >
      {chips.map((c) => (
        <span key={c.key}>
          <span className={c.tone}>{c.label}</span>{" "}
          <span className="font-semibold tabular-nums text-parchment-50">{c.value}</span>
        </span>
      ))}
    </Link>
  );
}

// If this device has a game in progress (tab closed mid-game, wandered home),
// offer the way back in. Verified against the archive so a finished game never
// claims to be live.
function ReturnToGameBanner() {
  const [active, setActive] = useState<ActiveGame | null>(null);
  useEffect(() => {
    const stored = loadActiveGame();
    if (!stored) return;
    let cancelled = false;
    fetch(`/api/games/${encodeURIComponent(stored.id)}`)
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ game?: { winner: unknown; completed_at: unknown } } | null>)
          : null,
      )
      .then((data) => {
        if (cancelled) return;
        const g = data?.game;
        const finished = !!g && (g.completed_at != null || g.winner != null);
        if (finished) {
          clearActiveGame(stored.id);
          return;
        }
        setActive(stored);
      })
      .catch(() => {
        if (!cancelled) setActive(stored);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!active) return null;
  return (
    <LinkButton tone="primary" href={`/game/${active.id}`} block size="lg" align="start" className="mt-2">
      Rejoin your game
    </LinkButton>
  );
}

type RecentGame = {
  id: string;
  whiteName: string;
  blackName: string;
  winner: "w" | "b" | "draw" | null;
  reason: string;
  rated: boolean;
  category: string;
  completedAt: number;
};

// The left column: the latest finished games as a plain feed, the way
// Lichess lists forum posts. Disappears entirely when the archive is empty.
function HomeFeed() {
  const [games, setGames] = useState<RecentGame[] | null>(null);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);

  const loadGames = useCallback(() => {
    setFailed(false);
    fetch("/api/community/recent")
      .then((res) => {
        if (!res.ok) throw new Error(`recent ${res.status}`);
        return res.json() as Promise<{ games: RecentGame[] }>;
      })
      .then((data) => {
        if (mountedRef.current) setGames(data.games.slice(0, 10));
      })
      .catch(() => {
        if (mountedRef.current) setFailed(true);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    queueMicrotask(() => {
      if (mountedRef.current) loadGames();
    });
    return () => {
      mountedRef.current = false;
    };
  }, [loadGames]);

  const modeOf = (category: string) => (category === "nerf" || category === "buff" ? category : undefined);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] uppercase tracking-[0.05em] text-parchment-400">Latest games</h2>
        <Link href="/community" className="-my-1 inline-flex min-h-[44px] items-center text-[13px] text-parchment-400 no-underline hover:text-parchment-100 [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:my-0">
          Community »
        </Link>
      </div>
      {failed ? (
        <p className="mt-3 text-[13px] text-parchment-400">
          Could not load.{" "}
          <button type="button" onClick={loadGames} className="text-gold-leaf hover:underline">
            Retry
          </button>
        </p>
      ) : games === null ? (
        <ul className="mt-3 space-y-3" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="skeleton h-9 w-full" />
          ))}
        </ul>
      ) : games.length === 0 ? (
        <p className="mt-3 text-[13px] text-parchment-400">No games finished yet.</p>
      ) : (
        <ul className="mt-2">
          {games.map((g) => (
            <li key={g.id} className="border-b border-[color:var(--edge)] py-2 last:border-b-0">
              <Link href={`/game/${g.id}`} className="block text-[13px] leading-snug text-parchment-200 no-underline hover:text-parchment-50">
                <span className="text-parchment-50">{g.whiteName}</span>
                <span className="text-parchment-400"> vs </span>
                <span className="text-parchment-50">{g.blackName}</span>
                <span className="ml-1.5 font-mono tabular-nums text-parchment-300">{resultLabel(g.winner)}</span>
              </Link>
              <div className="mt-0.5 flex items-center gap-2 text-[12px] text-parchment-400">
                <ModeBadge mode={modeOf(g.category)} compact />
                <span>{g.rated ? "Rated" : "Casual"}</span>
                <span>{timeAgo(g.completedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The change log, Lichess's blog timeline: a brass date, a title, one line.
function UpdatesTimeline() {
  return (
    <div className="plate p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] uppercase tracking-[0.05em] text-parchment-400">Latest updates</h2>
        <Link href="/updates" className="-my-1 inline-flex min-h-[44px] items-center text-[13px] text-parchment-400 no-underline hover:text-parchment-100 [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:my-0">
          All updates »
        </Link>
      </div>
      <ol className="mt-3 border-l border-[color:var(--edge)] pl-4">
        {UPDATES.slice(0, 4).map((u) => (
          <li key={u.anchor} className="relative pb-4 last:pb-0">
            <span aria-hidden className="absolute -left-[21px] top-[7px] h-2 w-2 bg-brag" />
            <Link href={`/updates#${u.anchor}`} className="block no-underline">
              <span className="text-[12px] text-brag">{formatUpdateDate(u.date)}</span>
              <span className="mt-0.5 block text-[15px] text-parchment-50">{u.title}</span>
              <span className="block text-[13px] leading-snug text-parchment-300">{u.summary}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

type FeaturedCard = { kind: "buff" | "nerf"; id: string; name: string; tier: number; href: string; description: string; Icon: LucideIcon };

// One real card from the pool, chosen by the date so everyone sees the same
// one all day. The engine is lazy-imported; the box hides if the import fails.
function CardOfTheDay() {
  const [card, setCard] = useState<FeaturedCard | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("@/engine/buffs/library"),
      import("@/engine/nerfs/library"),
      import("@/lib/cardCodex"),
      import("@/lib/cardIcon"),
    ])
      .then(([buffs, nerfs, codex, icon]) => {
        if (cancelled) return;
        const day = Math.floor(Date.now() / 86_400_000);
        const pool = buffs.ALL_BUFFS.filter((b) => b.implemented && b.tier >= 3 && b.tier <= 8);
        const useNerf = day % 5 === 0;
        if (useNerf) {
          const ns = nerfs.PLAYABLE_NERFS;
          const n = ns[day % ns.length];
          setCard({
            kind: "nerf",
            id: n.id,
            name: n.name,
            tier: n.tier,
            description: n.description,
            href: codex.nerfPath(n.id),
            Icon: icon.nerfFaceIcon(n.id, n.icon) ?? Sparkles,
          });
        } else {
          const b = pool[day % pool.length];
          setCard({
            kind: "buff",
            id: b.id,
            name: b.name,
            tier: b.tier,
            description: b.description,
            href: codex.cardPath(b),
            Icon: icon.cardFaceIcon(b.id, b.category, b.icon) ?? Sparkles,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setCard(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (card === null) return null;
  return (
    <div className="plate p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] uppercase tracking-[0.05em] text-parchment-400">Card of the day</h2>
        <Link href="/codex" className="-my-1 inline-flex min-h-[44px] items-center text-[13px] text-parchment-400 no-underline hover:text-parchment-100 [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:my-0">
          Codex »
        </Link>
      </div>
      {card === undefined ? (
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="skeleton h-10 w-10" />
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-4 w-full" />
        </div>
      ) : (
        <Link href={card.href} className="mt-3 block no-underline">
          <div className="flex items-center gap-3">
            <span className={`grid h-[44px] w-[44px] shrink-0 place-items-center border tier-bg-${card.tier} tier-${card.tier}`}>
              <card.Icon size={22} strokeWidth={1.6} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] text-parchment-50">{card.name}</span>
              <span className="block text-[13px] text-parchment-400">
                {card.kind === "nerf" ? "Nerf" : "Buff"} · Tier {TIER_ROMAN[card.tier]}
              </span>
            </span>
          </div>
          <p className="mt-3 text-[13px] leading-snug text-parchment-300">{card.description}</p>
        </Link>
      )}
    </div>
  );
}

function resultLabel(winner: "w" | "b" | "draw" | null): string {
  if (winner === "w") return "1-0";
  if (winner === "b") return "0-1";
  if (winner === "draw") return "½-½";
  return "·";
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

function SiteFooter() {
  const footerLinks = [
    { href: "/about", label: "About" },
    { href: "/faq", label: "FAQ" },
    { href: "/contact", label: "Contact" },
    { href: "/guidelines", label: "Guidelines" },
    { href: "/privacy-policy", label: "Privacy" },
    { href: "/terms-of-service", label: "Terms" },
  ];

  return (
    <footer className="mx-auto mt-12 w-full max-w-[1300px] px-3 pb-8 sm:px-5">
      {/* This is a local copy of the site footer, and it had drifted below the
          shared one in components/SiteFooter.tsx: 12px links with no tap
          target, where the shared footer is 13px with 44px targets. Footer
          links are nav links, not captions, so they take the same treatment
          here. Height comes from a min-height that relaxes behind
          (pointer: fine), so the desktop row keeps its density. */}
      <div className="flex flex-col gap-3 border-t border-[color:var(--edge)] pt-4 text-[13px] text-parchment-400 sm:flex-row sm:items-center sm:justify-between">
        {/* Height was fixed here already; WIDTH was not, so "FAQ" was a
            24.7px-wide target that happened to be 44px tall. The shared footer
            solved this with px-3 and this copy never picked it up.
            The padding cannot come out of the existing 16px gap without the
            neighbouring hit areas overlapping (12px each side into a 16px gap),
            and no padding that fits inside that gap gets a 24.7px word to 44.
            So on a coarse pointer the links get their padding and the gap
            shrinks to compensate, and on a fine pointer both revert exactly to
            what this footer looked like before. */}
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center gap-x-1 gap-y-1 [@media(pointer:fine)]:gap-x-4"
        >
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="-my-1 inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-3 no-underline transition-colors hover:text-parchment-100 [@media(pointer:fine)]:my-0 [@media(pointer:fine)]:min-h-0 [@media(pointer:fine)]:min-w-0 [@media(pointer:fine)]:px-0"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <SocialsRow label="" className="" variant="quiet" />
      </div>
      <div className="mt-2 flex items-center justify-between text-[12px] text-parchment-500">
        <span>Nerf Chess</span>
        <BuildVersionLabel />
      </div>
    </footer>
  );
}

// The deployed build stamp: moderators and admins only.
function BuildVersionLabel() {
  const [isModerator, setIsModerator] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled || !me || me.isGuest) return;
      if (me.role === "mod" || me.role === "admin") setIsModerator(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const version = process.env.NEXT_PUBLIC_BUILD_VERSION ?? "";
  if (!isModerator || !version) return null;
  return (
    <span className="font-mono text-[12px] opacity-70" title="Deployed version">
      {version}
    </span>
  );
}
