"use client";

// Stepped coach-mark overlay: dims the screen except a spotlit target and
// pins a parchment coach card next to it (bottom sheet on small screens).
//
// The dimmer is a single spotlight div whose huge box-shadow paints the rest
// of the screen dark; the whole layer is pointer-events-none so the game
// underneath stays fully playable (several steps wait for the player to
// actually move). Only the coach card itself takes the pointer.
//
// Accessibility: the card is a role="dialog" (non-modal) that receives focus
// on every step change; Back/Next/Skip are real buttons; arrow keys step the
// tour and Escape skips it (captured, so they never double-drive the game's
// own history-navigation shortcuts while the tour is up); reduced-motion
// users get instant repositioning instead of the eased glide.

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";

export interface CoachStep {
  id: string;
  /** Small-caps kicker line above the title. */
  kicker: string;
  title: string;
  body: ReactNode;
  /** Selector fallbacks for the spotlit element; the first match with a
   * visible box wins. Omit for a centered card over a full-screen dim. */
  targetSelectors?: readonly string[];
  /** Shown in place of the Next button while the step waits on real play. */
  waitLabel?: string;
  /** Label for the Next button (defaults to "Next"). */
  nextLabel?: string;
}

interface SpotRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOT_PAD = 10;
const CARD_W = 352;

function sameRect(a: SpotRect | null, b: SpotRect | null) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

/** Track the on-screen box of the first visible selector match. A slow poll
 * (plus resize/scroll listeners) keeps the spotlight glued to its target as
 * the board lays itself out, without observing the whole page. */
