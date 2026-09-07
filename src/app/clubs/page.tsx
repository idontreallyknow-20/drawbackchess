"use client";

import { ClubIcon } from "@/components/ClubIcon";
import { SiteHeader } from "@/components/SiteHeader";
import { AccountUser, fetchMe } from "@/lib/authClient";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";

interface Club {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon?: string | null;
  owner_name: string;
  created_at: number;
  members: number;
  joined?: number;
}

export default function ClubsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The live directory leads the page; creation is a disclosure opened from the
  // header so the flat form never dominates the surface.
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/clubs");
    if (!res.ok) throw new Error("Could not load clubs.");
    const data = (await res.json()) as { clubs: Club[] };
    setClubs(data.clubs);
  };

  const reload = () => {
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        await load();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load clubs.");
      } finally {
        setLoading(false);
      }
    })();
  };

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => !cancelled && setUser(me));
    void (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load clubs.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const createClub = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clubs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const data = (await res.json().catch(() => ({}))) as { club?: Club; error?: string };
      if (!res.ok || !data.club) throw new Error(data.error || "Could not create club.");
      setShowCreate(false);
      router.push(`/clubs/${encodeURIComponent(data.club.slug)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create club.");
    } finally {
      setBusy(false);
    }
  };

  // Client-side filter over the already-fetched list, lichess-teams-style:
  // one search box narrows both "Your clubs" and the full directory. No new
  // API call; we just re-slice what we already have.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clubs;
    return clubs.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.owner_name.toLowerCase().includes(q),
    );
  }, [clubs, query]);

  const yourClubs = useMemo(() => filtered.filter((c) => !!c.joined), [filtered]);

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader active="/clubs" />

      <section className="mx-auto max-w-4xl px-5 pt-6 sm:px-6 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Clubs</h1>
            <p className="mt-2 text-[13px] text-parchment-300">Player groups for organizing games and events.</p>
          </div>
          <div className="flex items-center gap-2">
            <LinkButton tone="ghost" href="/tournaments" className="px-4 py-2 text-[13px]">
              Tournaments
            </LinkButton>
            <Button tone="leaf"
             
              onClick={() => setShowCreate((v) => !v)}
              aria-expanded={showCreate}
              className="px-4 py-2 text-[13px] font-semibold">
              {showCreate ? <X size={15} /> : <Plus size={15} />}
              {showCreate ? "Close" : "New club"}
            </Button>
          </div>
        </div>

        {/* Creation disclosure: a secondary panel that only opens on demand, so
            the live directory always leads the page. */}
        {showCreate && (
          <form onSubmit={createClub} className="mt-5 plate p-5">
            <div className="font-display text-xl text-parchment">Create club</div>
            {error && (
              <div className="mt-3 border border-oxblood-glow/60 bg-oxblood/15 px-3 py-2 text-[13px] text-parchment">
                {error}
              </div>
            )}
            {user === undefined ? (
              <p className="mt-4 text-[13px] text-parchment-400">Checking account...</p>
            ) : !user ? (
              <p className="mt-4 text-[13px] text-parchment-400">
                <Link href="/login?next=/clubs" className="text-gold-leaf hover:underline">
                  Sign in
                </Link>{" "}
                to create a club.
              </p>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-medium text-parchment-400" htmlFor="club-name">
                    Name
                  </label>
                  <input
                    id="club-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    className="mt-1 w-full border border-[color:var(--edge)] bg-[color:var(--bg-base)] px-3 py-2 text-[13px] text-parchment"
                  />
                </div>
                <div className="sm:row-span-2">
                  <label className="block text-[12px] font-medium text-parchment-400" htmlFor="club-description">
                    Description
                  </label>
                  <textarea
                    id="club-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={240}
                    rows={4}
                    className="mt-1 w-full resize-none border border-[color:var(--edge)] bg-[color:var(--bg-base)] px-3 py-2 text-[13px] text-parchment"
                  />
                </div>
                <Button tone="leaf"
                  type="submit"
                  disabled={busy || name.trim().length < 3}
                  className="h-fit w-full px-4 py-2.5 text-[13px] font-semibold disabled:opacity-50">
                  {busy ? "Creating..." : "Create club"}
                </Button>
              </div>
            )}
          </form>
        )}

        <div className="mt-6 min-w-0 space-y-4">
          {/* Search: filters the whole directory in place, like lichess's
              team search box at the top of the teams list. */}
          <SearchInput
            variant="plate"
            value={query}
            onChange={setQuery}
            label="Search clubs"
            placeholder="Search clubs by name, owner, or description"
          />

          {/* Your clubs: the memberships this account already holds, lifted
              to the top the way lichess surfaces "Your teams". */}
          {yourClubs.length > 0 && (
            <div className="plate overflow-hidden">
              <div className="border-b border-[color:var(--edge)] px-5 py-3 text-[12px] font-medium text-parchment-400">
                Your clubs
              </div>
              <ul className="divide-y divide-[color:var(--edge)]">
                {yourClubs.map((club) => (
                  <ClubRow key={club.id} club={club} />
                ))}
              </ul>
            </div>
          )}

          <div className="plate overflow-hidden">
            <div className="border-b border-[color:var(--edge)] px-5 py-3 text-[12px] font-medium text-parchment-400">
              {query ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}` : "All clubs"}
            </div>
            {loading ? (
              <ul className="divide-y divide-[color:var(--edge)]" aria-hidden>
                {Array.from({ length: 4 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-4 px-5 py-4">
                    <div className="h-[44px] w-[44px] shrink-0 bg-[color:var(--bg-raised)] animate-pulse" />
                    <div className="min-w-0 flex-1">
                      <div className="h-3.5 w-40 bg-white/[0.07] animate-pulse" />
                      <div className="mt-2 h-3 w-56 max-w-full bg-[color:var(--bg-raised)] animate-pulse" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : loadError ? (
              <div role="alert" className="px-5 py-8 text-center">
                <p className="text-[13px] text-parchment-200">{loadError}</p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <Button tone="leaf"
                   
                    onClick={reload}
                    className="px-4 py-2 text-[13px] font-semibold">
                    Retry
                  </Button>
                  <LinkButton tone="ghost" href="/lobby" className="px-4 py-2 text-[13px]">
                    Back to lobby
                  </LinkButton>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Users size={26} className="mx-auto text-parchment-500" aria-hidden />
                <p className="mt-2 text-[13px] text-parchment-300">
                  {clubs.length === 0 ? "No clubs yet. Start the first one." : "No clubs match that search."}
                </p>
                {clubs.length === 0 && !showCreate && (
                  <Button tone="leaf"
                   
                    onClick={() => setShowCreate(true)}
                    className="mt-3 px-4 py-2 text-[13px] font-semibold">
                    <Plus size={15} /> New club
                  </Button>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-[color:var(--edge)]">
                {filtered.map((club) => (
                  <ClubRow key={club.id} club={club} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

// One directory row, lichess-teams-style: the club's icon tile, its name with
// the description on a second line, the member count, and a chevron so the
// whole row obviously opens the club.
function ClubRow({ club }: { club: Club }) {
  return (
    <li>
      <Link
        href={`/clubs/${encodeURIComponent(club.slug)}`}
        className="group flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:bg-[color:var(--bg-raised)]"
      >
        <ClubIcon icon={club.icon} name={club.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-lg text-parchment-50 transition-colors group-hover:text-gold-leaf">
              {club.name}
            </span>
            {!!club.joined && (
              <span className="shrink-0 border border-[color:var(--edge-strong)] px-1.5 py-0.5 text-[12px] font-medium text-gold-leaf">
                Joined
              </span>
            )}
          </div>
          {club.description ? (
            <p className="mt-0.5 truncate text-[13px] text-parchment-300">{club.description}</p>
          ) : (
            <p className="mt-0.5 truncate text-[13px] italic text-parchment-500">No description.</p>
          )}
          <div className="mt-0.5 text-[12px] font-medium text-parchment-400">owner {club.owner_name}</div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[12px] text-parchment-400 tabular-nums">
          <Users size={13} />
          {club.members}
        </span>
        <ChevronRight
          size={16}
          className="shrink-0 text-parchment-500 transition-all group-hover:translate-x-0.5 group-hover:text-parchment-200"
          aria-hidden
        />
      </Link>
    </li>
  );
}
