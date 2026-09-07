"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Crown, Flame, LogIn, LogOut, Swords, Timer, Trophy, Users } from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerLink } from "@/components/PlayerLink";
import { SiteHeader } from "@/components/SiteHeader";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { AccountUser, fetchMe } from "@/lib/authClient";
import { saveOnlineSeat } from "@/lib/multiplayer";
import type {
  MyTournamentGame,
  StandingRow,
  TournamentDetail,
  TournamentRoundGame,
} from "@/app/api/tournaments/[id]/route";
import {
  clockLabel,
  countdownLabel,
  durationLabel,
  formatLabel,
  modeLabel,
  tournamentPhase,
} from "@/lib/tournaments";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

type DetailResponse = {
  tournament: TournamentDetail;
  standings: StandingRow[];
  entered: boolean;
  rounds: TournamentRoundGame[];
  myGame: MyTournamentGame | null;
};

const MEDALS = ["#d8b56e", "#c7c5c1", "#c79468"]; // gold, silver, bronze

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [me, setMe] = useState<AccountUser | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Request sequence: only the newest in-flight load may set state, so a
  // stale poll (or one that resolves after unmount) never lands.
  const loadReqRef = useRef(0);
  const load = useCallback(async () => {
    const req = ++loadReqRef.current;
    const res = await fetch(`/api/tournaments/${encodeURIComponent(id)}`);
    if (!res.ok) {
      throw new Error(res.status === 404 ? "That tournament doesn't exist." : "Could not load the tournament.");
    }
    const body = (await res.json()) as DetailResponse;
    if (req !== loadReqRef.current) return;
    setData(body);
    // A poll that recovers after a failed one clears the error banner.
    setError(null);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    // The ref object itself (not .current) is stable; aliased so the cleanup
    // can invalidate any load still in flight.
    const reqRef = loadReqRef;
    void (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the tournament.");
      }
    })();
    fetchMe().then((u) => !cancelled && setMe(u ?? null));
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      reqRef.current++;
      window.clearInterval(tick);
    };
  }, [load]);

  const t = data?.tournament;
  // Recompute the phase against the live clock so the page transitions on its
  // own, rather than trusting the snapshot the server returned. A tournament
  // that played out its configured rounds finishes early, so the stored
  // status wins over the clock.
  const phase = useMemo(
    () =>
      t
        ? t.status === "finished"
          ? "finished"
          : tournamentPhase(t.starts_at, t.duration_min, now)
        : "upcoming",
    [t, now],
  );

  // While the event is live (or about to start), poll the detail API. The
  // tournament engine advances lazily on read, so this poll IS the round
  // driver: it collects finished results, pairs the next round, and delivers
  // this player's seat when their game is ready.
  useEffect(() => {
    if (phase === "finished") return;
    const poll = window.setInterval(() => {
      load().catch(() => {});
    }, 10_000);
    return () => window.clearInterval(poll);
  }, [load, phase]);

  // Claim my seat (the token the server handed only to me) and go play.
  const playMyGame = useCallback(() => {
    const g = data?.myGame;
    if (!g) return;
    saveOnlineSeat(g.gameId, { color: g.color, token: g.token });
    router.push(`/game/${encodeURIComponent(g.gameId)}`);
  }, [data?.myGame, router]);

  const entry = async (action: "join" | "withdraw") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/${encodeURIComponent(id)}/entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "That didn't work.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <main className="min-h-screen">
        <SiteHeader active="/tournaments" />
        <section className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-parchment-300">{error}</p>
          <LinkButton tone="ghost" href="/tournaments" className="mt-4 inline-block px-4 py-2 text-sm">
            Back to tournaments
          </LinkButton>
        </section>
      </main>
    );
  }

  const standings = data?.standings ?? [];
  const entered = data?.entered ?? false;
  const podium = phase === "finished" ? standings.slice(0, 3) : [];

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader active="/tournaments" />
      <section className="mx-auto max-w-6xl px-5 sm:px-6">
        {!t ? (
          // Same gap as /clubs/[slug]: loading.tsx has the heading, but a
          // client-side navigation from /tournaments never renders it, so the
          // page's own in-flight branch has to carry one. Generic until the
          // real name arrives. Not used as a Suspense fallback, so it never
          // doubles up with another heading.
          <>
            <h1 className="sr-only">Tournament</h1>
            <p className="py-16 text-center text-sm text-parchment-400">Loading...</p>
          </>
        ) : (
          <>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                {/* One crumb, but through the shared trail rather than a
                    fourth hand-rolled one: the link measured 75.1x18 on a
                    coarse pointer and Breadcrumbs already owns the 44px hit
                    area (and steps it back down only behind pointer:fine). */}
                <div className="flex items-center gap-2 text-parchment-400">
                  <Trophy size={13} className="shrink-0 text-gold-leaf" aria-hidden />
                  <Breadcrumbs items={[{ label: "Tournaments", href: "/tournaments" }]} />
                </div>
                <h1 className="mt-1 break-words page-title">{t.name}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ModeTag mode={t.mode} />
                  <span className="border border-[color:var(--edge)] px-2 py-0.5 font-mono text-xs text-parchment-200">
                    {clockLabel(t.clock_time_sec, t.clock_increment_sec)}
                  </span>
                  <span className="border border-[color:var(--edge)] px-2 py-0.5 text-[12px] text-parchment-300">
                    {formatLabel(t.format)}
                  </span>
                  <span
                    className={
                      "border px-2 py-0.5 text-[12px] " +
                      (t.rated ? "border-[color:var(--edge-strong)] text-gold-leaf" : "border-[color:var(--edge)] text-parchment-400")
                    }
                  >
                    {t.rated ? "Rated" : "Casual"}
                  </span>
                  {t.club_name && t.club_id && (
                    <Link
                      href={`/clubs`}
                      className="border border-[color:var(--edge)] px-2 py-0.5 text-[13px] text-parchment-300 hover:text-gold-leaf"
                    >
                      {t.club_name}
                    </Link>
                  )}
                </div>
              </div>

              {/* Join / withdraw */}
              <div className="flex flex-col items-end gap-1">
                {me === undefined ? null : phase === "finished" ? (
                  <span className="text-[12px] text-parchment-500">Event over</span>
                ) : !me ? (
                  <LinkButton tone="leaf"
                    href={`/login?next=/tournaments/${encodeURIComponent(id)}`}
                    className="flex px-5 py-2.5 text-sm font-semibold">
                    <LogIn size={15} /> Sign in to join
                  </LinkButton>
                ) : entered ? (
                  <Button tone="ghost"
                    onClick={() => entry("withdraw")}
                    disabled={busy}
                    className="flex px-5 py-2.5 text-sm disabled:opacity-50">
                    <LogOut size={15} /> Withdraw
                  </Button>
                ) : (
                  <Button tone="cta"
                    onClick={() => entry("join")}
                    disabled={busy}
                    className="flex px-6 py-2.5 text-sm font-semibold disabled:opacity-50">
                    <LogIn size={15} /> Join
                  </Button>
                )}
                {entered && phase !== "finished" && (
                  <span className="text-[12px] text-verdigris-glow">You are in</span>
                )}
              </div>
            </div>

            {error && (
              <div className="mt-5 plate border-oxblood-glow/60 bg-oxblood/15 px-4 py-3 text-sm text-parchment">
                {error}
              </div>
            )}

            {/* Countdown / status banner */}
            <Countdown t={t} phase={phase} now={now} />

            {/* My pending game: the seat token travels only to its owner. */}
            {data?.myGame && phase === "ongoing" && (
              <div className="mt-4 plate flex flex-wrap items-center justify-between gap-3 border-verdigris/40 px-5 py-4">
                <div className="flex items-center gap-3">
                  <Swords size={20} className="shrink-0 text-verdigris-glow" aria-hidden />
                  <div>
                    <div className="text-[12px] text-parchment-400">Round {data.myGame.round}</div>
                    <div className="text-sm text-parchment-100">
                      Your game is ready. You play {data.myGame.color === "w" ? "white" : "black"}.
                    </div>
                  </div>
                </div>
                <Button tone="cta" onClick={playMyGame} className="px-6 py-2.5 text-sm font-semibold">
                  Play your game
                </Button>
              </div>
            )}

            {t.description && <p className="mt-4 max-w-3xl text-parchment-300">{t.description}</p>}

            <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              {/* Standings */}
              <div className="min-w-0 space-y-4">
                {podium.length > 0 && <Podium podium={podium} />}

                {(data?.rounds.length ?? 0) > 0 && (
                  <Rounds rounds={data!.rounds} currentRound={t.current_round} phase={phase} meId={me?.id ?? null} />
                )}

                <div className="plate overflow-hidden">
                  <div className="flex items-center justify-between gap-2 border-b border-[color:var(--edge)] px-5 py-3">
                    <span className="text-[12px] text-parchment-400">Standings</span>
                    <span className="flex items-center gap-1.5 text-[12px] text-parchment-500">
                      <Users size={12} /> {standings.length}/{t.max_players}
                    </span>
                  </div>
                  {standings.length === 0 ? (
                    <p className="px-5 py-8 text-sm text-parchment-400">
                      No players yet. {phase !== "finished" ? "Be the first to join." : ""}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[color:var(--edge)] text-left text-[12px] text-parchment-500">
                            <th scope="col" className="px-3 py-2 text-right font-medium">
                              #
                            </th>
                            <th scope="col" className="px-2 py-2 font-medium">
                              Player
                            </th>
                            <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                              Rating
                            </th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">
                              Score
                            </th>
                            <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                              Perf
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[color:var(--edge)]">
                          {standings.map((s, i) => {
                            const isMe = me?.id === s.user_id;
                            const isCreator = s.user_id === t.creator_user_id;
                            return (
                              <tr key={s.user_id} className={isMe ? "bg-[color:var(--bg-raised)]" : "transition-colors hover:bg-[color:var(--bg-raised)]"}>
                                <td className="px-3 py-2 text-right font-mono text-xs text-parchment-500">{i + 1}</td>
                                <td className="px-2 py-2">
                                  <div className="flex items-center gap-2.5">
                                    {/* Through PlayerLink, not a hand-spelled
                                        anchor: this one measured 66.1x18 on a
                                        coarse pointer precisely because it did
                                        not go through the shared component, so
                                        the fix that landed there never reached
                                        it. The avatar moves inside the link,
                                        which makes it part of the target. */}
                                    <PlayerLink
                                      name={s.username}
                                      avatar={s.avatar}
                                      avatarSize={26}
                                      className="min-w-0 text-parchment-100 hover:text-gold-leaf"
                                    />
                                    {s.flair && <span aria-hidden>{s.flair}</span>}
                                    {isCreator && <Crown size={12} className="shrink-0 text-gold-leaf" aria-label="Host" />}
                                    {s.streak >= 3 && <Flame size={12} className="shrink-0 text-oxblood-glow" aria-label="On a streak" />}
                                  </div>
                                </td>
                                <td className="hidden px-3 py-2 text-right font-mono text-xs text-parchment-400 sm:table-cell">
                                  {Math.round(s.rating)}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-sm font-semibold text-parchment-50">
                                  {s.score}
                                </td>
                                <td className="hidden px-3 py-2 text-right font-mono text-xs text-parchment-400 sm:table-cell">
                                  {s.performance != null ? Math.round(s.performance) : "-"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="border-t border-[color:var(--edge)] px-5 py-2.5 text-[12px] text-parchment-500">
                    Swiss pairing by score, then rating. Win 1 point, draw 0.5, bye 1. Rounds pair
                    automatically while the event runs.
                  </p>
                </div>
              </div>

              {/* Info sidebar */}
              <aside className="space-y-4">
                <div className="plate overflow-hidden">
                  <div className="border-b border-[color:var(--edge)] px-5 py-3 text-[12px] text-parchment-400">
                    Details
                  </div>
                  <dl className="divide-y divide-[color:var(--edge)]">
                    <InfoRow label="Time control" value={clockLabel(t.clock_time_sec, t.clock_increment_sec)} mono />
                    <InfoRow label="Mode" value={modeLabel(t.mode)} />
                    <InfoRow label="Rated" value={t.rated ? "Yes" : "Casual"} />
                    <InfoRow label="Format" value={formatLabel(t.format)} />
                    <InfoRow label="Duration" value={durationLabel(t.duration_min)} />
                    <InfoRow
                      label="Starts"
                      value={t.starts_at ? new Date(t.starts_at).toLocaleString() : "To be announced"}
                    />
                    <InfoRow label="Entrants" value={`${standings.length} / ${t.max_players}`} />
                  </dl>
                </div>

                <div className="plate px-5 py-4">
                  <div className="text-[12px] text-parchment-400">Host</div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-sm text-parchment-100">
                    <Crown size={13} className="shrink-0 text-gold-leaf" aria-hidden />
                    <PlayerLink
                      name={t.creator_name}
                      className="min-w-0 hover:text-gold-leaf"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-[12px] text-parchment-500">
                    <CalendarDays size={12} /> Created {new Date(t.created_at).toLocaleDateString()}
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function Countdown({ t, phase, now }: { t: TournamentDetail; phase: string; now: number }) {
  const endsAt = t.starts_at == null ? null : t.starts_at + t.duration_min * 60_000;

  let kicker: string;
  let big: string;
  let tone = "text-parchment-50";
  if (phase === "ongoing" && endsAt != null) {
    kicker = "In progress";
    big = `${countdownLabel(endsAt - now)} left`;
    tone = "text-verdigris-glow";
  } else if (phase === "finished") {
    kicker = "Finished";
    big = t.starts_at ? new Date(t.starts_at).toLocaleDateString() : "Completed";
    tone = "text-parchment-300";
  } else if (t.starts_at == null) {
    kicker = "Starting";
    big = "Date to be announced";
  } else {
    kicker = "Starts in";
    big = countdownLabel(t.starts_at - now);
    tone = "text-gold-leaf";
  }

  return (
    <div className="mt-5 plate flex items-center gap-4 px-5 py-4">
      <Timer size={22} className="shrink-0 text-parchment-400" aria-hidden />
      <div>
        <div className="text-[12px] text-parchment-400">{kicker}</div>
        <div className={"font-display text-2xl tabular-nums sm:text-3xl " + tone} aria-live="polite">
          {big}
        </div>
      </div>
    </div>
  );
}

function Podium({ podium }: { podium: StandingRow[] }) {
  // Classic center-tall arrangement: silver, gold, bronze.
  const order = [podium[1], podium[0], podium[2]].filter(Boolean) as StandingRow[];
  const rankOf = (s: StandingRow) => podium.indexOf(s);
  return (
    <div className="plate px-5 py-6">
      <div className="mb-4 flex items-center gap-2 text-[12px] text-parchment-400">
        <Trophy size={13} className="text-gold-leaf" /> Podium
      </div>
      <div className="flex items-end justify-center gap-4 sm:gap-8">
        {order.map((s) => {
          const rank = rankOf(s);
          const size = rank === 0 ? 64 : 48;
          return (
            <div key={s.user_id} className="flex flex-col items-center gap-1.5">
              <span className="font-display text-lg" style={{ color: MEDALS[rank] }}>
                {rank + 1}
              </span>
              <PlayerAvatar name={s.username} avatar={s.avatar} size={size} />
              <PlayerLink
                name={s.username}
                className="max-w-[6rem] text-sm text-parchment-100 hover:text-gold-leaf"
              />
              <span className="font-mono text-xs text-parchment-400">{s.score} pts</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Per-round pairings: players, live-game links, results. Rows come from the
// detail API newest round first; each round renders as its own block inside
// one plate so the current round leads.
function Rounds({
  rounds,
  currentRound,
  phase,
  meId,
}: {
  rounds: TournamentRoundGame[];
  currentRound: number;
  phase: string;
  meId: string | null;
}) {
  const byRound = useMemo(() => {
    const grouped = new Map<number, TournamentRoundGame[]>();
    for (const g of rounds) {
      const list = grouped.get(g.round) ?? [];
      list.push(g);
      grouped.set(g.round, list);
    }
    return [...grouped.entries()].sort((a, b) => b[0] - a[0]);
  }, [rounds]);

  return (
    <div className="plate overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--edge)] px-5 py-3">
        <span className="flex items-center gap-1.5 text-[12px] text-parchment-400">
          <Swords size={12} /> Pairings
        </span>
        <span className="text-[12px] text-parchment-500">
          Round {currentRound}
          {phase === "ongoing" ? " in progress" : ""}
        </span>
      </div>
      {byRound.map(([round, games]) => (
        <div key={round}>
          <div className="border-b border-[color:var(--edge)] bg-[color:var(--bg-zebra)] px-5 py-2 text-[12px] text-parchment-500">
            Round {round}
          </div>
          <ul className="divide-y divide-[color:var(--edge)]">
            {games.map((g) => {
              const mine = meId != null && (g.white_user_id === meId || g.black_user_id === meId);
              return (
                <li
                  key={`${round}-${g.board}`}
                  className={"flex items-center gap-3 px-5 py-2.5 " + (mine ? "bg-[color:var(--bg-raised)]" : "")}
                >
                  {g.black_user_id == null ? (
                    <span className="min-w-0 flex-1 truncate text-sm text-parchment-300">
                      {g.white_username} has a bye
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm text-parchment-100">
                      {g.white_username}
                      <span className="px-1.5 text-parchment-500">vs</span>
                      {g.black_username}
                    </span>
                  )}
                  <ResultBadge result={g.result} />
                  {g.game_id && (
                    <LinkButton tone="quiet" size="xs" href={`/game/${encodeURIComponent(g.game_id)}`}>
                      {g.result == null ? "Watch" : "Replay"}
                    </LinkButton>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ResultBadge({ result }: { result: string | null }) {
  const [label, cls] =
    result == null
      ? ["In play", "border-verdigris/40 text-verdigris-glow"]
      : result === "w"
        ? ["1-0", "border-[color:var(--edge)] text-parchment-100"]
        : result === "b"
          ? ["0-1", "border-[color:var(--edge)] text-parchment-100"]
          : result === "draw"
            ? ["1/2-1/2", "border-[color:var(--edge)] text-parchment-300"]
            : result === "bye"
              ? ["+1", "border-[color:var(--edge-strong)] text-gold-leaf"]
              : ["Void", "border-[color:var(--edge)] text-parchment-500"];
  return (
    <span className={"shrink-0 border px-1.5 py-0.5 font-mono text-[12px] " + cls}>{label}</span>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <dt className="text-[12px] text-parchment-500">{label}</dt>
      <dd className={"text-sm text-parchment-100 " + (mono ? "font-mono" : "")}>{value}</dd>
    </div>
  );
}

function ModeTag({ mode }: { mode: string }) {
  const cls = mode === "buff" ? "border-mode-buff/40 text-mode-buffGlow" : "border-mode-nerf/40 text-mode-nerfGlow";
  return <span className={"border px-2 py-0.5 text-[12px] " + cls}>{modeLabel(mode)}</span>;
}