function useSpotlightRect(selectors: readonly string[] | undefined): SpotRect | null {
  const [rect, setRect] = useState<SpotRect | null>(null);
  useEffect(() => {
    if (!selectors || selectors.length === 0) return;
    let raf = 0;
    const measure = () => {
      let next: SpotRect | null = null;
      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        // Collapsed / hidden match (e.g. the desktop dock below the lg
        // breakpoint): fall through to the next selector.
        if (r.width < 4 || r.height < 4) continue;
        next = { top: r.top, left: r.left, width: r.width, height: r.height };
        break;
      }
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    // First measurement rides the next frame (never a synchronous set inside
    // the effect body); the poll + listeners keep it fresh after that.
    schedule();
    const id = window.setInterval(measure, 300);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      window.clearInterval(id);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [selectors]);
  // Steps without a target render a full dim: any stale rect from the
  // previous step is masked here rather than cleared with a state write.
  return selectors && selectors.length > 0 ? rect : null;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function TourCoachOverlay({
  step,
  index,
  count,
  onNext,
  onBack,
  onSkip,
}: {
  step: CoachStep;
  /** Zero-based position among `count` steps (drives the progress dots). */
  index: number;
  count: number;
  /** Absent while the step waits on a gameplay gate (waitLabel shows). */
  onNext?: () => void;
  onBack?: () => void;
  onSkip: () => void;
}) {
  const rect = useSpotlightRect(step.targetSelectors);
  const floating = useMediaQuery("(min-width: 640px)");
  const cardRef = useRef<HTMLDivElement>(null);

  // Move focus to the card on each step so screen readers announce it and
  // Tab lands on the coach buttons. preventScroll: the board must not jump.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [step.id]);

  // Keyboard: arrows step the tour, Escape skips. Captured so the game's own
  // window-level shortcuts (history navigation, targeting cancel) don't fire
  // in the same keypress while the coach is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onSkip();
      } else if (e.key === "ArrowRight" && onNext) {
        e.preventDefault();
        e.stopPropagation();
        onNext();
      } else if (e.key === "ArrowLeft" && onBack) {
        e.preventDefault();
        e.stopPropagation();
        onBack();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onNext, onBack, onSkip]);

  // Card placement: bottom sheet on small screens; next to the spotlight
  // (below it, or above when the target hugs the bottom edge) on larger ones.
  let cardStyle: CSSProperties | undefined;
  let cardPosClass: string;
  if (!floating) {
    cardPosClass =
      "fixed inset-x-0 bottom-0 rounded-t-[14px] border-t border-gold/40 pb-[max(1.1rem,env(safe-area-inset-bottom))]";
  } else if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(12, rect.left), Math.max(12, vw - CARD_W - 12));
    const spaceBelow = vh - (rect.top + rect.height + SPOT_PAD);
    const spaceAbove = rect.top - SPOT_PAD;
    if (spaceBelow >= 250) {
      cardStyle = { top: rect.top + rect.height + SPOT_PAD + 12, left, width: CARD_W };
    } else if (spaceAbove >= 250) {
      cardStyle = { bottom: Math.max(12, vh - rect.top + SPOT_PAD + 12), left, width: CARD_W };
    } else {
      // Tall target (the board fills the viewport height): sit beside it,
      // roughly centered, preferring the emptier right flank.
      const sideTop = Math.min(
        Math.max(12, rect.top + rect.height / 2 - 140),
        Math.max(12, vh - 320),
      );
      const spaceRight = vw - (rect.left + rect.width + SPOT_PAD);
      const spaceLeft = rect.left - SPOT_PAD;
      if (spaceRight >= CARD_W + 24) {
        cardStyle = { top: sideTop, left: rect.left + rect.width + SPOT_PAD + 12, width: CARD_W };
      } else if (spaceLeft >= CARD_W + 24) {
        cardStyle = {
          top: sideTop,
          left: Math.max(12, rect.left - SPOT_PAD - 12 - CARD_W),
          width: CARD_W,
        };
      } else {
        // Nowhere clear: overlap the target's lower edge, kept on-screen.
        cardStyle = { bottom: 16, left, width: CARD_W };
      }
    }
    cardPosClass = "fixed border border-gold/40";
  } else {
    cardPosClass =
      "fixed left-1/2 top-1/2 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 border border-gold/40";
  }

  return (
    <>
      {/* Dimmer + spotlight. pointer-events-none: the game stays playable. */}
      <div className="pointer-events-none fixed inset-0 z-[45]" aria-hidden>
        {rect ? (
          <div
            className="absolute rounded-[2px] border border-gold/70 motion-safe:transition-all motion-safe:duration-300"
            style={{
              top: rect.top - SPOT_PAD,
              left: rect.left - SPOT_PAD,
              width: rect.width + SPOT_PAD * 2,
              height: rect.height + SPOT_PAD * 2,
              boxShadow:
                "0 0 0 200vmax rgba(9, 8, 12, 0.72), 0 0 22px rgba(214, 178, 90, 0.28)",
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-black/70" />
        )}
      </div>

      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby="tour-coach-title"
        aria-describedby="tour-coach-body"
        tabIndex={-1}
        className={
          "plate pointer-events-auto z-[46] px-5 py-4 shadow-xl outline-none " + cardPosClass
        }
        style={cardStyle}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[12px] text-gold-leaf">{step.kicker}</div>
          <button
            type="button"
            onClick={onSkip}
            className="shrink-0 text-[13px] text-parchment-400 underline decoration-parchment-500 underline-offset-2 transition-colors hover:text-parchment-200"
          >
            Skip tour
          </button>
        </div>
        <h2 id="tour-coach-title" className="mt-1 font-display text-2xl leading-tight text-parchment">
          {step.title}
        </h2>
        <div id="tour-coach-body" className="mt-2 text-[13px] leading-relaxed text-parchment-200">
          {step.body}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            {Array.from({ length: count }).map((_, i) => (
              <span
                key={i}
                className={
                  "h-1.5 w-1.5 rounded-full " +
                  (i === index ? "bg-gold-leaf" : i < index ? "bg-gold/50" : "bg-white/20")
                }
              />
            ))}
          </div>
          <span className="sr-only">
            Step {index + 1} of {count}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {onBack && (
              <Button tone="ghost"
               
                onClick={onBack}
                className="px-3 py-1.5 text-sm">
                Back
              </Button>
            )}
            {onNext ? (
              <Button tone="leaf"
               
                onClick={onNext}
                className="px-4 py-1.5 text-sm font-semibold">
                {step.nextLabel ?? "Next"}
              </Button>
            ) : (
              step.waitLabel && (
                <span
                  role="status"
                  className="font-display text-[12px] text-gold-leaf animate-flicker"
                >
                  {step.waitLabel}
                </span>
              )
            )}
          </div>
        </div>
      </div>
    </>
  );
}
