# NerfChess Design System

The single visual and interaction contract for every route. Written during the 2026-07 full-product redesign. Any page that deviates from this document is wrong, and either the page or this document must change in the same PR.

## 1. Identity pillars (keep, never dilute)

- Flat neutral dark surfaces, Lichess's: `#161512` page, `#262421` box, `#302e2c` raised, `#404040` borders. No page wash, no grain, no atmosphere layer. The light palette is the same ladder in reverse (`#edebe9` / `#ffffff` / `#f7f6f5` / `#d9d9d9`).
- There is a **fourth rung**, `--bg-hover`, one step past raised in the same direction: `#3c3934` dark, `#f1f0ee` light. It was previously in the code and not in this document, which is how the raised rung drifted unnoticed (see below). Hover always steps AWAY from the box, so it lightens in dark and darkens in light.
- **The ladder is load-bearing for contrast, not just for depth.** Measured against `parchment-400` (`#979797`, the muted floor named in section 10): page 6.25:1, box 5.30:1, raised 4.57:1, hover 3.94:1. Only the first three clear AA. That is the reason a permanent muted label must never sit on a hover fill: hover is a transient state carrying body-weight text, and the token cannot enforce that on its own. If a design wants dimmer text on a raised surface, the surface is wrong, not the text.
- These values are exact and drift is a real bug. In 2026-09 the raised rung shipped at `hsl(37 7% 22%)` (`#3c3934`) rather than the documented `#302e2c`, which by itself moved muted text on every menu, modal, popover and hovered row from 4.57:1 to 3.94:1, from passing AA to failing it. Light had drifted further and had the rungs out of ORDER: raised shipped at 89 percent lightness, darker than the 92 percent page it was supposed to rise from, while hover sat above it at 94.
- Neutral grey text: `#bababa` body, `#cccccc` headings, `#8c8c8c` secondary, `#707070` muted, via `--paper` and `parchment-*`.
- One accent, Lichess blue `#3692e7` (hover `#4a9fee`), on white. It owns "act here": links, primary buttons, focus, selection. There is no accent-colour setting.
- Mode duality as content, not ornament: a surface that belongs to Buff or Nerf carries its mode hue on a border, a chip, or a label. Nothing else may use those hues, and they never appear as a decorative gradient or divider.
- Chess-piece artwork and the competitive-fantasy voice: pieces, sigils, and card tiers are the decoration. No stock illustration, no emoji as UI.
- Dramatic game effects that never cost readability: the board stays legible through every animation.

## 2. Color roles

| Role | Token | Use |
|---|---|---|
| Page | `ink-900` (`--bg-base`) | The only page background. Flat, no wash |
| Panel | `--surface-panel` (`.plate`) | Cards, rails, lists |
| Raised | `--surface-raise` (`.plate-raised`) | Menus, modals, hovered rows |
| Edge | `--edge` / `--edge-strong` | All hairlines. Never `white/10` alpha borders in new code |
| Body text | `parchment` 100-300 | Content |
| Muted text | `parchment-400` | Labels, captions. Floor: never below `parchment-500` |
| Act | `--accent` (`gold` token, Lichess blue) | Primary buttons, links, focus, selected |
| Highlight | `--sun` (muted brass) | Rank, reward, featured, celebration |
| Positive | `--pos` (`#629924`) | Success, rating up, "Live" |
| Danger | `oxblood` / `--accent-danger` (`#c0413b`) | Errors, resign, destructive |
| Buff identity | `mode.buff` / `buffGlow` | Buff-mode surfaces and chips only |
| Nerf identity | `mode.nerf` / `nerfGlow` | Nerf-mode surfaces and chips only |
| Tiers | `.tier-1..10` + `.tier-bg-*` | Card tiers everywhere, no exceptions |

Rules:
- No new colors. If a design wants a color not in this table, the design is wrong. Board and piece palettes are the one exception: they are the player's setting (`BOARD_THEMES` / `PIECE_THEMES`, defaulting to the dark grey-blue `midnight` board and cburnett pieces).
- Mode hues never mean success/failure. Positive/danger never brand a mode.
- One accent-colored primary action per view region. Everything else is quiet.

## 3. Typography

