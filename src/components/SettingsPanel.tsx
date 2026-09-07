"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalChrome } from "@/lib/useModalChrome";
import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  BOARD_THEMES,
  BoardTheme,
  CUSTOM_BG_DATA_MAX,
  CUSTOM_BG_URL_MAX,
  DEFAULT_SETTINGS,
  PIECE_ANIM_PRESETS,
  PIECE_COLORS,
  PIECE_THEMES,
  PieceColor,
  PieceTheme,
  pieceLook,
  SITE_THEMES,
  SiteTheme,
  applyUiPrefs,
  loadSettings,
  sanitizeCustomBgUrl,
  saveSettings,
  Settings,
} from "@/lib/settings";
import { fileToDataUrl } from "@/lib/imageUpload";
import { configureSoundPrefs, playMove as playMoveSample, setUiSounds, setVolume } from "@/lib/sounds";
import Link from "next/link";
import { Piece } from "@/components/Pieces";
import { SECTIONS, type Control } from "@/components/settings/config";
import { SettingRow } from "@/components/settings/SettingRow";
import {
  GhostButton,
  Select,
  Slider,
  Toggle,
} from "@/components/settings/controls";
import "./SettingsPanel.css";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Set when a live game is in progress; when omitted, the panel infers it
   *  from the route (game pages live under /game and /play). */
  liveGame?: boolean;
}

