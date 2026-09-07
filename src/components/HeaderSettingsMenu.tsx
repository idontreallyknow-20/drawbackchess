"use client";

// The header quick-settings menu (Lichess calls it the dasher).
//
// Everything a player wants to change mid-session without leaving the page:
// the background palette, the board, the piece set, the board size, sound, and
// zen mode, plus a door to the full Preferences panel. Every control writes
// through the SAME path the Preferences panel uses (saveSettings, which
// re-applies the board colours, the piece set and the UI prefs, then tells the
// sound engine), so a change here and a change there are indistinguishable.
//
// The surface is a plain dropdown box: panel fill, one hairline border, 7px
// corners. No glow, no dungeon material.

import { useCallback, useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon, X } from "lucide-react";
import type { CSSProperties } from "react";
import {
  BOARD_THEMES,
  BoardTheme,
  PIECE_THEMES,
  PieceColor,
  PieceTheme,
  pieceLook,
  SETTINGS_CHANGED_EVENT,
  SITE_THEMES,
  SiteTheme,
  Settings,
  loadSettings,
  saveSettings,
} from "@/lib/settings";
import { configureSoundPrefs, setUiSounds, setVolume } from "@/lib/sounds";
import { Piece } from "@/components/Pieces";
import { Button } from "@/components/ui/Button";
import { useZenMode } from "@/lib/useZenMode";

const PANEL_STYLE: CSSProperties = {
  background: "var(--bg-panel)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--ui-roundness)",
  boxShadow: "0 14px 28px rgba(0,0,0,0.15), 0 10px 10px rgba(0,0,0,0.12)",
};

const THEME_ORDER: SiteTheme[] = ["dark", "midnight", "light", "system"];

/** The white knight from a piece set, the same preview the Preferences piece
 *  picker shows: an asset set draws its own wN.svg, an inline set draws the
 *  shared <Piece> with that set's fills pushed in as variables. */
function KnightPreview({ theme, color, size = 20 }: { theme: PieceTheme; color: PieceColor; size?: number }) {
  const t = pieceLook(theme, color);
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center"
      style={
        {
          "--piece-w-fill": t.wFill,
          "--piece-w-stroke": t.wStroke,
          "--piece-b-fill": t.bFill,
          "--piece-b-stroke": t.bStroke,
        } as CSSProperties
      }
    >
      {t.assetSet ? (
        <span
          className="bg-contain bg-center bg-no-repeat"
          style={{
            width: size,
            height: size,
            backgroundImage: `url("/piece/lichess/${t.assetSet}/wN.svg")`,
          }}
        />
      ) : (
        <Piece type="n" color="w" size={size} />
      )}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em]"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </div>
  );
}

/** A compact switch. Sized, not padded, so it is a hit target rather than a
 *  hand-rolled slab; the fill comes from the theme's accent. */
function MiniToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="pill-switch relative inline-flex h-6 w-11 shrink-0 items-center transition-colors"
      style={{
        background: checked ? "var(--accent)" : "var(--bg-raised)",
        boxShadow: "inset 0 0 0 1px var(--border-subtle)",
      }}
    >
      <span
        aria-hidden
        className="block h-4 w-4 rounded-full transition-transform"
        style={{
          background: checked ? "var(--text-on-accent, #fff)" : "var(--text-secondary)",
          transform: checked ? "translateX(24px)" : "translateX(4px)",
        }}
      />
    </button>
  );
}

