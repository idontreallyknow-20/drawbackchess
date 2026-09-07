"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyBoardColors,
  applyPieceColors,
  applyUiPrefs,
  loadSettings,
  pullSettingsFromServer,
  saveSettings,
  SETTINGS_CHANGED_EVENT,
} from "@/lib/settings";
import { configureSoundPrefs, preloadSounds, setUiSounds, setVolume } from "@/lib/sounds";
import { fxLevel, setFxLevel } from "@/lib/fxToggle";
import { requestUiSlot, UI_PRIORITY } from "@/lib/uiInterrupts";

export function SettingsBootstrap() {
  useEffect(() => {
    const apply = () => {
      const s = loadSettings();
      applyBoardColors(s);
      applyPieceColors(s);
      applyUiPrefs(s);
      setVolume(s.volume);
      setUiSounds(s.uiSounds);
      configureSoundPrefs({
        enabled: s.soundEnabled,
        move: s.moveSound,
        capture: s.captureSound,
        check: s.checkSound,
        gameEnd: s.gameEndSound,
        theme: s.soundTheme,
      });
      // Decoding eight samples competes with hydration on a cold load, and
      // nothing can play before a gesture anyway: wait for an idle moment.
      if (s.soundEnabled && s.soundTheme === "lichess") {
        const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
        if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(() => preloadSounds(), { timeout: 4000 });
        else window.setTimeout(preloadSounds, 1500);
      }
    };
    apply();
    // Signed-in accounts sync settings across devices: adopt the server copy
    // when it is newer than this device's (writes re-fire the changed event).
    void pullSettingsFromServer();
    window.addEventListener(SETTINGS_CHANGED_EVENT, apply);
    // "System" theme follows the OS live.
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const onScheme = () => applyUiPrefs(loadSettings());
    media?.addEventListener?.("change", onScheme);
    // The OS reduced-motion flag is honored live too (see applyUiPrefs):
    // flipping it in system settings stands animations down without a reload.
    const motionMedia = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    motionMedia?.addEventListener?.("change", onScheme);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, apply);
      media?.removeEventListener?.("change", onScheme);
      motionMedia?.removeEventListener?.("change", onScheme);
    };
  }, []);

  return (
    <>
      <LagWatch />
      <MotionNotice />
    </>
  );
}

const MOTION_NOTICE_KEY = "dc:motion-notice"; // "restored" | "dismissed" (effects-off variant)
const MOTION_ON_NOTICE_KEY = "dc:motion-on-notice"; // "kept" | "quieted" (effects-on variant)

type MotionNoticeVariant = "effectsOff" | "effectsOn";

/** Tells a player where their card animations stand versus the device's
 *  reduced-motion request, once per device, in whichever direction applies.
 *
 *  "Follow system motion" defaults OFF: card plays are gameplay information,
 *  so NerfChess keeps them on even when the OS asks apps to reduce motion.
 *  The "effectsOn" variant surfaces that choice to affected players and offers
 *  the opt-out (stand effects down with the system), flagged as not
 *  recommended because quiet plays are easy to miss.
 *
 *  The "effectsOff" variant covers players who HAVE opted in (or carry the old
 *  stored default): applyUiPrefs folds the OS flag into html[data-anim="off"],
 *  a hard kill switch, which is indistinguishable from the game being broken —
 *  phones enable reduced motion for battery saving and accessibility defaults,
 *  so nothing would ever animate with nothing explaining it. This variant says
 *  why, and offers to show the effects anyway.
 *
 *  Either way it only appears when the OS request is the deciding factor: a
 *  player who turned on Reduced motion in Settings themselves knows exactly
 *  why it is quiet and is never interrupted. Goes through the same UI
 *  interrupt queue as LagWatch, so it can never cover a draft. */
