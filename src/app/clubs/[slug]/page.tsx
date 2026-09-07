"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Crown, LogIn, LogOut, Paintbrush, Trash2, Trophy, Upload, Users } from "lucide-react";
import { ClubIcon, renderClubIconGlyph } from "@/components/ClubIcon";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { SiteHeader } from "@/components/SiteHeader";
import { AccountUser, fetchMe } from "@/lib/authClient";
import { CLUB_ICON_COLORS, CLUB_ICON_NAMES, encodeClubIcon, isUploadedClubIcon, parseClubIcon } from "@/lib/clubIcons";
import { fileToDataUrl } from "@/lib/imageUpload";
import type { ClubMemberRow, ClubPostRow, ClubTournamentRow } from "@/app/api/clubs/[slug]/route";
import { tournamentPhase } from "@/lib/tournaments";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

// Club home, lichess-teams-style: description and members on one side, the
// club's events and a members-only message board on the other.

type ClubDetail = {
  club: {
    id: string;
    slug: string;
    name: string;
    description: string;
    icon: string;
    owner_user_id: string;
    owner_name: string;
    created_at: number;
  };
  members: ClubMemberRow[];
  memberCount: number;
  posts: ClubPostRow[];
  tournaments: ClubTournamentRow[];
  myRole: string | null;
};

// Owner-only icon picker: a curated grid of emblem glyphs and a row of accent
// colors, saved to the club as one "iconName|colorId" string via
// PATCH /api/clubs/[slug].
function ClubIconPicker({
  slug,
  current,
  clubName,
  onSaved,
  onClose,
}: {
  slug: string;
  current: string;
  clubName: string;
  onSaved: (icon: string) => void;
  onClose: () => void;
}) {
  const parsed = parseClubIcon(current);
  const [iconName, setIconName] = useState(parsed?.name ?? CLUB_ICON_NAMES[0]);
  const [colorId, setColorId] = useState(parsed?.color.id ?? CLUB_ICON_COLORS[1].id);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(isUploadedClubIcon(current) ? current : null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (value: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/clubs/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icon: value }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Could not save the icon.");
      onSaved(value);
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save the icon.");
    } finally {
      setSaving(false);
    }
  };

  // Read a chosen file, downscale to a small square data URL on the client,
  // then upload it (the server re-validates MIME/size/dimensions). The client
  // budget stays well under the 1 MB server cap so club lists stay light.
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setSaveError(null);
    try {
      const dataUrl = await fileToDataUrl(file, { maxDim: 256, maxChars: 300_000, cover: true });
      setUploaded(dataUrl);
      await save(dataUrl);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not read that image.");
    }
  };

  return (
    <div className="plate mt-5 p-5">
      <div className="flex items-center gap-4">
        <ClubIcon icon={uploaded ?? encodeClubIcon(iconName, colorId)} name={clubName} size={56} />
        <div>
          <div className="font-display text-xl text-parchment">Club icon</div>
          <p className="mt-0.5 text-sm text-parchment-400">Pick an emblem and a color for {clubName}.</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-12">
        {CLUB_ICON_NAMES.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setIconName(e)}
            aria-label={`Icon ${e}`}
            aria-pressed={iconName === e}
            className={`grid h-10 w-full cursor-pointer place-items-center border transition-colors ${
              iconName === e
                ? "border-gold/70 bg-[color:var(--bg-raised)] text-gold-leaf"
                : "border-[color:var(--edge)] bg-[color:var(--bg-base)] text-parchment-200 hover:border-[color:var(--edge-strong)] hover:bg-[color:var(--bg-raised)]"
            }`}
          >
            {renderClubIconGlyph(e, 18)}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {CLUB_ICON_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setColorId(c.id)}
            aria-label={`Color ${c.label}`}
            aria-pressed={colorId === c.id}
            title={c.label}
            className={`h-10 w-10 sm:h-8 sm:w-8 cursor-pointer rounded-full border-2 transition-[border-color] duration-150 hover:border-parchment-300 ${
              colorId === c.id ? "border-parchment-50" : "border-transparent"
            }`}
            style={{ background: c.hex }}
          />
        ))}
      </div>

      {/* Custom image upload: an alternative to the curated emblem grid. */}
      <div className="mt-4 border-t border-[color:var(--edge)] pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button tone="ghost"
           
            onClick={() => fileRef.current?.click()}
            disabled={saving}
            className="flex px-4 py-2 text-sm disabled:opacity-50">
            <Upload size={14} /> Upload image
          </Button>
          <span className="text-xs text-parchment-500">PNG, JPEG, or WebP. Max 1 MB, 1024px.</span>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button tone="leaf"
         
          onClick={() => save(encodeClubIcon(iconName, colorId))}
          disabled={saving}
          className="px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {saving ? "Saving..." : "Save emblem"}
        </Button>
        {(parsed || uploaded) && (
          <Button tone="ghost"
           
            onClick={() => save("")}
            disabled={saving}
            className="px-4 py-2 text-sm disabled:opacity-50">
            Remove icon
          </Button>
        )}
        <Button tone="ghost" onClick={onClose} className="px-4 py-2 text-sm">
          Cancel
        </Button>
        {saveError && <span className="text-sm text-oxblood-glow">{saveError}</span>}
      </div>
    </div>
  );
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