export function SettingsPanel({ open, onClose, liveGame }: Props) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // Drill-down navigation: the panel opens on a sparse home of category
  // cards; picking one slides into that section's focused sub-page, with a
  // Back control at its head. One level, never deeper.
  const [view, setView] = useState<"home" | string>("home");
  const pathname = usePathname();
  const inLiveGame =
    liveGame ?? (pathname != null && (pathname.startsWith("/game") || pathname.startsWith("/play")));

  // Re-sync from storage each time the panel opens, matching the previous
  // behaviour where values were reloaded on open. Also start back on the
  // home grid so the panel always opens in the same place. Handled on the
  // open transition during render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setSettings(loadSettings());
      setView("home");
    }
  }

  // Scroll lock + Escape: `aria-modal` below promised both and neither
  // existed, so a touch drag scrolled the page behind the panel and Tab walked
  // straight out of it. Called BEFORE the early return so hook order is stable.
  const chrome = useModalChrome(open, onClose);
  const { attachDialog } = chrome;

  if (!open) return null;

  // Single write path for every live control: merge, persist, apply side
  // effects. saveSettings() already re-applies the themes and UI preferences;
  // audio needs an explicit push into the sound engine.
  const update = (patch: Partial<Settings>) => {
    // Merge from storage (the latest persisted value, which state mirrors) and
    // run the side effects outside the state updater, which React may replay.
    const merged = { ...loadSettings(), ...patch };
    setSettings(merged);
    saveSettings(merged);
    if (patch.volume != null) setVolume(merged.volume);
    if (patch.uiSounds != null) setUiSounds(merged.uiSounds);
    configureSoundPrefs({
      enabled: merged.soundEnabled,
      move: merged.moveSound,
      capture: merged.captureSound,
      check: merged.checkSound,
      gameEnd: merged.gameEndSound,
      theme: merged.soundTheme,
    });
    // Audition the new set so the choice is audible immediately.
    if (patch.soundTheme != null || patch.volume != null) playMoveSample();
  };

  const renderControl = (control: Control, label: string) => {
    switch (control.kind) {
      case "toggle":
        return (
          <Toggle
            label={label}
            checked={settings[control.setting]}
            onChange={(v) => update({ [control.setting]: v } as Partial<Settings>)}
          />
        );
      case "slider":
        return (
          <Slider
            label={label}
            value={settings[control.setting]}
            min={control.min}
            max={control.max}
            step={control.step}
            format={control.format}
            onChange={(v) => update({ [control.setting]: v } as Partial<Settings>)}
          />
        );
      case "animationSpeed":
        return (
          <Select
            label={label}
            value={settings.animationSpeed}
            options={control.options}
            onChange={(v) => update({ animationSpeed: v })}
          />
        );
      case "pieceAnimMs": {
        const known = PIECE_ANIM_PRESETS.some((o) => o.value === settings.pieceAnimMs);
        const options = known
          ? PIECE_ANIM_PRESETS.map((o) => ({ value: String(o.value), label: o.label }))
          : [
              ...PIECE_ANIM_PRESETS.map((o) => ({ value: String(o.value), label: o.label })),
              { value: String(settings.pieceAnimMs), label: `${settings.pieceAnimMs} ms` },
            ];
        return (
          <Select
            label={label}
            value={String(settings.pieceAnimMs)}
            options={options}
            onChange={(v) => update({ pieceAnimMs: Number(v) })}
          />
        );
      }
      case "clockTenths":
        return (
          <Select
            label={label}
            value={settings.clockTenths}
            options={[
              { value: "never", label: "Never" },
              { value: "low", label: "Under 10 seconds" },
              { value: "always", label: "Always" },
            ]}
            onChange={(v) => update({ clockTenths: v })}
          />
        );
      case "siteTheme":
        return <SiteThemePicker value={settings.siteTheme} onChange={(t) => update({ siteTheme: t })} />;
      case "soundTheme":
        return (
          <Select
            label={label}
            value={settings.soundTheme}
            options={control.options}
            onChange={(v) => update({ soundTheme: v })}
          />
        );
      case "account":
        return <AccountSettings />;
      case "customBg":
        return (
          <CustomBackgroundControl
            url={settings.customBgUrl}
            data={settings.customBgData}
            dim={settings.customBgDim}
            onApply={(patch) => update(patch)}
          />
        );
      case "boardTheme":
        return <BoardThemePicker settings={settings} onChange={update} />;
      case "pieceTheme":
        return <PieceThemePicker settings={settings} onChange={update} />;
      case "pieceColor":
        return <PieceColorPicker settings={settings} onChange={update} />;
      case "reset":
        return (
          <GhostButton
            label="Reset"
            onClick={() => {
              update({ ...DEFAULT_SETTINGS });
              setVolume(DEFAULT_SETTINGS.volume);
              setUiSounds(DEFAULT_SETTINGS.uiSounds);
            }}
          />
        );
    }
  };

  // Pickers span a full row; simple controls sit inline on the right. Sliders
  // grow into the free row width instead of hugging a fixed size.
  const isStacked = (control: Control) =>
    control.kind === "boardTheme" ||
    control.kind === "pieceTheme" ||
    control.kind === "pieceColor" ||
    control.kind === "siteTheme" ||
    control.kind === "account" ||
    control.kind === "customBg";

  const activeSection = view === "home" ? null : SECTIONS.find((s) => s.id === view) ?? null;

  // Portalled to the body. This panel is rendered INSIDE <nav>, which
  // globals.css pins at z-index 30, so the whole modal was trapped in that
  // stacking context and the body-level AchievementToast (z-40) painted over
  // it — an unlock while Settings was open put the toast and its buttons on
  // top of the settings pane, intercepting clicks meant for it.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/70 p-4"
      onPointerDown={chrome.onBackdropPointerDown}
    >
      <div
        ref={attachDialog}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="plate plate-raised relative flex max-h-[88dvh] w-full max-w-[46rem] flex-col overflow-hidden"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Header. */}
        <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--edge)] py-2.5 pl-5 pr-2.5">
          <h2 className="font-display text-[15px] font-bold text-parchment-50">Settings</h2>
          <button
            onClick={onClose}
            className="nav-icon-btn relative z-20 grid min-h-[44px] min-w-[44px] place-items-center text-parchment-400 hover:text-parchment"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Gentle reminder for players who open Settings mid-game. */}
        {inLiveGame && (
          <p className="shrink-0 border-b border-[color:var(--edge)] px-5 py-1.5 text-[12px] text-gold-leaf">
            Heads up: the game clock keeps running while Settings is open.
          </p>
        )}

        {/* Body: a left column of section links and a right column of plain
            rows on desktop; one column on a phone, where the section list is
            the first view and a Back control returns to it. */}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Section links. Always on screen from sm up; on a phone this is
              the whole view until a section is chosen. */}
          <nav
            aria-label="Settings sections"
            className={
              "shrink-0 overflow-y-auto border-[color:var(--edge)] p-2 sm:block sm:w-[13rem] sm:border-r " +
              (activeSection ? "hidden" : "block h-[min(32rem,60dvh)] sm:h-[min(32rem,60dvh)]")
            }
          >
            <ul className="flex flex-col gap-0.5">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <button
                    onClick={() => setView(section.id)}
                    aria-current={activeSection?.id === section.id || undefined}
                    className="settings-tab flex min-h-[44px] w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13px]"
                  >
                    <section.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                    <span className="min-w-0 flex-1 truncate">{section.title}</span>
                    <ChevronRight
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 text-parchment-500 sm:hidden"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Content. Plain rows: label left, control right. */}
          <div
            className={
              "min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 sm:block sm:h-[min(32rem,60dvh)] sm:px-5 " +
              (activeSection ? "block h-[min(32rem,60dvh)]" : "hidden")
            }
          >
            {activeSection ? (
              <>
                {/* Sub-page head. The Back control is the phone's way out of a
                    section; from sm up the section list is already on screen. */}
                <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b border-[color:var(--edge)] bg-inherit px-4 py-1.5 sm:-mx-5 sm:px-5">
                  <button
                    onClick={() => setView("home")}
                    className="flex min-h-[36px] items-center gap-1 pr-2 text-[13px] text-parchment-400 transition hover:text-parchment sm:hidden"
                  >
                    <ChevronLeft aria-hidden className="h-4 w-4" />
                    Back
                  </button>
                  <span className="flex items-center gap-2 font-display text-[14px] font-semibold text-parchment-100">
                    <activeSection.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                    {activeSection.title}
                  </span>
                </div>
                {activeSection.rows.map((row, i) => {
                  const prevGroup = activeSection.rows[i - 1]?.group;
                  const opensGroup = row.group != null && row.group !== prevGroup;
                  return (
                    <Fragment key={row.id}>
                      {opensGroup && (
                        <div className={"flex items-center gap-2.5 pb-1 " + (i === 0 ? "pt-2.5" : "pt-4")}>
                          <span className="text-[12px] font-semibold text-parchment-300">{row.group}</span>
                          <span aria-hidden className="h-px flex-1 bg-[color:var(--edge)]" />
                        </div>
                      )}
                      <div className={!opensGroup && i > 0 ? "border-t border-[color:var(--edge)]" : ""}>
                        <SettingRow
                          label={row.label}
                          hint={row.hint}
                          stacked={isStacked(row.control)}
                          grow={row.control.kind === "slider"}
                          control={renderControl(row.control, row.label)}
                        />
                      </div>
                    </Fragment>
                  );
                })}
              </>
            ) : (
              <p className="hidden pt-6 text-[13px] text-parchment-400 sm:block">
                Pick a section on the left.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A small gem set into a picker card's corner when it is the chosen one. */
function SelectedGem() {
  return (
    <span
      aria-hidden
      className="absolute right-1.5 top-1.5 z-10 h-1.5 w-1.5 rotate-45 bg-gold-leaf shadow-[0_0_6px_1px_rgb(var(--accent-hi-rgb)/0.6)]"
    />
  );
}

/** Shared treasure treatment for picker cards: gold ring + faint glow when
 *  selected, a firmer edge on hover otherwise. */
const pickerCardClass = (selected: boolean) =>
  selected
    ? "border-[color:var(--edge-strong)] bg-[color:var(--bg-raised)] shadow-[0_0_16px_-8px_rgb(var(--accent-hi-rgb)/0.55)]"
    : "border-[color:var(--edge)] hover:border-[color:var(--edge-strong)] hover:bg-[color:var(--bg-raised)]";

/** Site theme picker: three cards, dark / light / system. Each shows the page
 *  background, a panel chip and the accent, so the choice previews at a glance
 *  before it is applied. */
function SiteThemePicker({
  value,
  onChange,
}: {
  value: SiteTheme;
  onChange: (theme: SiteTheme) => void;
}) {
  const ids = Object.keys(SITE_THEMES) as SiteTheme[];

  // Hover-to-preview: resting on a card for a beat repaints the whole page in
  // that theme (applyUiPrefs with the hovered id over the real settings), and
  // leaving reverts to what is actually saved. Fine pointers only, so touch
  // scrolling through the grid never flashes themes; keyboard focus previews
  // too. A real selection cancels any pending revert, because saveSettings
  // will apply the picked theme through the normal path.
  const previewTimer = useRef<number | null>(null);
  const previewing = useRef(false);

  const clearPreviewTimer = () => {
    if (previewTimer.current != null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  };
  const startPreview = (k: SiteTheme) => {
    clearPreviewTimer();
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      previewing.current = true;
      applyUiPrefs({ ...loadSettings(), siteTheme: k });
    }, 250);
  };
  const revertPreview = () => {
    clearPreviewTimer();
    if (previewing.current) {
      previewing.current = false;
      applyUiPrefs(loadSettings());
    }
  };
  const canHoverPreview = () =>
    !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
  // Unmount (panel closed, section left) always reverts a live preview. Only
  // refs and module functions are touched, so the cleanup needs no deps.
  useEffect(
    () => () => {
      if (previewTimer.current != null) window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
      if (previewing.current) {
        previewing.current = false;
        applyUiPrefs(loadSettings());
      }
    },
    [],
  );

  const select = (k: SiteTheme) => {
    clearPreviewTimer();
    previewing.current = false; // the real save applies it; nothing to revert
    onChange(k);
  };

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ids.map((k) => {
        const t = SITE_THEMES[k];
        const selected = value === k;
        return (
          <button
            key={k}
            onClick={() => select(k)}
            onPointerEnter={() => {
              if (canHoverPreview()) startPreview(k);
            }}
            onPointerLeave={revertPreview}
            onFocus={(e) => {
              if (e.currentTarget.matches(":focus-visible")) startPreview(k);
            }}
            onBlur={revertPreview}
            onKeyDown={(e) => {
              if (e.key === "Escape") revertPreview();
            }}
            aria-pressed={selected}
            className={
              "group press relative overflow-hidden rounded-none border text-left transition-colors " +
              pickerCardClass(selected)
            }
          >
            {selected && <SelectedGem />}
            {/* Miniature page: background wash, a panel chip, an accent dot. */}
            <span
              className="relative block h-12 w-full"
              style={{ background: t.swatch.bg }}
              aria-hidden
            >
              <span
                className="absolute left-2 top-2 h-5 w-9 rounded-none border border-[color:var(--edge)]"
                style={{ background: t.swatch.panel }}
              />
              <span
                className="absolute bottom-2 right-2 h-2 w-2 rounded-full"
                style={{ background: t.swatch.glow }}
              />
            </span>
            <span className="block px-2 py-1.5">
              <span className="block font-display text-[13px] leading-tight text-parchment">
                {t.label}
              </span>
              <span className="block text-[12px] leading-tight text-parchment-400">{t.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Custom background: upload an image (stored device-local as a data URL) or
 *  paste an http(s) URL, plus a dim slider. Both inputs are validated before
 *  anything persists, so the page background always degrades to the theme
 *  default. An upload wins over the URL until it's removed. */
function CustomBackgroundControl({
  url,
  data,
  dim,
  onApply,
}: {
  url: string;
  data: string;
  dim: number;
  onApply: (patch: Partial<Settings>) => void;
}) {
  const [draft, setDraft] = useState(url);
  const [invalid, setInvalid] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Track external changes (reset, server sync); adjust on the change during
  // render rather than in an effect.
  const [prevUrl, setPrevUrl] = useState(url);
  if (prevUrl !== url) {
    setPrevUrl(url);
    setDraft(url);
    setInvalid(false);
  }

  const apply = () => {
    const clean = sanitizeCustomBgUrl(draft);
    if (draft.trim() && !clean) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onApply({ customBgUrl: clean });
  };

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const dataUrl = await fileToDataUrl(file, { maxDim: 1920, maxChars: CUSTOM_BG_DATA_MAX });
      onApply({ customBgData: dataUrl });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not read that image.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn-ghost press relative min-h-[36px] cursor-pointer rounded-none px-3 py-1.5 font-display text-[13px]">
          {uploading ? "Reading…" : data ? "Replace image" : "Upload image"}
          <input
            type="file"
            accept="image/*"
            aria-label="Upload a background image"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
        {data && (
          <>
            <span
              aria-hidden
              className="h-8 w-12 shrink-0 rounded-none border border-[color:var(--edge-strong)] bg-cover bg-center"
              style={{ backgroundImage: `url("${data}")` }}
            />
            <GhostButton label="Remove" onClick={() => onApply({ customBgData: "" })} />
          </>
        )}
      </div>
      {uploadError && <p className="text-[12px] text-oxblood-glow">{uploadError}</p>}
      {data && (
        <p className="text-[12px] text-parchment-400">
          Uploaded backgrounds stay on this device and override the URL below.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="url"
          value={draft}
          maxLength={CUSTOM_BG_URL_MAX}
          placeholder="https://example.com/image.jpg"
          aria-label="Background image URL"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          className="input-rune min-h-[36px] w-full min-w-0 flex-1 basis-40 rounded-none px-3 py-1.5 text-[13px]"
        />
        <GhostButton label="Apply" onClick={apply} />
        {url && (
          <GhostButton
            label="Clear"
            onClick={() => {
              setDraft("");
              setInvalid(false);
              onApply({ customBgUrl: "" });
            }}
          />
        )}
      </div>
      {invalid && (
        <p className="text-[12px] text-oxblood-glow">Use a direct http(s) image link.</p>
      )}
      <div className="flex min-h-[36px] items-center justify-between gap-3">
        <span className="text-[12px] text-parchment-400">Dim</span>
        <Slider
          label="Background dim"
          value={dim}
          min={0}
          max={0.6}
          step={0.05}
          disabled={!url && !data}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onApply({ customBgDim: v })}
        />
      </div>
    </div>
  );
}

/** Compact disclosure for the large theme galleries: rests as a single row
 *  showing the current pick (name + small swatch); expanding reveals the full
 *  grid. Keeps the Layout/Motion controls below within easy reach. */
function PickerDisclosure({
  prompt,
  selectedName,
  swatch,
  children,
}: {
  /** Action label on the collapsed row, e.g. "Choose piece set". */
  prompt: string;
  selectedName: string;
  swatch: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-[44px] w-full items-center gap-2.5 rounded-none border border-[color:var(--edge)] p-2 text-left transition-colors hover:border-[color:var(--edge-strong)] hover:bg-[color:var(--bg-raised)]"
      >
        {swatch}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[13px] leading-tight text-parchment">
            {selectedName}
          </span>
          <span className="block text-[12px] leading-tight text-parchment-400">
            {expanded ? "Hide options" : prompt}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={"h-4 w-4 shrink-0 text-parchment-400 transition-transform " + (expanded ? "rotate-180" : "")}
        />
      </button>
      {expanded && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** The board-theme swatch grid, a live control that spans a full row. */
function BoardThemePicker({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const value = settings.boardTheme;
  const current = BOARD_THEMES[value] ?? BOARD_THEMES.brown;
  return (
    <PickerDisclosure
      prompt="Choose board theme"
      selectedName={current.label}
      swatch={
        <span aria-hidden className="grid h-7 w-7 shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-none">
          <span style={{ background: current.light }} />
          <span style={{ background: current.dark }} />
          <span style={{ background: current.dark }} />
          <span style={{ background: current.light }} />
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(BOARD_THEMES) as BoardTheme[]).map((k) => {
          const t = BOARD_THEMES[k];
          const selected = value === k;
          return (
            <button
              key={k}
              onClick={() => onChange({ boardTheme: k })}
              aria-pressed={selected}
              className={
                "relative flex min-h-[44px] items-center gap-2.5 rounded-none border p-2 transition-colors " +
                pickerCardClass(selected)
              }
            >
              {selected && <SelectedGem />}
              <span className="grid h-7 w-7 shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-none">
                <span style={{ background: t.light }} />
                <span style={{ background: t.dark }} />
                <span style={{ background: t.dark }} />
                <span style={{ background: t.light }} />
              </span>
              <span className="font-display text-[13px] text-parchment">{t.label}</span>
            </button>
          );
        })}
      </div>
    </PickerDisclosure>
  );
}

/** A knight pair in a set of fills: the shared preview swatch for the design
 *  and colour pickers. Asset sets draw their own SVG, the inline design draws
 *  <Piece> with the fills pushed in as variables. */
function PiecePairSwatch({
  look,
  both = true,
}: {
  look: { wFill: string; wStroke: string; bFill: string; bStroke: string; assetSet?: string };
  both?: boolean;
}) {
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-none bg-ink-700"
      style={
        {
          "--piece-w-fill": look.wFill,
          "--piece-w-stroke": look.wStroke,
          "--piece-b-fill": look.bFill,
          "--piece-b-stroke": look.bStroke,
        } as CSSProperties
      }
    >
      {look.assetSet ? (
        <>
          <span
            className="h-4 w-4 bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: `url("/piece/lichess/${look.assetSet}/wN.svg")` }}
          />
          {both && (
            <span
              className="-ml-1 h-4 w-4 bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: `url("/piece/lichess/${look.assetSet}/bN.svg")` }}
            />
          )}
        </>
      ) : (
        <>
          <Piece type="n" color="w" size={16} />
          {both && <Piece type="n" color="b" size={16} className="-ml-1" />}
        </>
      )}
    </span>
  );
}

/** The piece DESIGN grid: the site's own set plus the Lichess sets. Colour is
 *  the separate picker below. */
function PieceThemePicker({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const value = settings.pieceTheme;
  const current = PIECE_THEMES[value] ?? PIECE_THEMES.lichessCburnett;
  return (
    <PickerDisclosure
      prompt="Choose piece design"
      selectedName={current.label}
      swatch={<PiecePairSwatch look={pieceLook(value, settings.pieceColor)} both={false} />}
    >
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(PIECE_THEMES) as PieceTheme[]).map((k) => {
          const t = PIECE_THEMES[k];
          const selected = value === k;
          return (
            <button
              key={k}
              onClick={() => onChange({ pieceTheme: k })}
              aria-pressed={selected}
              className={
                "relative flex min-h-[44px] items-center gap-2.5 rounded-none border p-2 transition-colors " +
                pickerCardClass(selected)
              }
            >
              {selected && <SelectedGem />}
              <PiecePairSwatch look={pieceLook(k, settings.pieceColor)} />
              <span className="font-display text-[13px] text-parchment">{t.label}</span>
            </button>
          );
        })}
      </div>
    </PickerDisclosure>
  );
}

/** The piece COLOUR grid. It paints the inline design; a Lichess set is fixed
 *  artwork, so while one is chosen the grid still shows the colours (they are
 *  kept) but says plainly that they are not in effect. */
function PieceColorPicker({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const value = settings.pieceColor;
  const current = PIECE_COLORS[value] ?? PIECE_COLORS.classic;
  const design = PIECE_THEMES[settings.pieceTheme] ?? PIECE_THEMES.lichessCburnett;
  const inert = !!design.assetSet;
  return (
    <PickerDisclosure
      prompt={inert ? `Not used by the ${design.label} set` : "Choose piece colour"}
      selectedName={current.label}
      swatch={<PiecePairSwatch look={current} />}
    >
      {inert && (
        <p className="mb-2 text-[12px] leading-snug text-parchment-400">
          The {design.label} set has its own colours. Pick the Nerf Chess design above to use these.
        </p>
      )}
      <div className={"grid grid-cols-2 gap-2 " + (inert ? "opacity-60" : "")}>
        {(Object.keys(PIECE_COLORS) as PieceColor[]).map((k) => {
          const t = PIECE_COLORS[k];
          const selected = value === k;
          return (
            <button
              key={k}
              onClick={() => onChange({ pieceColor: k })}
              aria-pressed={selected}
              className={
                "relative flex min-h-[44px] items-center gap-2.5 rounded-none border p-2 transition-colors " +
                pickerCardClass(selected)
              }
            >
              {selected && <SelectedGem />}
              <PiecePairSwatch look={t} />
              <span className="font-display text-[13px] text-parchment">{t.label}</span>
            </button>
          );
        })}
      </div>
    </PickerDisclosure>
  );
}

/** Account section: live actions where the platform supports them today,
 *  clearly-labelled placeholders for the rest so the section is ready to grow. */
function AccountSettings() {
  return (
    <div className="space-y-2">
      <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] p-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-parchment-100">Profile</div>
          <p className="text-[12px] text-parchment-400">Avatar, bio, and game history</p>
        </div>
        <LinkButton tone="ghost"
          href="/profile"
          className="shrink-0 px-3 py-1.5 text-[13px]">
          Edit profile
        </LinkButton>
      </div>
      {[
        { label: "Change username", hint: "Not available yet" },
        { label: "Change password", hint: "Not available yet" },
        { label: "Email preferences", hint: "Coming soon" },
        { label: "Log out of all devices", hint: "Coming soon" },
      ].map((item) => (
        <div
          key={item.label}
          className="flex min-h-[44px] items-center justify-between gap-3 rounded-none border border-[color:var(--edge)] bg-transparent p-2.5 opacity-70"
        >
          <div className="text-[13px] font-medium text-parchment-300">{item.label}</div>
          <span
            className="rune-badge shrink-0"
            style={{ ["--badge-rgb" as string]: "152 145 127" }}
          >
            {item.hint}
          </span>
        </div>
      ))}
      <form action="/api/auth/logout" method="post">
        <Button tone="danger"
          type="submit"
          className="w-full px-3 py-2 text-[13px] font-semibold">
          Log out
        </Button>
      </form>
    </div>
  );
}
