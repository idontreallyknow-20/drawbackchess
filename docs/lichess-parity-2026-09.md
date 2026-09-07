# Lichess parity audit, 2026-09

A behaviour-level study of what Lichess actually does on the board, in analysis,
on the clock, and around the game, matched against what NerfChess ships today.
This extends `docs/ui-research.md` (which covered presentation and page
composition) into interaction semantics. Every row ends in a sized move for one
of our own surfaces, or in an explicit "do not build this".

Sources are lila (`lichess-org/lila`) and chessground (`lichess-org/chessground`)
at master, read directly, not marketing pages. Paths like
`ui/round/src/keyboard.ts` refer to lila; paths like `src/components/Board.tsx`
refer to this repo.

Two rules of this product decide a lot of what transfers:

- **There is no checkmate.** You win by capturing the king. Moving into check is
  legal and sometimes correct (`src/lib/premoves.ts:24` exists precisely to stop
  a blind premove from doing it for you). Every Lichess feature whose unit of
  meaning is "mate in N" needs re-basing on "king capture in N" or dropping.
- **A draft lands every 5 own-moves** (`docs/draft-system.md`, `DEFAULT_CADENCE`
  in `src/engine/draft.ts`). Any feature that changes the length or the pace of a
  game changes the card economy, so it is never a pure UI change.

---

## Ranked backlog

Ordered by impact on one player's session divided by size. Sizes: XS under an
hour, S a half day, M a few days, L a week or more.

| # | Item | Size | Area | Why here |
|---|---|---|---|---|
| 1 | Shared keymap module plus the `?` help dialog (K1, K2, K3, K6) | S | Keyboard | One module and one dialog buys `f`, `k`/`j`, `0`/`$`, `home`/`end`, `c`, and a discoverable list of everything else. Nothing else moves the "this is a real chess site" needle per hour spent |
| 2 | Bind `z` on every board surface, not just `/game` (K4) | XS | Zen | Zen already exists and works. It is simply not reachable from `/analysis`, `/tv` or `/history/[id]` |
| 3 | Fade the origin square during a drag (B7) | XS | Board | `.dragging` is defined in `globals.css:1524` and never applied, so a drag paints the piece twice. One class, and every drag stops looking wrong |
| 4 | Clock urgency relative to the time control (C2) | XS | Clock | Fixed 30s/10s thresholds mean a 1+0 clock is "urgent" from move one and a 10+0 clock never warns in time |
| 5 | Running-clock separator blink (C4) | XS | Clock | Two characters of markup. It is the cheapest signal that a clock is live rather than frozen, and NerfChess pauses clocks for drafts, so "is this running" is a real question here |
| 6 | Wheel over the board scrubs plies (B14) | XS | Board | Lichess users reach for it reflexively. The ply-scrub plumbing already exists in `MoveList` |
| 7 | PGN export on `/history/[id]` (N6) | XS | Notation | The export exists (`src/lib/pgn.ts:41`) and is wired on two of three replay surfaces |
| 8 | Fix the analysis rail typography (A10) | XS | Analysis | Two 11px tracked-out labels violate design-system 3 and section 3's retirement of the eyebrow pattern |
| 9 | TV featured-game hysteresis and rematch follow (S2) | S | Social | The TV board currently reshuffles on every poll. Lichess only switches when a candidate scores 17% better, and follows the rematch when a game ends. This is the single biggest felt-quality gap on `/tv` |
| 10 | Arrow polish: snap to queen and knight lines, bent knight arrows, Lichess modifier map (B9, B10, B11) | S | Board | Annotation is how spectators and coaches talk. Ours draws to the raw hovered square, straight-lines knight moves, and uses a different modifier map from every other chess site |
| 11 | Drag threshold and touch tap-tap default (B6) | S | Board | A 3px threshold and "touch defaults to tap-tap" are why Lichess never eats a tap as a micro-drag. We arm the drag on pointerdown with no threshold |
| 12 | Move the analysis engine into a Worker (A2) | M | Analysis | `src/app/analysis/page.tsx:159` runs a 300ms blocking search on the main thread every position change. It is the only place in the product that janks by design |
| 13 | Daily puzzle, capture-the-king shaped (P1) | M | Puzzles | The roadmap's own #1 retention item, and the only one that works with zero opponents online |
| 14 | Move classification from the local engine (A4) | M | Analysis | Win-percentage deltas of 0.1/0.2/0.3 give inaccuracy/mistake/blunder. Cheap once A2 lands, and it unlocks N5 and A6 |
| 15 | Card-aware game review (A9) | M | Analysis | Today `Analyze` from the end screen replays bare UCI and truncates the moment a card touched the board (`src/app/analysis/page.tsx:333`). For this product that is the analysis feature |
| 16 | Screen-reader board: ARIA grid of focusable squares (X1) | M | Accessibility | Squares are `div`s with an `aria-label` and no role and no tab stop (`src/components/Board.tsx:1720`). Nobody can play this game without a mouse |
| 17 | TV channels by speed, with a champion per channel (S1) | S | Social | We have exactly two channels (`?mode=nerf|buff`). Speed channels cost a filter and give the watch page a reason to have a nav |
| 18 | Give more time button (C8) | S | Clock | A social affordance with no rules interaction. Cheap goodwill in a small community |
| 19 | Move times in the notation panel (N8) | S | Notation | We already store per-move clock state for the replay. Surfacing it makes post-game reading much richer |
| 20 | Keyboard-only play: cursor, piece jumping, typed move (X2, K8) | M | Accessibility | Depends on X1. Also the fastest input method for strong players, which is why Lichess ships it as a preference and not only as an accessibility feature |
| 21 | Restricted (smart) premoves (B5) | S | Board | Lichess filters premoves that cannot possibly become legal. Ours offers the whole pseudo-legal set, so a premove down a blocked file is offerable and then silently cancels |
| 22 | Analysis engine principal variation lines (A3) | M | Analysis | We show one best move and a depth. Two or three lines with scores is what makes an eval bar readable |
| 23 | Clock bar under each clock (C5) | S | Clock | Lichess scales a bar over `initial + 5 * increment`. Reads faster than digits at a glance and is a pure add |
| 24 | Board coordinates outside the board, plus an every-square mode (B13) | S | Board | Ours are always inside the edge squares (`src/components/Board.tsx:2217`), and the card art already fights them for corners |
| 25 | Learn from your mistakes (A6) | L | Analysis | Depends on A4. High retention value, but it is a whole guided flow, not a panel |
| 26 | Puzzles from your own games (P6) | L | Puzzles | The most on-brand puzzle source we have: "you held Shadow Queen here and missed the king capture" |
| 27 | Board editor with card state (Z3) | M | Editor | The analysis board already takes a FEN. A piece editor without a nerf/buff editor cannot express a real NerfChess position, so it is only worth building with the card half |
| 28 | Move announcements to a live region (X3) | S | Accessibility | Status live regions exist in `OnlineMatch`, moves are not among them |
| 29 | `h` board menu (K5) | S | Keyboard | Needs the menu to exist first. Our equivalent is the in-match settings panel, which is a modal, not a dropdown |
| 30 | Puzzle trainer with rating and themes (P2) | L | Puzzles | The full loop. Only after P1 proves the format |
| 31 | Server-side full-game analysis with accuracy and ACPL chart (A5) | L | Analysis | We have an `engine-service`, so the pipe exists. The cost is the job queue, the storage, and the chart |
| 32 | Inline notation toggle, move context menu (N4, N7) | S | Notation | Genuine Lichess conveniences, but they serve study authors, and we have no studies |
| 33 | Berserk (C6) | S | Clock | Only meaningful inside arena tournaments, and halving the clock changes the draft economy. See conflicts |
| 34 | Blindfold (Z2) | S | Zen | Half-defeated by a visible card dock and a hidden nerf. Novelty, not retention |
| 35 | Puzzle Storm and Racer (P3, P4) | L | Puzzles | Great products. Both need a puzzle corpus that does not exist yet |
| 36 | Streamer surfacing (S4) | M | Social | Needs streamers to exist first. Revisit after acquisition work |
| 37 | Correspondence (S5) | L | Social | Conflicts hard with a 5-move draft cadence. See conflicts |
| 38 | Opening explorer (A7) | M | Analysis | Do not build the Lichess version. Build the card explorer instead. See conflicts |
| 39 | Variation tree in analysis (A8) | M | Analysis | Ours truncates the line when you branch (`src/app/analysis/page.tsx:146`). Correct call for now |