export default function ClubPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [data, setData] = useState<ClubDetail | null>(null);
  const [me, setMe] = useState<AccountUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postText, setPostText] = useState("");
  const [postError, setPostError] = useState<string | null>(null);
  const [pickingIcon, setPickingIcon] = useState(false);

  // Request sequence: only the newest in-flight load may set state, so a
  // stale refresh (or one that resolves after unmount) never lands.
  const loadReqRef = useRef(0);
  const load = useCallback(async () => {
    const req = ++loadReqRef.current;
    const res = await fetch(`/api/clubs/${encodeURIComponent(slug)}`);
    if (!res.ok) {
      throw new Error(res.status === 404 ? "That club doesn't exist." : "Could not load the club.");
    }
    const body = (await res.json()) as ClubDetail;
    if (req !== loadReqRef.current) return;
    setData(body);
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    // The ref object itself (not .current) is stable; aliased so the cleanup
    // can invalidate any load still in flight.
    const reqRef = loadReqRef;
    void (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the club.");
      }
    })();
    fetchMe().then((u) => !cancelled && setMe(u ?? null));
    return () => {
      cancelled = true;
      reqRef.current++;
    };
  }, [load]);

  const membership = async (action: "join" | "leave") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clubs/${encodeURIComponent(slug)}/membership`, {
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

  const submitPost = async (event: FormEvent) => {
    event.preventDefault();
    if (!postText.trim()) return;
    setPostError(null);
    try {
      const res = await fetch(`/api/clubs/${encodeURIComponent(slug)}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: postText }),
      });
      const body = (await res.json().catch(() => ({}))) as { post?: ClubPostRow; error?: string };
      if (!res.ok || !body.post) throw new Error(body.error || "Could not post.");
      setData((d) => (d ? { ...d, posts: [body.post!, ...d.posts] } : d));
      setPostText("");
    } catch (e) {
      setPostError(e instanceof Error ? e.message : "Could not post.");
    }
  };

  const deletePost = async (id: string) => {
    try {
      const res = await fetch(`/api/clubs/${encodeURIComponent(slug)}/posts?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) setData((d) => (d ? { ...d, posts: d.posts.filter((p) => p.id !== id) } : d));
    } catch {}
  };

  if (error && !data) {
    return (
      <main className="min-h-screen">
        <SiteHeader active="/clubs" />
        <section className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-parchment-300">{error}</p>
          <LinkButton tone="ghost" href="/clubs" className="mt-4 inline-block px-4 py-2 text-sm">
            Back to clubs
          </LinkButton>
        </section>
      </main>
    );
  }

  const club = data?.club;
  const isOwner = data?.myRole === "owner";
  const isMember = data?.myRole != null;
  const mayModerate = isOwner || me?.role === "mod" || me?.role === "admin";

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader active="/clubs" />
      <section className="mx-auto max-w-6xl px-5 pt-6 sm:px-6 sm:pt-8">
        {!club ? (
          <p className="py-16 text-center text-sm text-parchment-400">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-0 items-center gap-4">
                <ClubIcon icon={club.icon} name={club.name} size={64} />
                <div className="min-w-0">
                <h1 className="truncate page-title">{club.name}</h1>
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-parchment-400">
                  <span className="flex items-center gap-1.5">
                    <Crown size={13} className="text-gold-leaf" />
                    <Link href={`/u/${encodeURIComponent(club.owner_name)}`} className="hover:text-gold-leaf">
                      {club.owner_name}
                    </Link>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Users size={13} /> {data.memberCount} member{data.memberCount === 1 ? "" : "s"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CalendarDays size={13} /> since {new Date(club.created_at).toLocaleDateString()}
                  </span>
                </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {mayModerate && (
                  <Button tone="ghost"
                    onClick={() => setPickingIcon((v) => !v)}
                    className="flex px-4 py-2 text-sm">
                    <Paintbrush size={14} />{" "}
                    {parseClubIcon(club.icon) || isUploadedClubIcon(club.icon) ? "Change icon" : "Pick an icon"}
                  </Button>
                )}
                {me && !isMember && (
                  <Button tone="leaf"
                    onClick={() => membership("join")}
                    disabled={busy}
                    className="flex px-4 py-2 text-sm font-semibold disabled:opacity-50">
                    <LogIn size={14} /> Join club
                  </Button>
                )}
                {isMember && !isOwner && (
                  <Button tone="ghost"
                    onClick={() => membership("leave")}
                    disabled={busy}
                    className="flex px-4 py-2 text-sm disabled:opacity-50">
                    <LogOut size={14} /> Leave
                  </Button>
                )}
                {isMember && (
                  <LinkButton tone="ghost"
                    href={`/tournaments?club=${encodeURIComponent(club.id)}`}
                    className="flex px-4 py-2 text-sm">
                    <Trophy size={14} /> New event
                  </LinkButton>
                )}
              </div>
            </div>

            {pickingIcon && (
              <ClubIconPicker
                slug={club.slug}
                current={club.icon}
                clubName={club.name}
                onSaved={(icon) => setData((d) => (d ? { ...d, club: { ...d.club, icon } } : d))}
                onClose={() => setPickingIcon(false)}
              />
            )}

            {error && (
              <div className="mt-5 plate border-oxblood-glow/60 bg-oxblood/15 px-4 py-3 text-sm text-parchment">
                {error}
              </div>
            )}
            {club.description && <p className="mt-4 max-w-2xl text-parchment-300">{club.description}</p>}

            <div className="mt-8 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="flex flex-col gap-4">
                {/* Members, sorted by rating, doubles as the club leaderboard. */}
                <div className="plate overflow-hidden">
                  <div className="flex items-center justify-between gap-2 border-b border-[color:var(--edge)] px-5 py-3">
                    <span className="text-[12px] text-parchment-400">Leaderboard</span>
                    <span className="text-[12px] text-parchment-500">
                      {data.memberCount} member{data.memberCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="max-h-96 divide-y divide-[color:var(--edge)] overflow-y-auto">
                    {data.members.map((m, i) => (
                      <li key={m.user_id}>
                        <Link
                          href={`/u/${encodeURIComponent(m.username)}`}
                          className="flex items-center gap-2.5 px-5 py-2 transition-colors hover:bg-[color:var(--bg-raised)]"
                        >
                          <span className="w-4 shrink-0 font-mono text-[12px] text-parchment-500">{i + 1}</span>
                          <PlayerAvatar name={m.username} avatar={m.avatar} size={22} />
                          <span className="min-w-0 truncate text-sm text-parchment-100">
                            {m.username}
                            {m.role === "owner" && (
                              <Crown size={11} className="ml-1.5 inline text-gold-leaf" aria-label="Owner" />
                            )}
                          </span>
                          <span className="ml-auto shrink-0 font-mono text-xs text-parchment-400">
                            {Math.round(m.rating)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Club events */}
                <div className="plate overflow-hidden">
                  <div className="border-b border-[color:var(--edge)] px-5 py-3 text-[12px] text-parchment-400">
                    Events
                  </div>
                  {data.tournaments.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-parchment-400">No events yet.</p>
                  ) : (
                    <ul className="divide-y divide-[color:var(--edge)]">
                      {data.tournaments.map((t) => (
                        <li key={t.id} className="px-5 py-2.5">
                          <div className="truncate text-sm text-parchment-100">{t.name}</div>
                          <div className="mt-0.5 text-[12px] text-parchment-400">
                            {t.status === "finished" ? "finished" : tournamentPhase(t.starts_at, t.duration_min)} ·{" "}
                            {t.players}/{t.max_players} players
                            {t.starts_at ? ` · ${new Date(t.starts_at).toLocaleString()}` : ""}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Message board */}
              <div className="plate flex h-fit flex-col overflow-hidden">
                <div className="border-b border-[color:var(--edge)] px-5 py-3 text-[12px] text-parchment-400">
                  Club board
                </div>
                {isMember ? (
                  <form onSubmit={submitPost} className="border-b border-[color:var(--edge)] px-5 py-4">
                    <textarea
                      value={postText}
                      onChange={(e) => setPostText(e.target.value)}
                      maxLength={500}
                      rows={2}
                      placeholder={`Message the members of ${club.name}…`}
                      className="w-full resize-none border border-[color:var(--edge)] bg-[color:var(--bg-base)] px-3 py-2 text-sm text-parchment focus:border-[color:var(--edge-strong)] focus:outline-none"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {postError ? (
                        <span className="text-xs text-oxblood-glow">{postError}</span>
                      ) : (
                        <span className="text-[12px] text-parchment-500">Visible to everyone; members can post.</span>
                      )}
                      <Button tone="leaf"
                        type="submit"
                        disabled={!postText.trim()}
                        className="px-4 py-1.5 text-xs font-semibold disabled:opacity-50">
                        Post
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="border-b border-[color:var(--edge)] px-5 py-3 text-sm text-parchment-400">
                    {me ? "Join the club to post on its board." : "Sign in and join to post."}
                  </p>
                )}
                {data.posts.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-parchment-400">Nothing posted yet.</p>
                ) : (
                  <ul className="divide-y divide-[color:var(--edge)]">
                    {data.posts.map((p) => (
                      <li key={p.id} className="group px-5 py-3">
                        <div className="flex items-center gap-2">
                          <PlayerAvatar name={p.username} avatar={p.avatar} size={20} />
                          <Link
                            href={`/u/${encodeURIComponent(p.username)}`}
                            className="text-sm font-medium text-parchment-100 hover:text-gold-leaf"
                          >
                            {p.username}
                          </Link>
                          <span className="text-[12px] text-parchment-500">{timeAgo(p.created_at)}</span>
                          {(mayModerate || p.user_id === me?.id) && (
                            <button
                              onClick={() => deletePost(p.id)}
                              className="ml-auto text-parchment-500 opacity-0 transition hover:text-oxblood-glow group-hover:opacity-100"
                              aria-label="Delete post"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-parchment-200">{p.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
