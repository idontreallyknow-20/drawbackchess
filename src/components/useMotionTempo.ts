"use client";

import { useEffect, useState } from "react";

/**
 * The player's Animations setting, as a tempo the JS-driven choreographies can
 * actually use.
 *
 * WHY THIS EXISTS
 *
 * `html[data-anim]` carries three values (normal / fast / off) and globals.css
 * acts on two of them: "off" clamps every transition and animation to nothing,
 * and "fast" clamps `transition-duration` to 80ms. Neither touches a
 * `@keyframes` duration, a framer-motion transition, or a `setTimeout` — which
 * is the whole of the draft's choreography. So a player who explicitly asked
 * for fast animations still sat through the identical 2.8 second sealed-vault,
 * vault-opening and card-deal sequence as everyone else. "Fast" was a promise
 * the most expensive moment in the product did not keep.
 *
 * `useReducedMotion` already collapses the "off" case for us, so this hook
 * exists for the middle rung: it reports the tempo, and `tempoScale` turns it
 * into the multiplier a choreography applies to its own beats.
 *
 * Live in both directions (MutationObserver on the attribute), same as
 * useReducedMotion, so flipping the setting mid-session takes effect at once.
 */
export type MotionTempo = "normal" | "fast" | "off";

export function useMotionTempo(): MotionTempo {
  const [tempo, setTempo] = useState<MotionTempo>(detectTempo);
  useEffect(() => {
    const update = () => setTempo(detectTempo());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-anim"] });
    // The attribute is stamped by applyUiPrefs after hydration, so read once
    // more on mount rather than trusting the render-time value forever.
    update();
    return () => observer.disconnect();
  }, []);
  return tempo;
}

export function detectTempo(): MotionTempo {
  if (typeof document === "undefined") return "normal";
  const anim = document.documentElement.getAttribute("data-anim");
  return anim === "off" || anim === "fast" ? anim : "normal";
}

/**
 * How much of its normal length a choreography should run at this tempo.
 *
 * 0.6 for "fast", not 0.08 like the CSS transition clamp: a transition is a
 * state change and can be near-instant, but a choreographed beat has an
 * internal structure (deal, then turn over, then settle) that stops reading as
 * anything at all below about half speed. Fast means brisk, not skipped; the
 * player who wants it skipped has "off".
 */
export function tempoScale(tempo: MotionTempo): number {
  return tempo === "off" ? 0 : tempo === "fast" ? 0.6 : 1;
}
