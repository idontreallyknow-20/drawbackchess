"use client";

// Editor for the house-bot identities: rename a persona, give it a different
// avatar from the house avatar catalog, or set a profile bio. Edits persist as
// overrides (house_identity_overrides) with the baked roster constants as the
// fallback, and land on the persona's users row immediately, so profiles, the
// leaderboard, and the lobby pick them up without a deploy (the game server's
// identity cache refreshes within about a minute). Open to any moderator or
// admin, matching the server-side authorization in /api/mod/house/personas.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AccountUser, fetchMe } from "@/lib/authClient";
import { ModShell } from "@/components/mod/ModShell";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { fileToDataUrl } from "@/lib/imageUpload";
import { Button } from "@/components/ui/Button";

type PersonaView = {
  userId: string;
  skill: number;
  seedRating: number;
  location: string;
  defaults: { username: string; avatar: string };
  override: { username: string | null; avatar: string | null; bio: string | null } | null;
  effective: { username: string; avatar: string; bio: string | null };
};

type PersonasPayload = { personas: PersonaView[]; avatars: string[] };

const PAGE = 60;

function filtered(personas: PersonaView[], query: string): PersonaView[] {
  const q = query.trim().toLowerCase();
  if (!q) return personas;
  return personas.filter(
    (p) =>
      p.effective.username.toLowerCase().includes(q) ||
      p.defaults.username.toLowerCase().includes(q) ||
      p.location.toLowerCase().includes(q) ||
      String(p.skill).startsWith(q),
  );
}

export default function ModHousePage() {
  const [me, setMe] = useState<AccountUser | null | undefined>(undefined);
  const [data, setData] = useState<PersonasPayload | null>(null);
  const [failed, setFailed] = useState(false);
  // 900 personas with three controls each is too much DOM to mount at once:
  // filter by name and page the rest in.
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    fetchMe().then(setMe);
    fetch("/api/mod/house/personas")
      .then((res) => (res.ok ? (res.json() as Promise<PersonasPayload>) : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const isMod = me && (me.role === "mod" || me.role === "admin");

  return (
    <ModShell title="House bots" isAdmin={me?.role === "admin"}>
      <>
        {me === undefined ? (
          <div className="text-parchment-300">Loading…</div>
        ) : !isMod ? (
          <>
                        <p className="mt-3 text-parchment-200">This page is for moderators.</p>
          </>
        ) : (
          <>
                        <p className="mt-3 max-w-2xl text-sm text-parchment-300">
              The engine-driven roster that keeps the lobby warm. Rename a persona,
              pick a different avatar, or set a profile bio; names pass the same
              checks a player registration does. Changes go live without a deploy.
            </p>
            {failed ? (
              <p className="mt-6 text-sm text-parchment-400">Could not load the roster. Try again in a minute.</p>
            ) : !data ? (
              <p className="mt-6 text-parchment-300">Loading…</p>
            ) : (
              <>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShown(PAGE);
                  }}
                  placeholder="Filter by name, location or skill"
                  aria-label="Filter personas"
                  className="w-full max-w-sm bg-[color:var(--bg-base)] border border-[color:var(--edge)] rounded-none px-3 py-1.5 text-sm text-parchment placeholder:text-parchment-400/60 focus:outline-none focus:border-[color:var(--edge-strong)]"
                />
                <span className="text-xs text-parchment-400">
                  {filtered(data.personas, query).length} of {data.personas.length} personas
                </span>
              </div>
              <div className="mt-3 plate divide-y divide-[color:var(--edge)]">
                {filtered(data.personas, query).slice(0, shown).map((p) => (
                  // Keyed on the server-side username too: a save (any row's)
                  // that changes it remounts the row, so the name input resets
                  // to the fresh server value without an effect.
                  <PersonaRow
                    key={`${p.userId}:${p.effective.username}`}
                    persona={p}
                    avatars={data.avatars}
                    canEdit={!!isMod}
                    onSaved={setData}
                  />
                ))}
              </div>
              {filtered(data.personas, query).length > shown && (
                <div className="mt-3">
                  <Button tone="default" onClick={() => setShown((n) => n + PAGE)}>
                    Show {Math.min(PAGE, filtered(data.personas, query).length - shown)} more
                  </Button>
                </div>
              )}
              </>
            )}
          </>
        )}
      </>
    </ModShell>
  );
}