---

## 1. Board interaction

| # | What Lichess does | NerfChess today | Gap and size | Variant fit |
|---|---|---|---|---|
| B1 | Exactly one premove is held. Setting a new one replaces it (`chessground/src/board.ts:54`, `setPremove` overwrites `premovable.current`). There is no queue depth | Same, deliberately. `enqueuePremove` (`src/components/OnlineMatch.tsx:907`) writes a single-element array; the array type is kept only so the board props and the ack path did not have to change | None | Fine |
| B2 | Premove destination dots are shown during the opponent's turn (`premovable.showDests`) | Shown, and computed against the live nerf and buff state, so the dots already respect your rule (`src/components/OnlineMatch.tsx:1757`) | None. This is ahead of Lichess: our premove options union in buff-granted movement | Fine |
| B3 | Any press that is not a new valid premove cancels it (`drag.ts` start: `if (hadPremove) unsetPremove`). Right-click to draw also cancels, via `cancelMove`, **unless Ctrl is held**, in which case only the selection clears and the premove survives (`draw.ts:70`) | Left-click on a dead square cancels (`src/components/Board.tsx:3922`), a refused drop cancels (`:4049`), right-click cancels (`:4231`). No Ctrl escape hatch | **B3, XS.** In `handleSquareContextMenu` and `startRightDrag`, skip the premove cancel when `e.ctrlKey`. Files: `src/components/Board.tsx` | Fine |
| B4 | A premove that has become illegal is dropped when the turn arrives (`chessground.playPremove()` returns false, the caller does nothing) | Same, plus two things Lichess cannot do: the queued move is matched against the real legal set including nerf filters (`src/components/OnlineMatch.tsx:953`), and a premove that would leave your own king in check is cancelled rather than played (`:961`, `src/lib/premoves.ts:24`) | None. Document the self-check rule in the help dialog when K1 lands: it is a real rule and currently invisible | This is the correct capture-the-king adaptation. Moving into check stays legal manually |
| B5 | Premoves are **restricted**: `ui/round/src/premove.ts` filters destinations that cannot become legal (a blocked slider path, a friendly-occupied square no enemy can capture on, a pawn push into an occupied square). Atomic and crazyhouse opt out | Unrestricted. `premoveOptionsFor` (`src/lib/premoves.ts:44`) returns the pseudo-legal set plus friendly targets, filtered only by the nerf | **B5, S.** Port `isPathClearEnoughForPremove` for sliders and the pawn cases. Skip the en-passant branches: they are a lot of code for a rare gain. Files: `src/lib/premoves.ts` | Careful: buff-granted movement and card teleports mean a piece can appear mid-path. Keep the union fallback that already exists at `src/components/OnlineMatch.tsx:1740` so a restricted premove still fires if the world changed |
| B6 | Drag arms only after 3px of movement (`draggable.distance`), and `autoDistance` zeroes that once the user has demonstrated they drag. On touch, `stats.dragged` defaults false, so the first interaction is tap-tap, not drag | Drag arms on pointerdown with no threshold (`src/components/Board.tsx:3963`). Move plays on pointerdown for legal destinations, which is correct and matches Lichess | **B6, S.** Add a `distance` gate before showing the ghost, and default the ghost off for `pointerType === "touch"` until movement exceeds the threshold. Files: `src/components/Board.tsx` | Fine |
| B7 | The picked-up piece is hidden on its origin square and a translucent `ghost` element is placed there; a live copy follows the cursor | A live copy follows the cursor (`src/components/Board.tsx:4967`) but the origin square keeps a full-opacity piece. `.dragging { opacity: 0.35 }` exists at `src/app/globals.css:1524` and is applied nowhere (`grep dragging src/components/Board.tsx` finds only a comment) | **B7, XS.** Add `drag?.from === sq && "dragging"` to the square's piece classes. Also delete the dead `transform: translate(-50%, -50%)` in `.drag-ghost`: the inline `translate3d` written by the pointermove handler always overrides it. Files: `src/components/Board.tsx`, `src/app/globals.css` | Fine |
| B8 | Drop resolves by hit-testing the pointer against the board rect; there is no magnetism, the square under the cursor wins | Same (`squareAtClient`, validated against the current move list at `src/components/Board.tsx:4039`) | None | Fine |
| B9 | While drawing, the arrow tip snaps to the nearest square that is a queen-direction or knight-direction step from the origin (`board.ts:358 getSnappedKeyAtDomPos`, `drawable.defaultSnapToValidMove`) | The arrow tip is the raw square under the pointer (`src/components/Board.tsx:4179`) | **B9, S.** Port the snap: filter candidate squares to queen or knight directions from the origin, pick the nearest centre. Files: `src/components/Board.tsx` | Fine, and more useful here than on Lichess: buff-granted movement makes "which square did you mean" ambiguous more often |
| B10 | A knight-move arrow is drawn as a bent L, long leg first | Straight diagonal. There is already a written-out TODO with the algorithm at `src/components/Board.tsx:857` | **B10, S.** Implement the TODO exactly as written. Files: `src/components/Board.tsx` | Fine |
| B11 | Brush by modifier: none is green, Shift or Ctrl is red, Alt or Meta is blue, both is yellow (`chessground/src/draw.ts:141 eventBrush`) | Four marks with a different map: none is gold, Alt is green, Ctrl is bruise, Shift is nerf-red (`src/components/Board.tsx:4221`) | **B11, XS.** Re-map so Shift and Ctrl both give the danger colour and Alt gives the informational colour, matching muscle memory from every other chess site. Keep our token palette, only change which modifier picks which. Files: `src/components/Board.tsx:4221`, `MARK_COLORS` at `:827` | Fine |
| B12 | Shapes clear when a move interaction begins or when a move lands; a refused move leaves them alone | Same, and explicitly commented as such (`src/components/Board.tsx:3837`, `:4144`) | None | Fine |
| B13 | Coordinates render on the board edge, with preferences for inside the square, outside the board, and on every square (`coordinates`, `coordinatesOnSquares`, `ranksPosition`) | One mode: 12px labels inside the a-file and first-rank squares, with a collision fallback that slides the label and adds an ink backing when card art claims the corner (`src/components/Board.tsx:2217`) | **B13, S.** Add an "outside the board" mode. It is the honest fix for the corner collision, and card art will only get denser. Files: `src/components/Board.tsx`, `src/components/settings/config.ts`, `src/lib/settings.ts` | Fine. The collision fallback is a NerfChess-specific problem Lichess does not have, and outside-the-board removes it entirely |
| B14 | Scrolling over the board steps through the game (documented in the help dialog under "Mouse tricks") | Not bound | **B14, XS.** Attach a wheel listener on the board wrapper that calls the same `onPlyChange` the move list uses. Guard it behind "not currently my turn to move" so a scroll cannot desync a live board. Files: `src/components/Board.tsx` or the two game pages | Fine |
| B15 | Touch: `blockTouchScroll` optionally stops page scroll on the board, and `touchIgnoreRadius` lets a touch near an occupied square count as an interaction rather than a scroll (`chessground/src/drag.ts:84 pieceCloseTo`) | Touch has its own good behaviour (a tap on a special square opens the effect popover, `src/components/Board.tsx:3903`), but no ignore radius and no scroll blocking | **B15, S.** Port `pieceCloseTo` and call `preventDefault` on touch starts near a piece. This is the difference between "I tried to move and the page scrolled" and a clean board. Files: `src/components/Board.tsx` | Fine, and more important here: `MobileMatchStack` makes the match page a scrolling column below `sm`, so board touches sit inside a scroller |
| B16 | Predrop: with a pocket, you can queue a drop during the opponent's turn (`predroppable`) | The pocket exists (`src/components/Pocket.tsx`) and drops route through the pick-square path (`src/components/Board.tsx:3852`), but there is no predrop | **B16, S.** Extend the premove queue to hold a `{drop, square}` entry. Files: `src/components/OnlineMatch.tsx`, `src/lib/premoves.ts` | Fine, and it is ours to define: banked pieces come from cards, not from captures |

