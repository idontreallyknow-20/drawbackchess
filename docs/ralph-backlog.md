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
- **Restart `next dev` between rounds.** It leaks: after about seven hours of
  HMR and route compiles the dev server sat at **9.1 GB resident**, which is 57
  percent of the box on its own. That single process was the whole of a
  near-OOM in round 7 (1.1 GB available, load average 74); killing it took
  available memory from 1.1 GB to 12.9 GB in three seconds, before anything
  else was touched. Check `ps -eo rss,args --sort=-rss | head` before blaming
  the workers.
- When memory does get tight, `pkill` and `pkill -9` themselves fail or return
  144 under load, and a second `pgrep` will show the processes still alive.
  `pgrep -f pat | xargs -r kill -9` works where `pkill -f pat` does not.
- **Close a row in the same commit as the work, and keep the line numbers out
  of the claim.** Round 7 sent a worker at six items and four of them (C10,
  C19, E10, E11) had already been done in rounds 1 and 2 while the rows still
  read TODO with round-0 line numbers that no longer pointed at anything. It
  spent most of its run proving that working code works. A row's line numbers
  are evidence for when it was written and nothing else; re-measure before
  believing one.
- **Give a worker the widths AND the pointer types**, not the widths alone.
  Every touch-target defect found so far has been masked by some width query
  standing in for a pointer query, and a probe that only varies width
  reproduces the same blind spot it is meant to find.

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
| 6 | `amazon_army` root-caused: the search-depth hypothesis was measured and REFUTED, and the real defect is that `negamax` cannot see buff-granted moves below the root. `SearchStats` added to `pickAIMove`; `test:search-buffs` locks the defect. Plus the system-states round: the polled inbox was silent about a dead connection, and sub-13px interactive text went 312 to 151 |
| 7 | A6 confirmed independently from the win-rate data via the duration x grant-size interaction (4.5 sigma where predicted, 0.4 and 0.5 where predicted absent). The 26 affected cards quarantined from downward retiers. Ladder checked for contamination and cleared. The mobile flip button that measured 0 x 0, the last `role="lead"`, contrast tokens, touch-target shapes, `/settings` route |

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
| A8 | **The pocket discount is probably backwards.** Measured in round 7 and the answer is no. The whole family, not the one card that raised it: pocket cards sit at **+1.1pt** residual against their own tier (n=13), non-pocket material cards at **+7.3pt** (n=71), a difference of **-6.3 +-5.0pt, 1.3 sigma** in the OPPOSITE direction to the hypothesis, and unresolvable either way. `bn4_care_package` +41.7 is the top of a spread running down to `legendary_forge` -16.7; those two carry the same payload class and sit 58 points apart on 12 pairs each, which is the error bar, exactly as round 1 found for `legendary_forge` against `bodyguard`. The mechanical argument (a drop lands anywhere, dodges every nerf filter, breaks stalemate) may still be right and the sweep may simply not resolve 5%, but changing a multiplier on the largest number in a noisy column is the failure mode this model exists to avoid. Multiplier stays 0.95; reasoning rewritten in the model's header | M | DROPPED (not supported) |
| A9 | Two parser holes left, held out by name in `KNOWN_MISREAD`: a replacement (`X ... and Y returns in its place`) is a transform written the long way round (`seance`), and a later sentence re-describing an already-scored piece is a gloss, not a second body (`wc_lost_and_found`) | S | TODO |
| A5 | Rework, not just retier, cards that are cheap AND boring (pure "+3 material, no decision") | M | TODO |
| A6 | **`amazon_army` measured -25 points. Root-caused: the bot's search cannot see buff-granted moves below the root.** Settled in round 6, see the write-up below. Pinned by `npm run test:search-buffs`. The fix is an engine change to a hot path with a desync hazard, so it is filed separately as A13 | M | DIAGNOSED |
| A13 | **Make `negamax` buff-aware.** `negamax`/`quiesce` take a bare `BoardState` and call `generateMoves(board)`; only the root calls `legalMoves(game)`, which is the only function that runs `def.augmentMoves`. So every move-granting buff exists at ply 0 and nowhere else. Design sketch and the three hazards are in `scripts/test-search-buff-visibility.ts`. Do not attempt this in the same round as anything else | L | TODO |
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
  three that resolves).** Round 2 read this as the model under-pricing the
  POCKET: `legalMoves` appends drops after every nerf and effect filter, onto
  any empty square on the whole board, and counts them for stalemate
  resolution, so a pocketed knight can appear on a fork square with no travel
  and nothing able to stop it, and the model charges 0.95 for that. Filed as
  A8, and **round 7 measured the family and did not support it**: the thirteen
  pocket cards average +1.1pt against their tier while the other 71
  material-carrying cards average +7.3pt, a 1.3 sigma difference the wrong way.
  This row is the top of a spread that reaches -16.7 for the same payload
  class. One 2.8 sigma row in a family that averages nothing is a row, not a
  finding.
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

