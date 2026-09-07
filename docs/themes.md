# Site themes

The site theme is a Settings > Appearance preference (`settings.siteTheme`),
applied by `applyUiPrefs` as `html[data-theme="<id>"]`. There are four ids and
three palettes:

| Id | What it is |
| --- | --- |
| `dark` | The default. Lichess's own warm-grey dark palette. |
| `midnight` | Lichess's dark ladder on a navy hue (`--site-hue: 218deg`), a cooler text ramp and the accent lifted one notch (`#4c9ff0`). |
| `light` | Lichess's light palette. |
| `system` | Follows the device, resolving to `dark` or `light` before it reaches the DOM. |

`applyUiPrefs` never writes `system` into `data-theme`: it reads
`prefers-color-scheme` and stamps the palette that wins, so CSS only ever sees
three values. Midnight and light are override blocks in `globals.css`; the
warm dark palette IS the `:root` block.

## The two palettes

The dark palette IS the `:root` token block in `globals.css`. The light theme is
the one override block, `html[data-theme="light"]`, and it sets the same names.

| Token | Dark | Light |
| --- | --- | --- |
| `--bg-base` (page) | `#161512` | `#edebe9` |
| `--bg-panel` (box) | `#262421` | `#ffffff` |
| `--bg-raised` (raised) | `#302e2c` | `#f7f6f5` |
| `--bg-hover` (a row under the pointer) | `#3c3934` | `#f1f0ee` |
| `--border-subtle` | `#404040` | `#d9d9d9` |
| `--text-primary` | `#bababa` | `#4d4d4d` |
| `--text-heading` | `#cccccc` | `#333333` |
| `--text-secondary` | `#8c8c8c` | `#787878` |
| `--text-muted` | `#707070` | `#999999` |
| accent (`--accent-gold`) | `#3692e7` | `#1b78d0` |
| accent hover | `#4a9fee` | `#3692e7` |
| `--text-on-accent` | `#ffffff` | `#ffffff` |

Everything else in `:root` is computed from those, so a palette change costs no
per-component work. `--accent-gold` is a historical NAME kept because several
hundred consumers spell it that way; its value is the accent blue.

There is one accent. The accent-colour setting is gone.

## The semantic accents

Nerf red (`--accent-nerf` `#e05252`), Buff blue (`--accent-buff` `#5b9bd5`),
positive green (`--accent-positive` `#629924`) and danger (`--accent-danger`
`#c0413b`) mean mode, powers, a win and destruction. They keep their meaning in
both palettes; light darkens them so they still clear WCAG AA as text on paper.

## Light-scheme treatments

Paper treatments (plate fill, the ink text ramp, border alphas, input styling)
hang off `html[data-light]`, which `applyUiPrefs` sets whenever the active
theme's `scheme` is `light`. They read the active palette's own
`--text-primary` / `--text-secondary` / `--text-muted` rather than literals.

## Typefaces

Lichess sets the whole interface in Noto Sans, and so do we. `layout.tsx`
self-hosts two faces under neutral `--f-*` names on `<html>`: Noto Sans and
JetBrains Mono. `:root` maps them onto the three ROLES:

- `--font-display` and `--font-body` both resolve to Noto Sans (weight does the
  hierarchy).
- `--font-mono` is JetBrains Mono, for clocks, ratings, ids and coordinates.

Components ask for a role, never for a face. The base font size is 14px, and
the fluid ramp `--step-0..5` tops out near 2.1rem: Lichess headings are modest.

## Migrating an old stored theme

Before this pass there were 22 theme ids: ten dark tints, two light tints and
five "flagships" with their own accent, faces, materials, atmospheres and chest
re-skins. All of them are gone. `LEGACY_SITE_THEMES` in `src/lib/settings.ts`
maps every retired id onto its replacement, so an existing user loads as `light`
if their theme was a light one and `dark` otherwise, instead of being reset.

## Custom background

Still supported, as on Lichess: Settings > Appearance takes an uploaded image
(device-local data URL) or an http(s) URL plus a dim slider. It sets
`background-image` on `body` and layers over the flat `--bg-base` canvas, so
`body` must stay `background-color: transparent`.

## Adding a theme

1. Add the id to `SiteTheme` and an entry to `SITE_THEMES` in
   `src/lib/settings.ts` (label, hint, scheme, swatch, accent).
2. Add the `html[data-theme="<id>"]` block in `globals.css`: the four
   background + border tokens, the text ramp, the accent and
   `--text-on-accent`. Nothing else.
3. Check contrast: body text, secondary text and the accent should all clear
   4.5:1 on `--surface-panel`, and `--text-on-accent` should clear 4.5:1 on the
   accent fill.
