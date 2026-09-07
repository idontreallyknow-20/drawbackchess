// Shared rarity theme: one color identity per achievement rarity, used by
// every surface that renders an achievement (the trophy wall, the profile
// strip, the unlock toast). Each rarity carries:
//   color  - the INK: icon tint, chip text, progress segments. A CSS custom
//            property, not a literal, so globals.css can retint it per theme
//            (see below). The literal in the var() fallback is the dark value.
//   rgb    - the same hue as an "R G B" triple for rgb(<rgb> / a) layering
//   softBg - a low-opacity wash for chips and medallion fills
//   border - the resting border/ring tone
//   glow   - the soft outer glow color for unlocked medallions
//
// Identities (dark parchment site, gold reserved for the top of the ladder):
//   common    = parchment / silver (quiet, everyday)
//   rare      = verdigris / teal   (a step up, cool)
//   epic      = violet             (matches the tier-7 violet family)
//   legendary = gold / sun         (the reward hue, with a soft glow)
//
// WHY `color` IS A VAR AND THE OTHER FOUR ARE NOT
//
// These values are consumed as REACT INLINE STYLES, which no stylesheet can
// reach: `globals.css` could not retint the rarity chips at any specificity,
// so on paper they shipped the dark theme's parchment-on-white and measured
// (with the locked chip's own `opacity: 0.7` composited in, at 12px, where the
// 4.5:1 body threshold applies): common 1.43, legendary 1.38, rare 1.64, epic
// 2.07. Dark and midnight failed on rare, epic and gold too. Routing only the
// INK through a custom property hands the per-theme decision back to the
// stylesheet, which is the only place that knows what the paper is.
//
// `rgb`, `softBg`, `border` and `glow` deliberately keep their literals. They
// are washes, rims, medallion fills and glows with no contrast obligation, and
// splitting ink from tint is what lets paper darken its text without dragging
// the decorative layer to a place it does not belong. This is the same split
// the per-theme tier palette made for `.tier-*` versus `--tier-rgb`.

import type { AchievementRarity } from "@/lib/achievements";

export interface RarityTheme {
  label: string;
  color: string;
  rgb: string;
  softBg: string;
  border: string;
  glow: string;
}

export const RARITY_THEME: Record<AchievementRarity, RarityTheme> = {
  common: {
    label: "Common",
    color: "var(--rarity-ink-common, #cbc6b9)",
    rgb: "200 195 182",
    softBg: "rgba(200,195,182,0.08)",
    border: "rgba(200,195,182,0.30)",
    glow: "rgba(200,195,182,0.18)",
  },
  rare: {
    label: "Rare",
    color: "var(--rarity-ink-rare, #72d9c5)",
    rgb: "88 192 173",
    softBg: "rgba(88,192,173,0.10)",
    border: "rgba(88,192,173,0.38)",
    glow: "rgba(88,192,173,0.26)",
  },
  epic: {
    label: "Epic",
    color: "var(--rarity-ink-epic, #d9b5ff)",
    rgb: "168 119 216",
    softBg: "rgba(168,119,216,0.10)",
    border: "rgba(168,119,216,0.42)",
    glow: "rgba(168,119,216,0.28)",
  },
  legendary: {
    label: "Legendary",
    color: "var(--rarity-ink-legendary, #f4c864)",
    rgb: "238 194 94",
    softBg: "rgba(238,194,94,0.12)",
    border: "rgba(238,194,94,0.48)",
    glow: "rgba(238,194,94,0.34)",
  },
};

// Easiest to hardest: the display order for filters, sorting inside category
// sections, and the segmented progress bar.
export const RARITY_ASC: AchievementRarity[] = ["common", "rare", "epic", "legendary"];