function PersonaRow({
  persona,
  avatars,
  canEdit,
  onSaved,
}: {
  persona: PersonaView;
  avatars: string[];
  canEdit: boolean;
  onSaved: (data: PersonasPayload) => void;
}) {
  const [name, setName] = useState(persona.effective.username);
  const [bio, setBio] = useState(persona.effective.bio ?? "");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const post = async (body: Record<string, unknown>) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/mod/house/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: persona.userId, ...body }),
      });
      const data = (await res.json().catch(() => null)) as (PersonasPayload & { error?: string }) | null;
      if (!res.ok || !data?.personas) {
        setError(data?.error ?? "Could not save. Try again.");
        return;
      }
      onSaved(data);
      setPicking(false);
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // Upload a custom image as this bot's pfp: downscale to a small square data
  // URL on the client, then POST it as the avatar (the server re-validates
  // MIME/size/dimensions via imageValidate before storing).
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file, { maxDim: 160, maxChars: 200_000, cover: true });
      await post({ avatar: dataUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that image.");
    }
  };

  const nameDirty = name.trim() !== persona.effective.username;
  const bioDirty = bio.trim() !== (persona.effective.bio ?? "");
  const dirty = nameDirty || bioDirty;
  const edited = !!persona.override;

  // Save whichever text fields (username, bio) changed in one request; the
  // avatar picker posts on its own.
  const saveEdits = () => {
    const body: Record<string, unknown> = {};
    if (nameDirty) body.username = name.trim();
    if (bioDirty) body.bio = bio.trim();
    if (Object.keys(body).length) post(body);
  };

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canEdit || saving}
          onClick={() => setPicking((v) => !v)}
          title={canEdit ? "Change avatar" : undefined}
          // The only child is the avatar, and a preset avatar is aria-hidden,
          // so without this the control announces as an unnamed button.
          aria-label={`Change ${persona.effective.username}'s avatar`}
          className={"shrink-0 " + (canEdit ? "press" : "cursor-default")}
        >
          <PlayerAvatar name={persona.effective.username} avatar={persona.effective.avatar} size={36} />
        </button>
        {canEdit ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty) saveEdits();
            }}
            className="w-44 bg-transparent plate px-3 py-1.5 text-sm font-display font-semibold outline-none focus:border-[color:var(--edge-strong)]"
            maxLength={20}
            aria-label={`Username for ${persona.defaults.username}`}
          />
        ) : (
          <span className="font-display font-semibold">{persona.effective.username}</span>
        )}
        {edited && (
          <span
            className="text-[12px] px-2 py-0.5 rounded-none border border-[color:var(--edge-strong)] text-parchment-50"
            title={`Default: ${persona.defaults.username}`}
          >
            edited
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-sm text-parchment-400">
          <span className="font-mono tabular-nums" title="Skill tier">{persona.skill}</span>
        </span>
        {canEdit && (
          <span className="flex items-center gap-2 text-sm">
            <Button tone="ghost"
             
              disabled={saving || !dirty}
              onClick={saveEdits}
              className="px-3 py-1 text-parchment-50">
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button tone="ghost"
             
              disabled={saving || !edited}
              onClick={() => post({ reset: true })}
              title="Restore the baked username and avatar"
              className="px-3 py-1">
              Reset
            </Button>
          </span>
        )}
      </div>
      {canEdit && (
        <div className="mt-2">
          <input
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty) saveEdits();
            }}
            placeholder="Profile bio (optional)"
            maxLength={300}
            className="w-full bg-transparent plate px-3 py-1.5 text-sm outline-none focus:border-[color:var(--edge-strong)]"
            aria-label={`Bio for ${persona.defaults.username}`}
          />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-oxblood-glow">{error}</p>}
      {picking && canEdit && (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <Button tone="ghost"
             
              disabled={saving}
              onClick={() => fileRef.current?.click()}
              className="px-3 py-1 text-parchment-50">
              Upload image…
            </Button>
            <span className="text-[12px] text-parchment-500">PNG, JPEG, or WebP. Max 1 MB, 1024px.</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
          {avatars.map((id) => (
            <button
              key={id}
              type="button"
              disabled={saving}
              onClick={() => post({ avatar: id })}
              title={id}
              aria-label={`Use avatar ${id}`}
              className={
                "rounded-none border p-0.5 transition " +
                (id === persona.effective.avatar
                  ? "border-[color:var(--edge-strong)]"
                  : "border-transparent hover:border-[color:var(--edge-strong)]")
              }
            >
              <PlayerAvatar name={persona.effective.username} avatar={id} size={28} />
            </button>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
