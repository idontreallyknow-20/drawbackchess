"use client";

// THE STUDIO: the clip modal rebuilt as a recording panel. Three zones:
//
//   VIEWPORT  the preview canvas in editor chrome (REC strip, resolution
//             readout, live mono timecode, viewfinder brackets, transport).
//   TIMELINE  a film-strip scrubber over the whole reel: one cell per ply,
//             capture tint, card ticks, payoff bracket, draggable playhead.
//   DECK      the control surface: preset swatches pinned over a smallcaps
//             tab rail (STYLE / CAM / FX / PACE / GRADE / TEXT / AUDIO /
//             EXPLAIN / BRAND / FORMAT), dense label-left rows below.
//
// The instant-reel machinery is unchanged underneath: opening the modal
// starts the offline Tier 1 encode immediately; every config change discards
// the take and re-renders on a 450ms debounce. Transport state (play, pause,
// scrub) lives entirely in refs and the renderer handle, so seeking and
// pausing can NEVER trigger a re-encode. Browsers without WebCodecs get the
// realtime Tier 2 recorder behind an explicit Record button; the rest get an
// honest "unsupported".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardState, Color, Move } from "@/engine/types";
import type { GameResult } from "@/engine/game";
import {
  pieceLook,
  boardColors,
  loadSettings,
  resolvePieceTheme,
} from "@/lib/settings";
import {
  applyChapterMods,
  applyPlySkips,
  buildClipTimeline,
  buildHighlightsTimeline,
  chapterTitle,
  pickWindowPayoff,
  planAutoClip,
  planHighlights,
  type ClipChapterMod,
  type ClipPlyMod,
} from "./clipReplay";
import {
  PIECE_WORD,
  biggestClipCard,
  buildClipScene,
  clipLayout,
  hookDragBand,
  loadClipPieceImages,
  type ClipPoster,
  type ClipScene,
  type ClipSceneChapterIn,
  type ClipVerdict,
  type ClipVersusCard,
  type PieceImageSource,
} from "./clipScene";
import { STICKER_CAP, type ClipSticker, type StickerId } from "./clipStickers";
import {
  EncodeCancelled,
  QUALITY_BITRATE,
  detectEncodeSupport,
  encodeClipOffline,
  recordClipRealtime,
  type ClipFps,
  type EncodeSupport,
} from "./clipEncoder";
import { playPreviewSfx, type ClipAudioOptions } from "./clipAudio";
import { type ClipCustomMusic, type ClipMusicSelection } from "./clipMusic";
import {
  REEL_BOARD_THEMES,
  STYLE_DEFAULTS,
  surpriseStyle,
  type ClipStyle,
  type StylePreset,
} from "./clipStyles";
import {
  exportPresetCode,
  importPresetCode,
  loadSavedPresets,
  storeSavedPresets,
  touchSavedPreset,
  upsertSavedPreset,
  type SavedClipPreset,
  type SavedPresetExtras,
} from "./clipPresets";
import { buildPostKit } from "./clipPost";
import {
  HOOK_PRESETS,
  TIKTOK_MODE,
  TRACK_META,
  type ClipOptionsState,
  type PliesChoice,
} from "./clipOptions";
import { type ClipRendererHandle } from "./ClipRenderer";
import { Viewport, formatClipTime } from "./studio/Viewport";
import { Timeline } from "./studio/Timeline";
import { Deck } from "./studio/Deck";
import type { Studio } from "./studio/controls";
import { useModalChrome } from "@/lib/useModalChrome";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { Button } from "@/components/ui/Button";
import "./clipStudio.css";