/** A labelled range. The readout keeps the row honest about what the drag did. */
function MiniSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  format: (v: number) => string;
}) {
  return (
    <label className="flex items-center gap-2.5 text-[13px]" style={{ color: "var(--text-primary)" }}>
      <span className="w-20 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-11 min-w-0 flex-1 cursor-pointer sm:h-6"
        style={{ accentColor: "var(--accent)" }}
      />
      <span
        className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums"
        style={{ color: "var(--text-secondary)" }}
      >
        {format(value)}
      </span>
    </label>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The gear button and the dropdown it opens. Owns its own open state; the
 *  header passes onOpen so its other menus can stand down, and
 *  onOpenPreferences so the full panel is one click away. */
export function HeaderSettingsMenu({
  onOpen,
  onOpenPreferences,
  className,
}: {
  onOpen?: () => void;
  onOpenPreferences?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Stay in step with every other surface: the full Preferences panel, the
  // `z` key, and the settings sync all fire the same event.
  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
  }, []);

  // Outside click and Escape close it; Escape hands focus back to the gear.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // The single write path, mirroring the Preferences panel: persist (which
  // re-applies board, pieces and UI prefs), then push audio into the engine.
  const update = useCallback((patch: Partial<Settings>) => {
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
  }, []);

  return (
    <div ref={rootRef} className={"relative " + (className ?? "")}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Quick settings"
        title="Quick settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="nav-icon-btn relative grid h-11 w-11 place-items-center text-parchment-300 hover:bg-[color:var(--bg-hover)] hover:text-parchment-50 sm:h-10 sm:w-10"
        onClick={() => {
          const next = !open;
          // Re-read on the way open so a value changed elsewhere is current.
          if (next) {
            setSettings(loadSettings());
            onOpen?.();
          }
          setOpen(next);
        }}
      >
        <SettingsIcon size={18} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Quick settings"
          className="absolute right-0 top-full z-50 mt-2 w-[19rem] max-w-[calc(100vw-1.5rem)] space-y-3.5 overflow-y-auto p-3 text-[13px]"
          style={{ ...PANEL_STYLE, maxHeight: "min(32rem, calc(100vh - 5rem))" }}
        >
          <BackgroundSection value={settings.siteTheme} onPick={(t) => update({ siteTheme: t })} />
          <BoardSection value={settings.boardTheme} onPick={(b) => update({ boardTheme: b })} />
          <PieceSection
            value={settings.pieceTheme}
            color={settings.pieceColor}
            onPick={(p) => update({ pieceTheme: p })}
          />

          <div>
            <SectionLabel>Board size</SectionLabel>
            <MiniSlider
              label="Size"
              value={settings.boardSize}
              min={0.8}
              max={1.1}
              step={0.05}
              format={pct}
              onChange={(v) => update({ boardSize: v })}
            />
          </div>

          <div>
            <SectionLabel>Sound</SectionLabel>
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: "var(--text-primary)" }}>Sound</span>
              <MiniToggle
                label="Sound"
                checked={settings.soundEnabled}
                onChange={(v) => update({ soundEnabled: v })}
              />
            </div>
            <div className="mt-2">
              <MiniSlider
                label="Volume"
                value={settings.volume}
                min={0}
                max={1}
                step={0.05}
                format={pct}
                onChange={(v) => update({ volume: v })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span style={{ color: "var(--text-primary)" }}>
              Zen mode
              <span className="ml-1.5 font-mono text-[12px]" style={{ color: "var(--text-muted)" }}>
                z
              </span>
            </span>
            <MiniToggle
              label="Zen mode"
              checked={settings.zenMode}
              onChange={(v) => update({ zenMode: v })}
            />
          </div>

          {onOpenPreferences && (
            <div style={{ borderTop: "1px solid var(--border-subtle)" }} className="pt-2.5">
              <Button
                tone="ghost"
                size="sm"
                block
                onClick={() => {
                  setOpen(false);
                  onOpenPreferences();
                }}
              >
                All preferences
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BackgroundSection({ value, onPick }: { value: SiteTheme; onPick: (t: SiteTheme) => void }) {
  return (
    <div>
      <SectionLabel>Background</SectionLabel>
      <div className="grid grid-cols-2 gap-1.5">
        {THEME_ORDER.map((id) => (
          <Button
            key={id}
            tone={value === id ? "leaf" : "ghost"}
            size="sm"
            block
            aria-pressed={value === id}
            onClick={() => onPick(id)}
          >
            {SITE_THEMES[id].label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Selection ring shared by the two swatch grids. */
function tileStyle(selected: boolean): CSSProperties {
  return {
    borderRadius: "3px",
    boxShadow: selected
      ? "0 0 0 2px var(--accent)"
      : "inset 0 0 0 1px var(--border-subtle)",
  };
}

function BoardSection({ value, onPick }: { value: BoardTheme; onPick: (b: BoardTheme) => void }) {
  return (
    <div>
      <SectionLabel>Board</SectionLabel>
      <div className="grid grid-cols-6 gap-1.5">
        {(Object.keys(BOARD_THEMES) as BoardTheme[]).map((id) => {
          const t = BOARD_THEMES[id];
          const selected = value === id;
          return (
            <button
              key={id}
              type="button"
              title={t.label}
              aria-label={t.label}
              aria-pressed={selected}
              onClick={() => onPick(id)}
              className="grid h-11 w-full place-items-center sm:h-9"
            >
              <span
                aria-hidden
                className="grid h-7 w-7 grid-cols-2 grid-rows-2 overflow-hidden"
                style={tileStyle(selected)}
              >
                <span style={{ background: t.light }} />
                <span style={{ background: t.dark }} />
                <span style={{ background: t.dark }} />
                <span style={{ background: t.light }} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PieceSection({
  value,
  color,
  onPick,
}: {
  value: PieceTheme;
  color: PieceColor;
  onPick: (p: PieceTheme) => void;
}) {
  return (
    <div>
      <SectionLabel>Pieces</SectionLabel>
      <div className="grid grid-cols-6 gap-1.5">
        {(Object.keys(PIECE_THEMES) as PieceTheme[]).map((id) => {
          const t = PIECE_THEMES[id];
          const selected = value === id;
          return (
            <button
              key={id}
              type="button"
              title={t.label}
              aria-label={t.label}
              aria-pressed={selected}
              onClick={() => onPick(id)}
              className="grid h-11 w-full place-items-center sm:h-9"
            >
              <span
                className="grid h-7 w-7 place-items-center"
                style={{ ...tileStyle(selected), background: "var(--bg-raised)" }}
              >
                <KnightPreview theme={id} color={color} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The only thing left on screen while zen mode is on: the way out. Rendered
 *  inside the header so it survives every page that has one; zen.css keeps it
 *  hidden until the flag is set. */
export function ZenExitButton() {
  const { zen, setZen } = useZenMode();
  return (
    <Button
      tone="ghost"
      size="sm"
      className="zen-exit"
      aria-hidden={!zen}
      tabIndex={zen ? undefined : -1}
      onClick={() => setZen(false)}
    >
      <X size={14} aria-hidden />
      Exit zen (z)
    </Button>
  );
}