---

## 2. Keyboard

Lichess's full keymap is one file, `modules/web/src/main/ui/help.scala`, which
renders the `?` dialog. Reproduced here because it is the checklist.

**Round (playing a game):** `left`/`k` previous, `right`/`j` next, `up`/`0`/`home`
to start, `down`/`$`/`end` to end, `f` flip, `z` zen, `c` focus chat, `h` board
menu, `?` help.

**Analysis:** all of the above plus `shift`+arrows for branches and lines, tap
`ctrl` to show or hide the current variation, `l` toggle local engine, `space`
play the engine's move, `x` show threat, `z` toggle all computer analysis, `a`
best-move arrow, `v` variation arrows, `e` explorer, `b` board editor,
`shift`+`space` play the first explorer move, `shift`+`C` comments,
`shift`+`I` inline notation.

**Puzzles:** navigation plus `l`, `space`, `x`, `n` next puzzle, `f`, `z`, `h`, `?`.

**Typed move input** (a preference, not a default): `e2e4`, `5254`, `Nc3`,
`O-O`, `c8=Q`, `R@b4`, and the word commands `clock`, `who`, `draw`, `resign`,
`zerk`, `next`, `upv`, `downv`, `help`.

| # | What Lichess does | NerfChess today | Gap and size | Variant fit |
|---|---|---|---|---|
| K1 | `?` opens a modal listing every shortcut for the current surface, loaded per-context (`/round/help`, `/analysis/help`, `/training/help`) | Nothing. There is no discoverable keymap anywhere in the product | **K1, S.** One `useBoardKeys(surface)` hook plus one `KeyboardHelpDialog` fed from the same table, so the dialog can never drift from the bindings. Put the NerfChess-specific rules in it too: premove self-check cancel, draft keys. Files: new `src/lib/useBoardKeys.ts`, new `src/components/KeyboardHelp.tsx`, wired from `src/app/game/[id]/page.tsx`, `src/app/game/page.tsx`, `src/app/analysis/page.tsx`, `src/app/history/[id]/page.tsx` | Fine |
| K2 | `f` flips the board immediately | Flip is a settings toggle only (`src/components/settings/config.ts:168`, read at `src/components/OnlineMatch.tsx:2589`) | **K2, XS.** Bind `f` to the same setting write. Files: the new keymap hook | Fine |
| K3 | `k`/`j` and `0`/`$`/`home`/`end` alias the arrow keys | Arrows only, in `src/components/MoveList.tsx:101`, correctly guarded against typing at `:96` | **K3, XS.** Add the aliases in the existing handler, or move the handler into the keymap hook. Files: `src/components/MoveList.tsx` | Fine |
| K4 | `z` toggles zen on round, analysis and puzzle surfaces | Bound, but only where `useZenHotkey` is imported: `src/app/game/[id]/page.tsx:30` and `src/app/game/page.tsx:75`. Not on `/analysis`, `/tv`, `/history/[id]` | **K4, XS.** Import the existing hook on the other three routes. Files: those three pages | Fine |
| K5 | `h` opens the board menu: flip, zen, blindfold, vibration, streamer mode, swap clock, voice input, keyboard input, confirm move, and links to the two preference pages (`ui/round/src/view/boardMenu.ts`) | We have an in-match settings modal (`SettingsPanel`, opened from `src/components/OnlineMatch.tsx:337`), which is heavier and modal | **K5, S.** Either bind `h` to the existing panel (XS, and slightly wrong: a modal is not a menu), or build the compact dropdown. Recommend the former now and the latter never, because our settings drill-down is the design-system reference pattern (section 4) | Fine |
| K6 | `c` focuses chat, `Esc` unfocuses | Chat exists (`src/components/ChatPanel.tsx`), no shortcut | **K6, XS.** Files: `src/components/ChatPanel.tsx` plus the keymap hook | Fine |
| K7 | On analysis: `l` engine on/off, `space` play the engine move, `x` threat, `a` best-move arrow, `v` variation arrows, `e` explorer, `b` editor | `/analysis` binds arrow keys only (`src/app/analysis/page.tsx:173`). The engine toggle is a button at `:298`, the best move is already drawn as a highlight at `:270` | **K7, S** for `l`, `space` and `a`. `x`, `e`, `b` need features that do not exist (A7, Z3). Files: `src/app/analysis/page.tsx` | `space` playing "the best move" is fine. `x` (show threat) means "what would the opponent do if it were their turn", which in this game depends on their held cards, so it is only honest in the post-game review where those are known |
| K8 | Typed move input, opt-in, with SAN, UCI, numeric coordinates, drops, and word commands | Nothing | **K8, M.** A single text input above the board that parses SAN and UCI against the live legal set (which we already compute) and submits. Word commands worth taking: `draw`, `resign`, `next`. Files: new `src/components/MoveInput.tsx`, wired in `src/components/OnlineMatch.tsx` | Fine, and it needs one addition: a command to act on a draft (`pick 1`, `pick 2`, `bank`), because a keyboard-only player currently cannot resolve a draft at all |
| K9 | `n` next puzzle | No puzzles | Rolls into P1 | See section 7 |