interface Props {
  open: boolean;
  onClose: () => void;
  moves: Move[];
  /** Per-ply board snapshots from the game page (history-review cache). */
  snapshots: ReadonlyMap<number, BoardState>;
  historyDiverged: boolean;
  /** Buff ids of signature plays keyed by history length at fire time. */
  signatureIds?: ReadonlyMap<number, string>;
  orientation: Color;
  playerNames: Record<Color, string>;
  result?: GameResult | null;
  /** Ratings per side (rated games only); shown on the versus intro card. */
  ratings?: Partial<Record<Color, number>> | null;
  /** Mode chip line for the versus intro card (BUFF / NERF). */
  modeChip?: string | null;
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ClipModal({
  open,
  onClose,
  moves,
  snapshots,
  historyDiverged,
  signatureIds,
  orientation,
  playerNames,
  result,
  ratings,
  modeChip,
}: Props) {
  const chrome = useModalChrome(open, onClose);
  const reduced = useReducedMotion();
  const [pliesChoice, setPliesChoiceState] = useState<PliesChoice>("auto");
  const [opts, setOpts] = useState<ClipOptionsState>(TIKTOK_MODE);
  // Which style preset the current knobs came from (null: hand-tuned), and
  // the Surprise-me tap counter (each tap is a fresh deterministic shuffle).
  const [presetId, setPresetId] = useState<string | null>("tiktok");
  const [surpriseTap, setSurpriseTap] = useState(0);
  const [hook, setHook] = useState<string | null>(null); // null = auto default
  // Saved presets (localStorage only, LRU-capped at 12). Lazy init: the
  // modal mounts fresh per open, and loadSavedPresets is SSR-safe.
  const [savedPresets, setSavedPresets] = useState<SavedClipPreset[]>(() => loadSavedPresets());
  // A/B compare: the pinned style renders right of the seam at the same t.
  const [compareOn, setCompareOn] = useState(false);
  const [pinned, setPinned] = useState<{ name: string; style: ClipStyle } | null>(null);
  // Post kit fold under the export bar.
  const [postOpen, setPostOpen] = useState(false);
  const [postCopied, setPostCopied] = useState(false);
  const [images, setImages] = useState<Map<string, HTMLImageElement> | null>(null);
  const [support, setSupport] = useState<EncodeSupport | null>(null);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [clip, setClip] = useState<{
    url: string;
    blob: Blob;
    container: "mp4" | "webm";
    tier: 1 | 2;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  // GIF loop export: a secondary take of just the payoff window. Encoded on
  // demand (never automatically) and discarded with the video take.
  const [gif, setGif] = useState<{ url: string; blob: Blob } | null>(null);
  const [gifBusy, setGifBusy] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const gifUrlRef = useRef<string | null>(null);
  const gifRunRef = useRef(0);
  // Imported backing track (audio/*, decoded client-side, never uploaded).
  const [customMusic, setCustomMusic] = useState<ClipCustomMusic | null>(null);
  const musicFileRef = useRef<HTMLInputElement | null>(null);
  const rendererRef = useRef<ClipRendererHandle | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const clipUrlRef = useRef<string | null>(null);
  // Monotonic id for the background auto-encode: bumping it cancels whatever
  // render is in flight (the encoder polls it between frames).
  const encodeRunRef = useRef(0);

  // --- Transport state: refs + tiny UI mirrors, NEVER config state ----------
  const [playing, setPlaying] = useState(true);
  const playingRef = useRef(true);
  const [loopOn, setLoopOn] = useState(true);
  const [muted, setMuted] = useState(true);
  const wasPlayingRef = useRef(false);
  const monitorRef = useRef<{ stop: () => void } | null>(null);
  const tickTargets = useRef<Record<string, HTMLElement | null>>({});
  const sceneRef = useRef<ClipScene | null>(null);
  const optsRef = useRef(opts);
  const mutedRef = useRef(muted);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // Board colors and piece sprites follow the player's settings so the clip
  // looks like THEIR board. Inline piece themes rasterize the site's own SVG
  // silhouettes rather than swapping to a lichess set.
  const { colors, pieceSource } = useMemo(() => {
    const s = loadSettings();
    const t = pieceLook(resolvePieceTheme(s), s.pieceColor);
    const source: PieceImageSource = t.assetSet
      ? { kind: "asset", set: t.assetSet }
      : { kind: "inline", wFill: t.wFill, wStroke: t.wStroke, bFill: t.bFill, bStroke: t.bStroke };
    return { colors: boardColors(s), pieceSource: source };
    // Re-read when the modal reopens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fonts and accent resolved once from the document's CSS variables. Three
  // voices reach the frame: display slams, body rule copy, mono chrome.
  const { fonts, accent } = useMemo(() => {
    const fallback = {
      fonts: {
        display: "system-ui, sans-serif",
        body: "system-ui, sans-serif",
        mono: "ui-monospace, monospace",
      },
      accent: "#d4a017", // gold literal, mirrors --accent-gold (canvas can't read CSS vars)
    };
    if (typeof document === "undefined") return fallback;
    const read = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const font = (name: string, fb: string) => {
      const v = read(name);
      return v ? `${v}, ${fb}` : fb;
    };
    return {
      fonts: {
        display: font("--font-display", "system-ui, sans-serif"),
        body: font("--font-body", "system-ui, sans-serif"),
        mono: font("--font-mono", "ui-monospace, monospace"),
      },
      accent: read("--accent-hi") || read("--accent") || fallback.accent,
    };
  }, []);

  // The auto-director's pick: window length + payoff ply + what the payoff IS
  // (drives the suggested hook). Recomputed only when the inputs change.
  const autoPlan = useMemo(
    () =>
      open
        ? planAutoClip({ moves, snapshots, historyDiverged, signatureIds })
        : null,
    [open, moves, snapshots, historyDiverged, signatureIds],
  );

  // How far back the window handles can reach: the longest reconstructable
  // tail (the auto-director's own 14-ply scan depth).
  const windowProbe = useMemo(
    () =>
      open
        ? buildClipTimeline({ moves, snapshots, historyDiverged, plies: 14, signatureIds })
        : null,
    [open, moves, snapshots, historyDiverged, signatureIds],
  );
  const availStart = windowProbe?.startPly ?? Math.max(0, moves.length - 2);
  const head = moves.length;

  // Highlights: scan the WHOLE game for up to 3 distinct moments (>= 8 plies
  // apart). The 8s length target trims the chapter count to 2; the reel
  // length itself is fit by hold trims inside the scene build.
  const highlightsPlan = useMemo(
    () =>
      open
        ? planHighlights(
            { moves, snapshots, historyDiverged, signatureIds },
            opts.lengthTarget === 8 ? 2 : 3,
          )
        : null,
    [open, moves, snapshots, historyDiverged, signatureIds, opts.lengthTarget],
  );
  const highlightsOn = opts.format === "highlights" && !!highlightsPlan;
  const chapterAvailStart = highlightsPlan?.availStart ?? 0;
  // Chapter edge drags applied over the plan, clamped to stay ordered.
  const chapters = useMemo(
    () =>
      highlightsOn && highlightsPlan
        ? applyChapterMods(
            highlightsPlan.chapters,
            opts.chapterMods,
            chapterAvailStart,
            moves.length,
          )
        : null,
    [highlightsOn, highlightsPlan, opts.chapterMods, chapterAvailStart, moves.length],
  );

  // Reel length target in ms (null keeps the natural duration; highlights
  // clamp themselves into the 8-20s band inside the scene build).
  const targetMs = opts.lengthTarget === "auto" ? null : opts.lengthTarget * 1000;

  // The manual window (drag handles) beats the Last-N chips beats the
  // director. plies counts back from the window's END, which is the head
  // unless the manual window cut it earlier. Highlights mode replaces the
  // window entirely with its chapter windows.
  const win = highlightsOn ? null : opts.clipWindow;
  const plies = win
    ? win.end - win.start
    : pliesChoice === "auto"
      ? (() => {
          const auto = autoPlan?.plies ?? 8;
          if (targetMs === null) return auto;
          // Reel length target: the planner may TRIM the auto window toward
          // the target (never stretch it, and never touch a manual cut);
          // hold trims inside the scene build do the fine fit.
          const chrome = 3100 + (opts.versusIntro ? 1500 : 0);
          const fit = Math.max(4, Math.min(14, Math.round((targetMs - chrome) / 850)));
          return Math.min(auto, fit);
        })()
      : pliesChoice;

  const baseTimeline = useMemo(() => {
    if (!open) return null;
    if (chapters) {
      return buildHighlightsTimeline(
        { moves, snapshots, historyDiverged, signatureIds },
        chapters,
      );
    }
    return buildClipTimeline({
      moves,
      snapshots,
      historyDiverged,
      plies,
      endPly: win?.end,
      signatureIds,
    });
  }, [open, moves, snapshots, historyDiverged, plies, win, signatureIds, chapters]);

  // Per-ply skips are hard cuts: dropped segments, jump-cut boards.
  const timeline = useMemo(
    () => (baseTimeline ? applyPlySkips(baseTimeline, opts.plyMods) : null),
    [baseTimeline, opts.plyMods],
  );

  // The payoff: a manual "Set as payoff" override wins; highlights reels use
  // the LAST chapter's moment (the kill); a manual window repicks within
  // itself with the director's priorities; otherwise the auto plan's pick
  // (auto window) or the scene's internal scan (Last-N).
  const payoffPly = useMemo(() => {
    if (opts.payoffPly !== null) return opts.payoffPly;
    if (chapters && chapters.length > 0) return chapters[chapters.length - 1].payoffPly;
    if (win) return timeline ? pickWindowPayoff(timeline) : null;
    return pliesChoice === "auto" ? (autoPlan?.payoffPly ?? null) : null;
  }, [opts.payoffPly, chapters, win, timeline, pliesChoice, autoPlan]);

  // Chapter data for the scene build + the studio timeline: resolved titles
  // (auto by role / card name, edited via the chapter chip).
  const sceneChapters = useMemo<ClipSceneChapterIn[] | null>(() => {
    if (!chapters) return null;
    return chapters.map((ch) => ({
      fromPly: ch.start,
      toPly: ch.end - 1,
      payoffPly: ch.payoffPly,
      title: chapterTitle(ch, opts.chapterMods[ch.payoffPly]),
    }));
  }, [chapters, opts.chapterMods]);

  // Versus intro card data (names fall back to YOU / THEM; ratings and the
  // mode chip only when the host page provides them).
  const versus = useMemo<ClipVersusCard | null>(
    () =>
      opts.versusIntro
        ? {
            w: playerNames.w?.trim() || "YOU",
            b: playerNames.b?.trim() || "THEM",
            wRating: ratings?.w ?? null,
            bRating: ratings?.b ?? null,
            chip: modeChip ?? null,
          }
        : null,
    [opts.versusIntro, playerNames, ratings, modeChip],
  );

  const bigCard = useMemo(() => (timeline ? biggestClipCard(timeline) : null), [timeline]);

  // Reel board themes recolor squares + frame in the render only.
  const reelColors = useMemo(() => {
    if (opts.boardTheme === "site") return colors;
    const t = REEL_BOARD_THEMES[opts.boardTheme];
    return { light: t.light, dark: t.dark, frame: t.frame };
  }, [colors, opts.boardTheme]);

  // Hook auto-suggested from the payoff, respecting the emoji knob.
  const hookSuggestion = useMemo(() => {
    const level = opts.emojiLevel;
    if (autoPlan?.kind === "card" && autoPlan.card) {
      const base = `${autoPlan.card.name.toUpperCase()} IS BROKEN`;
      return level === "brainrot" ? `${base} \u{1F525}` : base;
    }
    if (autoPlan?.kind === "capture" && autoPlan.captured) {
      const base = `WAIT FOR THE ${PIECE_WORD[autoPlan.captured]}`;
      if (level === "off") return base;
      return level === "brainrot" ? `${base} \u{1F480}\u{1F480}` : `${base} \u{1F480}`;
    }
    if (bigCard) return `${bigCard.name.toUpperCase()} IS BROKEN`;
    return HOOK_PRESETS[0];
  }, [autoPlan, bigCard, opts.emojiLevel]);

  // Intro title templates: a non-custom template supplies the hook line (the
  // "ruined" one auto-fills the payoff card's name) AND restyles the intro
  // slam typography inside the scene renderer. Custom keeps free text.
  const templateHook = useMemo(() => {
    const card = autoPlan?.card ?? bigCard;
    switch (opts.style.titleTemplate) {
      case "pov": {
        if (card) return `POV: HE DRAWS ${card.name.toUpperCase()}`;
        if (autoPlan?.kind === "capture" && autoPlan.captured) {
          return `POV: YOUR ${PIECE_WORD[autoPlan.captured]} IS GONE`;
        }
        return "POV: THE ENDGAME FINDS YOU";
      }
      case "neversaw":
        return "He never saw it coming";
      case "waitforit":
        return "Wait for it...";
      case "illegal":
        return "This card is ILLEGAL";
      case "ruined":
        return `${card?.name ?? "This card"} just ruined his life`;
      default:
        return null;
    }
  }, [opts.style.titleTemplate, autoPlan, bigCard]);
  const hookText = templateHook ?? hook ?? hookSuggestion;

  // Whether the reel's last animated ply IS the game's final ply (manual
  // windows and skips can both cut the finish out).
  const coversEnd =
    !!timeline &&
    timeline.segments.length > 0 &&
    timeline.segments[timeline.segments.length - 1].ply >= moves.length - 1;

  const verdict = useMemo<ClipVerdict | null>(() => {
    if (result && coversEnd) {
      if (result.winner === "draw") return { main: "DRAW", sub: result.reason };
      if (result.winner === "w" || result.winner === "b") {
        const name = playerNames[result.winner];
        if (result.reason === "no legal moves" || result.reason === "king captured") {
          return { main: "CHECKMATE", sub: `${name} wins` };
        }
        return {
          main: name.toLowerCase() === "you" ? "YOU WIN" : `${name.toUpperCase()} WINS`,
          sub: result.reason,
        };
      }
      return { main: "GAME OVER", sub: null };
    }
    if (bigCard) return { main: bigCard.name.toUpperCase(), sub: "signature play" };
    return { main: "TO BE CONTINUED", sub: null };
  }, [result, coversEnd, playerNames, bigCard]);

  // Thumbnail designer spec: null keeps the classic frame-0 poster.
  const poster = useMemo<ClipPoster | null>(
    () =>
      opts.posterFrac === null
        ? null
        : {
            frac: opts.posterFrac,
            text: opts.posterText.trim() || hookText,
            ring: opts.posterRing,
          },
    [opts.posterFrac, opts.posterText, opts.posterRing, hookText],
  );

  // Beat grid for beat-synced cuts: built-in tracks only (imported audio has
  // no BPM map, so the PACE toggle disables itself with a note).
  const beatBpm =
    opts.style.beatSync && opts.musicOn && !customMusic
      ? TRACK_META[opts.musicTrack].bpm
      : null;

  const scene = useMemo<ClipScene | null>(() => {
    if (!timeline) return null;
    return buildClipScene({
      timeline,
      orientation,
      colors: reelColors,
      names: playerNames,
      aspect: opts.aspect,
      hookText,
      captionStyle: opts.captionStyle,
      emojiLevel: opts.emojiLevel,
      style: opts.style,
      ctaText: opts.ctaText,
      speedRamp: opts.speedRamp,
      freezeStamp: opts.freezeStamp,
      momentumBar: opts.momentumBar,
      moveCounter: opts.moveCounter,
      watermark: opts.watermarkOn ? opts.handle.trim() || "nerfchess.com" : null,
      endCard: opts.endCard,
      explainArrows: opts.explainArrows,
      explainRules: opts.explainRules,
      explainCallouts: opts.explainCallouts,
      verdict,
      fonts,
      accent,
      payoffPly,
      beatBpm,
      poster,
      plyMods: opts.plyMods,
      commentaryOn: opts.commentaryOn,
      chapters: sceneChapters,
      versus,
      stickers: opts.stickers,
      hookYFrac: opts.hookYFrac,
      hookScale: opts.hookScale,
      targetMs,
    });
  }, [
    timeline,
    orientation,
    reelColors,
    playerNames,
    opts,
    hookText,
    verdict,
    fonts,
    accent,
    payoffPly,
    beatBpm,
    poster,
    sceneChapters,
    versus,
    targetMs,
  ]);
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  // The pinned style's scene for A/B compare: the SAME options with only the
  // style pack swapped, so both panes read the same t through one renderer.
  // The export always uses the current (left) scene.
  const pinnedScene = useMemo<ClipScene | null>(() => {
    if (!compareOn || !pinned || !scene) return null;
    return buildClipScene({ ...scene.opts, style: pinned.style });
  }, [compareOn, pinned, scene]);

  // The music selection handed to both encode tiers. Null when off; the
  // imported track (if any) replaces the built-in one.
  const music = useMemo<ClipMusicSelection | null>(
    () =>
      opts.musicOn
        ? { track: opts.musicTrack, volume: opts.musicVolume, custom: customMusic }
        : null,
    [opts.musicOn, opts.musicTrack, opts.musicVolume, customMusic],
  );

  // The whole audio mix: sfx level + per-voice mutes + the music bed. One
  // object so the encode effect keys on every audible knob.
  const audioMix = useMemo<ClipAudioOptions>(
    () => ({
      sfx: opts.sound,
      sfxVolume: opts.sfxVolume,
      mutes: opts.voiceMutes,
      music,
    }),
    [opts.sound, opts.sfxVolume, opts.voiceMutes, music],
  );

  const discardClip = useCallback(() => {
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = null;
    setClip(null);
    setShared(false);
    // The GIF is a take of the same config: discard it too, and supersede any
    // GIF encode in flight (the encoder polls the run id between frames).
    if (gifUrlRef.current) URL.revokeObjectURL(gifUrlRef.current);
    gifUrlRef.current = null;
    setGif(null);
    gifRunRef.current++;
    setGifBusy(false);
  }, []);

  // GIF loop: 2-4s of the payoff window, encoded client-side by the
  // dependency-free quantizer + LZW in clipGif.ts.
  const exportGif = useCallback(async () => {
    const sc = sceneRef.current;
    if (!sc || !images || gifBusy) return;
    const run = ++gifRunRef.current;
    setGifBusy(true);
    setGifProgress(0);
    try {
      const { encodeClipGif } = await import("./clipGif");
      const res = await encodeClipGif(
        sc,
        images,
        (f) => {
          if (gifRunRef.current === run) setGifProgress(f);
        },
        () => gifRunRef.current !== run,
      );
      if (gifRunRef.current !== run) return;
      const url = URL.createObjectURL(res.blob);
      gifUrlRef.current = url;
      setGif({ url, blob: res.blob });
      // Surfaced for automated tests / debugging.
      console.log(`nerfchess gif recorded: ${res.blob.size} bytes`);
    } catch (e) {
      if (gifRunRef.current === run && (e as Error)?.name !== "GifCancelled") {
        setError("GIF export failed in this browser.");
      }
    } finally {
      if (gifRunRef.current === run) setGifBusy(false);
    }
  }, [images, gifBusy]);

  // Piece sprites, loaded once per source (the modal mounts fresh per open,
  // so the initial null state already covers the loading readout).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadClipPieceImages(pieceSource).then((loaded) => {
      if (!cancelled) setImages(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [open, pieceSource]);

  // Which encode tier this browser gets, for the readout and the encode path.
  // Probed at the selected quality's bitrate so the answer matches the take.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const L = clipLayout(opts.aspect);
    detectEncodeSupport(
      L.W,
      L.H,
      opts.sound || opts.musicOn,
      QUALITY_BITRATE[opts.quality],
    ).then((s) => {
      if (!cancelled) setSupport(s);
    });
    return () => {
      cancelled = true;
    };
  }, [open, opts.aspect, opts.sound, opts.musicOn, opts.quality]);

  // Export settings: quality bitrate always applies; 60fps applies only when
  // the probe said the codec takes it (else fall back to 30 with a note).
  const bitrate = QUALITY_BITRATE[opts.quality];
  const effFps: ClipFps = opts.fps === 60 && support?.fps60 ? 60 : 30;

  useEffect(() => {
    const runRef = encodeRunRef;
    const monitor = monitorRef;
    const gifRun = gifRunRef;
    return () => {
      stopRef.current?.();
      runRef.current++;
      gifRun.current++;
      monitor.current?.stop();
      if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
      if (gifUrlRef.current) URL.revokeObjectURL(gifUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // INSTANT REEL: as soon as the scene, sprites, and a Tier 1 encoder are
  // ready (and after any settings change discards the old take), the offline
  // render starts by itself. Debounced so chip-mashing restarts once, and
  // cancellable mid-render via the run id the encoder polls. Transport state
  // (pause / scrub) is deliberately absent from these deps.
  useEffect(() => {
    if (!open || !scene || !images || !support || support.tier !== 1) return;
    if (clip || error) return;
    const runRef = encodeRunRef;
    const run = ++runRef.current;
    const timer = window.setTimeout(async () => {
      if (encodeRunRef.current !== run) return;
      setRecording(true);
      setProgress(0);
      try {
        const res = await encodeClipOffline(
          scene,
          images,
          support,
          audioMix,
          (f) => {
            if (encodeRunRef.current === run) setProgress(f);
          },
          () => encodeRunRef.current !== run,
          { fps: effFps, bitrate },
        );
        if (encodeRunRef.current !== run) return;
        const url = URL.createObjectURL(res.blob);
        clipUrlRef.current = url;
        setClip({ url, blob: res.blob, container: res.container, tier: res.tier });
        // Surfaced for automated tests / debugging.
        console.log(`nerfchess clip recorded: ${res.blob.size} bytes`);
      } catch (e) {
        if (encodeRunRef.current === run && !(e instanceof EncodeCancelled)) {
          setError("Rendering failed in this browser. Try adjusting the format.");
        }
      } finally {
        if (encodeRunRef.current === run) {
          setRecording(false);
          setProgress(null);
        }
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      // Supersede any in-flight render; the encoder bails at the next frame.
      runRef.current++;
    };
  }, [open, scene, images, support, clip, error, audioMix, effFps, bitrate]);

  // Every option change invalidates the recorded take (frame 0 is burned into
  // the file, so even a caption edit means a re-render). The auto-encode
  // effect above then rebuilds the reel on its own.
  const set = useCallback(
    <K extends keyof ClipOptionsState>(key: K, value: ClipOptionsState[K]) => {
      setOpts((o) => ({ ...o, [key]: value }));
      setError(null);
      discardClip();
    },
    [discardClip],
  );
  const editHook = useCallback(
    (value: string | null) => {
      setHook(value);
      setError(null);
      discardClip();
    },
    [discardClip],
  );
  const setPliesChoice = useCallback(
    (p: PliesChoice) => {
      setPliesChoiceState(p);
      // The Last-N chips and the manual window are rivals; picking a chip
      // hands the cut back to the counted window.
      setOpts((o) => (o.clipWindow ? { ...o, clipWindow: null } : o));
      setError(null);
      discardClip();
    },
    [discardClip],
  );

  // --- Manual clip window + per-ply curation ---------------------------------
  const setClipWindow = useCallback(
    (start: number, end: number) => {
      setOpts((o) => ({ ...o, clipWindow: { start, end } }));
      setError(null);
      discardClip();
    },
    [discardClip],
  );
  const restoreAutoWindow = useCallback(() => {
    setPliesChoiceState("auto");
    setOpts((o) => ({ ...o, clipWindow: null }));
    setError(null);
    discardClip();
  }, [discardClip]);
  const setPlyMod = useCallback(
    (ply: number, patch: Partial<ClipPlyMod>) => {
      setOpts((o) => ({
        ...o,
        plyMods: { ...o.plyMods, [ply]: { ...o.plyMods[ply], ...patch } },
      }));
      setError(null);
      discardClip();
    },
    [discardClip],
  );
  const togglePayoff = useCallback(
    (ply: number) => {
      setOpts((o) => ({ ...o, payoffPly: o.payoffPly === ply ? null : ply }));
      setError(null);
      discardClip();
    },
    [discardClip],
  );

  // --- Chapters (highlights format) ------------------------------------------
  const setChapterEdge = useCallback(
    (payoffPly: number, which: "start" | "end", ply: number) => {
      setOpts((o) => ({
        ...o,
        chapterMods: {
          ...o.chapterMods,
          [payoffPly]: { ...o.chapterMods[payoffPly], [which]: ply },
        },
      }));
      setError(null);
      discardClip();
    },
    [discardClip],
  );
  const setChapterTitle = useCallback(
    (payoffPly: number, title: string) => {
      setOpts((o) => ({
        ...o,
        chapterMods: {
          ...o.chapterMods,
          [payoffPly]: { ...o.chapterMods[payoffPly], title },
        },
      }));
      setError(null);
      discardClip();
    },
    [discardClip],
  );

  // --- Stickers ---------------------------------------------------------------
  const addSticker = useCallback(
    (id: StickerId) => {
      setOpts((o) => {
        if (o.stickers.length >= STICKER_CAP) return o;
        const i = o.stickers.length;
        // Staggered default parking (board-relative fractions) so freshly
        // added stickers never stack; drag on the viewport to place.
        const sticker: ClipSticker = {
          id,
          x: 0.12 + (i % 3) * 0.34,
          y: i < 3 ? -0.07 : 1.04,
          ply: null,
        };
        return { ...o, stickers: [...o.stickers, sticker] };
      });
      setError(null);
      discardClip();
    },
    [discardClip],
  );
  const removeSticker = useCallback(
    (index: number) => {
      setOpts((o) => ({ ...o, stickers: o.stickers.filter((_, i) => i !== index) }));
      setError(null);
      discardClip();
    },
    [discardClip],
  );
  const moveSticker = useCallback(
    (index: number, x: number, y: number) => {
      const cl = (v: number) => Math.max(-0.12, Math.min(1.12, Math.round(v * 1000) / 1000));
      setOpts((o) => ({
        ...o,
        stickers: o.stickers.map((s, i) => (i === index ? { ...s, x: cl(x), y: cl(y) } : s)),
      }));
      setError(null);
      discardClip();
    },
    [discardClip],
  );
  const pinSticker = useCallback(
    (index: number, ply: number | null) => {
      setOpts((o) => ({
        ...o,
        stickers: o.stickers.map((s, i) => (i === index ? { ...s, ply } : s)),
      }));
      setError(null);
      discardClip();
    },
    [discardClip],
  );

  // --- Saved presets (localStorage only, never uploaded) ---------------------
  const presetExtras = useCallback(
    (o: ClipOptionsState): SavedPresetExtras => ({
      emojiLevel: o.emojiLevel,
      captionStyle: o.captionStyle,
      musicTrack: o.musicTrack,
      boardTheme: o.boardTheme,
      versusIntro: o.versusIntro,
    }),
    [],
  );
  const applySavedExtras = useCallback(
    (o: ClipOptionsState, style: ClipStyle, extras: SavedPresetExtras): ClipOptionsState => ({
      ...o,
      style: { ...style },
      ...(extras.emojiLevel !== undefined ? { emojiLevel: extras.emojiLevel } : {}),
      ...(extras.captionStyle !== undefined ? { captionStyle: extras.captionStyle } : {}),
      ...(extras.musicTrack !== undefined ? { musicTrack: extras.musicTrack } : {}),
      ...(extras.boardTheme !== undefined ? { boardTheme: extras.boardTheme } : {}),
      ...(extras.versusIntro !== undefined ? { versusIntro: extras.versusIntro } : {}),
    }),
    [],
  );
  const savePreset = useCallback(
    (name: string) => {
      const { list, preset } = upsertSavedPreset(
        savedPresets,
        name,
        opts.style,
        presetExtras(opts),
      );
      setSavedPresets(list);
      storeSavedPresets(list);
      setPresetId(preset.id);
    },
    [savedPresets, opts, presetExtras],
  );
  const applySaved = useCallback(
    (p: SavedClipPreset) => {
      setOpts((o) => applySavedExtras(o, p.style, p.extras));
      const list = touchSavedPreset(savedPresets, p.id);
      setSavedPresets(list);
      storeSavedPresets(list);
      setPresetId(p.id);
      setError(null);
      discardClip();
    },
    [savedPresets, applySavedExtras, discardClip],
  );
  const deleteSaved = useCallback(
    (id: string) => {
      const list = savedPresets.filter((p) => p.id !== id);
      setSavedPresets(list);
      storeSavedPresets(list);
      setPresetId((cur) => (cur === id ? null : cur));
    },
    [savedPresets],
  );
  const exportCode = useCallback(() => {
    const active = savedPresets.find((p) => p.id === presetId);
    return exportPresetCode(active?.name ?? "My style", opts.style, presetExtras(opts));
  }, [savedPresets, presetId, opts, presetExtras]);
  const importCode = useCallback(
    (code: string): boolean => {
      const parsed = importPresetCode(code);
      if (!parsed) return false;
      // An imported style lands as a saved chip AND becomes the current look.
      const { list, preset } = upsertSavedPreset(
        savedPresets,
        parsed.name,
        parsed.style,
        parsed.extras,
      );
      setSavedPresets(list);
      storeSavedPresets(list);
      setOpts((o) => applySavedExtras(o, parsed.style, parsed.extras));
      setPresetId(preset.id);
      setError(null);
      discardClip();
      return true;
    },
    [savedPresets, applySavedExtras, discardClip],
  );

  // --- A/B compare -----------------------------------------------------------
  const toggleCompare = useCallback(() => {
    setCompareOn((v) => {
      const next = !v;
      // Default pin: the style as it stands when compare switches on.
      if (next) {
        setPinned((cur) => cur ?? { name: "Pinned", style: { ...optsRef.current.style } });
      }
      return next;
    });
  }, []);
  const pinStyle = useCallback((name: string, style: ClipStyle) => {
    setPinned({ name, style: { ...style } });
  }, []);

  // One style knob changed by hand: the preset chip lets go.
  const setStyle = useCallback(
    (patch: Partial<ClipStyle>) => {
      setOpts((o) => ({ ...o, style: { ...o.style, ...patch } }));
      setPresetId(null);
      setError(null);
      discardClip();
    },
    [discardClip],
  );

  // Preset tap: a partial override of the defaults (plus its vibe extras),
  // keeping the current Surprise seed so seeded FX stay stable.
  const applyPreset = useCallback(
    (p: StylePreset) => {
      setOpts((o) => ({
        ...o,
        style: { ...STYLE_DEFAULTS, ...p.style, seed: o.style.seed },
        ...(p.extras?.emojiLevel !== undefined ? { emojiLevel: p.extras.emojiLevel } : {}),
        ...(p.extras?.captionStyle !== undefined ? { captionStyle: p.extras.captionStyle } : {}),
        ...(p.extras?.musicTrack !== undefined ? { musicTrack: p.extras.musicTrack } : {}),
        ...(p.extras?.versusIntro !== undefined ? { versusIntro: p.extras.versusIntro } : {}),
      }));
      setPresetId(p.id);
      setError(null);
      discardClip();
    },
    [discardClip],
  );

  // Surprise me: deterministic per tap count. Tap N always yields combo N.
  const surpriseMe = useCallback(() => {
    const tap = surpriseTap + 1;
    setSurpriseTap(tap);
    setOpts((o) => ({ ...o, style: surpriseStyle(tap) }));
    setPresetId("surprise");
    setError(null);
    discardClip();
  }, [surpriseTap, discardClip]);

  const resetTikTok = useCallback(() => {
    setOpts(TIKTOK_MODE);
    setPliesChoiceState("auto");
    setPresetId("tiktok");
    setHook(null);
    setError(null);
    discardClip();
  }, [discardClip]);

  // Import your own backing track: decoded with the Web Audio API right here
  // in the browser; the file is never uploaded anywhere.
  const importMusicFile = useCallback(
    async (file: File) => {
      try {
        const data = await file.arrayBuffer();
        const ac = new AudioContext();
        try {
          const buffer = await ac.decodeAudioData(data);
          setCustomMusic({ buffer, name: file.name });
          setError(null);
          discardClip();
        } finally {
          void ac.close();
        }
      } catch {
        setError("Couldn't decode that audio file. Try an mp3, wav, or ogg.");
      }
    },
    [discardClip],
  );
  const clearCustomMusic = useCallback(() => {
    setCustomMusic(null);
    setError(null);
    discardClip();
  }, [discardClip]);

  // --- Preview monitor (sfx out loud while unmuted) --------------------------
  const stopMonitor = useCallback(() => {
    monitorRef.current?.stop();
    monitorRef.current = null;
  }, []);
  const syncMonitor = useCallback(() => {
    stopMonitor();
    const h = rendererRef.current;
    const sc = sceneRef.current;
    const o = optsRef.current;
    if (!h || !sc || mutedRef.current || !h.isPlaying() || !o.sound) return;
    monitorRef.current = playPreviewSfx(sc.audio, h.getTime(), {
      volume: o.sfxVolume,
      mutes: o.voiceMutes,
    });
  }, [stopMonitor]);
  useEffect(() => {
    if (muted) stopMonitor();
    else syncMonitor();
  }, [muted, stopMonitor, syncMonitor]);
  // A new scene (config change) restarts the schedule under the monitor.
  useEffect(() => {
    if (!mutedRef.current) syncMonitor();
  }, [scene, syncMonitor]);

  // --- Transport -------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const h = rendererRef.current;
    if (!h) return;
    const p = h.toggle();
    playingRef.current = p;
    setPlaying(p);
    if (p) syncMonitor();
    else stopMonitor();
  }, [syncMonitor, stopMonitor]);
  const restart = useCallback(() => {
    rendererRef.current?.restart();
    playingRef.current = true;
    setPlaying(true);
    syncMonitor();
  }, [syncMonitor]);
  const scrubStart = useCallback(() => {
    const h = rendererRef.current;
    if (!h) return;
    wasPlayingRef.current = h.isPlaying();
    h.pause();
    playingRef.current = false;
    setPlaying(false);
    stopMonitor();
  }, [stopMonitor]);
  const scrub = useCallback((tMs: number) => {
    rendererRef.current?.seek(tMs);
  }, []);
  const scrubEnd = useCallback(() => {
    if (!wasPlayingRef.current) return;
    rendererRef.current?.play();
    playingRef.current = true;
    setPlaying(true);
    syncMonitor();
  }, [syncMonitor]);
  const stepFrame = useCallback(
    (dir: 1 | -1) => {
      rendererRef.current?.stepFrame(dir);
      playingRef.current = false;
      setPlaying(false);
      stopMonitor();
    },
    [stopMonitor],
  );
  const jumpPly = useCallback(
    (dir: 1 | -1) => {
      const h = rendererRef.current;
      const sc = sceneRef.current;
      if (!h || !sc) return;
      const marks = [0, ...sc.segs.map((sf) => sf.start), sc.freezeStart];
      const t = h.getTime();
      let target = dir > 0 ? sc.durationMs : 0;
      if (dir > 0) {
        for (const m of marks) {
          if (m > t + 1) {
            target = m;
            break;
          }
        }
      } else {
        for (let i = marks.length - 1; i >= 0; i--) {
          if (marks[i] < t - 40) {
            target = marks[i];
            break;
          }
        }
      }
      h.seek(target);
      if (h.isPlaying()) syncMonitor();
    },
    [syncMonitor],
  );

  // The transport tick writes straight into DOM nodes (timecode, playhead,
  // meter needle), bypassing React so a 60fps preview costs zero renders.
  const registerTickTarget = useCallback((key: string, el: HTMLElement | null) => {
    tickTargets.current[key] = el;
  }, []);
  const onTick = useCallback((tMs: number, isPlaying: boolean) => {
    const sc = sceneRef.current;
    if (!sc) return;
    const els = tickTargets.current;
    const pct = `${((tMs / Math.max(1, sc.durationMs)) * 100).toFixed(2)}%`;
    const stampText = formatClipTime(tMs);
    if (els.timecode) els.timecode.textContent = stampText;
    if (els.playhead) els.playhead.style.left = pct;
    if (els.ptime) els.ptime.textContent = stampText;
    if (els.needle) els.needle.style.left = pct;
    if (els.strip) els.strip.setAttribute("aria-valuenow", String(Math.round(tMs)));
    if (playingRef.current !== isPlaying) {
      playingRef.current = isPlaying;
      setPlaying(isPlaying);
    }
  }, []);
  const onLoop = useCallback(() => {
    if (!mutedRef.current) syncMonitor();
  }, [syncMonitor]);
  const onAutoPause = useCallback(() => {
    stopMonitor();
  }, [stopMonitor]);

  // Desktop keyboard transport: space play/pause, arrows step a frame,
  // [ ] jump a ply. Fine-pointer devices only, so mobile stays untouched.
  const keysRef = useRef({ togglePlay, stepFrame, jumpPly });
  useEffect(() => {
    keysRef.current = { togglePlay, stepFrame, jumpPly };
  }, [togglePlay, stepFrame, jumpPly]);
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.tagName === "SELECT" ||
          tgt.isContentEditable)
      ) {
        return;
      }
      if (e.key === " ") {
        if (tgt && (tgt.tagName === "BUTTON" || tgt.tagName === "A")) return;
        e.preventDefault();
        keysRef.current.togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        keysRef.current.stepFrame(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        keysRef.current.stepFrame(-1);
      } else if (e.key === "]") {
        e.preventDefault();
        keysRef.current.jumpPly(1);
      } else if (e.key === "[") {
        e.preventDefault();
        keysRef.current.jumpPly(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Tier 2 fallback: realtime MediaRecorder over the live preview canvas,
  // behind an explicit Record / Re-record button (a realtime take needs the
  // preview restarted from the top, so it never auto-fires).
  const recordRealtime = async () => {
    if (!scene || !images || recording || !support || support.tier !== 2) return;
    discardClip();
    setError(null);
    setRecording(true);
    setProgress(null);
    try {
      const canvas = rendererRef.current?.canvas;
      if (!canvas) throw new Error("no canvas");
      const rec = recordClipRealtime(canvas, scene, support, audioMix, bitrate);
      stopRef.current = rec.stop;
      // Restart the timeline in sync with the recorder; stop shortly after
      // the run completes so the final frame lands in the file.
      rendererRef.current?.restart(() => {
        window.setTimeout(() => rec.stop(), 250);
      });
      playingRef.current = true;
      setPlaying(true);
      const res = await rec.done;
      stopRef.current = null;
      const url = URL.createObjectURL(res.blob);
      clipUrlRef.current = url;
      setClip({ url, blob: res.blob, container: res.container, tier: res.tier });
      console.log(`nerfchess clip recorded: ${res.blob.size} bytes`);
    } catch {
      setError("Recording failed in this browser. Try again or switch format.");
    }
    setRecording(false);
  };

  const clipFile = useMemo(
    () =>
      clip
        ? new File([clip.blob], `nerfchess-clip.${clip.container}`, {
            type: clip.blob.type || `video/${clip.container}`,
          })
        : null,
    [clip],
  );
  const canShare =
    !!clipFile &&
    typeof navigator !== "undefined" &&
    !!navigator.canShare &&
    navigator.canShare({ files: [clipFile] });

  const share = async () => {
    if (!clipFile) return;
    try {
      await navigator.share({ files: [clipFile], title: "Nerf Chess reel" });
      setShared(true);
      window.setTimeout(() => setShared(false), 2000);
    } catch {
      // User dismissed the share sheet; ignore.
    }
  };

  // Post kit: caption + 15 hashtags, pure string assembly from scene data.
  const postKit = useMemo(() => {
    if (!timeline || !scene) return null;
    return buildPostKit({
      hookText,
      names: playerNames,
      result,
      coversEnd,
      timeline,
      autoPlan,
      card: scene.outroCard,
      totalPlies: moves.length,
    });
  }, [timeline, scene, hookText, playerNames, result, coversEnd, autoPlan, moves.length]);

  const copyPostKit = async () => {
    if (!postKit) return;
    const text = `${postKit.caption}\n\n${postKit.hashtags.join(" ")}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        ta.remove();
      }
    }
    setPostCopied(true);
    window.setTimeout(() => setPostCopied(false), 1600);
  };

  if (!open) return null;

  const durationSec = scene ? Math.round(scene.durationMs / 100) / 10 : null;
  // Hook drag geometry: the viewport handle and the scene build share the
  // same safe band, so what the grip shows is exactly what encodes.
  const hookBand = hookDragBand(opts.aspect, opts.hookScale);
  const aspectLayout = clipLayout(opts.aspect);
  const defaultHookFrac = aspectLayout.hookY / aspectLayout.H;
  const previewMax =
    opts.aspect === "tiktok"
      ? "max-w-[13rem] sm:max-w-[15rem]"
      : opts.aspect === "square"
        ? "max-w-[18rem]"
        : opts.aspect === "youtube"
          ? "max-w-[24rem]"
          : "max-w-[19rem]";
  const settingsLocked = recording && support?.tier === 2;

  const studio: Studio = {
    opts,
    set,
    setStyle,
    locked: settingsLocked,
    accent,
    scene,
    images,
    hookText,
    hookSuggestion,
    editHook,
    pliesChoice,
    setPliesChoice,
    resetTikTok,
    highlightsCount: highlightsPlan?.chapters.length ?? 0,
    addSticker,
    removeSticker,
    pinSticker,
    reelPlyRange:
      timeline && timeline.segments.length > 0
        ? {
            first: timeline.segments[0].ply,
            last: timeline.segments[timeline.segments.length - 1].ply,
          }
        : null,
    encode: support ? { tier: support.tier, fps60: support.fps60 } : null,
    customMusic,
    pickMusicFile: () => musicFileRef.current?.click(),
    clearCustomMusic,
    musicFileRef,
    importMusicFile: (file) => void importMusicFile(file),
    registerTickTarget,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Clip studio: cut and save a reel of the final moves"
      data-clip-modal
      data-clip-bytes={clip?.blob.size ?? 0}
      data-clip-gif-bytes={gif?.blob.size ?? 0}
      data-clip-gif-type={gif?.blob.type ?? ""}
      data-clip-duration={scene?.durationMs ?? 0}
      data-clip-style-sig={`${opts.style.grade}:${opts.style.particles}:${opts.style.transition}:${opts.style.zoom}:${opts.style.speed}:${opts.style.seed}:${opts.style.captionPack}:${opts.style.titleTemplate}:${opts.style.outro}:${opts.style.beatSync ? "beat" : "free"}:${opts.style.tensionMeter ? "tension" : "-"}:${opts.style.minimap ? "minimap" : "-"}:${opts.style.sceneSet}:${opts.style.zoomCurve}`}
      data-clip-preset={presetId ?? "custom"}
      data-clip-format={opts.format}
      data-clip-target={String(opts.lengthTarget)}
      data-clip-chapters={
        sceneChapters ? `${sceneChapters.length}:${sceneChapters.map((c) => c.title).join("|")}` : ""
      }
      data-clip-stickers={opts.stickers
        .map((s) => `${s.id}@${s.x.toFixed(3)},${s.y.toFixed(3)}${s.ply !== null ? `#${s.ply}` : ""}`)
        .join(";")}
      data-clip-hook={`${opts.hookScale}:${opts.hookYFrac !== null ? opts.hookYFrac.toFixed(3) : "auto"}`}
      data-clip-versus={opts.versusIntro ? "on" : "off"}
      data-clip-window={
        timeline && timeline.segments.length > 0
          ? `${timeline.segments[0].ply + 1}-${timeline.segments[timeline.segments.length - 1].ply + 1}`
          : ""
      }
      data-clip-window-mode={
        highlightsOn ? "chapters" : win ? "manual" : pliesChoice === "auto" ? "auto" : "lastN"
      }
      data-clip-mods={(() => {
        const mods = Object.entries(opts.plyMods);
        const count = (k: "skip" | "slow" | "punch") => mods.filter(([, m]) => m[k]).length;
        const notes = mods.filter(([, m]) => m.note?.trim()).length;
        return `skip:${count("skip")}|slow:${count("slow")}|punch:${count("punch")}|notes:${opts.commentaryOn ? notes : 0}|payoff:${opts.payoffPly ?? "-"}`;
      })()}
      data-clip-fps={effFps}
      data-clip-quality={opts.quality}
      data-clip-board={opts.boardTheme}
      data-clip-compare={compareOn ? "on" : "off"}
      className="fixed inset-0 z-[60] grid place-items-center bg-[#0f0d0a]/80 px-2 py-3 sm:px-4 sm:py-6"
      onPointerDown={chrome.onBackdropPointerDown}
    >
      <div
        className="plate plate-raised relative w-[min(97vw,66rem)] max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-3 shadow-2xl sm:p-5"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="card-corner tl" />
        <span className="card-corner tr" />
        <span className="card-corner bl" />
        <span className="card-corner br" />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p>Clip the finish</p>
            <h2 className="mt-0.5 font-display text-xl font-bold text-parchment sm:text-2xl">
              The studio
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="hidden font-mono text-[12px] uppercase tracking-[0.06em] text-parchment-400 sm:inline"
              data-clip-tier={support?.tier ?? 0}
            >
              {support ? support.detail : "Probing encoder"}
            </span>
            <Button
              tone="ghost"
              onClick={onClose}
              aria-label="Close"
              iconOnly
              className="shrink-0 text-parchment-300"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </Button>
          </div>
        </div>

        {timeline && scene ? (
          <>
            <div className="clip-studio-grid mt-3">
              <div className="clip-studio-left">
                <Viewport
                  scene={scene}
                  images={images}
                  rendererRef={rendererRef}
                  playing={playing}
                  loop={loopOn}
                  muted={muted}
                  onTogglePlay={togglePlay}
                  onRestart={restart}
                  onToggleLoop={() => setLoopOn((v) => !v)}
                  onToggleMute={() => setMuted((v) => !v)}
                  onTick={onTick}
                  onLoop={onLoop}
                  onAutoPause={onAutoPause}
                  registerTickTarget={registerTickTarget}
                  previewMax={previewMax}
                  compareScene={pinnedScene}
                  pinnedName={pinned?.name ?? null}
                  fps={effFps}
                  hookDrag={
                    hookText.trim()
                      ? {
                          frac: Math.max(
                            hookBand.min,
                            Math.min(hookBand.max, opts.hookYFrac ?? defaultHookFrac),
                          ),
                          min: hookBand.min,
                          max: hookBand.max,
                          onCommit: (f) => set("hookYFrac", f),
                          locked: settingsLocked,
                        }
                      : null
                  }
                  stickerDrag={
                    opts.stickers.length > 0
                      ? { list: opts.stickers, onCommit: moveSticker, locked: settingsLocked }
                      : null
                  }
                />
                <div className="mt-2">
                  <Timeline
                    scene={scene}
                    onScrubStart={scrubStart}
                    onScrub={scrub}
                    onScrubEnd={scrubEnd}
                    registerTickTarget={registerTickTarget}
                    window={{
                      availStart,
                      head,
                      start: baseTimeline?.startPly ?? availStart,
                      end:
                        (baseTimeline?.startPly ?? availStart) +
                        (baseTimeline?.segments.length ?? 0),
                      manual: !!win,
                      onChange: setClipWindow,
                      onAuto: restoreAutoWindow,
                    }}
                    curation={{
                      mods: opts.plyMods,
                      payoffPly: opts.payoffPly,
                      onMod: setPlyMod,
                      onTogglePayoff: togglePayoff,
                      locked: settingsLocked,
                    }}
                    chapters={
                      chapters && sceneChapters
                        ? {
                            spans: chapters.map((ch, i) => ({
                              payoffPly: ch.payoffPly,
                              start: ch.start,
                              end: ch.end,
                              title: sceneChapters[i]?.title ?? "",
                              index: i,
                            })),
                            availStart: chapterAvailStart,
                            head,
                            onEdge: setChapterEdge,
                            onTitle: setChapterTitle,
                            locked: settingsLocked,
                          }
                        : null
                    }
                  />
                </div>
                {reduced && (
                  <p className="mt-1 font-mono text-[12px] uppercase tracking-[0.06em] text-parchment-400">
                    Reduced motion: chrome still; transport live
                  </p>
                )}
              </div>

              <Deck
                studio={studio}
                presetId={presetId}
                applyPreset={applyPreset}
                surpriseMe={surpriseMe}
                saved={savedPresets}
                applySaved={applySaved}
                deleteSaved={deleteSaved}
                savePreset={savePreset}
                exportCode={exportCode}
                importCode={importCode}
                compareOn={compareOn}
                toggleCompare={toggleCompare}
                pinStyle={pinStyle}
                pinnedName={pinned?.name ?? null}
              />
            </div>

            {error && (
              <p role="alert" className="mt-2 text-xs text-oxblood-glow">
                {error}
              </p>
            )}

            {/* Fixed export bar: SAVE with format + size baked into the label,
                Share beside it, encode progress as a hairline fill. */}
            <div className="clip-export">
              {recording && support?.tier === 1 && (
                <div
                  className="clip-export-hairline"
                  style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
                  aria-hidden
                />
              )}
              <div className="clip-export-row" aria-live="polite">
                {clip ? (
                  <>
                    <a
                      href={clip.url}
                      download={`nerfchess-clip.${clip.container}`}
                      data-clip-download
                      data-clip-ready
                      className="btn-leaf press inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[1px] px-4 py-2 font-display text-base font-semibold"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Save {clip.container.toUpperCase()} {sizeLabel(clip.blob.size)}
                    </a>
                    {canShare ? (
                      <Button tone="primary" size="lg" onClick={share} className="font-semibold">
                        {shared ? "Shared" : "Share"}
                      </Button>
                    ) : null}
                    {clip.tier === 2 && (
                      <Button tone="ghost" size="lg" onClick={recordRealtime} disabled={recording} data-clip-record>
                        Re-record
                      </Button>
                    )}
                  </>
                ) : support?.tier === 1 ? (
                  <span className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 border border-white/10 bg-white/[0.02] px-4 font-mono text-[13px] uppercase tracking-[0.06em] text-parchment-300">
                    {progress !== null
                      ? `Render ${Math.round(progress * 100)}%`
                      : images
                        ? "Render queued"
                        : "Loading pieces"}
                  </span>
                ) : support?.tier === 2 ? (
                  <Button
                    tone={recording ? "ghost" : "leaf"}
                    size="lg"
                    onClick={recordRealtime}
                    disabled={recording || !images}
                    data-clip-record
                    block
                    className={"font-semibold " + (recording ? "opacity-80" : "")}
                  >
                    {recording ? "Recording live" : !images ? "Loading pieces" : "Record reel"}
                  </Button>
                ) : (
                  <span className="inline-flex min-h-[48px] flex-1 items-center justify-center px-4 text-center text-xs text-parchment-400">
                    {support ? support.detail : "Probing this browser's encoder"}
                  </span>
                )}
                {/* GIF loop: a secondary export of just the payoff window,
                    encoded on demand by the dependency-free encoder. */}
                {gif ? (
                  <a
                    href={gif.url}
                    download="nerfchess-loop.gif"
                    data-clip-gif-download
                    className="btn-ghost press inline-flex min-h-[48px] items-center justify-center gap-2 px-4 font-display text-sm font-semibold"
                  >
                    GIF {sizeLabel(gif.blob.size)}
                  </a>
                ) : (
                  <Button
                    tone="ghost"
                    size="lg"
                    onClick={() => void exportGif()}
                    disabled={gifBusy || !scene || !images}
                    data-clip-gif
                    title="Export a 2-4s looping GIF of the payoff"
                    className="font-semibold"
                  >
                    {gifBusy ? `GIF ${Math.round(gifProgress * 100)}%` : "GIF loop"}
                  </Button>
                )}
              </div>
              <div className="clip-export-status">
                <span>
                  {highlightsOn
                    ? `${chapters?.length ?? 0} chapter${(chapters?.length ?? 0) === 1 ? "" : "s"}`
                    : win
                      ? `Cut ${win.start + 1}-${win.end}`
                      : pliesChoice === "auto"
                        ? "Auto window"
                        : `Last ${plies}`}{" "}
                  · {timeline.segments.length} plies · {durationSec ?? "?"}s
                </span>
                <span>
                  {clip
                    ? `Tier ${clip.tier} · ${clip.container} · ${effFps}fps`
                    : canShare === false && clipFile
                      ? "Save works everywhere"
                      : support
                        ? `Tier ${support.tier}`
                        : ""}
                </span>
              </div>

              {/* POST KIT: the paste-ready caption + 15 hashtags, folded under
                  the export bar once a take exists. Pure string assembly. */}
              {clip && postKit && (
                <div className="clip-postkit">
                  <Button
                    tone="quiet"
                    size="xs"
                    press={false}
                    onClick={() => setPostOpen((v) => !v)}
                    aria-expanded={postOpen}
                    data-clip-postkit-toggle
                    className="clip-postkit-toggle"
                  >
                    <span aria-hidden>{postOpen ? "▾" : "▸"}</span> Post kit
                  </Button>
                  {postOpen && (
                    <div className="clip-postkit-body" data-clip-postkit>
                      <p className="clip-postkit-caption" data-clip-postkit-caption>
                        {postKit.caption}
                      </p>
                      <p
                        className="clip-postkit-tags"
                        data-clip-postkit-tags={postKit.hashtags.length}
                      >
                        {postKit.hashtags.join(" ")}
                      </p>
                      <Button
                        tone="ghost"
                        size="xs"
                        onClick={() => void copyPostKit()}
                        data-clip-postkit-copy
                        className="text-parchment-300"
                      >
                        {postCopied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="mt-4 border border-white/10 bg-white/[0.02] p-4 text-sm text-parchment-300">
            This game&apos;s final positions can&apos;t be replayed for a clip: a card rewrote
            the board and no stored positions cover these moves.
          </div>
        )}
      </div>
    </div>
  );
}
