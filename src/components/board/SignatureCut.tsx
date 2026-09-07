"use client";

// A name collision, fixed at the boundary.
//
// The signature-VFX API uses a prop called `role` to mean "which cut of the
// sequence is this": "lead" for the single origin flourish, "target" for each
// affected square, "entrance" for the arrival. That is a perfectly good name
// for the concept and a terrible one for a React prop, because `role` is also
// the ARIA attribute: every call site reads as if it were declaring a landmark,
// `role="lead"` is not a valid ARIA role, and one careless `{...props}` spread
// anywhere down that chain of ~40 effect modules puts a literal invalid
// `role="lead"` attribute into the DOM.
//
// These two wrappers are the one place the rename happens. Board.tsx spells
// `cut`, which cannot be mistaken for ARIA and cannot leak into the a11y tree;
// the effect components keep the prop name they were built with. Renaming the
// prop through the whole effects library is the deeper fix and this is the
// seam it would land on.

import { GenBurst, type GenConfig } from "../effects/genSignature";
import { SignatureOverlay, type SigVisual } from "../effects/BoardEffects";

/** Which cut of a signature sequence a mount is playing. Mirrors the effects
 *  library's `SigRole`, minus "entrance" (Board never mounts that cut). */
export type SigCut = "lead" | "target";

/** One cut of a GENERATED signature. */
export function GenBurstCut({
  config,
  cut,
  delayMs,
}: {
  config: GenConfig;
  cut: SigCut;
  delayMs: number;
}) {
  return <GenBurst config={config} role={cut} delayMs={delayMs} />;
}

/** One cut of a BESPOKE signature. */
export function SignatureCut({
  visual,
  cut,
  delayMs,
}: {
  visual: SigVisual;
  cut: SigCut;
  delayMs: number;
}) {
  return <SignatureOverlay visual={visual} role={cut} delayMs={delayMs} />;
}