---

## 3. Analysis

| # | What Lichess does | NerfChess today | Gap and size | Variant fit |
|---|---|---|---|---|
| A1 | Eval gauge is a permanent vertical bar beside the board on analysis, study, and (as a preference) during a game | An eval bar exists on `/analysis` only, and is hidden below the `sm` breakpoint (`src/app/analysis/page.tsx:241`, `hidden ... sm:block`). Nothing on `/history/[id]` or the spectate view | **A1, S.** Extract the bar into a component and place it on the review surfaces. Keep it hidden on phones, which matches Lichess col1 | Fine, with one caveat: a material or mobility eval is close to meaningless while a card can delete a queen. Label it as a **material and mobility** read, not "the eval", or players will trust a number that does not know about the cards |
| A2 | Engine is Stockfish in a Worker (`ui/lib/src/ceval/engines/`), threaded, with a cache, and never touches the main thread | `analyzeBoard(board, 300)` runs synchronously on the main thread behind a 120ms timeout whose only job is to let the board paint first (`src/app/analysis/page.tsx:159`) | **A2, M.** Move `src/engine/ai` into a Web Worker with a request or cancel protocol keyed by FEN. Files: new `src/workers/analysis.worker.ts`, `src/app/analysis/page.tsx`, `src/engine/ai.ts` | Fine. Our engine already understands nerfs and buff-granted movement, which is the hard part and is already done |
| A3 | Multiple principal variations with scores, each clickable to walk the line, hoverable to preview | One best move in SAN plus a depth (`src/app/analysis/page.tsx:318`) | **A3, M.** Depends on A2. Files: `src/engine/ai.ts` (multi-PV search), `src/app/analysis/page.tsx` | Fine |
| A4 | Classification from win-percentage swing: 0.30 is a blunder, 0.20 a mistake, 0.10 an inaccuracy (`modules/tree/src/main/Advice.scala:44`). Mate-sequence cases get their own ladder | Nothing | **A4, M.** Same win-percent sigmoid we already have (`evalPercent`, `src/app/analysis/page.tsx:51`), same three thresholds, driven by A2. Files: new `src/lib/moveJudgement.ts`, `src/components/MoveList.tsx` for the glyphs | The mate branch does not transfer. Replace it with a **king-capture** branch: losing a forced king capture, or allowing one, is the blunder class here. Also add a fourth, product-specific class: **a bad draft**, computed by evaluating the position with each of the two offered cards |
| A5 | Server-side full-game analysis on request, streamed back with progress, producing the ACPL chart, per-side accuracy, and glyphs in the move list (`ui/analyse/src/serverSideUnderboard.ts`) | Nothing. `engine-service/` exists and already runs bots | **A5, L.** A job endpoint, a queue, storage on the game record, and the chart. Files: `engine-service/`, `src/app/api/games/`, `src/app/history/[id]/page.tsx` | Fine, and cheaper than for Lichess: our games are short and our engine is ours |
| A6 | Learn from your mistakes: walks your own eval swings one at a time, hides the engine line, asks you to find the better move, offers the solution, and skips positions that were book (`ui/analyse/src/retrospect/retroCtrl.ts`) | Nothing | **A6, L.** Depends on A4. Files: new `src/components/review/`, `src/app/history/[id]/page.tsx` | The "skip if it was a book move" branch has no equivalent and should be dropped. Replace it with "skip if the position was decided by a card the player could not see", which is both more honest and specific to us |
| A7 | Opening explorer over masters, lichess games, and your own, plus a tablebase | Nothing | **Do not build the Lichess version.** Openings are near-meaningless when a hidden nerf changes the legal move set from move one. **Build A7', M:** a **card explorer**. At any ply, show which cards were offered at this draft round across real games, the pick rate, and the win rate. We already collect the data (`docs/card-winrate.*.json`) and already have a codex to link into | This is the transferable idea. It answers the question players actually have, which is "was taking that card right", not "what does theory say about 1.e4" |
| A8 | Full variation tree with branches, promotion of a line to mainline, and inline or column rendering | Playing from an earlier ply discards the rest of the line, deliberately (`src/app/analysis/page.tsx:146`) | **A8, M**, and I would not do it. A tree is a study tool, and we have no studies | Fine to skip |
| A9 | Analysis of a real game replays exactly that game | The `Analyze` deep link from the end screen (`src/components/GameOver.tsx:758`) hands `/analysis` a bare UCI list, which replays against a plain board and **truncates at the first move a card made possible** (`src/app/analysis/page.tsx:333`) | **A9, M to L.** Replay through the same `NerfGame` path the live match uses, with the recorded card state, rather than through `generateMoves`. `src/lib/gameReview.ts` already has the tolerant replay primitives and the `historyDiverged` guard; the missing piece is carrying draft state into the analysis route. Files: `src/app/analysis/page.tsx`, `src/lib/gameReview.ts`, `src/components/GameOver.tsx:758` | This is the highest-value analysis work in the product. Every other item in this section is worth less than an analysis board that can actually open the game you just played |
| A10 | Labels sit at body size | `src/app/analysis/page.tsx:332` and `:372` use `text-[11px] tracking-[0.14em]`, which is both under the 12px floor and the retired eyebrow pattern (design-system 3) | **A10, XS.** Files: `src/app/analysis/page.tsx` | Fine |
| A11 | Every async surface has loading, empty, error, reconnect and recovered states | Route level is covered by the in-flight `src/app/analysis/loading.tsx` and `src/app/analysis/error.tsx`. The engine **panel** is not: it has a pending state ("…") and an off state, no error state if the search throws, and the FEN error is a border colour plus one line | **A11, S.** Design-system 8 applies to the panel, not only the route. Files: `src/app/analysis/page.tsx` | Fine |

