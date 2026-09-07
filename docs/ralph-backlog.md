# Ralph backlog

The standing work list for the continuous improvement loop. This file is the
loop's memory: a round picks the next unstarted items, does them, and updates
the status here in the same commit. A later session that knows nothing about
this one can read this file and carry on.

Status values: `TODO`, `WIP`, `DONE`, `DROPPED` (with a reason).
Sizes: XS under an hour, S a round, M two or three rounds, L a night.

Working rules for every round, non-negotiable:

- `docs/design-system.md` and `docs/DESIGN.md` are the contract. No new colours,
  no shadows, no glow, no backdrop blur, 7px on boxes and 3px on buttons, 13px
  text floor, transform and opacity only, `--ease-*` and `--dur-1..3`.
- Every animation respects `data-anim` (off/fast) and `prefers-reduced-motion`.
- No em dashes in user-visible text.
- Nothing is pushed on a red guard. `npm run typecheck`, `npm run lint`, and the
  guards relevant to what changed, plus `npm run build` before a push.
- `./node_modules/.bin/tsx`, never `npx -y tsx` (parallel npx installs race and
  corrupt the cache).
- **Parallelism has a hard ceiling here, and it is lower than it looks.** The
  box has 4 cores. `tsc --noEmit` and `eslint .` each walk 649 files across
  340k lines (one of them 1.06 MB), and each run costs about 10 to 17 percent
  of memory. Round 0 ran eight workers at once, they all reached their verify
  step together, and load average hit 87: every command including `pkill`
  started timing out. Three or four concurrent workers is the real limit, and
  a worker should lint and typecheck the files it touched rather than the
  whole repo, with one full-repo pass done once at integration time.
- Long simulations run niced and get suspended (`pkill -STOP`) while workers
  verify, then resumed. `sim-card-winrate.ts` flushes every 10 cards and
  resumes from its own shard file, so stopping it never costs more than the
  current batch.

---

## Round log

| Round | What landed |
|---|---|
| 0 | Backlog created, route sweep harness, material model, stale rules copy fixed |

---

## A. Balance: the material ladder

The named problem: the tier ladder is sublinear in material, so a card that
hands you 3 points is priced roughly where a card that hands you 1 point is.
`wa_conjure_bishop` (permanent unconditional bishop) sits at tier 3, below
`split_bishop` and `bn4_cathedral_choir` which do the same thing at tier 4.
`bn4_care_package` at tier 3 measures +41.7 win-rate points, the same band as
tier 6 and 7 cards. There is no invariant covering spawn or revival material,
which is why nothing caught it.

| # | Item | Size | Status |
|---|---|---|---|
| A1 | `scripts/material-model.ts`: score every active card for effective material, fit a tier floor against measured win rate, report violations | M | WIP |
| A2 | Full-library win-rate sweep, 3 niced shards, `--games 10`, writing `docs/card-winrate.shard{0,1,2}.json` | L | WIP (running) |
| A3 | Apply the retiers through `hand-audit.json` + `npm run gen:retiers` + `CARD_HISTORY` | M | TODO |
| A4 | Pin the material ladder as an invariant so a later blanket pass cannot undo it | S | TODO |
| A5 | Rework, not just retier, cards that are cheap AND boring (pure "+3 material, no decision") | M | TODO |
| A6 | `amazon_army` t7 measures -25 points: a play-policy bug, not a tier problem. Root cause in `/dev/lab` | S | TODO |
| A7 | Work the `pending-review` backlog in `docs/card-audit.md`: 266 duplicate-signature, 211 near-duplicate, 90 dominated | L | TODO |

## B. Feel: the practice-games loop

Findings come from actually playing. Each round plays several full bot games
(Buff, Nerf, plain chess; easy and hard; 1+0 and 10+0) and adds what felt wrong.

