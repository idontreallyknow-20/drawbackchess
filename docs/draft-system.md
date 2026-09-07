# Draft mode: nerf + buff drafts

Draft mode is an alternate ruleset (`/game?...&draft=1`, "Ruleset: Draft" on the
play page). The arc: you start weak and asymmetric from a hidden nerf, then
draft your way back to power. The comeback is the game.

## The loop

1. **Nerf draft** — before the first move each player sees two nerf cards and
   picks one. You can see which two cards your opponent is choosing between,
   but **not** which one they took (hidden choice was picked over visible for
   chaos; reveal buffs like *Extra Glance* / *Watchtower* exist to buy the
   information back).
2. **Buff cadence**: drafts are simultaneous. A shared move counter fires
   every **5** of your own moves (`DEFAULT_CADENCE` and `NERF_MODE_CADENCE`
   in `src/engine/draft.ts`) and hands both players an offer at the same moment
   (two cards, pick one), so neither side ever runs a draft ahead of the
   other. Buff offers, picks, and held buffs are **public**: both players can
   see them (the opponent's current offer is only shown to you if you drafted
   *Peek* / *Draft Insight*, their held buffs are always visible in the dock).
3. **Banking** — on any buff draft you can skip instead of picking. Your next
   draft then rolls one tier higher. Banking **does not stack** (cap +1); a
   second consecutive skip just re-banks the same +1.

## Tier progression

Every draft round rolls one **shared** tier used by both players' offers and
by both cards inside each offer. The base tier follows the curve
**1, 2, 3, 5, 7, 7, 7, 8** over rounds 1 through 8 (later rounds stay at 8),
then a single ±1 jitter (18% up / 18% down) is rolled once for the whole
round. Round 1 never jitters up, so the first draft is always tier 1. There
is no per-card slip gate: a round's tier is one number for everyone, and the
only things that move a player off it are a banked skip (exactly +1 for the
next offer, cap +1, one round only), the stacked-draft match preset (+2 for
the joining friend on every offer), and cards that fix your next draft's tier
(`forceTier`, e.g. Draft Insight, North Star). All rolls come from a seeded
RNG stored in the match state, so replays and snapshots are deterministic.

## Engine architecture

- `src/engine/buff.ts` — core types: `Buff` (definition + hooks),
  `BuffInstance` (held card), `BuffMatchState` (per-game draft/effect state,
  fully JSON-serializable, lives at `NerfGame.buffs`), `ActiveEffect`
  (freezes, shields, barred lines, king-safety, nerf suspension).
- `src/engine/buffs/helpers.ts` — factories (move-gen helpers, targeted
  removal/placement/revival/freeze/shield/steal builders) so most cards are a
  few lines each.
- `src/engine/buffs/library.ts` — the barrel that merges every themed module
  into `ALL_BUFFS`. As of 2026-09: 2,112 buffs defined, **1,423 active** in the
  draft pools (the rest are retired via `src/engine/retired.ts` or are
  cataloged stubs with `implemented: false`, and neither ever appears in a
  draft). Nerfs run the same way: 368 defined, 242 active. 1,665 active cards
  in total. These counts move with every balance pass, so regenerate them with
  `npm run gen:card-registry` rather than trusting this line.
- `src/engine/draft.ts` — tier rolling, offer generation, banking.
- `src/engine/game.ts` — integration: `enableDraftMode`, the legal-move
  pipeline (freeze → buff augments → nerf filter → opponent
  shields/zones/filters), turn manipulation (extra moves / skips), draft
  cadence, `pickDraftCard` / `bankDraft` / `activateBuff` / `buffNextTarget`,
  and `aiResolveDraft` for bots.

### Buff kinds

- **passive** — hooks run while held (move augments, timed effects,
  piece-bound upgrades like *Knight to Nightrook*). Buff-granted moves are
  tagged with `Move.via` so charges are consumed when the move is played, and
  they flow through the existing AI search untouched (the bot sees and uses
  them).
- **instant** — applies the moment the card is picked (freezes, reveals,
  skips, board-wide effects).
- **activated** — the holder clicks *Use* in the buff dock on their turn and
  picks targets (squares or enemy buffs) in a small picker modal.

### Rules decisions baked into the engine

- **Using an activated buff costs your turn**: after the effect resolves the
  move passes to your opponent, with the same handover bookkeeping as a
  played move. Free-action cards (the extra-move family) are the exception
  and resolve within your turn. Every activation also arms the chained-move
  king guard, so the activator cannot capture the king until the opponent
  has replied.
- Nerf constraints still govern buff-granted moves (augments run **before**
  the nerf's `filterMoves`).
- Freezes never affect kings, and a player locked down entirely by buff
  effects gets a **forced pass** (their effect timers tick) instead of losing
  by "no legal moves". Mutual paralysis is a draw.
- Buff effects that mutate the board directly (summons, removals, teleports)
  bypass move history, so threefold-repetition detection is effectively reset
  by them (fifty-move counting is unaffected).
- Nerf-modifier buffs: *Grace Period* (suspend 4 turns) and *Nerf Breaker*
  (remove outright) are implemented because they don't need per-nerf
  downgrade paths. The graded ones (*Loosen the Leash*, *Piece Parole*,
  *Half Measure*, *Rehab*, *Nerf Reversal*) are stubs until nerfs declare
  their own downgrade paths — that category has to be built in tandem with
  the nerf library.

## UI

- `src/components/DraftOverlay.tsx` — the pick-or-bank modal, with whatever
  opponent-draft info your reveals entitle you to.
- `src/components/BuffCard.tsx` — card rendering (tier colors, category,
  status, spent/nullified states).
- `src/components/BuffDock.tsx` — held buffs (yours + opponent's), activation
  buttons, and the square/buff target picker.
- The nerf draft screen and all wiring live in `src/app/game/page.tsx`
  (AI games). Saved games and the AI worker snapshot carry the full
  `buffs` state, so refresh/restore and worker search both work in draft mode.

## Known gaps / follow-ups

- ~100 cards are stubs (atomic/explosion family, rewinds, move-history
  effects like *Momentum*, per-piece conditional shields). The `Buff` hook
  surface covers most of them; explosions and rewinds need new engine events.

Closed gaps:

- The buff dock renders in a bottom drawer (`MobileBuffDrawer`) below the
  `lg:` breakpoint, with a badge when an activated buff is usable.
- The AI activates targeted buffs it holds (`aiActivateBuffs`): targets are
  auto-picked (enemy value first, then own pieces, then central squares), one
  activation per turn before the search, and offensive one-shots hold out for
  at least a minor piece of value. Boards mutated by buffs set
  `BuffMatchState.historyDiverged`, which suspends replay-based threefold
  detection instead of crashing it.
- Zone effects are painted on the board: frozen pieces (icy tint +
  snowflake), shielded/sanctuary squares (green inset ring), squares barred
  against you (red wash, shared with nerf visuals), and squares your buffs
  bar against the opponent (green wash).