---

## 4. Clock

| # | What Lichess does | NerfChess today | Gap and size | Variant fit |
|---|---|---|---|---|
| C1 | Tenths preference with three values: never, below 10 seconds, always (`ui/lib/src/game/clock/clockCtrl.ts:68`). Tick interval is 100ms when tenths show, 500ms otherwise, 1000ms in blind mode | Same three values, same below-10s default (`src/lib/clockFormat.ts:17`, `src/components/settings/config.ts:312`). Tick is 100ms under 10s, 250ms above (`src/components/ClockPill.tsx:120`) | None. Ours ticks twice as often as Lichess above 10s, which is a battery cost with no visible gain, but not worth a change | Fine |
| C2 | Emergency threshold scales with the time control: `min(60, initial < 60 ? max(2, initial * 0.2) : max(10, initial * 0.125))` (`clockCtrl.ts:97`). A 1+0 game goes emergency at 12 seconds, a 10+0 at 75, capped to 60 | Fixed: `low` at 30 seconds, `critical` at 10, for every time control (`src/components/ClockPill.tsx:148`) | **C2, XS.** Take the Lichess formula, pass the initial time into `ClockPill`. Files: `src/components/ClockPill.tsx`, callers in `src/components/OnlineMatch.tsx` and `src/app/game/page.tsx` | Fine, with one adjustment: our clock **pauses for drafts** and grants a free window, so the threshold should be computed on the initial time, not on time banked, which is what the formula already does |
| C3 | One low-time sound per side per emergency entry, with a 20 second re-arm (`clockCtrl.ts:62`), and it stops firing after the first time unless time climbs back | Fires at 10s and again at 5s, re-arms if time climbs back above each line, and is de-duplicated across the mobile and desktop copies of the pill with a 900ms global gate (`src/components/ClockPill.tsx:97`, `:12`) | None. Ours is arguably better for a game where increment can push you back over the line repeatedly | Fine |
| C4 | The `:` separator dims for the first 500ms of every second while the clock runs (`clockView.ts:85`, `sepLow`), so a running clock is visibly running even at 1Hz | No separator treatment | **C4, XS.** Render the separator as its own span and drop its opacity when `displayMs % 1000 < 500`. Files: `src/components/ClockPill.tsx`, `src/lib/clockFormat.ts` | More valuable here than on Lichess, because our clock genuinely stops during drafts. A player needs to tell "paused for the draft" from "running" at a glance, and today only the `Draft` chip says so |
| C5 | A bar under each clock scales from full to zero over `max(initial, 2) + 5 * increment` seconds, driven by the Web Animations API, paused when it is not that player's turn, and tinted when berserked (`clockView.ts:100`) | No bar | **C5, S.** A single `transform: scaleX()` element, which satisfies design-system 6 (transform and opacity only). Files: `src/components/ClockPill.tsx` | Fine. Pause it during the draft window along with the clock, which makes the pause legible for free and partly covers C4 |
| C6 | Berserk in arenas: halve your clock, lose the increment, gain a point on a win. Shown as an icon replacing the "give time" button (`ui/round/src/view/clock.ts:47`) | Nothing. Tournaments exist (`src/app/tournaments/`) | **C6, S** to build, but read the conflict first | **Conflicts.** Halving the clock does not halve the number of drafts, because drafts fire on move count, not on time. A berserked player faces the same six or seven draft decisions with half the time to make them, which is a much larger penalty here than on Lichess. If it ships, the draft decision window must be exempt from the halving, or berserk must also raise the draft cadence |
| C7 | Increment shown as `3+2` in every listing | Same (`src/app/tv/page.tsx:36`) | None | Fine |
| C8 | A "give more time" button beside the opponent's clock, adding a fixed `moretime` amount | Nothing | **C8, S.** Server event plus a button. Files: `src/lib/multiplayer.ts`, `src/components/OnlineMatch.tsx`, the game server | Fine |
| C9 | First-move expiration: a bar counting down the seconds to play the first move, going emergency under 8 seconds with a sound (`ui/round/src/view/expiration.ts`). Failing it aborts the game | Different mechanic: a free-time grace chip shows `+N` inside the clock while the first-move grace is shielding it (`src/components/ClockPill.tsx:190`) | None needed. Ours is a grant, theirs is a forfeit | Ours is the right shape for a game where the first move can be preceded by a nerf draft |
| C10 | Hours render as `hh:mm:ss` | `formatClock` never renders hours (`src/lib/clockFormat.ts:27`) | **C10, XS**, and moot: `src/lib/ratingCategories.ts:80` lists ultrabullet, bullet, blitz, rapid and nothing longer. Only fix this if classical or correspondence ever ships | Fine |