| # | Item | Size | Status |
|---|---|---|---|
| B1 | Audit premoves against Lichess: queue depth, cancel gestures, premove that a nerf later makes illegal, premove during a draft | M | TODO |
| B2 | Drag feel: ghost piece, cursor offset, drop snapping, right-click cancel, touch drag | M | TODO |
| B3 | Move feedback: last-move highlight, check indication, capture impact, legal-dot weight, hover ring | S | TODO |
| B4 | Keyboard: move input by typing, arrow-key move-list scrubbing, a `?` shortcut overlay | M | TODO |
| B5 | Chess sound design pass (move, capture, check, low time, game end), separate from the already-dense card audio | S | TODO |
| B6 | Clock: low-time urgency, tenths under 10s, pause correctness | S | TODO |
| B7 | Piece glide tuning, and making `data-anim=fast` actually feel fast | S | TODO |

## C. Pages and device screens

Static counts before the sweep: 62 route `page.tsx`, but only 8 `loading.tsx`,
1 `error.tsx` (the root), and 8 files importing `EmptyState`. Design system
section 8 requires five states on every async surface. Most routes have one.

| # | Item | Size | Status |
|---|---|---|---|
| C1 | `e2e/sweep.spec.ts`: every route at 360/390/768/1024/1440/1920 in dark, midnight and light, asserting overflow, one h1, console errors, text floor, focus, touch targets | M | WIP |
| C2 | Fix everything the sweep finds, worst first | L | TODO |
| C3 | Add the missing loading states | M | TODO |
| C4 | Add the missing error boundaries | M | TODO |
| C5 | Add the missing empty states | M | TODO |
| C6 | Mobile match column (`MobileMatchStack`), draft overlay on a phone, buff dock: the three highest-traffic mobile surfaces | M | TODO |

## C2. Findings from the round-0 UI audit

Measured, with file:line. These are the concrete C2 work items.