### A6 settled (round 6): the search is blind to buffs below the root

Round 5 left `amazon_army`'s -25 open with a named hypothesis and the exact
experiment that would settle it. The experiment was run. **The hypothesis was
wrong.**

The instrument first. `pickAIMove` now takes an optional write-only
`SearchStats` and reports the deepest ply it actually completed and how many
root moves it considered, so "the bot played worse while holding this" and
"this card is bad" can finally be told apart. `analyzeBoard` already returned a
depth, but it takes a raw board and therefore cannot see buffs at all, which is
the same defect this ended up finding.

The hypothesis was that a 43 percent wider tree buys fewer plies out of the
bot's 60ms floor budget, so the harness charges the card for a weaker search.
Measured, on a quiet box:

| level | budget | depth without | depth with | root moves |
|---|---|---|---|---|
| medium | 60ms | 3 | 3 | 40 -> 57 |
| medium | 700ms | 3 | 3 | 40 -> 57 |
| hard | 60ms | 3 | 3 | 40 -> 57 |
| hard | 700ms | 4 | 4 | 40 -> 57 |

The widening costs **zero plies at every level and budget tried**. Alpha-beta
with move ordering absorbs it, and `medium` is capped at `maxDepth: 3` anyway,
which is low enough that 60ms was never the binding constraint. There is no
search-depth bias against move-expansion cards. That is a clean negative and it
closes off a whole line of suspicion about the balance dataset.

The real mechanism is worse and it was two greps away once the timing story
died. `negamax` and `quiesce` take a bare `BoardState`. Only `pickAIMove`'s root
calls `legalMoves(game)`, and `legalMoves` is the *only* place `def.augmentMoves`
runs. So:

```
ply 0   legalMoves(game)      57 moves, 17 of them granted by the card
ply 1+  generateMoves(board)  42 moves, 0 of them granted by the card
```

Both lines describe positions two of White's turns into a three-turn card. The
bot plays a move that exists **only** because of the card, then evaluates every
follow-up as if the piece were an ordinary knight. It cannot see a two-move plan
that needs the buff twice, it cannot see the opponent's buffed replies at all,
and it never models expiry in either direction. Holding a move-granting card
makes the bot's own move real and its picture of the future false, which is a
strictly worse place to be than not holding it. That is enough to produce a
negative measurement from a card that only adds options.

This is not specific to `amazon_army`. It applies to every card in the library
that grants movement, which is the whole `movement` category plus every
`timedAugment` / `permanentAugment` / `pieceBound` holder. **Do not retier a
move-granting card downward on win-rate evidence** until A13 lands and the
measurements are retaken.

Not fixed in this round, deliberately. The obvious fix is a board-bound augment
closure called per node, and it carries three hazards, the second of which is
disqualifying for an unsupervised change:

1. `makeBuffApi` captures `game.board` by value, so a per-node augment means
   either rebuilding a ~20-closure api object per node (too slow for a hot
   path) or mutating a shared one (a lifetime hazard).
2. Not every `augmentMoves` generator is board-pure. One that touches `api.rng`
   would advance the game's RNG stream once per searched node. That is exactly
   what `test:desync`, `test:snapshot` and `test:spectator-sync` exist to catch,
   and it would corrupt live games rather than merely mis-score them.
3. Applying the augment at every ply ignores expiry, so a 12-ply `hard` search
   would over-value a three-turn card. Swapping one bias for the other is not
   obviously progress.