Faces are **roles, not fixed families**: `--font-display` for headings and numbers that matter, `--font-body` for content, `--font-mono` (JetBrains Mono, self-hosted) for ids, clocks, and coordinates. Both text roles resolve to Noto Sans, the face Lichess ships, so weight does the hierarchy. Never name a family directly in a component; use the role.

Scale: the fluid ramp `--step-0..5` only, on a 14px base. No ad-hoc `text-4xl` in new code. The ramp is tight on purpose: the largest step lands near 2.1rem and a page heading around 1.6rem, which is how Lichess sets type.

Hierarchy is weight + size + color, in that order. Never letter-spacing alone.

Minimum sizes (hard floor):
- Body and interactive text: 13px (`text-[13px]`) desktop, 14px mobile.
- Captions and labels: 12px. The 9-10px letterspaced-smallcaps pattern is retired sitewide, along with the `.smallcaps` / `.eyebrow` / `.kicker` utilities that carried it. A section label is a plain bold heading at the body size, not an uppercase tracked-out device.

Numbers that update (clocks, ratings, counts) always `tabular-nums`.

## 4. Spacing and density

- Base unit 4px. Panel padding: 12px compact, 16px default, 20px only for hero moments. The `p-2 px-3` plate default stays.
- Section rhythm on marketing/landing surfaces: `--rhythm-section`. App surfaces (lobby, game, TV) are dense: they are tools, not brochures.
- Density rule: a list row is 40-48px tall, a data table row 36-40px. Empty air is not hierarchy.
- Max content width 1200px app, 1100px reading. The board column caps at 720px.
- No giant empty sections. If a region can be empty, it gets a designed empty state (see 8) sized to its content, not to the viewport.
- **Progressive disclosure (2026-08 de-crowd pass).** A view region shows ONE primary thing; everything secondary folds behind a labeled disclosure (header-with-chevron toggle, `aria-expanded`, count chip) or an overflow menu. Tab sets answer exactly one question (the dock's You/Them, the lobby's Play/Watch) — histories and rarely-used editors are disclosures, not tabs. Deep links (`?tab=`) must keep working by mapping old values onto the new tab and auto-opening the right fold. Settings is the reference two-level drill-down: a sparse home of category cards (title + one-line blurb) opening focused sub-pages with a Back control, one level, never deeper. Collapsed rows carry their state as chips (Usable, Temp, Used) so folding never hides live status.

## 5. Surfaces and geometry

The whole site is flat boxes on a flat page. There is one box style, one radius pair, and no material.

- Geometry: **7px** on a box or panel, **3px** on a button, enforced by the global rules in `globals.css` (`[class*="rounded"]` and a `button, .btn, [role="button"]` override). True circles only for avatars and status dots. `npm run test:rounded` guards it.
- `.plate` is the only box: `background: var(--bg-panel)`, `1px solid var(--border-subtle)`, 7px radius, **no shadow**. Two plain variants exist and neither adds a shadow: `.plate-raised` (one rung lighter, for modals and menus) and `.plate-hover` (border and fill lift on hover, behind `hover: hover`). `.rail-panel` is the same box under a different name, kept because the in-game rail spells it.
- Elevation is lightness on the background ladder (`--bg-base` -> `--bg-panel` -> `--bg-raised`), never a drop shadow, never a glow, never `backdrop-blur`.
- Retired in the 2026-09 flattening, and not to be reintroduced: `.dgn-slab`, `.dgn-rivets`, `.torch-pool`, `.rune-divider`, `.mode-seam`, `.seam-edge-b`, `.mode-field`, `.corner-cut`, `.plate-warm`, `.gilt`, `.masthead`, `.sec-title`, `.kicker`, and the whole dungeon lobby/menu/gate stylesheet set. A new surface reuses `.plate`; it does not invent a parallel treatment.
- Glow is not a state and no longer an event either: selection and urgency are carried by the accent border, the accent fill, and weight.

## 6. Motion

Vocabulary: `--ease-out` for entrances and hovers, `--ease-io` for movement between states, `--ease-spring` only for reveal, seal, and victory. Durations `--dur-1..3` (120/200/320ms); anything longer is a choreographed game effect with its own budget (see the passive effect spec).

Rules:
- Respect `data-anim` (off/fast) and `prefers-reduced-motion` in every new animation, including game effects. Reduced motion means a short fade plus a persistent indicator, never zero feedback.
- Animate `transform` and `opacity` only, except sanctioned board effects.
- Nothing loops forever except the three ambient effects (flicker, sigil, bob) and clock urgency.
- An animation may never delay authoritative state or block input after state resolves.