function MotionNotice() {
  const [show, setShow] = useState<MotionNoticeVariant | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const s = loadSettings();
    if (s.reducedMotion || s.animationSpeed === "off") return;
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const variant: MotionNoticeVariant = s.followSystemMotion ? "effectsOff" : "effectsOn";
    try {
      const key = variant === "effectsOff" ? MOTION_NOTICE_KEY : MOTION_ON_NOTICE_KEY;
      if (window.localStorage.getItem(key)) return;
    } catch {}
    // Deliberately delayed before it even asks for a slot. The interrupt queue
    // only defers to holds that already EXIST, and this effect runs on mount,
    // which on the game route is before the opening draft has pushed its hold.
    // Rendering it there put the notice straight over the cards. A few seconds
    // costs nothing for a once-per-device message and guarantees any draft on
    // the first screen has claimed its hold first.
    let cancel: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      cancel = requestUiSlot(UI_PRIORITY.performance, (release) => {
        releaseRef.current = release;
        setShow(variant);
      });
    }, 6000);
    return () => {
      window.clearTimeout(timer);
      cancel?.();
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, []);

  if (!show) return null;
  const settle = (key: "restored" | "dismissed" | "kept" | "quieted") => {
    try {
      window.localStorage.setItem(
        show === "effectsOff" ? MOTION_NOTICE_KEY : MOTION_ON_NOTICE_KEY,
        key,
      );
    } catch {}
    setShow(null);
    releaseRef.current?.();
    releaseRef.current = null;
  };
  return (
    <div
      role="status"
      aria-live="polite"
      // bottom honours the home indicator, like the FPS meter below: at a flat
      // 12px this notice started inside the home-bar zone and put its buttons
      // right where the swipe lives.
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      className="fixed left-1/2 z-[95] w-[min(92vw,22rem)] -translate-x-1/2 border border-gold/40 bg-ink-700/95 p-3 shadow-plate"
    >
      {show === "effectsOff" ? (
        <>
          <div className="font-display text-sm font-bold text-parchment-100">Card effects are off</div>
          <p className="mt-1 text-xs leading-snug text-parchment-300">
            Your device asks apps to reduce motion, and your settings honor that, so NerfChess
            is standing its card animations down. That is why plays look quiet. You can show
            them anyway without changing anything on your device.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-[1px] border border-white/15 px-2.5 py-1 text-[13px] text-parchment-300 hover:bg-white/5"
              onClick={() => settle("dismissed")}
            >
              Keep it calm
            </button>
            <button
              type="button"
              className="rounded-[1px] border border-gold/50 bg-gold/15 px-2.5 py-1 text-[13px] font-semibold text-parchment-100 hover:bg-gold/25"
              onClick={() => {
                saveSettings({ ...loadSettings(), followSystemMotion: false });
                settle("restored");
              }}
            >
              Show effects
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="font-display text-sm font-bold text-parchment-100">Card effects are on</div>
          <p className="mt-1 text-xs leading-snug text-parchment-300">
            Your device asks apps to reduce motion, but NerfChess keeps its card animations on
            by default: plays are how you see what a card just did. If you would rather NerfChess
            follow your device, you can stand them down here. Not recommended, since quiet plays
            are easy to miss.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-[1px] border border-white/15 px-2.5 py-1 text-[13px] text-parchment-300 hover:bg-white/5"
              onClick={() => {
                saveSettings({ ...loadSettings(), followSystemMotion: true });
                settle("quieted");
              }}
            >
              Turn them off
            </button>
            <button
              type="button"
              className="rounded-[1px] border border-gold/50 bg-gold/15 px-2.5 py-1 text-[13px] font-semibold text-parchment-100 hover:bg-gold/25"
              onClick={() => settle("kept")}
            >
              Keep effects on
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// How LagWatch decides the device is struggling: rolling 4-second windows of
// requestAnimationFrame gaps; a window is "bad" when nearly half of its wall
// time is spent inside slow frames (a gap over 34ms means the device dipped
// under ~30fps). Five bad windows in a row (~20s of sustained jank, never a
// single hitch) trip the notice, and the first two windows after load are
// discarded outright — page-load warm-up (hydration, JIT, asset decode) janks
// every device for a few seconds and says nothing about steady-state pacing.
const LAG_WINDOW_MS = 4000;
const LAG_SLOW_FRAME_MS = 34;
const LAG_BAD_RATIO = 0.45;
const LAG_BAD_WINDOWS = 5;
const LAG_WARMUP_WINDOWS = 2;
const LAG_NOTICE_KEY = "dc:lag-notice"; // "dismissed" | "applied"

/** Watches real frame pacing and, on sustained jank, offers performance mode
 *  in a small popup — animations are never silently degraded or disabled.
 *  One-shot per device: any choice (or already-reduced settings) disarms it.
 *
 *  PRESENTATION IS GATED: the detection runs silently in the background, but
 *  the popup itself goes through the UI interrupt queue (uiInterrupts). While
 *  a draft is active (or any other protected moment holds interrupts), the
 *  recommendation waits; it can never cover the cards, eat decision time, or
 *  burn game-clock time. It presents once the table is clear. */
function LagWatch() {
  const [show, setShow] = useState(false);
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(LAG_NOTICE_KEY)) return;
    } catch {}
    const s = loadSettings();
    // Nothing left to offer when the user already runs a reduced setup.
    if (s.reducedMotion || s.animationSpeed !== "normal") return;

    let raf = 0;
    let cancelSlot: (() => void) | null = null;
    let last = performance.now();
    let windowStart = last;
    let slowMs = 0;
    let badWindows = 0;
    let windowsSeen = 0;
    const tick = (now: number) => {
      const gap = now - last;
      last = now;
      // A huge gap is a background tab or a paused rAF, not jank: start over.
      if (gap > 1000) {
        windowStart = now;
        slowMs = 0;
        badWindows = 0;
      } else {
        if (gap > LAG_SLOW_FRAME_MS) slowMs += gap;
        if (now - windowStart >= LAG_WINDOW_MS) {
          windowsSeen += 1;
          // Warm-up windows never count: the first seconds after load jank
          // everywhere (hydration, JIT, decoding) and would trip this on
          // perfectly healthy desktops.
          const bad =
            windowsSeen > LAG_WARMUP_WINDOWS && slowMs / (now - windowStart) > LAG_BAD_RATIO;
          badWindows = bad ? badWindows + 1 : 0;
          windowStart = now;
          slowMs = 0;
          if (badWindows >= LAG_BAD_WINDOWS) {
            // Detected. Queue the recommendation; it shows only when no draft
            // (or other protected surface) is active, one interrupt at a time.
            cancelSlot = requestUiSlot(UI_PRIORITY.performance, (release) => {
              releaseRef.current = release;
              setShow(true);
            });
            return; // stop sampling once the notice is queued
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      cancelSlot?.();
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, []);

  if (!show) return null;
  const settle = (key: "applied" | "dismissed") => {
    try {
      window.localStorage.setItem(LAG_NOTICE_KEY, key);
    } catch {}
    setShow(false);
    releaseRef.current?.();
    releaseRef.current = null;
  };
  return (
    <div
      role="status"
      aria-live="polite"
      // bottom honours the home indicator, like the FPS meter below: at a flat
      // 12px this notice started inside the home-bar zone and put its buttons
      // right where the swipe lives.
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      className="fixed left-1/2 z-[95] w-[min(92vw,22rem)] -translate-x-1/2 border border-gold/40 bg-ink-700/95 p-3 shadow-plate"
    >
      <div className="font-display text-sm font-bold text-parchment-100">Animations running slow?</div>
      <p className="mt-1 text-xs leading-snug text-parchment-300">
        This device looks like it&apos;s struggling to keep up. Smooth it out sets move
        animations to fast and eases the effects dial down to Calm. Nothing is hidden, and
        you can change both anytime in Settings.
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="rounded-[1px] border border-white/15 px-2.5 py-1 text-[13px] text-parchment-300 hover:bg-white/5"
          onClick={() => settle("dismissed")}
        >
          No thanks
        </button>
        <button
          type="button"
          className="rounded-[1px] border border-gold/50 bg-gold/15 px-2.5 py-1 text-[13px] font-semibold text-parchment-100 hover:bg-gold/25"
          onClick={() => {
            saveSettings({ ...loadSettings(), animationSpeed: "fast" });
            // animationSpeed only clamps transition durations, which does not
            // touch the card-effect load that actually costs frames during a
            // play. The FX dial is the real particle budget: pull it down to
            // Calm, and only downward so a player who deliberately chose Epic
            // is not reset past where they already were.
            if (fxLevel() > 1) setFxLevel(1);
            settle("applied");
          }}
        >
          Smooth it out
        </button>
      </div>
    </div>
  );
}