| # | Item | Size | Status |
|---|---|---|---|
| C10 | **The board is not keyboard-operable.** Squares carry `role="gridcell"` (`Board.tsx:1719`) but the parent grid (`Board.tsx:4621`) has no `role="grid"`/`role="row"`, so the roles are orphaned, and there is no `tabIndex` and no keydown. The only keydown in the file is Escape for arrow-drag cancel. You cannot make a move without a pointer | M | TODO |
| C11 | **No board-flip affordance.** The `flipBoard` setting exists (`settings/config.ts:180`) and is read, but there is no button on the board and no `f` shortcut. It is three levels into the Settings panel. `/analysis` has its own local flip button, so the game surface is the odd one out | S | TODO |
| C12 | **No in-game eval bar.** The math already exists: `evalPercent()` and `evalLabel()` at `analysis/page.tsx:51-61`. It is not wired into `OnlineMatch`, `game/[id]`, `history/[id]` or the spectator view | M | TODO |
| C13 | **The 768 to 1023 tablet band is unstyled.** Only 7 `md:` uses in the whole codebase (vs 563 `sm:`, 114 `lg:`), so tablets inherit the phone-derived `sm` layout with a fixed 288px rail and a fixed bottom drawer | M | TODO |
| C14 | **301 sub-12px text violations** against the design system's own hard floor: 227 `text-[11px]`, 58 `text-[10px]`, 13 `text-[9px]`, 3 `text-[8px]`. Worst: `TurnCostBadge.tsx:57` (8px), `PlayerNerfCard.tsx:281` (8px), `Board.tsx:378` (9px), `clip/ClipModal.tsx:1538` (9px on parchment-500) | M | TODO |
| C15 | **Contrast below AA.** `parchment-500` `#7a7a7a` on panel is ~3.6:1, and it is used 92 times outside effects. Alpha-dimmed text compounds it: `text-parchment-400/40` on panel is roughly 1.9:1 | M | TODO |
| C16 | **No focus trap.** `useModalChrome.ts` does scroll lock, Escape and a ghost-click guard, but does not cycle Tab, despite 9 `aria-modal="true"` dialogs and design system section 10 promising it | S | TODO |
| C17 | **No `not-found.tsx` anywhere**, and no per-segment `error.tsx` for `/game/[id]`, `/u/[username]`, `/tournaments/[id]` | S | TODO |
| C18 | **No `/settings` route.** Settings live only in a panel opened from the header, so they are not linkable, bookmarkable or deep-linkable | S | TODO |
| C19 | **Invalid ARIA:** `role="lead"` reaches the DOM from `Board.tsx:4859, 4872` and `dev/plays/PlaysGallery.tsx:165`. It is a prop-name collision (the VFX API means "lead vs support") that lands as a literal invalid `role` attribute | XS | TODO |
| C20 | **Four dead components:** `CurrentGameCard.tsx` (superseded by `profile/CurrentGameCard.tsx`, kept alive artificially by the button-audit baseline), `AccountChip.tsx`, `BuffUsedToast.tsx`, `ratings/RatingCard.tsx`. None has an importer | XS | TODO |
| C21 | **Duplicated settings rows:** the `accessibility` section of `settings/config.ts` duplicates the `appearance` Motion rows with `-A11y`-suffixed ids, so two controls bind the same two settings and the Accessibility blurb is literally "Motion" | XS | TODO |
| C22 | **`npm run typecheck` fails out of the box** for anyone with a stale `.next` cache: `tsconfig.json` includes `.next/types/**` and `.next/dev/types/**`, and truncated generated files there produce 7 syntax errors that have nothing to do with `src` | XS | TODO |
| C23 | Two mod tables force horizontal scroll in the 640 to 760 band: `mod/ControlsSection.tsx:324` (`min-w-[420px]`) and `mod/DashboardSection.tsx:212` (`min-w-[34rem]`). `SiteHeader.tsx:379,434` dropdowns are `w-80` unguarded and overflow at 320px | XS | TODO |
| C24 | Six icon-only buttons without `aria-label`: `OnlineMatch.tsx:2374`, `game/page.tsx:1510`, `mod/house/page.tsx:205,296`, `u/[username]/page.tsx:2074,2144` | XS | TODO |
| C25 | `scripts/check-buttons.ts` carries a 61-file baseline of surfaces still using hand-rolled buttons. `--strict` only catches new offenders, so the debt is invisible. Work the baseline down | M | TODO |
| C26 | Weakest system-state pages, from the audit: `analysis` (no error/empty/loading), `achievements` (no empty), `history/[id]` (no error, no empty), `game/page.tsx` (16 loading markers, 0 error), `codex/suggest` (0 loading), `mod/page.tsx` (0 error). `tv/page.tsx` is the reference implementation to copy: it distinguishes "unreachable and nothing cached" from "first snapshot loading" | M | TODO |
| C27 | The `clip/studio/*` subtree (~1,900 lines) has one width query and is otherwise unresponsive | S | TODO |

## D. Motion and graphics

| # | Item | Size | Status |
|---|---|---|---|
| D1 | Route and page transitions (there are none today), list stagger, skeleton to content crossfade | M | TODO |
| D2 | Draft overlay choreography: deal, hover, pick, commit, pocket flight | M | TODO |
| D3 | Game-over and the secret-nerf reveal, the game's most shareable beat | M | TODO |
| D4 | Normalise the keyframe vocabulary: audit ~5,570 keyframes for durations and easings that ignore `--ease-*` / `--dur-1..3` | M | TODO |
| D5 | Split `sigVisuals.tsx` (19.6k lines, 1.06 MB) so a game loads only what it fires | L | TODO |
| D6 | Split `Board.tsx` (5,045 lines) by concern: grid, drag, animation pipeline, overlays | L | TODO |

## E. Lichess parity and new surfaces

Research lands in `docs/lichess-parity-2026-09.md` and feeds items back here.

