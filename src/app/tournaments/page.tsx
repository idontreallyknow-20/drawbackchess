"use client";

import { SiteHeader } from "@/components/SiteHeader";
import { AccountUser, fetchMe } from "@/lib/authClient";
import type { TournamentListRow } from "@/app/api/tournaments/route";
import {
  clockLabel,
  countdownLabel,
  durationLabel,
  formatLabel,
  modeLabel,
  TOURNAMENT_FORMATS,
} from "@/lib/tournaments";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, Trophy, Users, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

interface Club {
  id: string;
  name: string;
}

// Common arena clocks, offered as chips so creating an event is a couple of
// clicks rather than raw seconds entry.
const CLOCK_PRESETS: { label: string; t: number; i: number }[] = [
  { label: "1+0", t: 60, i: 0 },
  { label: "2+1", t: 120, i: 1 },
  { label: "3+0", t: 180, i: 0 },
  { label: "3+2", t: 180, i: 2 },
  { label: "5+0", t: 300, i: 0 },
  { label: "5+3", t: 300, i: 3 },
  { label: "10+0", t: 600, i: 0 },
  { label: "15+10", t: 900, i: 10 },
];
const DURATION_PRESETS = [20, 30, 45, 60, 90, 120];

const INPUT_CLASS =
  "mt-1 w-full border border-[color:var(--edge)] bg-[color:var(--bg-base)] px-3 py-2 text-[13px] text-parchment";
const LABEL_CLASS = "block text-[12px] font-medium text-parchment-400";

function ModeTag({ mode }: { mode: string }) {
  const cls = mode === "buff" ? "border-mode-buff/40 text-mode-buffGlow" : "border-mode-nerf/40 text-mode-nerfGlow";
  return (
    <span className={"border px-1.5 py-0.5 text-[12px] font-medium " + cls}>{modeLabel(mode)}</span>
  );
}