---

## 5. Notation panel

| # | What Lichess does | NerfChess today | Gap and size | Variant fit |
|---|---|---|---|---|
| N1 | Two columns per move number, one row per move pair, very tight leading, whole cell clickable, active ply carries the accent | Same shape (`src/components/MoveList.tsx:164`), accent fill on the selected cell (`:252`), 13px mono | None. This is a straight match | Fine, and our numbering already handles extra-move cards correctly by numbering off move colour rather than ply parity (`src/components/MoveStrip.tsx:29`) |
| N2 | The current ply is scrolled into view on every jump | Same (`src/components/MoveList.tsx:87`) | None | Fine |
| N3 | On one-column layouts the move list becomes a horizontal strip under the board | Same (`src/components/MoveStrip.tsx`), kept scrolled to the head | None | Fine |
| N4 | `shift`+`I` toggles inline notation (one flowing paragraph instead of columns) | Nothing | **N4, S.** Low value without variations | Fine to skip |
| N5 | Glyphs (`?!`, `?`, `??`) appear inline in the move list after analysis, and the classification drives the move colour | Nothing | Rolls into A4. When it lands, add a glyph slot to `MoveCell` (`src/components/MoveList.tsx:230`) | Add a fourth glyph for the draft decision, rendered on the move that triggered it |
| N6 | PGN is downloadable everywhere a game is viewable | `gameToPGN` (`src/lib/pgn.ts:41`) carries `Variant`, the rule cards, and the termination reason. Wired as copy on `/game/[id]:1304` and download on `/analysis:223`. **Not on `/history/[id]`** (166 lines, no export path) | **N6, XS.** Files: `src/app/history/[id]/page.tsx` | Fine. Our PGN already does the right variant thing by keeping SAN standard and putting the cards in custom tags |
| N7 | Right-click a move for a context menu (copy PGN from here, set as mainline, delete from here) | Nothing | **N7, S.** Only "copy PGN from here" transfers without variations | Fine to skip |
| N8 | Move times shown per move, plus a move-time chart under the board | Nothing in the list | **N8, S.** We already replay clock state for the clip studio (`src/components/clip/clipReplay.ts`). Files: `src/components/MoveList.tsx`, `src/lib/gameHistory.ts` | Very high value here specifically: the draft window charges the clock (the `Draft` chip at `src/components/ClockPill.tsx:178` exists because of it), so "where did my time go" has an answer this game can give and normal chess cannot |

---

## 6. Zen, blindfold, board editor

| # | What Lichess does | NerfChess today | Gap and size | Variant fit |
|---|---|---|---|---|
| Z1 | Zen hides everything but the board, the clocks and the move list. Bound to `z` on round, analysis and puzzle surfaces; also a board-menu toggle; also a server-side preference | Fully built: a `zenMode` setting (`src/lib/settings.ts:182`), an `html[data-zen]` flag written by `applyUiPrefs` (`:631`), `src/app/zen.css` doing the hiding with a `.zen-exit` affordance, and `useZenHotkey` (`src/lib/useZenMode.ts:47`) | **Z1, XS.** The hook is only imported on the two `/game` routes. Add it to `/analysis`, `/tv`, `/history/[id]`. Files: those three pages | **Define what zen keeps.** In normal chess the answer is "board, clocks, moves". Here the card dock is not chrome, it is the game state. Zen must keep the dock and the draft overlay, and hide chat, nav, spectators and stakes. Check `src/app/zen.css:16` against `BuffDock` before extending |
| Z2 | Blindfold hides the pieces, keeps the board, the coordinates and the move list. Per-user, stored, and announced to the server (`ui/round/src/ctrl.ts:921`) | Nothing | **Z2, S.** A CSS class on the board root plus a settings toggle | **Partly conflicts.** Blindfold assumes the position is the whole hidden state. Here the position is only part of it: cards, freezes, wards and doom counters live on squares and in the dock. Blindfold with the dock visible is an odd half-measure. Low priority, and if built it should hide the board status glyphs too |
| Z3 | Board editor: drag pieces on and off, set side to move, castling rights, en passant, then "analyse from here" or "play with the machine" | Nothing. `/analysis` accepts a pasted FEN (`src/app/analysis/page.tsx:387`) and exposes the current FEN read-only at `:374` | **Z3, M** for pieces only, **L** with card state | **A pieces-only editor is a trap.** A NerfChess position is a board plus a nerf plus held buffs plus active effects plus the draft counter. An editor that can only set pieces produces positions that cannot occur and that the engine will evaluate wrongly. Build it only alongside a card-state editor, and only after A9 makes "analyse a real position" work at all |

---

## 7. Puzzles

None of this exists in NerfChess. `grep -ri puzzle src/` returns 16 hits, all card
art and achievement icons. The roadmap (Priority 1, item 2) already names this as
the retention engine, and it is the only feature in this document that works with
zero opponents online.

What Lichess actually ships, concretely:

- **Daily puzzle**: one position, shareable, on the homepage, no account needed.
- **Puzzle trainer**: rated, themed, with a per-session store of the last 100
  rounds held in localStorage for an hour (`ui/puzzle/src/session.ts:23`), so the
  strip of recent results survives a reload. Vote up or down. Retry allowed.