| # | Item | Size | Status |
|---|---|---|---|
| E1 | Lichess behaviour study and gap analysis | S | DONE (round 0), see `docs/lichess-parity-2026-09.md` |
| E2 | Puzzles, and a daily puzzle. The roadmap's top retention ask: it works with nobody else online | L | TODO |
| E3 | The named-bot ladder. 900 personas already exist in `src/lib/server/bots.ts` | M | TODO |
| E4 | Analysis: eval bar and move classification | M | TODO |

Ranked from the parity study, cheapest first. lichess.org itself is blocked by
the egress proxy, so these were read out of `lichess-org/lila` and
`lichess-org/chessground` source rather than the live site.

| # | Item | Size | Status |
|---|---|---|---|
| E10 | **Every drag paints the piece twice.** `.dragging` is defined at `globals.css:1524` and applied nowhere, so the origin square never fades under a dragged piece | XS | TODO |
| E11 | Bind `z` (zen) on `/analysis`, `/tv` and `/history/[id]`. The hook exists and is only imported on `/game` | XS | TODO |
| E12 | Clock urgency relative to the time control (Lichess's formula) rather than fixed 30s and 10s thresholds | XS | TODO |
| E13 | Blink the clock separator while a clock runs. It matters more here than on Lichess because our clock genuinely pauses for drafts | XS | TODO |
| E14 | Wheel over the board scrubs plies | XS | TODO |
| E15 | PGN export on `/history/[id]`; it is already wired on the other two replay surfaces | XS | TODO |
| E16 | A shared keymap module plus the `?` help dialog. Buys `f`, `k`/`j`, `0`/`$`, `home`/`end` and `c` in one change | S | TODO |
| E17 | TV featured-game hysteresis (Lichess uses a 1.17x gate) and rematch follow. We reshuffle on every poll | S | TODO |
| E18 | Arrow polish: snap to queen and knight lines, bent knight arrows, the Lichess modifier map | S | TODO |
| E19 | Drag distance threshold, and tap-tap as the touch default | S | TODO |
| E20 | Move the analysis engine into a Worker. It currently runs a 300ms blocking search on the main thread | M | TODO |
| E21 | Move classification from win-percent deltas (0.1 / 0.2 / 0.3, Lichess's own thresholds) | M | TODO |
| E22 | Card-aware game review. `Analyze` currently truncates at the first card-enabled move | M | TODO |
| E23 | Move times in the notation panel. The draft charges the clock, so "where did my time go" has a real answer here that it does not have on Lichess | S | TODO |
| E24 | Give-more-time button | S | TODO |

Deliberately NOT building, with reasons, so a later round does not relitigate:
the opening explorer (a hidden nerf changes the legal move set from move one,
so opening stats would be noise dressed as authority; build a card explorer
over the win-rate data instead), anything mate-based, variation trees and
studies, correspondence (one day per move against a draft every 5 moves breaks
the mechanic), berserk unless the draft cadence moves with it, and a
pieces-only board editor, which can only produce positions that cannot occur.

Two conflicts to respect when E2 and the a11y work land: classic tactics
puzzles do not transfer, because nearly all of them resolve to mate or
material. The three formats that do work here are "capture the king in N under
this nerf", "find the only move your rule allows", and "two cards are offered,
which one wins", and the last has no chess analogue at all. And a screen-reader
board here has to name card state per square (frozen, warded, doomed with a
count, mined), not just pieces, or it is unplayable in a way Lichess's is not.

## F. Correctness and docs drift

| # | Item | Size | Status |
|---|---|---|---|
| F1 | Guide pages claimed a 45% top-tier slip gate that no longer exists; `docs/draft-system.md` said cadence 6 (code says 5) and "263 cards" (1,665 active) | XS | DONE (round 0) |
| F2 | `.gitignore` does not cover the `AGENTS.md` that `next dev` generates | XS | TODO |
| F3 | Desync telemetry, Priority 0 in `docs/improvement-roadmap.md`. Needs real traffic, so build the hashing and the report surface | M | TODO |