`npm run test:search-buffs` is a known-issue lock, not a red guard: it states
the defect, pins its size at 17 granted moves in a fixed position so the file
cannot quietly stop measuring anything, keeps the refuted depth hypothesis
refuted, and turns its message inside out the moment the search starts seeing
buffs.

### A6 confirmed from the data as well (round 7)

The above is an argument from the code. `scripts/analyze-search-bias.ts`
(`npm run analyze:search-bias`) asks whether the defect leaves a fingerprint in
the 617 measured cards, which is a harder question, because the obvious
comparison proves nothing: move-granting cards do measure below everything else
(mean +2.6 against +5.8, and the gap widens to -19.1 at t7), but at those tiers
the comparison group is mass-removal and spawn cards which are genuinely
enormous. "Cards that add moves are weaker than cards that add queens" is not
evidence of a measurement bug.

**The obvious test fails too.** If invisible moves alone made a card measure
badly, the residual should scale with the grant. It does not: the slope is 1.2
sigma, and a threshold split PEAKS at 12 granted moves and decays above it,
which no real dose-response does. The three largest grants in the library are
`warp_step` (108 moves), `overclock_major` (39) and `reposition` (37), and their
residuals are -8.6, -5.1 and **+19.4**. Those should be the worst cards on the
board and they are among the best.

**The reason is in their text.** "Move one piece up to three squares ...
**once**." "All your pieces may move like kings ... **for 1 turn**." Against
`amazon_army` "for your next **three** turns" and `onslaught` "for your next 3
turns". A card spent on the turn it fires cannot be hurt by a search that
forgets it one ply down: the root sees the move, plays it, and there is no
future left to get wrong. A card that lasts three turns is wrong about every ply
it searches.

So the defect predicts an **interaction**, not a main effect. Duration decides
whether the search is wrong; grant size decides by how much; neither should
predict anything alone. Measured (both variables read out of the engine, not
parsed from card text):

| | slope, points per granted move | sigma | n | r2 | mean residual |
|---|---|---|---|---|---|
| expires in 2 to 4 turns | **-1.26 +-0.28** | **4.5** | 20 | 0.53 | -6.1pt |
| never expired in the probe | -0.38 +-1.04 | 0.4 | 6 | 0.03 | **+10.1pt** |
| spent on the turn it fires | -0.05 +-0.09 | 0.5 | 18 | 0.02 | -1.2pt |

Main effects, for contrast: duration alone **0.3 sigma**, grant size alone
**1.2 sigma**. The signal lives entirely in the interaction, which is the shape
A6 predicts and a far harder pattern to produce by chance than either half. The
grant>=12 threshold that peaks and decays is this same interaction seen through
the wrong variable.

The permanent row is the third leg and it sharpens rather than muddies the
story. A permanent grant has no expiry for the search to miss, and its holder
gets a buffed root on **every** move of the game instead of two or three, so
the search's wrongness never has to be cashed into a plan. **The penalty is
worst exactly where a card demands a multi-turn plan**, which is the one thing a
search that forgets the buff after one ply cannot build. (This three-way split
was found by noticing that `berolina_pawns` and `twin_knights` both measure +25
with big permanent grants, which the two-way version could not explain.)

Scale check: `amazon_army` grants 17 moves and lasts three turns, so 1.26 x 17 is
about **21 points against a measured -25**. The defect accounts for most of that
card, and for the family behind it.

Held by `scripts/test-balance-pass-2026-09.ts` section 1c: a tier FLOOR for all
26 cards, so a later blanket wave cannot cut one on numbers that look damning
and are not. The asymmetry is deliberate: the bias only pushes measurements
down, so a card here that still measures well may be raised freely. Retire that
block when A13 lands. Verified to fail when a floor is moved by one rung.

One measurement trap worth recording, because it inverted the answer on the
first attempt: probing duration by playing *quiet* moves reports a "once" card
as permanent, because its charge is spent by playing the granted move, not by
taking a turn. The probe has to play the card's own moves.

**Consequence for the ladder: no move-granting card may be retiered downward on
win-rate evidence until A13 lands and the family is re-measured.** That covers
44 cards with a measurement and 93 holders in total.