export default function TournamentsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [tournaments, setTournaments] = useState<TournamentListRow[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Create form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState("arena");
  const [mode, setMode] = useState("nerf");
  const [rated, setRated] = useState(false);
  const [clockIdx, setClockIdx] = useState(2);
  const [durationMin, setDurationMin] = useState(60);
  // 0 = as many rounds as fit the duration; the engine stops either way.
  const [roundsTotal, setRoundsTotal] = useState(0);
  const [clubId, setClubId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(16);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The form's own error: a refused create must not blank the directory,
  // which renders nothing while the load error above is set.
  const [createError, setCreateError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [tournamentRes, clubRes] = await Promise.all([fetch("/api/tournaments"), fetch("/api/clubs")]);
    if (!tournamentRes.ok) throw new Error("Could not load tournaments.");
    const tournamentData = (await tournamentRes.json()) as { tournaments: TournamentListRow[] };
    setTournaments(tournamentData.tournaments);
    if (clubRes.ok) {
      const clubData = (await clubRes.json()) as { clubs: Club[] };
      setClubs(clubData.clubs);
    }
  };

  // Retry from the error state: clear the message, drop back to the loading
  // skeleton, and refetch. Wired to the Retry button so a recovered network
  // fills the directory in place instead of dead-ending on the banner.
  const reload = () => {
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load tournaments.");
      } finally {
        setLoading(false);
      }
    })();
  };

  useEffect(() => {
    let cancelled = false;
    const initialClub = new URLSearchParams(window.location.search).get("club");
    if (initialClub) queueMicrotask(() => setClubId(initialClub));
    fetchMe().then((me) => !cancelled && setUser(me));
    void (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load tournaments.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, []);

  // Re-bucket on every tick so an event slides from "starting soon" into "in
  // progress" and then "finished" on its own, without a reload.
  const sections = useMemo(() => {
    const ongoing: TournamentListRow[] = [];
    const upcoming: TournamentListRow[] = [];
    const finished: TournamentListRow[] = [];
    for (const t of tournaments) {
      const endsAt = t.starts_at == null ? null : t.starts_at + t.duration_min * 60_000;
      // The engine finishes an event early once its configured rounds are
      // played, so the stored status wins over the clock.
      if (t.status === "finished") finished.push(t);
      else if (t.starts_at != null && now >= t.starts_at && endsAt != null && now < endsAt) ongoing.push(t);
      else if (endsAt != null && now >= endsAt) finished.push(t);
      else upcoming.push(t);
    }
    const soonest = (a: TournamentListRow, b: TournamentListRow) =>
      (a.starts_at ?? Number.MAX_SAFE_INTEGER) - (b.starts_at ?? Number.MAX_SAFE_INTEGER);
    ongoing.sort(soonest);
    upcoming.sort(soonest);
    finished.sort((a, b) => (b.starts_at ?? b.created_at) - (a.starts_at ?? a.created_at));
    return { ongoing, upcoming, finished };
  }, [tournaments, now]);

  const selectedClubName = useMemo(
    () => clubs.find((club) => club.id === clubId)?.name ?? null,
    [clubId, clubs],
  );

  const createTournament = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 3) return;
    setBusy(true);
    setCreateError(null);
    try {
      const preset = CLOCK_PRESETS[clockIdx] ?? CLOCK_PRESETS[2];
      const starts = startsAt ? new Date(startsAt).getTime() : null;
      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          format,
          mode,
          rated,
          clockTimeSec: preset.t,
          clockIncrementSec: preset.i,
          durationMin,
          roundsTotal,
          clubId: clubId || null,
          startsAt: starts != null && Number.isFinite(starts) ? starts : null,
          maxPlayers,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { tournament?: TournamentListRow; error?: string };
      if (!res.ok || !data.tournament) throw new Error(data.error || "Could not create tournament.");
      setShowCreate(false);
      router.push(`/tournaments/${encodeURIComponent(data.tournament.id)}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create tournament.");
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader active="/tournaments" />

      <section className="mx-auto max-w-4xl px-5 pt-6 sm:px-6 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Tournaments</h1>
            <p className="mt-2 text-[13px] text-parchment-300">Scheduled arenas for the Nerfchess ladder.</p>
          </div>
          <div className="flex items-center gap-2">
            <LinkButton tone="ghost" href="/clubs" className="px-4 py-2 text-[13px]">
              Clubs
            </LinkButton>
            <Button tone="leaf"
             
              onClick={() => setShowCreate((v) => !v)}
              aria-expanded={showCreate}
              className="px-4 py-2 text-[13px] font-semibold">
              {showCreate ? <X size={15} /> : <Plus size={15} />}
              {showCreate ? "Close" : "New tournament"}
            </Button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-5 plate flex flex-col gap-3 border-oxblood-glow/60 bg-oxblood/15 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="text-[13px] text-parchment">{error}</span>
            <div className="flex shrink-0 items-center gap-2">
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
        )}

        {/* Directory leads; creation is a disclosure opened from the header. */}
        {showCreate && (
          <form onSubmit={createTournament} className="mt-5 plate p-5">
            <div className="font-display text-xl text-parchment">Create tournament</div>
            {createError && (
              <div className="mt-3 border border-oxblood-glow/60 bg-oxblood/15 px-3 py-2 text-[13px] text-parchment">
                {createError}
              </div>
            )}
            {user === undefined ? (
              <p className="mt-4 text-sm text-parchment-400">Checking account...</p>
            ) : !user ? (
              <p className="mt-4 text-sm text-parchment-400">
                <Link href="/login?next=/tournaments" className="text-gold-leaf hover:underline">
                  Sign in
                </Link>{" "}
                to create a tournament.
              </p>
            ) : (
              <>
                <label className="mt-4 block text-[12px] font-medium text-parchment-400" htmlFor="t-name">
                  Name
                </label>
                <input id="t-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={70} className={INPUT_CLASS} />

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL_CLASS} htmlFor="t-format">
                      Format
                    </label>
                    <select id="t-format" value={format} onChange={(e) => setFormat(e.target.value)} className={INPUT_CLASS}>
                      {TOURNAMENT_FORMATS.map((value) => (
                        <option key={value} value={value}>
                          {formatLabel(value)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS} htmlFor="t-mode">
                      Mode
                    </label>
                    <select id="t-mode" value={mode} onChange={(e) => setMode(e.target.value)} className={INPUT_CLASS}>
                      <option value="nerf">Nerf</option>
                      <option value="buff">Buff</option>
                    </select>
                  </div>
                </div>

                <label className="mt-3 block text-[12px] font-medium text-parchment-400">Time control</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {CLOCK_PRESETS.map((preset, i) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setClockIdx(i)}
                      aria-pressed={clockIdx === i}
                      className={
                        "min-h-[44px] [@media(pointer:fine)]:min-h-0 border px-2.5 py-1 font-mono text-xs transition-colors " +
                        (clockIdx === i
                          ? "border-[color:var(--edge-strong)] bg-[color:var(--bg-raised)] text-gold-leaf"
                          : "border-[color:var(--edge)] text-parchment-300 hover:border-[color:var(--edge-strong)]")
                      }
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={LABEL_CLASS} htmlFor="t-duration">
                      Duration
                    </label>
                    <select
                      id="t-duration"
                      value={durationMin}
                      onChange={(e) => setDurationMin(Number(e.target.value))}
                      className={INPUT_CLASS}
                    >
                      {DURATION_PRESETS.map((min) => (
                        <option key={min} value={min}>
                          {durationLabel(min)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS} htmlFor="t-rounds">
                      Rounds
                    </label>
                    <select
                      id="t-rounds"
                      value={roundsTotal}
                      onChange={(e) => setRoundsTotal(Number(e.target.value))}
                      className={INPUT_CLASS}
                    >
                      <option value={0}>As many as fit</option>
                      {[3, 4, 5, 6, 7, 8, 9].map((n) => (
                        <option key={n} value={n}>
                          {n} rounds
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS} htmlFor="t-max">
                      Seats
                    </label>
                    <input
                      id="t-max"
                      type="number"
                      min={2}
                      max={256}
                      value={maxPlayers}
                      onChange={(e) => setMaxPlayers(Number(e.target.value))}
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <label className="mt-3 block text-[12px] font-medium text-parchment-400" htmlFor="t-start">
                  Starts (optional)
                </label>
                <input
                  id="t-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className={INPUT_CLASS}
                />

                {clubs.length > 0 && (
                  <>
                    <label className="mt-3 block text-[12px] font-medium text-parchment-400" htmlFor="t-club">
                      Club
                    </label>
                    <select id="t-club" value={clubId} onChange={(e) => setClubId(e.target.value)} className={INPUT_CLASS}>
                      <option value="">Open event</option>
                      {clubs.map((club) => (
                        <option key={club.id} value={club.id}>
                          {club.name}
                        </option>
                      ))}
                    </select>
                    {selectedClubName && (
                      <p className="mt-1 text-[12px] text-parchment-400">Members of {selectedClubName} only.</p>
                    )}
                  </>
                )}

                <label className="mt-3 flex items-center gap-2 text-sm text-parchment-200">
                  <input type="checkbox" checked={rated} onChange={(e) => setRated(e.target.checked)} className="h-4 w-4" />
                  Rated
                </label>

                <label className="mt-3 block text-[12px] font-medium text-parchment-400" htmlFor="t-desc">
                  Description
                </label>
                <textarea
                  id="t-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={280}
                  rows={3}
                  className={INPUT_CLASS + " resize-none"}
                />

                <Button tone="leaf"
                  type="submit"
                  disabled={busy || name.trim().length < 3}
                  className="mt-4 w-full px-4 py-2.5 text-[13px] font-semibold disabled:opacity-50">
                  {busy ? "Creating..." : "Create tournament"}
                </Button>
              </>
            )}
          </form>
        )}

        {/* Directory: in progress, starting soon, finished */}
        <div className="mt-6 min-w-0 space-y-4">
          {loading ? (
            <div className="plate overflow-hidden">
              <div className="border-b border-[color:var(--edge)] px-5 py-3 text-[12px] font-medium text-parchment-400">
                Loading events
              </div>
              <ul className="divide-y divide-[color:var(--edge)]" aria-hidden>
                {Array.from({ length: 3 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-4 px-5 py-4">
                    <div className="h-11 w-14 shrink-0 bg-[color:var(--bg-raised)] animate-pulse" />
                    <div className="min-w-0 flex-1">
                      <div className="h-3.5 w-44 bg-white/[0.07] animate-pulse" />
                      <div className="mt-2 h-3 w-32 bg-[color:var(--bg-raised)] animate-pulse" />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : error ? (
            // A load error owns the screen: the alert above is the single
            // state. The section bodies must NOT also render their "0 events"
            // empty states, which would falsely claim an empty (but healthy)
            // directory next to a "could not load" banner.
            null
          ) : (
            <>
              <Section title="In progress" accent tournaments={sections.ongoing} now={now} emptyText="No tournaments running right now." />
              <Section title="Starting soon" tournaments={sections.upcoming} now={now} emptyText="Nothing scheduled yet. Create the first event." />
              <Section title="Finished" tournaments={sections.finished} now={now} emptyText="No finished tournaments yet." muted />
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function Section({
  title,
  tournaments,
  now,
  emptyText,
  accent = false,
  muted = false,
}: {
  title: string;
  tournaments: TournamentListRow[];
  now: number;
  emptyText: string;
  accent?: boolean;
  muted?: boolean;
}) {
  // Hide the finished section entirely when empty to keep the page tight.
  if (muted && tournaments.length === 0) return null;
  return (
    <div className="plate overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--edge)] px-5 py-3">
        <span className="flex items-center gap-2 text-[12px] font-medium text-parchment-300">
          {accent && (
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--pos-rgb))] motion-safe:animate-pulse"
              aria-hidden
            />
          )}
          {title}
        </span>
        <span className="font-mono text-[12px] text-parchment-400 tabular-nums">
          {tournaments.length} event{tournaments.length === 1 ? "" : "s"}
        </span>
      </div>
      {tournaments.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <Trophy size={24} className="mx-auto text-parchment-500" aria-hidden />
          <p className="mt-2 text-[13px] text-parchment-400">{emptyText}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--edge)]">
          {tournaments.map((t) => (
            <TournamentRow key={t.id} t={t} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TournamentRow({ t, now }: { t: TournamentListRow; now: number }) {
  const endsAt = t.starts_at == null ? null : t.starts_at + t.duration_min * 60_000;
  let when: string;
  let whenClass = "text-parchment-400";
  if (t.status === "finished") {
    when = "Finished";
    whenClass = "text-parchment-500";
  } else if (t.starts_at == null) {
    when = "Start TBA";
  } else if (now < t.starts_at) {
    when = `in ${countdownLabel(t.starts_at - now)}`;
    whenClass = "text-gold-leaf";
  } else if (endsAt != null && now < endsAt) {
    when = `${countdownLabel(endsAt - now)} left`;
    whenClass = "text-verdigris-glow";
  } else {
    when = "Finished";
    whenClass = "text-parchment-500";
  }

  return (
    <li>
      <Link
        href={`/tournaments/${encodeURIComponent(t.id)}`}
        className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[color:var(--bg-raised)]"
      >
        <span
          aria-hidden
          className="grid h-11 w-14 shrink-0 place-items-center border border-[color:var(--edge)] bg-[color:var(--bg-base)] font-mono text-sm text-parchment-100"
        >
          {clockLabel(t.clock_time_sec, t.clock_increment_sec)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-lg text-parchment-50">{t.name}</span>
            <ModeTag mode={t.mode} />
            {t.rated ? (
              <span className="shrink-0 border border-[color:var(--edge-strong)] px-1.5 py-0.5 text-[12px] font-medium text-gold-leaf">Rated</span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[13px] font-medium text-parchment-400">
            {formatLabel(t.format)} · {durationLabel(t.duration_min)}
            {t.club_name ? ` · ${t.club_name}` : ""} · by {t.creator_name}
          </div>
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
          <span className={"font-mono text-[13px] tabular-nums " + whenClass}>{when}</span>
          <span className="flex items-center gap-1 font-mono text-[12px] text-parchment-500 tabular-nums">
            <Users size={12} /> {t.players}/{t.max_players}
          </span>
        </div>
      </Link>
    </li>
  );
}
