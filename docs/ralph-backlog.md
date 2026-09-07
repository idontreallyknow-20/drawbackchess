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
| 0 | Backlog created, Lichess parity study, stale rules copy fixed (guides described a slip gate the engine no longer has), modal focus trap |
| 1 | Material model, chess sound pass (found `tone()` ignoring the volume slider outright), board keyboard play, loading and error states 8 to 21 and 1 to 18, typography floor, contrast tokens, four dead components |
| 2 | Clock urgency scaled to the time control, running-separator blink, the new sound cues wired to their events, zen on analysis and TV and the replay, PGN on the replay |
| 3 | Surface ladder restored to its documented values, sentence case in the nav and settings menu plus `scripts/check-case.ts` to hold it, the material ladder applied (18 cards) and pinned as an invariant |
| 4 | Route sweep harness (48 routes, 6 widths, 3 themes, 828 cells, 13.5 min), touch targets fixed after it proved every rem-based one was 12.5 percent short, eight routes given the h1 they lacked |
| 5 | The bot now simulates a card's effect before choosing its targets, which fixes a blunder that was corrupting every win-rate measurement of every activated card; changelog caught up; sweep restarted |

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
| A1 | `scripts/material-model.ts`: score every active card for effective material, fit a tier floor against measured win rate, report violations | M | DONE (round 1) |
| A2 | Full-library win-rate sweep, 3 niced shards, `--games 10`, writing `docs/card-winrate.shard{0,1,2}.json` | L | WIP. **Restarted from zero in round 5**: the bot play policy changed, so the 220 cards measured before it are not comparable with anything measured after, and mixing the two would be worse than either alone. Suspend with `pkill -STOP -f sim-card-winrate` while workers verify, resume with `-CONT`; it flushes every 10 cards and resumes from its own shard file |
| A3 | Apply the retiers through `hand-audit.json` + `npm run gen:retiers` + `CARD_HISTORY` | M | DONE (round 2): 18 moved, 10 of the original 28 were parser misreads and are fixed or held out |
| A4 | Pin the material ladder as an invariant so a later blanket pass cannot undo it | S | DONE (round 2): section 1b of `scripts/test-balance-pass-2026-09.ts` |
| A8 | The pocket discount is probably backwards: a crazyhouse drop lands anywhere, dodges every nerf filter, and breaks stalemate, so it is worth MORE than the same piece in your own half, not 0.95 of it. Measure the family, then move the multiplier | M | TODO |
| A9 | Two parser holes left, held out by name in `KNOWN_MISREAD`: a replacement (`X ... and Y returns in its place`) is a transform written the long way round (`seance`), and a later sentence re-describing an already-scored piece is a gloss, not a second body (`wc_lost_and_found`) | S | TODO |
| A5 | Rework, not just retier, cards that are cheap AND boring (pure "+3 material, no decision") | M | TODO |
| A6 | **`amazon_army` measured -25 points and it is probably not the card.** It is passive, so the activation fix (A11) does not touch it, and it only ADDS legal moves: knights gain bishop slides, bishops gain knight leaps. A card that strictly widens your options cannot make the position worse, so the loss has to come from somewhere else. Measured fact: in a normal middlegame position it takes White from **40 legal moves to 57, a 43 percent wider tree**. Unproven hypothesis: the harness plays at skill 1350, which is a **60ms** search budget, and a fixed budget over a 43 percent wider tree buys fewer plies, so the bot simply plays worse while holding it. If that is right the harness systematically under-measures EVERY move-expansion card, which would be a second measurement bias on top of the activation one. I could not settle it: timing a 60ms search needs a quiet machine and this box was running three simulation shards, a route sweep and two workers. To finish it, instrument the search to report the ply depth it completed (`analyzeBoard` already returns `depth` but takes a raw board and cannot see buffs, so `pickAIMove` needs the same) and compare depth, not wall time | M | TODO |
| A7 | Work the `pending-review` backlog in `docs/card-audit.md`: 266 duplicate-signature, 211 near-duplicate, 90 dominated | L | TODO |
| A11 | **`queens_rampage` was a play-policy bug, not a tier problem.** FIXED (round 5) by `refineLastSquarePick` in `src/engine/game.ts`: the bot now re-picks a card's last square by simulating the activation on a detached copy of the game and scoring the resulting position, instead of ranking squares by the piece standing on them. Pinned by `npm run test:ai-activation`, which fails on two of three assertions without the fix | S | DONE |
| A12 | **Material is one axis of power and the model only sees that one.** Twelve cards measure above +30 win-rate points at M=0: `mirror_of_souls` +50.0 (piece-swap), `bn4_ascension_small` +45.8 (promotion-grant), `detonate` +44.4 (forced-sacrifice), `smurf_account` +41.7 (capture-denial), `giants_maul` +41.7 (mass-freeze), `piece_parole` +40.0 (single-piece-shield), `bn4_endless_militia` +35.0 and `total_atomic` +33.3 and `atomic_captures` +31.8 (mass-removal). Either a second model for those categories, or an explicit statement that they are priced by hand and why | M | TODO |