**But the ladder itself is clean, which was worth checking rather than
assuming.** The tier floor is fitted against the M=0 baseline, and the biased
cards nearly all carry no material, so they sit in that baseline and drag it
down. If the drag were large, every material bucket would look more excessive
than it is and the whole ladder would be tilted. Measured:

| M band | n | mean | excluding the 26 biased cards |
|---|---|---|---|
| M=0 | 533 | +3.99 | 507 cards, **+4.06** |
| 0 to 1 | 20 | +10.96 | unchanged |
| 1 to 3 | 38 | +11.28 | unchanged |
| 3 to 5 | 11 | +8.73 | unchanged |
| over 5 | 15 | +26.00 | unchanged |

26 cards in a 533-card bucket move the baseline by **0.07 points**. A6 corrupts
the per-card reading for one family and does not reach the ladder. (Note the
baseline is now +3.99, not the +0.9 recorded in round 1: the sweep has kept
running and there are far more rows behind it.)

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
| B8 | **Every buff game opens with a modal over the board for about 4.6 seconds.** Measured three times at 4571 / 4577 / 5258ms from hydration to the board being touchable: the opening pick deals its cards, and they are not interactive until the deal finishes (the decision timer appearing is the signal). The first thing a new player experiences is a wait they cannot act on. There IS a "Hide" button, which is the right instinct, but it is a second click rather than the board simply being live behind the offer. Worth timing the deal against how long it actually needs, and whether the cards can be interactive as they land rather than after | S | TODO |
| B9 | **Draft cards carry no selection state for a screen reader.** The card buttons have no `aria-pressed` and no `aria-selected`; the only signal that a card is chosen is the commit button renaming itself from "Pick a card" to "Confirm <name>". Visually the selection is obvious, and to a screen reader it is a button that did nothing | S | TODO |
| B10 | **Accessible names and the live region run words together.** A draft card announces as `"Walking Pace, PleaseMovementPassiveITrivialOnce, your a-file or b-file pa..."`: the name, category, kind, tier numeral and rarity badges are concatenated with no separator. The board's live region does the same across whole sentences: `"black knight g8 to f6 | Special OrderI | Special OrderIBot played a buffYour next draft is dealt from tier 2."` Both are badge spans with no whitespace or punctuation between them. Fix is separators (or `sr-only` commas) at the badge level, which is one place for both | S | TODO |
| B11 | **What is already right, measured, so nobody "fixes" it.** Legal-move dots appear **50 to 79ms after pointerdown**, not on pointerup, which is the Lichess behaviour and most of why picking a piece up feels immediate. A move commits in **171 to 272ms** under `next dev` on a loaded box, with the origin and destination updating in the same frame (no stall hiding behind the glide). The easy bot replies in **807 to 826ms** including any draft its move triggers. The clock shows `5:00` on a five-minute game and `0:08.0` inside the emergency band, so tenths appear exactly when they matter. All four are pinned by `npx playwright test e2e/feel.spec.ts` | S | DONE |

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
| C10 | **The board was not keyboard-operable.** DONE (round 1, re-verified round 7). `role="grid"`/`role="row"`, a roving `tabIndex`, `handleGridKeyDown` and an `aria-live` region are all in `Board.tsx`. Measured rather than read: a complete move lands on board state (`sq12` white pawn to `sq28`) at 1440 fine and 390 coarse, in both orientations, and arrow keys move in SCREEN space (`ArrowRight dx=+87.1 dy=0` with either colour at the bottom), with exactly one `[tabindex="0"]` per board | M | DONE |
| C11 | **No board-flip affordance.** DONE (round 7). `BoardTools` (flip + `f` + a shortcuts sheet) was already on `/game` and `OnlineMatch`, but the rail is `hidden sm:grid`, so at 360 the flip button measured **0.0 x 0.0**: a phone had a keyboard shortcut and no button, which is the whole of what C11 complained about. `FlipBoardButton` extracted (button only, no keymap, so a second mount cannot double-bind `useBoardKeys` and turn `f` into a no-op) and placed in the mobile player strip, exactly complementary to the rail. Now 44 x 44 coarse at 360/390/768/1024, 36 x 36 fine. `f` also bound on `/analysis`, locally, because its flip is local state and must not write the global `flipBoard` | S | DONE |
| C12 | **No in-game eval bar.** The math already exists: `evalPercent()` and `evalLabel()` at `analysis/page.tsx:51-61`. It is not wired into `OnlineMatch`, `game/[id]`, `history/[id]` or the spectator view | M | TODO |
| C13 | **The 768 to 1023 tablet band is unstyled.** Only 7 `md:` uses in the whole codebase (vs 563 `sm:`, 114 `lg:`), so tablets inherit the phone-derived `sm` layout with a fixed 288px rail and a fixed bottom drawer | M | TODO |
| C14 | **301 sub-12px text violations** against the design system's own hard floor: 227 `text-[11px]`, 58 `text-[10px]`, 13 `text-[9px]`, 3 `text-[8px]`. Worst: `TurnCostBadge.tsx:57` (8px), `PlayerNerfCard.tsx:281` (8px), `Board.tsx:378` (9px), `clip/ClipModal.tsx:1538` (9px on parchment-500) | M | TODO |
| C15 | **Contrast below AA.** `parchment-500` `#7a7a7a` on panel is ~3.6:1, and it is used 92 times outside effects. Alpha-dimmed text compounds it: `text-parchment-400/40` on panel is roughly 1.9:1 | M | TODO |
| C16 | **No focus trap.** `useModalChrome.ts` does scroll lock, Escape and a ghost-click guard, but does not cycle Tab, despite 9 `aria-modal="true"` dialogs and design system section 10 promising it | S | TODO |
| C17 | **No `not-found.tsx` anywhere**, and no per-segment `error.tsx`. DONE (round 7). `src/app/not-found.tsx` plus segment boundaries for `/u/[username]`, `/game/[id]`, `/tournaments/[id]` and `/settings/[section]`, each saying what was not found in that thing's own words ("No player by that name", "No game with that id"). The `error.tsx` half was stale: `u/[username]/error.tsx` already existed and `game/error.tsx` already covered `/game/[id]`; only `/tournaments/[id]` inherited the wrong words and got one. All five measured at 360 and 1440, dark and light: 404 status, one `h1`, zero overflow, zero sub-44px targets. **Three of the four segment files are not on a live path yet**: those routes are client components that paint their own in-page state, and `notFound()` is server-side, so each needs one line in its `page.tsx` to become the boundary | S | DONE |
| C18 | **No `/settings` route.** DONE (round 7). `/settings` and `/settings/<section>`, deep-linked by PATH segment rather than fragment, because a path reaches the server and so earns its own title, canonical, history entry and a real 404 for an unknown name. Sync is structural: the whole settings surface moved out of `SettingsPanel.tsx` into `src/components/settings/rows.tsx` (**901 lines to 178**), both surfaces read the same config, and the model subscribes to `SETTINGS_CHANGED_EVENT`, so a write on either lands on the other. Verified both directions including a route row flipping live behind the open modal. Two traps recorded: a `loading.tsx` above the section route made `notFound()` fire after streaming started, so `/settings/nope` returned **200 with a soft 404** until the index moved into a `(all)` group; and `#appearance` did not scroll because the browser resolves the fragment before the hydration gate opens | S | DONE |
| C19 | **Invalid ARIA:** `role="lead"`. DONE (round 7). `Board.tsx`'s two call sites were already closed by the `SignatureCut`/`GenBurstCut` wrappers; the last one was in `src/app/dev/plays/PlaysGallery.tsx` (not `src/components/dev/...`, which does not exist) and was latent rather than live, one `{...props}` from reaching the DOM. `[role=lead]` measures 0 on `/analysis`, `/game`, `/history/[id]` and `/dev/plays` with 120 scene tiles rendered | XS | DONE |
| C20 | **Four dead components:** `CurrentGameCard.tsx` (superseded by `profile/CurrentGameCard.tsx`, kept alive artificially by the button-audit baseline), `AccountChip.tsx`, `BuffUsedToast.tsx`, `ratings/RatingCard.tsx`. None has an importer | XS | TODO |
| C21 | **Duplicated settings rows** in the `accessibility` section. DONE. Already fixed at HEAD in `3625f8b` (no `-A11y` ids, Accessibility owns motion). Two things were still thin and are now fixed: the section blurb was the bare label of its one row, and an Appearance row labelled "Theme" sat under a group eyebrow also called "Theme". Display labels only, so no setting key moves and no `dc:settings-v1` migration is needed | XS | DONE |
| C22 | **`npm run typecheck` fails out of the box** with a stale `.next` cache. DONE. Already fixed at HEAD via `exclude: [".next/dev/types"]`, and verified against Next's own source rather than taken on trust: `runTypeCheck.js` filters that exact directory out of the build's file list, so the repo tsconfig now matches what `next build` already does. The explanatory comment was wrong on the load-bearing detail (it said `next-env.d.ts` imports `.next/dev/types/routes.d.ts`; it imports `./.next/types/routes.d.ts`) and is rewritten | XS | DONE |
| C23 | Two mod tables forced horizontal scroll in the 640 to 760 band, and two header dropdowns were `w-80` unguarded. DONE. Both `min-w-` values were already gone at HEAD, replaced by `overflow-x-auto`, and the dropdowns already carried `max-w-[calc(100vw-1.5rem)]`; the same guard was added to the `w-56` profile menu. The overflow walk at 320/360/640/700/760 across 12 routes found **0 clipped boxes**, with every header dropdown opened at 320 and 360 | XS | DONE |
| C24 | Six icon-only buttons without `aria-label`. DONE. All six are labelled at HEAD and a full walk found **0 unnamed icon-only controls** across 12 routes at two widths | XS | DONE |
| C25 | `scripts/check-buttons.ts` carries a 61-file baseline of surfaces still using hand-rolled buttons. `--strict` only catches new offenders, so the debt is invisible. Work the baseline down | M | TODO |
| C26 | Weakest system-state pages, from the audit: `analysis` (no error/empty/loading), `achievements` (no empty), `history/[id]` (no error, no empty), `game/page.tsx` (16 loading markers, 0 error), `codex/suggest` (0 loading), `mod/page.tsx` (0 error). `tv/page.tsx` is the reference implementation to copy: it distinguishes "unreachable and nothing cached" from "first snapshot loading" | M | TODO |
| C27 | The `clip/studio/*` subtree (~1,900 lines) has one width query and is otherwise unresponsive | S | TODO |
| C28 | **Uppercase labels violate section 11** ("Sentence case everywhere... allcaps survive only in the LIVE badge"). Seen on the main nav (PLAY, WATCH, COMMUNITY, LEADERBOARD, RULES) and every quick-settings section head (BACKGROUND, BOARD, PIECES, BOARD SIZE, SOUND). Section 3 also retired the letterspaced-smallcaps pattern sitewide, so these are the survivors | S | TODO |
| C29 | **One light-mode piece preview is near-invisible.** In the quick-settings piece picker under the light theme, the tenth thumbnail (second row, fourth) renders as a faint outline on the near-white raised surface. Its white fill has nothing to sit against. The other ten are fine, so this is one theme's fill choice, not the picker. Worth checking the same set on a light board theme, where the same collision would happen in a real game. Found by looking at a screenshot; no guard covers it | S | TODO |
| C30 | **`--text-secondary` fails AA in light** on every surface: 3.71:1 on the page, 4.42:1 on a panel, 4.15:1 on raised. The round-2 contrast pass fixed the muted rung and did not touch this one | S | TODO |
| C31 | The surface ladder is fixed and now documented, but `--bg-hover` still measures 3.94:1 for `parchment-400` by design. Audit for muted text that sits permanently on a hover fill, which is the case that makes that number a real defect rather than an accepted one | S | TODO |
| C32 | **The whole spacing scale is 87.5 percent of the design system's px values.** `html` is 14px and `tailwind.config.ts` never overrides `spacing`, so Tailwind's rem scale resolves against 14, not 16: `p-4` is 14px where section 4 says 16, and the `p-2 px-3` "plate default" is 7px and 10.5px rather than 8 and 12. The touch targets are fixed with literal px, but the scale itself is untouched. Fixing it centrally makes the entire app roughly 14 percent roomier, and density is something this site values on purpose, so this is a design decision for the owner rather than a defect to quietly correct. Options: override `spacing` to px, raise the root to 16px and re-pin the type ramp, or write down that the scale is intentionally tighter than the doc and fix the doc | M | NEEDS A DECISION |
| C33 | `overflow-x: clip` on `html, body` (`globals.css:8`) means over-wide content is **silently clipped and unreachable** rather than scrollable, and `scrollWidth <= innerWidth` can never fail. Proved by planting a 900px div at 360px wide. Any overflow check has to walk the DOM for boxes past the edge with no scrolling ancestor, which `e2e/sweep.spec.ts` now does. Worth deciding whether clip is the right default at all | S | TODO |
| C34 | A client component that fetches and renders its heading from the response serves no `h1` while it waits. `/u/[username]` was the named case; `/game/[id]` had the same defect on its connecting branch, which is exactly where an id with no game behind it sits until the socket gives up, and every terminal branch of that file already had one. Fixed round 7 and measured across 14 samples over 5.6s: **zero frames without an `h1`**, transitioning "Game" to "Something interrupted the game". Worth a sweep for the rest of the shape | S | WIP |
| C35 | `/api/lobby` 404s twice per load on 8 routes under `next dev`. DONE (round 7). A route handler, not a client that swallows a 404, because a deaf client would also go quiet on a real routing regression in production. Production is untouched: `worker.ts` matches `/api/lobby` before falling through to Next, and the handler returns 503 under `NODE_ENV=production` rather than inventing an empty lobby on a live site. Lobby-related console errors per load **4 to 0** | S | DONE |
| C36 | `Button`'s `xs` and `sm` size tokens. DONE. Already `min-h-[44px]` with `[@media(pointer:fine)]` step-downs at HEAD (`1d4f4ee`), and `/login`'s tabs already 44px. The blast radius was measured anyway, because a change here would have touched every button on the site: 290 `Button`/`LinkButton` across 73 files, and every rendered `.btn-*` box on the five densest surfaces at 360 and 1440 in both pointer contexts. Coarse 44/45/56 with **zero overflow and zero wrap change**; fine gives the intended 36/40 | S | DONE |
| C37 | Disconnected and recovered states (section 8, states 4 and 5) are missing on 18 async routes. `ConnectionBanner` exists and is the pattern; it is simply not mounted on most of them | M | TODO |
| C38 | **The 277 was a fine-pointer number, which is a different question.** `e2e/sweep.spec.ts` measured touch targets in Playwright's default desktop context, so every `[@media(pointer:fine)]:min-h-*` step-down applied and every correctly-fixed control was counted as a defect: **258 at 360 fine against 81 at 360 coarse** on the same tree. The sweep now runs one pass per route in its own `hasTouch: true` context across 360/390/768/1024 (the old check stopped at 390 and so never saw the tablet band at all). Worked by shape: the wordmark link was 147.3x**34** on all 39 routes and was 37 of the 81; new shared `Breadcrumbs` and `SearchInput` primitives replaced one hand-rolled breadcrumb and four hand-rolled search boxes; the home footer copy had its height fixed and its width never was, so "FAQ" was a 24.7px-wide target that happened to be 44px tall. **81 to 20 at 360 coarse, 122 to 29 at 1024 coarse**, same probe both times. Two defects the sweep structurally cannot see were found by hand: the desktop nav dropdown rows (194x**35**, only present while hovered, and the band where they ARE the navigation is 768 to 1024) and the header icon buttons, which are `w-[44px]` flex items with no `shrink-0` and squeezed to **43.2px** on 34 routes with a long username in one probe run and 0 in the next | M | WIP |
| C39 | Sweep totals moved 1791 to 1387 defects and 674 to 307 high severity across the day. The remaining high-severity mass is C38. `type-floor-13` is 305 and `type-floor-12` is 330, which is the interactive-versus-caption judgement call already in flight | - | tracking |

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
| E10 | **Every drag paints the piece twice.** DONE. `.dragging` is applied at `Board.tsx:2275`; measured, the origin piece goes computed opacity 1 to **0.35** mid-drag and back to 1 after | XS | DONE |
| E11 | Bind `z` (zen) on `/analysis`, `/tv` and `/history/[id]`. DONE (round 2), measured on all three: `data-zen` toggles null to on. Not bound on the `/history/[id]` not-found branch, which has no zen-hidden chrome to hide | XS | DONE |
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