- **Puzzle Streak**: an endless run of increasing difficulty; one miss ends it;
  progress is stored so a reload does not lose the run (`ui/puzzle/src/streak.ts`).
- **Puzzle Storm**: 3 minutes, 10 second malus per miss, and a combo ladder that
  refunds time at 5, 12, 20 and 30 in a row (`ui/storm/src/config.ts`).
- **Puzzle Racer**: 90 seconds, no malus, multiplayer, combo ladder 1/2/3/4
  (`ui/racer/src/config.ts`).
- **Puzzle dashboard**: a radar chart of performance by theme, which is what turns
  a grind into a diagnosis.

| # | Work item | Size | Files | Variant fit |
|---|---|---|---|---|
| P1 | **Daily puzzle.** One position per day, shareable, playable signed out | M | new `src/app/puzzle/`, `src/app/api/puzzle/`, generation script in `scripts/` | **The classic puzzle format does not transfer and must be re-based.** Almost every Lichess puzzle resolves to mate or a material win. There is no mate here. The three formats that do work: (a) **"capture the king in N"** under a stated nerf, which is the direct translation, (b) **"you are under this nerf, find the only move"**, which teaches the card library, and (c) **"two cards are offered, which one wins"**, which is the draft skill and has no chess analogue at all. Format (c) is the one nobody else can ship |
| P2 | Puzzle trainer: rated, themed by card, with the session strip and up/down votes | L | as above plus `src/lib/rating.ts` | Themes should be card ids and card categories (`src/lib/cardEffectCategories.ts` already exists), not tactical motifs |
| P3 | Storm (3 min, 10s malus, combo ladder) | L | new `src/app/puzzle/storm/` | Fine once a corpus exists |
| P4 | Racer (90s, multiplayer) | L | new `src/app/puzzle/racer/` | Fine, and it is the one puzzle mode that also fixes liquidity, because racing needs opponents and tolerates any skill mix |
| P5 | Dashboard with a per-theme radar | L | new `src/app/puzzle/dashboard/` | Radar axes become card categories. This doubles as a balance dataset |
| P6 | **Puzzles mined from your own finished games** | L | `src/lib/gameReview.ts`, `engine-service/` | Depends on A4 and A5. The most on-brand version: every blunder we classify becomes a candidate puzzle, tagged with the card that made it possible. It solves the corpus problem, the retention problem, and the "why did I lose" problem at once |

The sequencing that matters: **P1 first and alone.** It proves the format with
one hand-authored position a day and no rating system. Only build P2 through P6
if the daily puzzle actually pulls returns.

---

## 8. Social and retention

| # | What Lichess does | NerfChess today | Gap and size | Variant fit |
|---|---|---|---|---|
| S1 | TV is a set of named channels (Top Rated, Bullet, Blitz, Rapid, Classical, and one per variant), each with its own rating floor and its own freshness window in seconds since the last move (`modules/tv/src/main/Tv.scala:85`). Each channel has a current champion | Two channels, `?mode=nerf` and `?mode=buff` (`src/components/SiteHeader.tsx:57`), and no champions | **S1, S.** Add speed channels over the existing filter, and a champion row. Files: `src/app/tv/page.tsx`, `src/lib/spectate/featuredBoard.ts` | Fine. Mode is the right primary axis for us; speed is the right secondary one |
| S2 | The featured game only changes when a candidate scores more than **1.17x** the current one, and when the featured game ends TV **follows its rematch** before falling back to the best candidate (`modules/tv/src/main/ChannelSyncActor.scala:78`). Score is the two ratings plus a title bonus. Freshness is per channel: 35 seconds for bullet, 5 minutes for rapid | Re-sorted by watcher count then best rating on every poll, no hysteresis and no rematch follow (`src/app/tv/page.tsx:51`) | **S2, S.** Add the 1.17x gate and the rematch follow. Files: `src/app/tv/page.tsx`, `src/lib/spectate/featuredBoard.ts` | Fine, and it matters more here: our card animations run for hundreds of milliseconds, so a board swap mid-effect is worse than on Lichess |
| S3 | The last two featured games are listed under the board (`GetGameIdAndHistory`) | We run archived replays when nothing is live (`src/app/tv/page.tsx:29`), which is a different and arguably better answer to an empty channel | **S3, S.** Add the "recently featured" strip as well, so a viewer who missed a finish can open it | Fine |
| S4 | A streamers directory, plus a live badge on the profile and in the game view when a player is streaming | Nothing | **S4, M.** Park it | Fine, but it needs streamers first. This is downstream of acquisition, not a lever on it |
| S5 | Correspondence: days per turn, a "your turn" inbox, and `moveOn`, which auto-redirects you to your next game where it is your move (`ui/round/src/moveOn.ts`) | Nothing. `src/lib/ratingCategories.ts:80` tops out at rapid | **S5, L.** Park it | **Conflicts.** A draft fires every 5 own-moves. With one day per move that is a card decision every five days, with a decision window measured in days, against an opponent who can look up the card in the codex. The draft is a real-time mechanic. If correspondence ever ships, drafts must resolve differently there (auto-pick by preference list, or both cards granted) |
| S6 | Challenge from anywhere: a profile, a game, a link, with a chosen time control, colour and rated flag | Challenge exists (`src/app/api/challenges/route.ts`, `src/components/FriendGame.tsx`, `/lobby?tab=friends`) | **S6, S.** Check that a challenge can be raised from `/u/[username]` with a time control chosen in place | Fine, and the roadmap's "first to beat me under a random nerf" (Priority 2, item 4) is exactly the right variant twist on this |
| S7 | Rematch is one click and the accepted rematch redirects both players instantly; "New opponent" re-queues at the same time control | Rematch is built, including the offered and incoming states and the withdraw path when the opponent has left (`src/components/GameOver.tsx:1099`) | None material | Fine. One check: a rematch must re-roll nerfs, not reuse them, or the second game is a solved copy of the first |
| S8 | GIF export of a position and of a game | We are **ahead**: a whole clip studio with GIF and video encoding, presets, music and stickers (`src/components/clip/`) | Nothing to copy. Protect it | This is our best organic-share asset and has no Lichess equivalent. It should be surfaced from the end screen more aggressively than it is |