### The ladder the model settled on (round 1)

`scripts/material-model.ts` scores every active card for effective material `M`
(pieces gained plus pieces denied, discounted by permanence, conditionality and
stated odds), then charges a tier floor for it.

The honest finding is that **the measurement establishes a direction and a lower
bound, not a rate.** One tier rung is worth about 0.93 win-rate points. Cards
carrying no material average +0.9 points; a card granting a minor averages
+15.6, which is 15.9 rungs of excess power for something the ladder charges 3
rungs for. Every material band measures above the no-material baseline by more
than the ladder charges. But the buckets hold 8 to 14 cards against a median
per-card error bar of 12.2 points, so they cannot pin the rate: the "pawn to a
minor" bucket out-measures the "rook" bucket, which is sampling noise, not a
fact about the game.

So the ladder is anchored **structurally** on the two floors the 2026-09 pass
already pinned in `scripts/test-balance-pass-2026-09.ts` (extra piece-class is
tier 4, amazon-class is tier 7). The line through those two points is
**0.5 tiers per point of material**:

| M | floor | what that is |
|---|---|---|
| under 0.75 | t1 | under the parser's own resolution |
| 0.75 | t2 | a pawn behind a lease, a gate, or the odds |
| 1.5 | t3 | a clean permanent pawn |
| 2.5 | **t4** | a minor (anchor: Cathedral Choir and Summon Knight already sit here) |
| 4.5 | t5 | a rook |
| 6.5 | t6 | a rook and a pawn, or two minors |
| 8.5 | **t7** | a queen (anchor) |
| 12 | t8 | queen and rook; the tier ceiling starts binding |
| 18 | t9 | apex |

### What round 2 did with it

Round 1 reported **28 violations**. Reading them one at a time found that ten
were the parser's fault, not the library's, so the fix went into the parser
first and the tiers second:

- an unstated promotion target was assumed to be a **queen**, which priced a
  minor's worth of upgrade at eight points (`bw3_heir_apparent`, and three more
  that were never violations but were scored four times too high). It is now
  priced at the cheapest promotion the game allows.
- a stated **plural** target was missed entirely, so "promote to knights" fell
  through to the same queen default (`promotion_storm`).
- a lease only counted when the card said "**then** vanishes", so "appears there
  **and** vanishes after 4 of your turns" was read as permanent (`phantom_rook`,
  `ww_mercenary_queen`: a four-turn rook and a three-turn queen priced as real
  ones).
- a **cost clause** reached by a conjunction was billed to nobody: "one of your
  own pawns bursts in the mess **and is lost** too" (`wc_pinata`), and the same
  hole hid the minor Apotheosis spends and the piece Funeral Pyre lights.
- an "**up to N**" in front of a list was applied to the first member only, so
  "up to two of your knights and bishops" bought three pieces
  (`bw2_queens_testament`) and "up to two ... knights or bishops" lost the
  discount altogether (`ww_last_reserves`).
- a **roulette table** with odds on no branch was scored as if the winning
  branch were certain (`cs_roulette`); it is refused now, like the other
  gambling ladders.
- a **pronoun** was bound to an antecedent two sentences back, and to a whole
  sentence rather than to a clause. Both are now one sentence and one clause.

That left **18 real violations**, and all 18 moved. `wa_conjure_bishop`, the
card that started this, scores M=3.00 and moved t3 to t4, landing exactly on the
minor anchor beside the cards that already do the same thing.

Two rows the parser still reads wrong are held out **by name** in
`KNOWN_MISREAD`, with the line of the engine that settles each and the parser
fix that would retire the entry (A9). Neither was moved.

Parser coverage is **67 percent** of the cards in a material effect category,
with 10 refused outright (gambling ladders whose branch odds are stated only in
total). The gaps are work, not noise: 18 of 40 mass-removal cards score nothing,
and three of the strongest measured cards in the library
(`bn4_endless_militia` +35.0, `total_atomic` +33.3, `atomic_captures` +31.8) sit
in that gap. The invariant is therefore an explicit **table of hand-checked
cards**, not a blanket "every card clears its model floor", so it cannot enforce
the parser's blind spots as design rules.

### The three model-versus-measurement conflicts, settled

- **`bn4_care_package` +41.7 +-14.9 at M=1.90 (2.8 sigma, the only one of the
  three that resolves).** The model is right that the tier is t3, and the power
  it cannot see is the POCKET. `legalMoves` appends drops after every nerf and
  effect filter, onto any empty square on the whole board, and counts them for
  stalemate resolution: a pocketed knight can appear on a fork square with no
  travel and nothing able to stop it. The model charges 0.95 for that, a
  discount. That multiplier is backwards, and it is A8.
