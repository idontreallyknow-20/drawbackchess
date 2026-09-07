"use client";

// AUDIO: the whole mix desk. Game sfx with its own volume (separate from the
// music bed), per-voice mutes, the track picker with BPM + mood tags, import
// your own audio, and a deterministic level-meter strip precomputed from the
// scheduled event envelope that a playback needle rides during preview.

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import type { ClipAudioEvent } from "../../clipScene";
import { MUSIC_TRACKS } from "../../clipMusic";
import { TRACK_META } from "../../clipOptions";
import { Chip, Row, SliderRow, ToggleRow, type Studio } from "../controls";

const METER_BARS = 96;

/** Deterministic loudness weight per scheduled event kind. */
const EVENT_WEIGHT: Record<ClipAudioEvent["kind"], number> = {
  impact: 1,
  verdict: 0.92,
  capture: 0.8,
  card: 0.7,
  intro: 0.62,
  outro: 0.55,
  move: 0.5,
  riser: 0.42,
  shimmer: 0.3,
  flip: 0.3,
  tick: 0.18,
};

/** Envelope per meter bar: each event contributes a decaying tail. Pure
 *  function of the schedule, so the strip is stable per config. */
function meterEnvelope(events: ClipAudioEvent[], durationMs: number): number[] {
  const bars = new Array<number>(METER_BARS).fill(0.04);
  const barMs = durationMs / METER_BARS;
  for (const ev of events) {
    const w = EVENT_WEIGHT[ev.kind];
    const startBar = Math.floor(ev.t / barMs);
    for (let k = 0; k < 6; k++) {
      const i = startBar + k;
      if (i < 0 || i >= METER_BARS) continue;
      bars[i] = Math.min(1, bars[i] + w * Math.pow(0.55, k));
    }
  }
  return bars;
}

function Meter({ studio }: { studio: Studio }) {
  const { scene, accent, registerTickTarget } = studio;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scene) return;
    const w = 320;
    const h = 26;
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.fillStyle = "#0f0c09";
    g.fillRect(0, 0, w, h);
    const bars = meterEnvelope(scene.audio, scene.durationMs);
    const bw = w / METER_BARS;
    for (let i = 0; i < METER_BARS; i++) {
      const v = bars[i];
      const bh = Math.max(1, Math.round(v * (h - 4)));
      g.fillStyle = v > 0.85 ? accent : v > 0.45 ? "rgba(236,231,221,0.75)" : "rgba(236,231,221,0.32)";
      g.fillRect(Math.round(i * bw) + 1, h - 2 - bh, Math.max(1, Math.floor(bw) - 1), bh);
    }
  }, [scene, accent]);

  return (
    <div className="clip-meter" aria-hidden>
      <canvas ref={canvasRef} />
      <span className="clip-meter-needle" ref={(el) => registerTickTarget("needle", el)} />
    </div>
  );
}

export function AudioPanel({ studio }: { studio: Studio }) {
  const {
    opts, set, locked, customMusic, pickMusicFile, clearCustomMusic,
    musicFileRef, importMusicFile,
  } = studio;
  const mutes = opts.voiceMutes;
  const flipMute = (key: keyof typeof mutes) =>
    set("voiceMutes", { ...mutes, [key]: !mutes[key] });
  return (
    <div className="clip-panel">
      <div className="clip-row">
        <span className="clip-row-label">Levels</span>
        <div className="clip-row-body" style={{ flexWrap: "nowrap" }}>
          <Meter studio={studio} />
        </div>
      </div>
      <ToggleRow
        label="SFX"
        disabled={locked}
        toggles={[{ label: "Game sound", on: opts.sound, onClick: () => set("sound", !opts.sound) }]}
      />
      <SliderRow
        label="SFX vol"
        value={Math.round(opts.sfxVolume * 100)}
        onChange={(v) => set("sfxVolume", v / 100)}
        disabled={locked || !opts.sound}
      />
      <Row label="Voices">
        <Chip label="Moves" on={!mutes.moves} onClick={() => flipMute("moves")} disabled={locked || !opts.sound} />
        <Chip label="Cards" on={!mutes.cards} onClick={() => flipMute("cards")} disabled={locked || !opts.sound} />
        <Chip label="Verdict" on={!mutes.verdict} onClick={() => flipMute("verdict")} disabled={locked || !opts.sound} />
        <Chip label="Ambience" on={!mutes.ambience} onClick={() => flipMute("ambience")} disabled={locked || !opts.sound} />
      </Row>
      <ToggleRow
        label="Music"
        disabled={locked}
        toggles={[{ label: "Backing track", on: opts.musicOn, onClick: () => set("musicOn", !opts.musicOn) }]}
      />
      <SliderRow
        label="Music vol"
        value={Math.round(opts.musicVolume * 100)}
        onChange={(v) => set("musicVolume", v / 100)}
        disabled={locked || !opts.musicOn}
      />
      {opts.musicOn && !customMusic && (
        <Row label="Track">
          {MUSIC_TRACKS.map((tr) => (
            <Chip
              key={tr.id}
              label={`${tr.label} ${TRACK_META[tr.id].bpm} ${TRACK_META[tr.id].mood}`}
              on={opts.musicTrack === tr.id}
              onClick={() => set("musicTrack", tr.id)}
              disabled={locked}
            />
          ))}
        </Row>
      )}
      {opts.musicOn && (
        <Row label="Import">
          <input
            ref={musicFileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            data-clip-music-file
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) importMusicFile(file);
            }}
          />
          {customMusic ? (
            <>
              <span className="max-w-[11rem] truncate text-[12px] text-gold-leaf" data-clip-music-name>
                {customMusic.name}
              </span>
              <Button tone="ghost" size="xs" onClick={clearCustomMusic} disabled={locked} className="text-parchment-300">
                Clear
              </Button>
            </>
          ) : (
            <Button tone="ghost" size="xs" onClick={pickMusicFile} disabled={locked} className="text-parchment-300">
              Your own audio
            </Button>
          )}
          <span className="text-[12px] text-parchment-400">stays on this device</span>
        </Row>
      )}
    </div>
  );
}