---

## 9. Accessibility

Lichess's blind mode (`nvui`) is a genuinely separate rendering of the game, not
a set of aria labels bolted onto the visual board. What it does, concretely
(`ui/lib/src/nvui/handler.ts`):

- The board is a table of focusable square elements carrying `rank`, `file`,
  `piece` and `color` attributes.
- Arrow keys walk the cursor square by square, orientation-aware, with a border
  sound at the edge.
- Digits 1 to 8 jump to a rank; shift plus a digit jumps to a file.
- Pressing a **piece letter** jumps to the next piece of that type; the shifted
  letter walks backwards; it wraps, with a distinct sound for wrap and for "no
  such piece".
- Moves are entered into a text input, with promotion prompted by letter.
- The clock renders verbally ("2 minutes 30 seconds") and ticks at 1Hz instead of
  100ms, because updating an active node faster confuses ChromeVox
  (`clockCtrl.ts:150`).
- Settings for move style (SAN, UCI, literate), piece style, prefix style,
  position style and board style, so the same board can be read several ways.

| # | What Lichess does | NerfChess today | Gap and size | Variant fit |
|---|---|---|---|---|
| X1 | The board is a keyboard-navigable ARIA structure | Squares are `div`s with `aria-label="square e4"` and nothing else: no `role`, no `tabIndex`, no piece information (`src/components/Board.tsx:1720`). `grep tabIndex src/components/Board.tsx` returns nothing | **X1, M.** Give the grid `role="grid"`, each square `role="gridcell"` with a focusable inner button, and an accessible name that includes the piece and any active effect ("e4, white knight, frozen"). Files: `src/components/Board.tsx` | **The name must carry card state.** A square in this game can be frozen, warded, barred, banned, doomed with a turn count, mined, or hold a walnut (`src/components/board/StatusGlyph.tsx`, `src/lib/boardStatus.ts`). A screen-reader board that reads only pieces is unplayable here in a way it is not on Lichess |
| X2 | Keyboard-only play: cursor, piece jumping, typed move entry | Impossible. Nothing on the board is reachable by keyboard | **X2, M.** Depends on X1. Port arrow-key walking and piece jumping; typed entry is K8 | Needs one addition Lichess does not: a keyboard path through the **draft overlay**, which currently traps a mouse-free player completely (`src/components/DraftOverlay.tsx:633` binds Escape only) |
| X3 | Every state change announces to a live region: check, move, opponent offers, clock warnings | Live regions exist for status, offers and errors (`src/components/OnlineMatch.tsx:2354`, `:3528`, `src/components/Board.tsx:329`), but not for moves | **X3, S.** Add a polite live region carrying the last move in SAN plus any effect that fired. Files: `src/components/OnlineMatch.tsx` | The effect half matters more than the move half. "Bishop takes e5" is useless if you cannot tell that a card just froze your queen |
| X4 | Clock renders verbally and ticks at 1Hz in blind mode (`clockView.ts:63 formatClockTimeVerbal`) | Numeric only. `role="timer"` is on the grace chip but not the clock itself (`src/components/ClockPill.tsx:192`) | **X4, XS** once X1 exists. Files: `src/components/ClockPill.tsx`, `src/lib/clockFormat.ts` | Fine |
| X5 | Focus visible everywhere, reduced motion honoured | Both hold, and `npm run test:reduced-motion` guards the second (design-system 6 and 10) | None | Fine |
| X6 | Text never drops below body size | `src/app/analysis/page.tsx:332` and `:372` sit at 11px | Same as A10, XS | Fine |

---

## What not to build

Lichess features that are correct for Lichess and wrong for this product. Naming
them is as useful as the backlog.

- **Opening explorer.** A hidden nerf changes the legal move set before move one,
  and a draft rewrites the board every five moves. Opening statistics over
  NerfChess games would be noise dressed as authority. Build the card explorer
  (A7') instead: same shelf in the UI, real information behind it.
- **Mate-based anything.** Mate-in-N puzzles, the mate-sequence advice ladder in
  `Advice.scala`, "checkmate is now unavoidable" comments. There is no
  checkmate. Every one of these has a king-capture translation; use it, do not
  port the original.
- **Variation trees and studies.** They serve people writing chess lessons. Our
  teaching surface is the codex and the guide routes, which already exist.
- **Correspondence** until the draft mechanic has an asynchronous answer. See S5.
- **Berserk** unless the draft cadence is adjusted with it. See C6.
- **A pieces-only board editor.** It can only produce positions that cannot
  occur. See Z3.
- **Zen that hides the card dock.** Zen on Lichess hides chrome. Here the dock is
  state. See Z1.
- **A raw eval number presented as "the eval".** A material and mobility score
  that does not know what cards are held will confidently lie. Label it. See A1.

---

## Sources

- `lichess-org/lila` at master: `modules/web/src/main/ui/help.scala` (the whole
  keymap), `ui/round/src/keyboard.ts`, `ui/analyse/src/keyboard.ts`,
  `ui/puzzle/src/keyboard.ts`, `ui/round/src/premove.ts`,
  `ui/round/src/view/clock.ts`, `ui/round/src/view/boardMenu.ts`,
  `ui/round/src/view/expiration.ts`, `ui/round/src/moveOn.ts`,
  `ui/lib/src/game/clock/clockCtrl.ts`, `ui/lib/src/game/clock/clockView.ts`,
  `ui/lib/src/nvui/handler.ts`, `ui/lib/src/nvui/chess.ts`,
  `ui/analyse/src/retrospect/retroCtrl.ts`, `ui/analyse/src/nodeFinder.ts`,
  `ui/analyse/src/serverSideUnderboard.ts`, `ui/puzzle/src/session.ts`,
  `ui/puzzle/src/streak.ts`, `ui/storm/src/config.ts`, `ui/racer/src/config.ts`,
  `modules/tree/src/main/Advice.scala`, `modules/tv/src/main/Tv.scala`,
  `modules/tv/src/main/ChannelSyncActor.scala`.
- `lichess-org/chessground` at master: `src/state.ts`, `src/drag.ts`,
  `src/draw.ts`, `src/board.ts`, `src/premove.ts`.