## 7. Components

- Buttons: use **`<Button>` / `<LinkButton>`** from `src/components/ui/Button.tsx`. There are exactly three tones:

  | Tone | Look | Use |
  |---|---|---|
  | `primary` | solid accent fill, white label | one per view region |
  | `default` | `--bg-raised` fill, hairline border, slightly lighter on hover | everything else |
  | `danger` | the same shape carrying red | Resign, Delete, Leave, Decline, Remove |

  The older names still compile and map onto those three (`leaf`/`cta`/`gold` -> primary, `ghost`/`quiet`/`glass`/`slab` -> default), so no call-site had to be rewritten. The `--btn-*` material contract is gone: there is no rim, top light, floor, glint, or face layer to author. `loading` gives the busy state; `.press` is on by default. Min touch target 44x44 mobile, 36px desktop. `npm run test:buttons` reports the remaining bespoke call sites.
- Tabs: underline style (current), 13px+ label, active = parchment-50 + accent underline, inactive = parchment-300. Same component on every route.
- Chips/badges: 12px, `.tier-bg-*` for tiers, mode chips for Buff/Nerf, `LIVE` badge = pos dot + label.
- Lists and tables: row hover `--surface-hover`, dividers `--edge`, never zebra. Rank/rating right-aligned tabular.
- Player identity unit: avatar (or piece glyph) + name + rating (+ provisional "?") + badges. One shared component, used by lobby rows, TV, game HUD, leaderboard, profiles, community.
- Forms: inputs on `ink-900/60`, `--edge` border, accent focus ring `focus-visible:outline-2 outline-offset-2`.

## 8. System states (every async surface implements all five)

1. Loading: skeleton in the exact final geometry (board skeleton pattern). Never spinners taller than 24px, never full-page spinners.
2. Empty: one sentence of what would be here + one action to change that. Sized to content. Piece-glyph accent, not sad-face illustration.
3. Error: what failed in plain words + Retry + a way out (Back to lobby). Never a dead end.
4. Disconnected/reconnecting: the existing ConnectionBanner pattern everywhere; board dims 20% but stays visible; never unmount live state during reconnect.
5. Recovered: silent when fast (<2s), single toast when slow. Never modal.

## 9. Navigation

- Top nav: Play, Watch, Community, Leaderboard, Rules + search, inbox, alerts, identity. Active route always marked. Identical on every page including game and TV (game pages may compact it, never replace it).
- Footer only on marketing/reading pages, never on app surfaces.
- Every player name links to `/u/[username]`. Every game id links to `/game/[id]`. Every card name links to its codex page. No dead nouns.
- Mobile: the match page is Lichess's column one below `sm` (640): the page scrolls, the board is full-bleed, the player bars are ~2.75rem with the clock beside them, and everything else stacks under the board in order (actions, horizontal move strip, your rule, your cards, chat, stakes) via `MobileMatchStack`. No fixed drawers on phones; the tablet range (`sm`..`lg`) keeps the buff drawer. Lobby keeps its bottom quick-match bar. Headers are 44-48px on phones.

## 10. Accessibility

- AA contrast minimum for text and interactive glyphs (parchment-400 on panel is the floor; check anything dimmer).
- Focus visible on everything interactive (accent 2px outline, 2px offset).
- All icon-only buttons carry `aria-label`. Status changes announce via `role="status"` / `aria-live="polite"` (existing patterns extend).
- Keyboard: move-list scrubbing with arrow keys, tab order follows visual order, modals trap focus and close on Escape.
- Hit areas: 44px mobile, and interactive rows are fully clickable, not just their text.

## 11. Voice

- Sentence case everywhere, including buttons ("Find a match", not "FIND A MATCH"). Allcaps survive only in the LIVE badge.
- Copy is confident and concrete: "A draft lands every 5 moves", never marketing fluff.
- Numbers are shown, not narrated: "312 online", not "lots of players online".

## 12. Route-level contracts

Every route redesign must produce: desktop + mobile screenshots, all five system states implemented, zero new colors, zero sub-12px text, linked player names, and a pass through this checklist recorded in the PR description.