- **`queens_rampage` -13.6 +-13.6 at t7 (1.00 sigma: not a measurement).** The
  card is fine and stays at t7, well above its M=3.90 floor. The sign comes from
  the bot: `aiSquareScore` ranks an enemy-occupied square at 1000+ and an empty
  one at 7, so the sweep always ENDS on the most valuable enemy piece in line;
  the activation path never consults move safety the way a real move does; and
  the gate only asks for a minor's worth of target. So the bot trades a queen
  for a knight into a defended square and then hands over the turn. A play-policy
  bug, filed beside A6.
- **`legendary_forge` -16.7 +-16.7 (1.00 sigma: not a measurement).** Moved t3
  to t4 anyway. Its payload is `Bodyguard`'s exactly (a minor into the pocket,
  one later turn to drop it), `Bodyguard` is t4, and `Bodyguard` measured
  **+15.0 +-13.0** on the same harness. A 32-point spread between two identical
  payloads is the error bar, not the cards.

Round 1's two recorded over-counts are closed: `apotheosis` now reads the minor
it spends (M 8.55 to 5.70, which puts it exactly at its tier and removes it from
the list), and `wc_sacrificial_bishop` already nets to zero, so the note was
stale. Both are pinned in the parser's self-check.

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
| C28 | **Uppercase labels violate section 11** ("Sentence case everywhere... allcaps survive only in the LIVE badge"). Seen on the main nav (PLAY, WATCH, COMMUNITY, LEADERBOARD, RULES) and every quick-settings section head (BACKGROUND, BOARD, PIECES, BOARD SIZE, SOUND). Section 3 also retired the letterspaced-smallcaps pattern sitewide, so these are the survivors | S | TODO |
| C29 | **One light-mode piece preview is near-invisible.** In the quick-settings piece picker under the light theme, the tenth thumbnail (second row, fourth) renders as a faint outline on the near-white raised surface. Its white fill has nothing to sit against. The other ten are fine, so this is one theme's fill choice, not the picker. Worth checking the same set on a light board theme, where the same collision would happen in a real game. Found by looking at a screenshot; no guard covers it | S | TODO |
| C30 | **`--text-secondary` fails AA in light** on every surface: 3.71:1 on the page, 4.42:1 on a panel, 4.15:1 on raised. The round-2 contrast pass fixed the muted rung and did not touch this one | S | TODO |
| C31 | The surface ladder is fixed and now documented, but `--bg-hover` still measures 3.94:1 for `parchment-400` by design. Audit for muted text that sits permanently on a hover fill, which is the case that makes that number a real defect rather than an accepted one | S | TODO |
| C32 | **The whole spacing scale is 87.5 percent of the design system's px values.** `html` is 14px and `tailwind.config.ts` never overrides `spacing`, so Tailwind's rem scale resolves against 14, not 16: `p-4` is 14px where section 4 says 16, and the `p-2 px-3` "plate default" is 7px and 10.5px rather than 8 and 12. The touch targets are fixed with literal px, but the scale itself is untouched. Fixing it centrally makes the entire app roughly 14 percent roomier, and density is something this site values on purpose, so this is a design decision for the owner rather than a defect to quietly correct. Options: override `spacing` to px, raise the root to 16px and re-pin the type ramp, or write down that the scale is intentionally tighter than the doc and fix the doc | M | NEEDS A DECISION |
| C33 | `overflow-x: clip` on `html, body` (`globals.css:8`) means over-wide content is **silently clipped and unreachable** rather than scrollable, and `scrollWidth <= innerWidth` can never fail. Proved by planting a 900px div at 360px wide. Any overflow check has to walk the DOM for boxes past the edge with no scrolling ancestor, which `e2e/sweep.spec.ts` now does. Worth deciding whether clip is the right default at all | S | TODO |
| C34 | `/u/[username]` renders no `h1` during its own in-page loading state (distinct from `loading.tsx`, which now has one). Same shape likely applies to any client component that fetches and renders a heading from the response | S | TODO |
| C35 | `/api/lobby` 404s twice per load on 8 routes under `next dev`: `lobbyClient.ts` fetches it and it is served by `worker.ts` only, with no `src/app/api/lobby` handler. Environment-shaped rather than broken in production, but it means the live strip cannot be exercised locally at all | S | TODO |
| C36 | `Button`'s `xs` and `sm` size tokens are `min-h-[36px]`, under the documented 44px mobile minimum, and `xs` is 12px text, under the 13px interactive floor. Only `md` is correct. `/login`'s Sign in and Register tabs are a bespoke 32px button, not `<Button>` at all | S | TODO |
| C37 | Disconnected and recovered states (section 8, states 4 and 5) are missing on 18 async routes. `ConnectionBanner` exists and is the pattern; it is simply not mounted on most of them | M | TODO |

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
