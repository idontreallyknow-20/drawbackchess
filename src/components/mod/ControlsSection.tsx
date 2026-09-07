"use client";

// Every switch that changes how nerfchess behaves, collected in one place.
//
// These used to be pinned above the tab strip, so the house-bot slider and the
// strength table were on screen while you worked a report queue — permanent
// clutter, and a live control one stray click away from the queue you were
// reading. They belong in their own section: you come here deliberately.
//
// Ordered by blast radius: what every visitor sees (house bots), then who the
// bots are, then the owner's private toggle, then the outbound webhook.

import { useEffect, useState } from "react";
import type { HouseState, PresetMap, SkillTier } from "./types";
import { ModButton, ModLinkButton, ModToggle, SectionHead } from "./ui";

export function ControlsSection({ isOwner, isAdmin }: { isOwner: boolean; isAdmin: boolean }) {
  return (
    <div className="space-y-8">
      <HouseBotsControl />
      <PersonasLink isAdmin={isAdmin} />
      {isOwner && <GodPanelControl />}
      <NotificationsControl />
    </div>
  );
}

// ---------------- house bots ----------------

// The house bots: the engine-driven roster that keeps the lobby warm. The switch
// writes app_settings.house_enabled; the game server reads it within a few
// seconds, stops advertising bot seeks, and winds down any bot game already in
// progress. Persisted, so it survives redeploys.
function HouseBotsControl() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [games, setGames] = useState<number | null>(null);
  const [bounds, setBounds] = useState<{ min: number; max: number }>({ min: 0, max: 70 });
  const [strength, setStrength] = useState<Pick<
    HouseState,
    "clamp" | "presets" | "skillTiers"
  > | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingest = (data: HouseState) => {
    setEnabled(data.enabled);
    setGames(data.games);
    setBounds({ min: data.min, max: data.max });
    setStrength({ clamp: data.clamp, presets: data.presets, skillTiers: data.skillTiers });
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mod/house")
      .then((res) => (res.ok ? (res.json() as Promise<HouseState>) : null))
      .then((data) => {
        if (!cancelled && data) ingest(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const post = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/mod/house", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      ingest((await res.json()) as HouseState);
    } catch {
      setError("Could not update. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const commitGames = (n: number) => {
    if (!saving && Number.isFinite(n)) post({ games: n });
  };

  return (
    <section className="plate space-y-4 p-4">
      <SectionHead
        title="House bots"
        blurb="The engine roster that keeps the lobby warm. Turning them off clears bot seeks within a few seconds and winds down bot games already running."
        actionsInline
        actions={
          <ModToggle
            label="House bots"
            on={enabled}
            busy={saving}
            onToggle={() => {
              if (enabled !== null && !saving) post({ enabled: !enabled });
            }}
          />
        }
      />
      {error && <p className="text-xs text-oxblood-glow">{error}</p>}

      {/* Active games: how many house-vs-house filler games run at once — the
          games that keep the Watch tab / lobby looking busy. The slider pins a
          target in the min..max range the API returns (0 = no filler games;
          human-vs-bot pickups still work). Lowering it lets the extra games drain
          out over a few minutes. Commits on release. Turning the bots off (above)
          clears them from the lobby entirely. */}
      <div className={"border-t border-[color:var(--edge)] pt-3 " + (enabled === false ? "opacity-50" : "")}>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="house-games" className="text-[11px] text-parchment-400">
            Filler games running
          </label>
          <span className="shrink-0 font-mono text-sm tabular-nums text-parchment-50">
            {games ?? "…"}
            <span className="text-parchment-500"> / {bounds.max}</span>
          </span>
        </div>
        <input
          id="house-games"
          type="range"
          min={bounds.min}
          max={bounds.max}
          step={1}
          value={games ?? bounds.min}
          disabled={games === null || saving}
          onChange={(e) => setGames(Number(e.target.value))}
          onPointerUp={(e) => commitGames(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => commitGames(Number((e.target as HTMLInputElement).value))}
          // Extra vertical padding widens the drag strip for a thumb without
          // changing how the track looks.
          className="mt-1 w-full touch-manipulation py-2 accent-gold-leaf disabled:cursor-not-allowed"
        />
      </div>

      {strength && (
        <HouseStrengthEditor
          state={strength}
          saving={saving}
          disabled={enabled === false}
          onSave={post}
        />
      )}
    </section>
  );
}

// The editable strength fields shown in the tier table. `pct` fields are stored
// as a 0-1 fraction but edited as a percentage. sampleWindowCp is intentionally
// omitted (advanced; left at its default) to keep the row compact.
const STRENGTH_FIELDS = [
  { key: "maxDepth", label: "depth", step: 1, pct: false },
  { key: "budgetMs", label: "ms", step: 10, pct: false },
  { key: "topK", label: "topK", step: 1, pct: false },
  { key: "temperatureCp", label: "temp", step: 10, pct: false },
  { key: "evalNoiseCp", label: "noise", step: 5, pct: false },
  { key: "blunderChance", label: "blndr%", step: 1, pct: true },
] as const;

type StrengthFieldKey = (typeof STRENGTH_FIELDS)[number]["key"];
type StrengthField = (typeof STRENGTH_FIELDS)[number];

// One editable strength number, shared by the phone blocks and the desktop
// table so both commit identically. Uncontrolled with a value-derived key: the
// field keeps whatever is typed until blur, then remounts on the API's answer.
function StrengthInput({
  tier,
  field,
  clamp,
  saving,
  onCommit,
  className,
}: {
  tier: SkillTier;
  field: StrengthField;
  clamp: HouseState["clamp"];
  saving: boolean;
  onCommit: (skill: number, key: StrengthFieldKey, pct: boolean, raw: number) => void;
  className?: string;
}) {
  const [lo, hi] = clamp[field.key] ?? [0, 9999];
  const eff = tier.effective[field.key] as number;
  const def = tier.defaults[field.key] as number;
  const shown = field.pct ? Math.round(eff * 100) : eff;
  const defShown = field.pct ? Math.round(def * 100) : def;
  const isOver = Object.prototype.hasOwnProperty.call(tier.overrides ?? {}, field.key);
  return (
    <input
      type="number"
      inputMode="numeric"
      min={field.pct ? lo * 100 : lo}
      max={field.pct ? hi * 100 : hi}
      step={field.step}
      defaultValue={shown}
      key={`${tier.skill}-${field.key}-${shown}`}
      disabled={saving}
      title={`default ${defShown}`}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (v !== shown) onCommit(tier.skill, field.key, field.pct, v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={
        "rounded border bg-[color:var(--bg-base)] px-1 py-1 text-right font-mono tabular-nums outline-none focus:border-gold-leaf/60 sm:py-0.5 " +
        (isOver ? "border-gold-leaf/50 text-parchment-50" : "border-[color:var(--edge)] text-parchment-300") +
        " " +
        (className ?? "")
      }
    />
  );
}

// Per-tier house-bot strength tuning. Presets fill the whole override map in one
// click; the table edits any single field live. Effective values come straight
// from the API's resolved profiles, so what is shown is exactly what plays.
// Changes reach live games within ~15s (the DO's settings cache TTL).
function HouseStrengthEditor({
  state,
  saving,
  disabled,
  onSave,
}: {
  state: Pick<HouseState, "clamp" | "presets" | "skillTiers">;
  saving: boolean;
  disabled: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const { clamp, presets, skillTiers } = state;

  // Apply a named preset: set every tier the preset names, and null every tier
  // it doesn't, so applying a preset always fully replaces prior overrides.
  const applyPreset = (preset: PresetMap) => {
    if (saving) return;
    const map: Record<string, Record<string, number | boolean> | null> = {};
    for (const t of skillTiers) map[String(t.skill)] = preset[String(t.skill)] ?? null;
    onSave({ skillOverrides: map });
  };

  const commitField = (skill: number, field: StrengthFieldKey, pct: boolean, raw: number) => {
    if (saving || !Number.isFinite(raw)) return;
    const value = pct ? raw / 100 : raw;
    onSave({ skillOverrides: { [String(skill)]: { [field]: value } } });
  };

  const resetTier = (skill: number) => {
    if (!saving) onSave({ skillOverrides: { [String(skill)]: null } });
  };

  const anyOverride = skillTiers.some((t) => t.overrides && Object.keys(t.overrides).length > 0);

  return (
    <div className={"border-t border-[color:var(--edge)] pt-3 " + (disabled ? "opacity-50" : "")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-parchment-400">Strength by tier</span>
        <div className="flex flex-wrap gap-1.5">
          <ModButton
            size="sm"
            disabled={saving || !anyOverride}
            onClick={() => onSave({ resetSkillOverrides: true })}
          >
            Reset all
          </ModButton>
          <ModButton tone="primary" size="sm" disabled={saving} onClick={() => applyPreset(presets.weakened)}>
            Weakened 50/30/20
          </ModButton>
          <ModButton tone="danger" size="sm" disabled={saving} onClick={() => applyPreset(presets.veryWeak)}>
            Very weak
          </ModButton>
        </div>
      </div>

      {/* Phones: one block per tier. A six-column table of number inputs at
          390px clipped "noise", "blndr%" and the reset button clean off the
          right edge, so half the controls did not exist on a phone. */}
      <div className="mt-2 space-y-2 sm:hidden">
        {skillTiers.map((t) => {
          const over = t.overrides ?? {};
          const touched = Object.keys(over).length > 0;
          return (
            <div key={t.skill} className="rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-base)] p-2.5">
              <div className="flex items-center justify-between">
                <span
                  className={
                    "font-display text-sm " + (touched ? "text-parchment-50" : "text-parchment-200")
                  }
                >
                  Tier {t.skill}
                </span>
                <ModButton
                  size="sm"
                  disabled={saving || !touched}
                  onClick={() => resetTier(t.skill)}
                  title="Reset this tier to baked default"
                >
                  Reset ↺
                </ModButton>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {STRENGTH_FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <span className="block text-[11px] text-parchment-400">{f.label}</span>
                    <StrengthInput
                      tier={t}
                      field={f}
                      clamp={clamp}
                      saving={saving}
                      onCommit={commitField}
                      className="mt-0.5 w-full"
                    />
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* From sm up the console gives this table 568px (640 viewport, less the
          shell's px-5 and this section's p-4), and the eight columns want about
          390px, so it fits without scrolling. It used to carry a 420px floor,
          which could never bind at any width where the table is shown and so
          only implied a scroll that never happened. The wrapper keeps
          overflow-x-auto as the safety net for a stray wide value. */}
      <div className="mt-2 hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-parchment-400">
              <th className="py-1 pr-2 text-left font-normal">Tier</th>
              {STRENGTH_FIELDS.map((f) => (
                <th key={f.key} className="px-1 py-1 text-right font-normal">
                  {f.label}
                </th>
              ))}
              <th className="pl-1" />
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {skillTiers.map((t) => {
              const over = t.overrides ?? {};
              const touched = Object.keys(over).length > 0;
              return (
                <tr key={t.skill} className="border-t border-[color:var(--edge)]">
                  <td className={"py-1 pr-2 " + (touched ? "text-parchment-50" : "text-parchment-200")}>
                    {t.skill}
                  </td>
                  {STRENGTH_FIELDS.map((f) => (
                    <td key={f.key} className="px-1 py-1 text-right">
                      <StrengthInput
                        tier={t}
                        field={f}
                        clamp={clamp}
                        saving={saving}
                        onCommit={commitField}
                        className="w-12"
                      />
                    </td>
                  ))}
                  <td className="pl-1 text-right">
                    <button
                      type="button"
                      disabled={saving || !touched}
                      onClick={() => resetTier(t.skill)}
                      title="Reset this tier to baked default"
                      className="px-1 text-parchment-400 disabled:opacity-25"
                    >
                      ↺
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-parchment-500">
        Move-quality weakening (topK / temp / noise), not just time. Changes reach live games within
        ~15s. Ratings drift is expected after a strength change. Highlighted values are overridden.
      </p>
    </div>
  );
}

// ---------------- personas ----------------

function PersonasLink({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) return null;
  return (
    <section className="plate p-4">
      <SectionHead
        title="House personas"
        blurb="Rename a bot, change its avatar, or write it a profile bio. Edits land on the persona's account immediately."
        actions={
          <ModLinkButton href="/mod/house" size="sm">
            Open persona editor ↗
          </ModLinkButton>
        }
      />
    </section>
  );
}

// ---------------- god panel ----------------

// The owner god panel is hidden by default; it switches on here and mounts in
// the owner's next draft game.
function GodPanelControl() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mod/god-panel")
      .then((res) => (res.ok ? (res.json() as Promise<{ enabled: boolean }>) : null))
      .then((data) => {
        if (!cancelled && data) setEnabled(data.enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async () => {
    if (enabled === null || saving) return;
    const next = !enabled;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/mod/god-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error();
      setEnabled(((await res.json()) as { enabled: boolean }).enabled);
    } catch {
      setError("Could not update. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="plate p-4">
      <SectionHead
        title="God panel"
        blurb="Your in-game card-summon panel. Hidden by default so it never gets in the way; switch it on and it mounts in your next draft game. Only you can see or use it."
        actionsInline
        actions={<ModToggle label="God panel" on={enabled} busy={saving} onToggle={toggle} />}
      />
      {error && <p className="mt-2 text-xs text-oxblood-glow">{error}</p>}
    </section>
  );
}

// ---------------- notifications ----------------

// Moved off the dashboard: this is a setting to check on, not a number to read
// every morning.
function NotificationsControl() {
  const [webhook, setWebhook] = useState<boolean | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/mod/notify-test")
      .then((r) => (r.ok ? (r.json() as Promise<{ configured: boolean }>) : { configured: false }))
      .then((j) => setWebhook(!!j.configured))
      .catch(() => setWebhook(false));
  }, []);

  return (
    <section className="plate p-4">
      <SectionHead
        title="Notifications"
        blurb={
          webhook === null
            ? "Checking…"
            : webhook
              ? "A webhook is configured: every moderator action appends a row to the sheet."
              : "No webhook configured. See docs/mod-notifications.md to point MOD_WEBHOOK_URL at a Google Apps Script."
        }
        actions={
          <ModButton
            size="sm"
            disabled={!webhook || testing === "sending"}
            onClick={async () => {
              setTesting("sending");
              try {
                const res = await fetch("/api/mod/notify-test", { method: "POST" });
                const json = (await res.json()) as { sent?: boolean; error?: string };
                setTesting(json.sent ? "Sent. Check the spreadsheet." : (json.error ?? "Failed."));
              } catch {
                setTesting("Failed to send.");
              }
            }}
          >
            {testing === "sending" ? "Sending…" : "Send test event"}
          </ModButton>
        }
      />
      {testing && testing !== "sending" && (
        <p className="mt-2 text-[12px] text-parchment-300">{testing}</p>
      )}
    </section>
  );
}
