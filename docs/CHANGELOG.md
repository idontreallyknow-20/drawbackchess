# NerfChess changelog

Canonical, version-controlled changelog. This file is the single source of truth
(the Google Drive copy, if any, is just a mirror). It is a timestamped, append
only log: the NEWEST entries are at the BOTTOM, so each update adds a new
`## <timestamp ET>` block and you keep reading down the file. Timestamps are US
Eastern (ET). Keep the append-only discipline; do not rewrite old blocks.

How to update it (do this with every change, without being asked):
1. Get the time in ET: `date "+%Y-%m-%d %H:%M %Z"`.
2. APPEND a new `## <timestamp ET>` block at the bottom (never rewrite old ones).
3. List what changed, with PR numbers and status (OPEN / MERGED).
4. Commit this file together with the change.

Other standing conventions: PR-only (never commit to master; the owner merges);
no em dashes anywhere; bump `buildVersion` in worker.ts on server changes; verify
with `npx tsc --noEmit` and, for server/engine changes, `npm run server:build`.

---

## 2026-07-05 (earlier this session)

Rule content:
- Opponent-hexes (curses on your opponent): 104 new, 10 to 16 per tier. PR #140/#141. MERGED. Reshipped missing tier 5-8 hexes (53 cards) as PR #166. MERGED.
- Nerf-relief boons (soften your own nerf): 32 new, pool 25 to 52. PR #142. MERGED.
- Expanded nerfs: 82 new across all 8 tiers (implemented count 232 to 302). PR #144. MERGED.
- Rule audit: objective sweep + 14-agent judgment pass; 24 findings fixed. PR #149. MERGED.

Features / UI:
- Draggable hotbar (drag an activated card onto its target). PR #145. MERGED.
- Leaderboard seeded with 150 lichess-style fake players (reversible migration). PR #143. MERGED.
- Per-effect board animations (king-only, no-pawn-advance, hex cast). PR #146. MERGED.
- Mobile nav hamburger; homepage stat counts the full library; subtler house flower. PR #147. MERGED.
- Design refresh (metal-gradient buttons, focus ring, docs/DESIGN.md). PR #148. MERGED.
- Jargon glossary tooltips. PR #164. MERGED.
- Mobile draft/UX fixes. PR #163. MERGED.
- Moderator panel members list excludes the 150 seeded bots. PR #169. MERGED.
- Tutorial "The four cards" section (nerf/buff/hex/boon, who-it-hits distinction). PR #170. MERGED.
- Codex: buff cards get the difficulty ornament; hex and boon become their own tabs; "Suggest a nerf" becomes "Suggest a rule". PR #171. MERGED.

Server / connection:
- Client connection resilience (retry/backoff, reconnect during matchmaking, seat at pairing). PR #150. MERGED.
- House-bot + game-server hardening (both modes queued, acceptWebSocket wrapped, update-interrupted games drawn+unrated). PR #151. MERGED.
- Overload/scan fix + accepting-a-bot-game fix (persisted disconnect gate). PR #168. MERGED.

---

## 2026-07-05 18:39 ET (server crisis, bots, tournaments, feature wave)

Deploy / build:
- A collaborator added a Hyperdrive/Postgres binding (#172) that BROKE the Cloudflare Workers Build, so #168-171 merged but could not deploy until fixed (#173). buildVersion was a static string, so deploys were unverifiable. Fixed: buildVersion is now bumped on server changes so /healthz identifies the running build.

Server stability saga:
- Symptom: "couldn't reach game server", slow loads, then hard crashes ("Durable Object exceeded its CPU time limit and was reset", timeouts).
- Root cause: the single global Durable Object ran FULL match-table scans on the request path and first index build; under bot churn the table bloated and each scan blew the CPU limit before it could GC, so it never drained (death spiral).
- PR #174 (server-cpu-fix-1): emergency alarm throttle + no filler + version marker. Helped, insufficient. MERGED.
- PR #176 (bounded GC + persisted live-index, no full scans): the real structural fix. CLOSED to avoid competing with the collaborator's server work.
- Collaborator PR #175: throttled the scans + fixed lobby seek pairing + stuck bots. MERGED. Server stabilized (briefly).

House bots:
- PR #177: HOUSE_ENABLED flag to pause all bot activity (clears seeks, draws in-progress bot games unrated). MERGED.
- PR #183: re-enabled bots; roster 16 to 50 with creative handles (waterbottle, iloveproteinbars, flower, bssfan, grade11isscary, timmychenbiggestfan, josephleungadmirer, kingcongo, SIXSEVENHAHAHAH, anarchychess + fillers); load-test caps. MERGED.
- PR #186: fewer seekers (2-4), faster bot-vs-bot spawn (20-80s to 4-10s), caps 18/20, buildVersion house-tune-1. OPEN.

Features:
- PR #178 cooler draft: glass reveal FX (drama scales with tier) + Surprise-your-friend stacked preset. MERGED.
- PR #179 UI redesign: research (docs/ui-research.md), mode-seam signature, fluid type scale, de-bland home/lobby, lichess rating chart, snappier search. MERGED.
- PR #180 low-time warning sound synced to the visible clock. MERGED.
- PR #181 profile polish + custom emoji flairs + avatar/flair rejection messaging. MERGED.
- PR #182 rule audit (judgment): correctness / tier-fit / clarity fixes. MERGED.
- PR #184 board bugs: mobile premove cancel, illegal-move arrows, fullscreen/resize. MERGED.

---

## 2026-07-05 evening ET (feature wave PRs, server still crashing, tooling)

Feature PRs opened:
- PR #187 tournaments: lichess-style list + detail + join/withdraw + standings/podium; D1-backed; reversible migration 0015; auth-gated. Built from scratch (no lichess source copied). OPEN.
- PR #188 homepage copy (Nerf = secret handicaps revealed at end; drafting; Buff = no nerfs, draft power-ups; win by capturing the king) + 3 nerf and 3 buff clickable cards to the codex. OPEN.
- PR #189 loading/join speedups: parallel replay prefetch, in-flight connect dedupe, board skeletons, cached lobby snapshot, hero prefetch. OPEN.
- PR #191 draft settings on /play + fixed Play-vs-Bot (it silently gave both sides hidden nerfs) + true Plain chess vs bot. OPEN.

Server:
- Under the 50-bot load (#183 + #186 both deployed, buildVersion house-tune-1) /healthz was 1/10 OK even at ~2 live games: still the full match-table scan choking on churn. The throttle-only fix (#175) does not eliminate the scan or drain the bloat.
- PR #192 (server-boundedgc-1): revived the bounded-GC (persisted live-id index, bounded cursor sweep, no full scans on the request path or index build) reconciled onto current server code, keeping the friend's alarm guards. OPEN. This is the durable fix for the crash under load.

Tooling / process:
- Set up Claude-in-Chrome (browser automation connected).
- Moved this changelog into the repo as docs/CHANGELOG.md (this file) as the canonical, always-available, version-controlled source of truth; documented the update process in CLAUDE.md.

Notes:
- Anything visual is typecheck-clean but needs a preview-deploy eyeball; the game board cannot be run in the build environment.

---

## 2026-07-05 night ET (UI warmth pass, PR conflict fixes, moderator controls)

UI / design:
- PR #194 approachability/warmth pass, grounded in a fresh multi-agent research sweep (Lichess, chess.com, top UI, the AI-generated-look tells, verified brand hexes). Warm the neutrals and structure, never the single accent: warm text ramp (--paper + tailwind parchment), ink-ladder elevation (--surface-panel/raise/hover) for menus/modals/hover rows, warm hover-reactive hairline (--edge/--edge-strong), governed --pos/--warm status pair reusing the mode-seam hues, motion vocabulary (--ease-*/--dur-*), breathing hero aura (opacity-only, gated), .tabular/.press/.hover-lift/.stagger-in utilities. GameOver victory beat recolored to the Nerf->Buff seam with a warm scrim and a rating count-up. Shared warm EmptyState (history + inbox), dismissible first-run welcome, and an anti-slop guardrail in docs/DESIGN.md. tsc + next build green. OPEN.
- Merged current master into PR #194 and resolved the conflicts (page.tsx: kept master's clickable example cards, added the staggered entrance; history: kept the new EmptyState, adopted /play for Play vs Bot).

Server / moderation:
- Resolved PR #192 against current master (bounded-GC preserved; master's house-tune changes coexist in disjoint regions); tsc + server:build clean; pushed.
- Moderator house-bots on/off toggle. New app_settings key/value table (migration 0016) flipped by mods via a guarded POST /api/mod/house; the game-server DO reads house_enabled (cached ~15s) in place of the HOUSE_ENABLED constant, which stays a hard code-level kill switch. A flip takes effect within a few seconds without a redeploy: bot seeks clear and any bot game winds down. buildVersion -> house-toggle-1.
- Mod Players tab now opens on a default roster (the most recent non-guest members) instead of a blank box, and still searches on input.

Notes:
- The warmth changes are typecheck/build-clean but want a preview-deploy eyeball; the board and the Durable Object can't fully run in the build environment.

---

## 2026-07-05 20:50 ET (count-based cards no longer soft-lock with few targets)

- Fix: cards that collect N targets (teleport N pieces, "three of your pieces become amazons" like Titan Legion, remove/freeze/promote/advance N, and the removeEnemies / placePieces / voidSquares factories) soft-locked when the board had fewer than N eligible targets: you picked the few that existed, then got stranded on an empty step you could neither complete nor skip, so the card did nothing. Now they resolve with as many targets as are available. Central one-line guard in buffNextTarget (src/engine/game.ts): once at least one target is picked, a non-finishable step with no remaining candidates ends collection, so the effect applies to the picks gathered so far. Safe for structured collectors (relocateMany, Warp Sovereign, stealBuffs, lineSweep) which already self-guard or ignore a dangling pick.
- Test: scripts/test-hexes.cjs (npm run test:rules) now drives every activated card on two sparse boards and fails on any soft-lock or non-termination. Verified to fail without the fix (7 cards) and pass with it (149 activated cards clean). tsc clean; test:rules and test:nerfs green.
- Design note: docs/2026-07-05-count-target-graceful-design.md. PR #197. OPEN.

---

## 2026-07-05 21:02 ET (turn-cost labels on every card)

- Feature: every draftable card now states whether using it uses up a turn, with a small badge in four states: Uses your turn (activated, playing it is your move), Free action (activated but resolves within your turn), Instant (applies the moment you draft it), Passive (always on while held). Nerfs are labeled Passive (secret handicaps, never activated). The label is derived from the same kind/freeAction fields the engine uses to pass the turn (game.ts), so it can never disagree with actual behavior. Shown on the shared BuffCard (draft picker, codex, in-game modal), the in-game BuffDock rows (own + revealed opponent cards; mobile drawer via the same rows), the boon corner list, and NerfCard/PlayerNerfCard. New src/engine/buff.ts turnCost()/NERF_TURN_COST and src/components/TurnCostBadge.tsx.
- Audit: swept all 419 cards for turn-cost mislabels. Deterministic pass (scripts/audit-turn-cost.cjs, table in docs/turn-cost-table.json): zero description-vs-behavior contradictions. Semantic pass (multi-agent, all cards, adversarially verified) flagged 12; all checked against source and found to be false positives (the flagged passive->turn cards are passive move-augments or unimplemented placeholders, correctly zero-turn) or design/balance calls left for the owner (pieceBound upgrades that intentionally spend a turn to designate a piece, which the badge now makes visible). No flags changed: the derived badge is correct by construction. Distribution: 155 Uses your turn, 12 Free action, 129 Instant, 123 Passive.
- Design note: docs/2026-07-05-turn-cost-labels-design.md. PR #198. Typecheck-clean; test:rules green; visuals want a preview-deploy eyeball. MERGED.

---

## 2026-07-05 21:39 ET (walnut hex: lifetime fix + walnut-piece visual)

- Fix: a walnut (and freeze) is bound to the piece on its square, but the effect was only removed when its turn timer expired, so when the walnutted piece was captured or removed the marker lingered on the empty square or jumped onto the capturing enemy piece. New pruneOrphanedSquareEffects in game.ts drops any freeze/walnut whose square no longer holds a piece of the effect's owner; called after every move and after every buff board mutation (settleAfterBuff). The visual reads effects live (draftZones), so it clears with the effect.
- Visual: a walnutted piece now renders as the whole piece becoming a plump, glossy walnut (new WalnutPiece in Pieces.tsx: gradient shell, brain-like ridges, gloss, per-instance gradient ids) with the original piece shrunk down and nestled inside the shell so you can still tell what it was. Replaces the old amber-tint-plus-peanut-emoji marker; a faint amber square wash remains.
- Animation: the walnut pops in with a comedic crunch, then gives a periodic little shudder as if the trapped piece is rattling to crack out (globals.css walnut-crunch + walnut-jiggle; cut under prefers-reduced-motion).
- Test: scripts/test-hexes.cjs (npm run test:rules) now asserts a walnut is pruned when its piece is captured. Verified to fail without the fix and pass with it. tsc clean; test:rules green. The visual wants a preview-deploy eyeball.
- PR #199. OPEN.

---

## 2026-07-12 00:18 ET (codex card insights: stats + history on every card page)

Implements docs/2026-07-11-codex-card-insights-design.md. Not yet a PR.

Codex pages:
- Hexes and boons get their own URL namespaces (/codex/hex/[id], /codex/boon/[id]), statically generated like the buff/nerf pages. Old /codex/buff URLs for those ids keep rendering with canonical + og:url pointing at the family path (no redirects). cardPath() in cardCodex.ts routes the codex list, related-card links, and the sitemap to the family paths.
- Every card page gains a server-rendered "History" timeline: wave-introduction line (src/data/cardHistory.ts, dates from git + this changelog) plus room for curated per-card balance notes (CARD_HISTORY).
- New "In play" panel (client, src/components/codex/CardInsights.tsx): games carried / seen in offers / picked, holder win rate (hidden under 20 decided games) with tier average, last-30-days activity, popularity rank within (family, tier), house-bot split, plus "currently disabled" / runtime tier-move banners. Renders nothing on failure; static content unaffected.
- Copy fix: hex/item category blurbs were missing their verb ("As a hex card, it a curse...").

Stats pipeline:
- src/lib/server/cardInsights.ts: one full-scan rollup over the games archive into a JSON blob cached in new D1 table codex_insights_cache (migrations/0023, mirrored in schema.ts), recomputed lazily when older than 6h, stale-served on failure. Nerf stats from the nerf id columns (portable SQL via pgAll); buff/hex/boon pick stats from draft_record (Postgres JSONB lateral walk, D1 json_each fallback). House bots split by the hp_ user-id prefix. Both SQL variants verified against a real SQLite with known fixtures.
- New GET /api/cards/insights?kind=&id= slices the blob per card; Cache-Control public max-age=300, s-maxage=3600. Only aggregates leave the server: no draft_record contents, no draftSeed, no per-game rows, grant actions never counted.

Moderator change history:
- New append-only D1 table card_override_history (migrations/0024, mirrored in schema.ts), no actor column (events are public, moderator identity is not).
- upsertCardOverride/deleteCardOverride now read-before-write and record one row per changed field (best effort: an audit failure never fails the override). Events (plus a synthetic "adjusted" event for pre-audit overrides) are served by the insights endpoint and rendered as "Moderator changes" on the card page.

Verified: tsc clean (only pre-existing stale .next/types artifacts), server:build green, dev-server walkthrough of hex/boon/nerf pages including a seeded 36-game fixture (win rates, ranks, tier average, bot split, tier-move banner, and audit events all correct, then cleaned up). buildVersion bumped to codex-card-insights-1.

---

## 2026-07-17 13:30 ET (dungeon gate lobby CTA, chest reveal ledger, nerf-mode wave 2)

UI:
- The Open Lobby CTA (desktop hero + mobile OpenLobbyPanel) is now a full dungeon gate (new DungeonGateButton + CSS): carved granite courses, iron corner braces with rivets, an Elder-Futhark rune lintel that ignites on hover, torch-pooled jambs, and a clipped four-ember file. Complete default/hover/pressed/focus-visible/loading/disabled states; transform/filter-only state changes (no layout shift), decorations clipped inside the button, gated under data-anim=off and data-perf=low.
- Leaderboard podium keeps the same three-across treasure-dais silhouette on phones (smaller avatars via a matchMedia hook, tightened columns, risers keep mobile min-heights, bios hidden below sm) instead of the squished vertical stack.

Draft chest:
- New reveal-state ledger (src/lib/draftReveal.ts, localStorage): the treasure chest plays exactly once per unique offer version (scope game id + offer index + reroll count). Fixes the asymmetry where a NEW draft arriving while the panel was minimized skipped the chest (the initial packStage honored `minimized`) while a reroll always played it (the dealKey reset path ignored it). Chest now fires for first/scheduled/banked/apex/reroll drafts and unrevealed reconnect restores; never for rerenders, StrictMode double-mounts, re-delivered draft states, or refresh after the reveal was watched. The draft chime rides the same ledger; a Skip control under the sealed chest jumps straight to the deal. Online scope start.id; local AI games scope ai:<game.startedAt> (survives the save/restore round-trip).

Nerf-mode wave 2 (audit: docs/2026-07-17-card-library-audit.md):
- Combination guard: COMBO_TAGS exclusive families in draft.ts — turn-theft (8 cards), draft-denial (14), mass-freeze (2). The draft never offers a card from a family the caster already holds unspent; deterministic pool filter over synced state (desync/replay-safe); BuffCard prints the exclusivity rule on the card face.
- +28 boons (bw2_*, boons2.ts; T6:5 T7:4 T8:4 of the batch), +27 hexes (hw2_*, hexes/wave2.ts, curse-structured: marks, transfers, delayed dooms, spreading ground, escalation contracts), +16 nerfs (nw2_*, nerfs/wave2.ts, filling T1/T2/T7/T8). Family totals: boons 60->88, hexes 180->207, nerfs 342->358.
- Tier 6-8 nerf rebalance (12 cards, all documented in docs/2026-07-17-nerf-wave2-and-rebalance.md): after-my-move grace + warning hints for the instant-execution loss cards (boastful, wn_glass_queen, wn_pin_cushion, wn_house_of_cards), narrowed trigger zones (hold_them_back, abstinence, helicopter_parent, closed_book), announced windows (glorious_battle), capped requirements (inching_forward), budget raise (war_footing), death_wish re-tiered 6->8.
- Animation coverage: five boon templates + five curse templates, 41 unique per-card flourish dressings, 14 fully bespoke tier 7-8 scenes (boonPlays.tsx/cursePlays.tsx); shared-flagship ratchet unchanged at 381/45 — every new card has a bespoke flagship. Passive-effect registry regenerated: 639 unique compositions covering all 16 new nerfs.
- Verified: tsc clean, eslint clean (2 pre-existing warnings), test:rules, test:nerfs, test:passive-registry, test:animations, test:desync, test:snapshot all green.

---

## 2026-07-17 17:45 ET (wave 3: multi-agent expansion, dungeon lobby, bot identity)

Delivered by a seven-subagent pipeline (content audit, boon designer, hex designer, balance reviewer, animation mapper, lobby redesign, bot data consistency) coordinated by the integrator.

Content (audit brief: docs/2026-07-17-wave3-content-map.md):
- +44 boons (bw3_*, boons3.ts) and +40 hexes (hw3_*, hexes/wave3.ts) in the genuinely open mechanic families (turncoat/possession, summoned hazards, sympathetic links, contracts, contagion, comeback, clocks, terrain, miracles); zero additions to the saturated petrify/freeze/zone/leash piles. Totals: boons 88->132, hexes 207->247, ALL_BUFFS 1006.
- Balance review over all 84 cards: bw3_futures_market fixed (prepThree gated out the banked-apex path, the card could never fire as described) and retiered T6->T7; bw3_battlefield_commission differentiated from field_knighting via deficit scaling; hw3_hydra_hex T7->T6. Verified: no new COMBO_TAGS families needed, no ward-stack lockouts, no soft-lock paths, determinism clean.
- Animation map: 63 dressed-template flagships (unique per-card SVG dressings across the ten wave templates) + 21 bespoke T7/T8 scenes; 8 new transform/opacity keyframes; shared-flagship baseline held at 381/45. Registries regenerated: 1355 icons, 687 plugin ids, 675 passive compositions.

Lobby (Fable agent):
- Full dungeon-chamber redesign extending the DungeonGateButton system: granite Quick-match chamber with Buff/Nerf carved-door mode cards (igniting in-flow selected state), engraved stone time-control tokens with a mobile bottom-sheet picker, ember tab underline, segmented rune filter, engraved section labels, stone secondary cards, dungeonized loading skeleton, sticky CTA as a real DungeonGateButton on a torchlit plinth.
- Mobile overhaul: hidden tab scrollbar with edge fade (no active-tab clipping), compact one-row masthead, 44px+ targets, safe-area insets, wrap-safe rating rows, no horizontal overflow at 360px; FpsMeter debug chip is now development-only.

Bot identity (worker.ts, games.ts, ratingSql.ts, profile page):
- Inline bot-avatar browser upload for house editors (ilovenewjeans): client validation, center-crop + compress to ~200KB, preview-before-save, server-side re-validation through the centralized isHouseEditor permission.
- Username propagation: houseNotify records actor_user_id (notifications heal on rename), live seats re-read canonical names, retained seeks re-sync from houseLiveInfo. Rule: archived games keep at-the-time names; current-state surfaces always canonical.
- Rating sync: bestLiveRatingSql unified onto the most-played-bucket rule (ends the MAX-vs-most-played divergence), per-mode challenge seeding, and recordFinishedGame rating writes converted to optimistic CAS with bounded retry so concurrent DO + arena-isolate results never lose an update.

Verified: tsc clean, eslint clean (2 pre-existing warnings), test:rules, test:nerfs, test:passive-registry, test:animations, test:desync, test:snapshot, test:glicko, and next build all green.

---

## 2026-07-18 17:08 ET (codex rule completeness: two orphaned nerfs restored)

Rule content:
- Codex completeness audit: cross-referenced every card id defined in the engine against ALL_BUFFS + ALL_NERFS (what the Codex renders). All 1006 buffs and 358 nerfs already surfaced; found five nerf rules defined in source but absent from the Codex, two of them accidental.
- Restored two fully implemented, non-duplicate nerf rules that were defined but never wired into any registry array (orphaned in the b437f3c refactor), so they never appeared in the Codex or the draft pool: Clergy (tier 2, bishops cannot retreat toward your own side; extras.ts EXTRA_NERFS) and Hand and Brainless (tier 6, each turn a random piece type you must move if able; implemented.ts ALL_IMPLEMENTED). ALL_NERFS 358 to 360.
- Left the deliberately retired rules retired (RETIRED_NERFS: resolvable by id for old replays, out of the Codex by design): Foot Soldiers Only (verified exact mechanical duplicate of the live Serf Labor, identical move filter), Number of the Beast, and Hand and Gigabrain.
- Regenerated derived registries: cardIconMap.gen.ts (1355 to 1357 cards: the two new ids plus the deterministic open-address probe cascade through the generic File-icon cluster, curated tier 7+ overrides untouched) and passive compositions.ts (675 to 677: two new nerf tuples plus deterministic sentence-uniqueness disambiguation).

Verified: tsc clean, eslint clean (2 pre-existing warnings), test:rules, test:nerfs, test:passive-registry, test:desync, test:apex, test:snapshot all green; both new nerfs prerender their /codex/nerf/[id] pages and never soft-lock from the opening. PR #425. OPEN.

---

## 2026-07-20 03:20 ET (autonomous overhaul pass: bot-profile routing, draft preview, knight/bishop overlap, em-dash guard, rule accuracy, friends skeleton)

Delivered from a seven-subagent read-only investigation (bot routing, effect duplication, em-dash enumeration, skeleton coverage, mobile layout, sound coverage, rule text) plus hands-on integration. Every change verified with the existing harnesses; no worker.ts / DO change, so buildVersion is untouched.

Bot profile routing after rename (the "old link opens Account not found" bug):
- Root cause: a NEW username resolves fine (rename writes username_lower, the profile lookup is case-insensitive), but OLD names dead-ended forever. Player identity was denormalized only for display in two spots that no rename backfilled: the frozen game-archive names (games.white_name/black_name) and any previously shared /u/oldName URL, with no old-to-current redirect anywhere. Live, id-joined surfaces (leaderboard, Online Now, notifications, lobby/TV) already tracked renames correctly.
- Fix (single mechanism repairs history links, recent-games links, and old shared URLs at once): new username_history(old_username_lower to user_id) table (migrations/0037 + schema.ts, idempotent). Both rename paths now record the outgoing name in the same write (flagged-user rename in /api/auth/rename; House-bot editor in /api/mod/house/personas, folded into its atomic batch). Renaming back clears the prior redirect (no loops). The profile API (/api/users/[username]) resolves a missed lookup through username_history and returns the current username; the profile page forwards with router.replace. Usernames were already never the permanent id (games/ratings/leaderboard key on account id); this only repairs the denormalized display name.

Opponent draft preview (bottom of the draft overlay):
- Replaced the single-line text summary ("Opponent's draft: Name (T3)...") with a new compact, dungeon-styled OpponentDraftPanel: small tier-tinted cards with the card face icon, name, tier chip, category, and a tap-to-expand short description; face-down backs (tier numeral) for tier-only and hidden states. Deliberately smaller than your own cards so your choices stay the visual priority; wraps without horizontal overflow; tapping toggles detail only (never touches the draft). Information permissions are unchanged: it renders only what the caller already deemed visible (showCards / showTier / reveal / lastPick), so nothing hidden can leak.

Knight-to-bishop overlap (Tier 3 vs Tier 7):
- Confirmed the pair: wa_spectral_minors (Spectral Retinue, T3 buff-mode instant) and bw3_mummers_dance (Mummers' Dance, T7 nerf-mode activated) had byte-identical effect bodies (swap every knight to bishop and back). Resolved by differentiating the T7 boon rather than deleting either: Mummers' Dance now also shields the whole re-tasked minor corps from capture for the opponent's next turn, so the army-wide re-task cannot be punished mid-costume-change. That protective rider is what earns the higher tier; the bare swap alone is a T3 effect. Distinction documented in-code.

Em dashes (static guard for the standing "no em dashes in user-facing text" rule):
- New scripts/check-emdash.ts (npm run test:emdash): a TypeScript-AST scanner that flags em dashes only inside rendered nodes (string literals, template literals, JSX text; className and other non-rendered attributes excluded) and never inside comments or SVG path data. Confirmed the convention is honored essentially perfectly: of ~1600 em-dash occurrences in src, all but one were in code comments. Fixed the lone rendered case (a cardIcon dev console message). Wired as a first-class check.

Rule-description accuracy (displayed text vs implemented behavior):
- Fixed three nerf descriptions that misdescribed their own code (the accurate text existed only in dead library.ts stubs that the implemented cards shadow): Thunderdome now says a piece in the center 16 can never leave the zone (the code makes it impossible, not "rarely"); Quicksand now describes the correct cumulative "second landing on the same 4th/5th-rank square, ever" rule (not "twice in a row"); Ichthyophobe no longer claims "Stockfish" (the engine is a one-ply greedy heuristic).

Friends panel loading (skeleton + error separation):
- FriendsPanel rendered nothing while its first fetch was in flight and hung on a blank panel if that fetch 5xx'd or went offline. Added a themed roster skeleton (pulse rows matching the final layout, motion-reduce aware) for the loading state and a separate "Try again" retry for the failed-load state.

Investigation findings recorded for follow-up (not changed this pass, to avoid registry churn / risky content surgery): several same-tier nerf mirror pairs (oddball/even_keeled, remorseful/one_bite_at_a_time) and tier inversions (onward_only T7 weaker than forward_march T5) where every alternative mechanic collides with an existing nerf (punching_down, theocracy), so re-theming would trade one duplicate for another; the persistent passive-aura sound layer is intentionally silent (effect activations already voice through sounds.ts, and continuous ambient passives are undesirable); a handful of low-severity mobile polish items (rating-chart tooltip edge clamp, a couple of username truncations, one wrapping button row).

Verified: tsc --noEmit clean, eslint clean (2 pre-existing warnings, both unrelated in game/page.tsx), and test:rules, test:nerfs, test:passive-registry, test:animations, test:desync, test:apex, test:snapshot, test:emdash all green. Visual/audio changes want a preview-deploy eyeball (the build env cannot render them). PR OPEN.

---

## 2026-07-20 04:29 ET (sound for every effect, complete card registry, whole-library card review)

Exhaustive card + sound pass (PR #428). Delivered with a 59-agent workflow (one auditor per card-source file, every one of the 1366 cards) whose findings were each verified against the engine before any fix.

Sound coverage for every effect:
- Every card's persistent effect (a nerf reveal, a buff/boon/hex acquisition) already carried a sound family in its passive composition (compositions.ts soundCue) that nothing ever played. Wired end to end: nine procedural Web Audio family voices in sounds.ts (decree, strike, bind, territory, tempo, blessing, summon, fracture, veil), each short and distinct, subtler than the marquee attack voices, gated by the effects pref + mute via fx(), and volume-scaled (tone() does not self-apply the volume setting).
- playPassiveCue dispatches "passive/<family>" to its voice, rate-limited (max 4 cues per 0.5s, extras dropped never queued) so a burst of reveals on load/reconnect cannot stack into a wall, and it only reads the audio clock so it can never autoplay before a user gesture. PassiveSpawn fires the cue exactly once per activation (ref-guarded against the re-renders that recreate the visual), one shot on spawn, never a continuous ambient loop.
- Result: all 677 passive effects (360 nerfs + 317 passive buffs) are voiced; the other 689 buffs are instant/activated and already voice through the cast/signature system. scripts/check-sound-coverage.cjs (npm run test:sound) asserts every composition carries a cue and every family has a wired dispatcher voice.

Complete card registry:
- scripts/gen-card-registry.ts (npm run test:card-registry) generates docs/card-registry.json, one derived row per card (all 1366: id, name, kind, category, tier, mechanic, description, animation family/primitives, sound cue/source, target). Everything is read from ALL_NERFS + ALL_BUFFS + PASSIVE_COMPOSITIONS, so it cannot drift; 0 empty descriptions.

Card review fixes (each verified; several plausible soft-lock reports were confirmed FALSE POSITIVES and left untouched, protected by the nerf filter safety net at game.ts:1130 and timedOppFilter's built-in fallback: cowardly, slowpoke, wa_jinx; understudy is guarded by heldBuffs dropping spent):
- Five reactive freezes added during the OPPONENT's own move with turns:1 never held: the shared post-move tick (game.ts:1505) decrements an opp-owned effect on that same move, so turns:1 ticked to 0 and the effect silently did nothing. Bumped to turns:2 (one effective frozen turn, the +1 the correct cards already use): we_frost_ward, wc_banana_peel_trail, kraken, the pt claimed-square freeze, the wa void-rift freeze.
- we_quagmire stuck a piece 2 turns while promising 3 (same tick convention inside mireSquares, its one caller); added the +1 there. wc_quicksand_patch reworded from "cannot move" to "can only crawl one square at a time" (the effect is a walnut, which the engine lets shuffle one square).

Recorded for follow-up (verified real but not changed this pass): a handful of description-count / placement mismatches (bw2_early_coronation promotable-rank range, hyein blocker-skipping wording, hw3_jammed_castle "two turns" timing, reinforcements back-rank exclusion, seance return-square, promotion_phobia back-rank reachability, castle_curfew move-20 off-by-one). ww_counter_charge and wa_stone_pawns were reported but are CORRECT once the tick convention and walnut semantics are accounted for.

Verified: tsc --noEmit clean, eslint clean (2 pre-existing warnings), and test:rules, test:desync, test:snapshot, test:apex, test:passive-registry, test:sound, test:card-registry all green. Audio and visuals want a preview-deploy eyeball (the build env has no audio). PR #428. OPEN.

## 2026-07-23 03:11 EDT

Balance overhaul (owner doc "NerfChess Balance Overhaul", 2228 named card changes). PR #445. OPEN.

Rule content:
- Full-library balance pass across all four sections: 949 buffs, 527 hexes, 404 boons, 348 nerfs. 837 tier moves, 1372 mechanical tweaks, 12 replacements, 7 renames (ids never change).
- Recurring templates applied consistently: duration shortenings (minimum one; exactly-one-turn effects grant one defender exemption instead), delayed activations (effects begin after the opponent's reply), first-affected-piece escape moves, non-capturing special moves, lossy one-shot charges, reroll riders and reroll costs, small clock garnish (5 to 15 seconds) where a card names no target.
- Tier 9 is now a valid apex band for hexes (special: true, never in the normal curve): The Curse Engine, Peace of the Grave, Mirror of Winter. Regicide left the apex band for the normal tier-8 pool per its retier; apex offers stay pure tier 9/10.
- Openers may carry a balance tier (opener() honors meta.tier; the opener pool still keys off the opener flag alone).
- Codex: every touched card gains a dated balance-history event (src/data/balanceWave1.ts, generated from the owner directives) merged into each card page's timeline.

Engine fixes surfaced by the pass:
- grantInventory now bumps the mutation counter, so pocket grants from hidden passive hooks reveal to replicas and can never desync the crazyhouse inventory (found by the desync harness).
- Living Board's targeting chain terminates after the optional king-step pick.
- Guardian-family openers enforce protection via move filters (the shared shield effect expired the turn it was added); flagged for a wider shield-family fix.

Harness/docs: passive compositions regenerated (1333 entries), card registry + card audit + animation baseline regenerated, desync scenarios and sims (cold_snap, phantom_rook, chess_diff, balance-fixes, apex) updated to the new behaviors. Full battery green: typecheck, lint, rules, nerfs, lab 2083/2083, passive-registry, apex, desync, snapshot, fairness, sequence, purity, emdash, sound, animations, spectator/tv/replay/archive, glicko, build. Known pre-existing failure left alone: sim-capture-accounting's perfect_rewind scenario references a card that never shipped (fails on master too).
- Draft picker: the gold selection ring now follows the card's hover lift on desktop (it sat 3px low); the minimized panel's ring rides the card itself.

## 2026-07-23 04:10 EDT

Owner follow-ups on PR #445 (same branch). OPEN.

- Animations: summon/morph/convert/promote signature cards fell back to a generic poof (or nothing) because the board suppressed their bespoke board-wide lead unconditionally; the suppress now applies only when a removal lead was actually staged. Oversize concern audited in both the DOM play layer and canvas VFX layer: already correct (one-cell parents, square-relative sizing).
- Draft picker selection ring: on hover-capable devices the gold ring sat 3px below the lifted card; the ring now lifts in lockstep (and the minimized panel's ring rides the card itself via glow).
- Draft lag: profiling showed the buff-draft ambient dungeon stage (23 composited layers) was the sole in-game jank source on weak GPUs (~14fps during drafts, 60fps everywhere else). Starfields now paint once, the ambient set follows the FX intensity dial, and sustained sub-30fps auto-downgrades the ambience for the session. Verified with CDP tracing before/after; full battery green.

---

## 2026-07-28 14:11 EDT (sprint overhaul: dead cards, notation, animation reliability, draft escalation, CI)

Broad quality pass. Every item below was verified against a harness or a
before/after measurement. PR #449. OPEN.

Cards that shipped doing nothing:
- The escape-curse helpers turned the restriction OFF while the escape was
  unspent and ticked the duration down anyway, so at turns:1 the opponent's
  first move burned the whole duration and the curse expired before it could
  apply. Six cards were live in the draft pool with zero effect, verified
  against a no-card control: hx4_early_frost (promises "your opponent's pawns
  cannot advance"; Black pushed a pawn twice unimpeded), hx4_hopscotch,
  hx4_hiccups, hx4_matins_bell, hx4_tea_break, and ov_paperwork_avalanche
  (reactive freeze at turns:1 during the opponent's own move, pruned by the
  shared post-move tick before it held anything: the same class fixed for five
  cards on 2026-07-20 and reintroduced by the later wave).
- Machinery fixed three ways: the restriction is live from the moment the curse
  lands (only the first affected piece keeps its forbidden moves, once);
  spending the escape no longer ticks the duration; and the duration only runs
  once the curse has actually bitten, bounded by a patience window so an
  unfired curse fades instead of lurking. The five descriptions promised
  behavior that was unachievable as written and were rewritten.
- New gate: scripts/test-card-impact.ts (npm run test:card-impact). Plays a
  scripted provocation line with and without the card and fails if the runs are
  identical. test:lab only ever asked whether a card threw, which is why all six
  passed every harness for weeks. Carries a self-check so divergence cannot be
  vacuous.

Notation:
- moveToSAN emitted no PGN disambiguator, so two knights that both reached d2
  both rendered "Nd2". The move list was ambiguous and every PGN from the
  Download PGN button was unreplayable by any reader. Added file/rank/full-square
  disambiguation per the spec, computed by replaying the line, with a divergence
  check so a board-rewriting card degrades to the bare form rather than printing
  a wrong origin hint. New shared helpers movesToSAN and sanLabels; the mobile
  drawer and clip captions now share the numbering rule instead of halving the
  ply count (which extra-move cards break).
- Analysis board numbered moves by ply parity, so any FEN with black to move
  numbered the whole line wrong and never showed the leading "N...".
- gameToPGN emitted no SetUp/FEN tags, so a PGN exported from a custom position
  replayed from the standard opening; numbering also restarted at 1.
- New gate: scripts/test-san.ts (npm run test:san), asserting no two legal moves
  in a position share a SAN, over positions forcing each disambiguation form
  plus a 5684-position random sweep.

Chess correctness:
- evaluateMoveRisk used the bare isInCheck while the board's check indicator
  uses the buff-aware gameInCheck, so a king attacked only through a
  buff-granted move lit up as in check but drew no warning on the move that
  hung it.
- makeMove cleared castling rights off move.capturedSquare alone; a
  card-synthesised capture without it left the right standing.

Animations:
- New MotionNotice: followSystemMotion defaults on and folds the OS
  reduced-motion flag into html[data-anim=off], a hard kill switch. Phones
  enable reduced motion for battery saving and accessibility defaults, so a
  large share of players saw no card animations at all with nothing explaining
  it. Shown once, only when the OS is the reason, queued through the same UI
  interrupt slot as LagWatch so it cannot cover a draft.
- .fx-one-shot scaled its 3.4s safety fade by --fx-dur, but roughly a third of
  the one-shot declarations never scale, so at the minimum setting the slot
  faded at 1.39s over art still running 2.8s: apex plays visibly cut in half.
  Clamped with max(1, ...).
- The zone-signature path (freeze, walnut, shield, kingSafe, stun, empower,
  rally, summon) mounted without fx-one-shot, so it had neither the hard fade
  nor the animations-off gate.
- resolveCardVfx was called without the generated family on the floor-fallback
  and zone paths, so roughly a thousand generated-signature cards got the same
  pale-blue burst. The floor fallback is exactly the path a quiet card takes.
- LagWatch's "Smooth it out" promised to trim the heaviest effects but only set
  perfMode and animationSpeed, neither of which touches card-effect load. It now
  also eases the FX dial to Calm, downward only.
- Per-card structural signets in basicPlays: 381 cards played a geometrically
  identical scene (35 on HoofSpring, 27 on GlintArc, 25 on SigilRing). Each now
  carries a constellation varying by arrangement (orbit, arc, column, corners,
  spiral, cross) and count, 36 distinct geometries, assigned so no two cards
  sharing a template share one. Shared flagships 381 to 86, tier>=5 63 to 42,
  baseline ratcheted. The remaining 86 are core SIGNATURES sharing a named
  visual, which needs per-card variation inside SignatureOverlay; left for a
  follow-up rather than papered over.
- audit-animations could not report an F4 violation (fail() ran before the const
  it appends to was initialized), and its flourish parser could not see a signet
  followed by another argument.

Draft:
- TIER_CURVE was [1,2,3,5,7] with later rounds pinned at the cap and a flat 45%
  slip gate, so every round from the fifth on rolled from one frozen
  distribution (20k seeds: T6 51%, T7 40%, T8 10%). A game runs about eleven
  drafts per player, so six or seven were statistically identical. The curve now
  runs to the tier-8 cap and the slip gate eases off late (45%, 34% from round
  6, 26% from round 8). Rounds 1 to 5 are byte-identical; round 8 onward lands
  tier 8 about 64% of the time. REPLAY_VERSION 10 to 11 accordingly.

Performance:
- countRepetitions built a position key for every position in the game. Only
  positions since the last irreversible move can match, so the earlier keys are
  skipped: 0.43ms to 0.17ms on a 150-ply board. Matters most in bulk replay,
  which the Durable Object does on reconnect, spectate, and every bot move.
  Pinned differentially against the naive scan in test:san.
- cardIcon.ts statically imported ALL_BUFFS and ALL_NERFS for a dev-only
  warning, pulling the whole engine card library and its transitive buff tree
  into every chunk touching the file, including /codex. Now a dynamic import the
  production build drops.
- Board prefetched the ~40k-line signature chunk on every mount, including plain
  bot games and the analysis board where no card can fire. Gated on the board
  having a draft state and deferred to idle.
- /game/[id] imported GameOver statically, defeating the dynamic() split in
  OnlineMatch, which is the only place OnlineMatch mounts.

CI:
- Half the suite passed locally but never gated a PR. New parallel content job
  runs test:animations, test:sound, test:card-registry, test:card-audit,
  test:emdash, the three draft checks, test:buff-purity and test:balance-fixes;
  glicko, san and card-impact join the engine job. Dropped a stale tracked
  build artifact (dist-server/src/engine/moveSafety.js).

Recorded, not done: OnlineMatch builds the Board's visual prop as a fresh object
literal every render, defeating around thirty downstream memos and re-rendering
all 64 squares on every clock frame. A useMemo there is a rules-of-hooks
violation because the component early-returns above that point, so it needs a
component split. Highest-value remaining client perf win.

Verified: tsc clean, eslint clean, and rules, nerfs, san, card-impact,
passive-registry, animations, emdash, sound, card-registry, card-audit,
draft-fairness, draft-sequence, draft-timeout, buff-purity, balance-fixes,
desync, apex, snapshot, glicko, spectator-sync, tv-spectator, replay-spectate,
archive-replay and lab all green. buildVersion sprint-overhaul-1. Visual and
audio changes want a preview-deploy eyeball (the build env cannot render).

---

## 2026-07-28 19:40 EDT (sprint 2: rating bug, board render, rounded corners, I Hate My Ex)

Continues PR #449.

House bot ratings disagreeing between TV and the profile (reported: 2600 on TV,
2300 on the profile):
- Root cause: games simulated on the OCI arena carry a seat rating that is a
  compile-time constant, houseSeedRating(persona), baked from the persona's name
  and skill (arena-service/game.ts:74). The arena service has no database. That
  constant rode through externalLiveGames and buildExternalMatch into
  playersPayload unvalidated. refreshSeatRatings does exactly this
  reconciliation, but only for matches the DO runs itself. The constant is
  numerically the frozen legacy users.rating column that ratingSql.ts already
  names as the root of the "ratings don't match between pages" reports.
- The gap is unbounded: a /mod/house override writes the database and the arena
  cannot see it; a roster revision reaching one deploy and not the other shifts
  one side by the full uplift spread (300 to 400, matching the report); and arena
  games are rated, so the real bucket drifts every game.
- Both ingest points now resolve the seat against user_ratings for the mode being
  played, via the houseLiveInfo cache that already holds that map. The lobby path
  warms the cache so a fresh DO instance never serves one stale payload.
- Same block: buildExternalMatch hardcoded rd:150, above PROVISIONAL_RD (110), so
  every arena bot showed a provisional "?" beside a rating it had held for
  hundreds of games (house accounts seed at RD 60). And the seat name was the
  baked persona name, so a /mod/house rename never reached TV.
- Decision extracted to src/lib/server/arenaSeat.ts so it is testable without a
  Durable Object; fallback is per FIELD, since a roster entry can have a
  canonical username but no rating row for the mode. New gate: test:arena-seat.

Board render (the 64-square problem):
- Board keys ~30 memos and all 64 memoized squares on the identity of the visual
  prop and its fields; OnlineMatch built it as a fresh literal in JSX every
  render, so every clock frame re-rendered the whole board. Last session's useMemo
  attempt was a rules-of-hooks violation and was reverted.
- The component split that seemed necessary is not: the early returns are at 2059
  and 2187 but the last hook is at 1924, so a memo above them is unconditionally
  reached and can guard on !game itself. Keying on game identity is safe for the
  reason `moves` already relies on: setGame is called in one place and every call
  site passes a fresh shallow copy.
- Memoizing visual alone would have changed nothing; checkSquares and the bare []
  literals behind legalMoves/opponentMoves/premoves feed the same squareEnv
  dependency list and are stabilized too. checkSquares' memo also removes two full
  gameInCheck move generations per render in draft games.

Rounded corners:
- Correction to an earlier claim of 1,230 violations: globals.css already clamps
  every non-rounded-full class to 1px, so the ~190 rounded-sm/md/lg uses render
  square today and were left alone.
- The real violations are the two escape hatches: component stylesheets (the
  lobby's primary CTA carried a 9px arch, the secondary buttons 6px, the draft
  reveal ring 6px on a square card) and rounded-full on padded elements (the
  AccountChip in the top nav, BuffDock buttons, tier badge, drag handle, toggle
  track, four profile badges). All squared; true dots keep their circles.
- New gate: test:rounded. Two passes, since the violations live where an AST walk
  over TSX cannot see them. Writing it first found six pills missed by reading.

I Hate My Ex: was a tier 1 card freezing one pawn each side. Now destroys every
piece on the board, both armies, leaving only the two kings. Tier 1 to 8, passive
to instant. Removal is `uncounted` (the whole-board-rewrite case) so the wreckage
never feeds the revive pools; kings survive so the game stays resolvable. A
comeback card by construction. New bespoke `exsmash` animation (a colossal fist
flattens the board, oxblood and ash) rather than reusing the wrecking ball, which
would have been two cards sharing one flagship.

Mobile draft readability (from a phone screenshot): the scrim was a flat 20% dim,
so on a phone the masthead, avatar and clocks read straight through the timer chip
and the clock notice. Now 70% below the sm breakpoint, unchanged on desktop. The
clock notice was a full sentence in wide-tracked uppercase sharing a flex row with
the clock readouts, breaking across three lines; it now has its own row in
sentence case. Dropped backdrop-filter from the timer chip (banned, and it sat
over the animated ambient stage recompositing every frame).

The three signature cards (I Love My GF, I Love Cami, Joseph Leung) pull with
their own rose-gold radiance, warmer than the tier 9 gold and tier 10 cyan.
Presentation only, outside the engine. I Love Cami tier 6 to 7.

docs/marketing-plan.md added.

Known outstanding (investigated, deliberately not half-done): the clock rebalance
to 1-2 cards per tier. 110 cards touch the clock; 69 are clock-only and 41 carry
it as a rider, and a sample of five showed five different clause shapes in the
descriptions, so a regex sweep would mangle them. It needs per-card judgment.

Verified: tsc clean, eslint clean, full battery green (san, card-impact,
arena-seat, rules, nerfs, passive-registry, animations, emdash, rounded, sound,
card-registry, card-audit, draft-*, buff-purity, balance-fixes, desync, apex,
snapshot, glicko, spectator-sync, tv-spectator, replay-spectate, archive-replay,
lab) plus all 26 Playwright e2e tests. buildVersion sprint-overhaul-1.

---

## 2026-07-28 23:20 EDT (sprint 3: the misaligned draft box, clock tier 1, exploit, mobile leaderboard)

Continues PR #449.

The misaligned box players kept reporting: found by RENDERING it rather than
reading CSS. Drove headless Chromium to the reporting phone's viewport (360x808)
and dumped the geometry of every bordered element in the draft overlay. It was
the countdown chip, and it was not internally misaligned at all: a separate
217x66 bordered box at y=51, above a panel that started at y=127. Two bordered
rectangles stacked with a gap, the upper one overlapping the masthead and
belonging to nothing on screen. On a taller phone, where the column stops
fitting and the overlay centers it, that box rides over the logo and player row.
Deleted rather than nudged: the countdown now sits inline in the panel header
beside the label it governs (26px dial plus the seconds, no chrome of its own).
"Choose within" went with it; a dial counting down next to "Opening pick" does
not need to announce itself. Verified by re-rendering: the draft column and the
panel frame are now the same box, and no separately bordered timer element
remains.

That deletion took two strings the e2e suite asserts on, and only the smoke test
was run locally, so CI caught it. "Your timer starts when the cards are ready" is
real reassurance and moved into the panel body under the title, where a sentence
fits; its test stands unchanged. The "Choose within" assertions were replaced
with the decision timer's ROLE, which is what they should have used: a countdown
is identified by role="timer" and its aria-label, not by wording a redesign can
legitimately change.

Draft polish:
- The compact panel's Confirm button appeared on selection, and since every
  button in that row is flex-1, inserting a third resized and re-wrapped Reroll
  and Bank the instant you clicked a card, moving the row under the cursor
  mid-click. Always rendered and merely disabled now, matching the full overlay.
- The lock-in bar transitioned width at 10Hz for the whole 20 second window,
  relayouting inside an overflow-hidden parent on every tick. Now scaleX.
- The wall torches were gated on reduced motion only, so twelve elements running
  ten infinite animations kept burning after useAmbientAutoCalm had measured the
  device as too slow, and when the player chose Calm by hand. They follow the FX
  dial now. Related: the panel's resize listener was keyed on dragPos, so
  dragging re-registered it on every pointermove.
- The most blocking surface in the product had no dialog semantics at all: a
  keyboard user tabbed straight out of a forced decision into the board. Now a
  labelled dialog with focus contained, pulled in on open (only when focus is
  outside) and restored on close. Escape peeks at the board, matching the Hide
  button, rather than closing: a draft cannot be dismissed.
- The reduced-motion notice added last session could render over the draft
  cards. It queues through the UI interrupt slot, but that only defers to holds
  that already exist and its effect runs on mount, before the opening draft has
  pushed one. It now waits before asking for a slot.

Clock rebalance, tier 1: 13 cards down to 2. Kept Polite Cough and Pinch of Sand,
where time IS the card. Eight were pure riders on cards already complete without
them. Three had the clock as their actual payoff and got a board payoff instead:
Loyal Pawn (the early promotion arrives protected for a turn), Quiet March (the
retreating pawn cannot be captured next turn), Name Tag (whichever piece takes
Gary walks away clean). augmentThenResolve now passes the resolving move to its
callback, which is what lets the first two shield the square the piece landed on.
Doing this one card at a time was the right call: two of eleven turned out to be
the card's entire payoff rather than a rider, and a regex would have gutted them.

Exploit sweep over resource-granting hooks: bn4_relay_baton granted a draft
reroll and 8 seconds on EVERY castle or promotion after the first, uncapped and
never spent. Promotions repeat, and with a revive or summon card indefinitely, so
a tempo card was an unbounded draft-manipulation engine. Capped at two later
handoffs. Other flagged candidates were false positives bounded by spendOnVia.

Mobile leaderboard, rendered at 360x808 with a stubbed API (the dev database has
no rated games, so the podium never mounts locally): every podium name was
truncated to a stub on ~100px risers, the champion's games count wrapped while
its neighbours did not so the columns misaligned, and the table's W/L/D column
took 84px of a 336px row leaving names ~144px. Names now wrap instead of
truncating, the count is nowrap, and W/L/D hides below sm where the full record
is a tap away on the profile.

Verified: tsc, eslint, full battery, and all 26 Playwright e2e tests green.

Still outstanding: clock tiers 2 to 8 (99 cards), confusing-text simplification,
weak-card buffs, cosmetic-only cards, the UI transition-token sweep, and
AnimatePresence on the draft's unmount paths.

## 2026-08-03 09:26 EDT

Card animations now default ON even when the device asks apps to reduce motion.

- "Follow system motion" flips to default OFF: card plays are gameplay
  information (they are how you see what a card just did), so the OS
  prefers-reduced-motion flag no longer stands them down unless the player
  opts in. The in-app Reduced motion and Animations switches keep working
  exactly as before and always win.
- MotionNotice grows a second variant. On a reduced-motion device with the new
  default, a one-time notice explains that effects are on by default and offers
  to turn them off, labelled not recommended since quiet plays are easy to
  miss ("Turn them off" sets followSystemMotion back on). Players who already
  opted in (or carry the old stored default) still get the original
  "Card effects are off" notice offering to show them anyway. Same UI interrupt
  queue as before, so neither variant can cover a draft.
- detectReduced (lib/useReducedMotion) now treats a stamped html[data-anim] as
  authoritative and only consults the OS media query pre-stamp, gated on the
  followSystemMotion setting. Before this, framer-motion driven effects stood
  down on OS reduced motion even with the setting off, the half-animated state
  the module's own docs warn about.
- The raw @media (prefers-reduced-motion) CSS guards in globals.css,
  DraftOverlay.css, creatorPlays.css and passive/primitives.css re-key onto
  html[data-anim="off"], which absorbs the OS request only when the player
  opted in; otherwise those keyframes would stay frozen while everything else
  played. draft-expire-pulse gains the data-anim rule it was missing.
- Settings hints for "Follow system motion" (Interface and Accessibility) now
  say it is off by default and that turning it on is not recommended.

Verified: tsc, check-reduced-motion, check-emdash, check-rounded,
check-buttons all green. PR #463. OPEN.

## 2026-08-03 09:58 EDT

Animation quality pass on the three entrance systems the owner flagged as
basic. PR #463. OPEN.

- Nerf entrances: the category arrival is now a 9-layer verdict stamp
  (warning under-glow and judicial seal tell, two-part stamp head with a
  one-frame squash, ink shards, emboss afterglow, drips and flecks). The
  neutral floor most nerf cards resolve to is now an edict: parchment
  unrolls, sigil brands in with a scorch flash, wax seal punches, embers
  settle. The board nerf-reveal gains a descending tier-tinted sweep, a
  real slam on the stamp caption, and a staggered press cascade across
  affected squares inside the same 2s budget.
- Creator cards: the one shared ring-and-step-in entrance is gone; each of
  the five cards arrives as its play in miniature (bait tips over and
  SPROINGs out of the snare; the rook slams in behind streaks with its
  caption; lamp blooms and cards flip for family night; the stopwatch
  sprints in and skids with a green split; chat lines scroll and the
  picker ring rattles before locking).
- Passive spawns: every activation now announces itself with a tell
  (color under-bloom plus anchor inhale), an announce ring with rising
  motes, and a slow settle, fitted inside each visual's existing duration
  budget; the nerf reveal press gains a pre-press shadow, a held squash,
  and a release shockwave.

All three-beat, transform/opacity only, --fx-dur scaled, standing down
under html[data-anim="off"]. Verified: tsc, test:animations,
test:scene-complexity (2130 scenes, 0 below floor), test:passive-registry,
test:passive-motifs, test:nerf-visuals, check-vfx-coverage (2448/2448),
test:emdash, test:rounded, check-reduced-motion.

## 2026-09-05 13:25 EDT

UI redesign and bug sweep (branch claude/ui-redesign-bug-sweep-ausg0e). OPEN.

Theme:
- New Midnight site theme (navy take on the Lichess ladder, cooler text
  ramp, accent lifted to #4c9ff0) and it is the default. Dark, Light and
  System stay; System resolves to Midnight or Light. Old stored ids still
  migrate through LEGACY_SITE_THEMES.

Move feel:
- Piece glide is now a millisecond setting (Settings > Board > Motion, presets
  Off / 60 / 100 / 150 / 250 ms, default 100) with a curve that finishes its
  travel by the stated time instead of creeping. applyUiPrefs stamps
  --piece-anim-ms; the board reads it when it starts a slide.
- Move-risk dots compute in an idle callback (useDeferredMoveRisks) instead of
  inside the render that lands the opponent's move, so that frame paints
  before 30 to 80 makeMove calls run.
- The check highlight reads the optimistic board, so the enemy king turns red
  when your piece lands, not one round trip later.
- A move played during a socket blip is held and flushed on reconnect
  (multiplayer.sendMove) instead of being dropped with an error toast.
- New Lichess prefs: Tenths of seconds (never / under 10s / always), Material
  difference, Show ratings.

Draft:
- The treasure chest is gone. DraftVault is a CSS 3D six-sided sigil prism
  over counter-rotating rune rings; materials slate / iron / gilt / arcane /
  apex / mythic climb with the offer's best card. Opening (~920ms): spin-up,
  rings flare and lift, faces shear away, core blooms into a flash and
  shockwave, cards deal out of the light. Same contract, same reduced-motion
  handling, /dev/chest gallery updated.
- When the 20s window ends the draft no longer auto-picks or vanishes, online
  or against a bot: it shrinks into the corner panel and STAYS there (the 12s
  auto-tuck fuse is gone) until the player resolves it. The bot game resumes
  the player's clock at that point. e2e draft-timing updated accordingly.

Phone layout (Lichess column one):
- The match page scrolls on phones instead of clipping inside h-dvh. Board is
  full-bleed, player bars are ~2.75rem (name over material, never wrapping)
  with the clock beside them, and MobileMatchStack renders actions, a
  horizontal MoveStrip with prev/next, your rule, the buff dock inline, chat
  and stakes under the board. MobileMoveDrawer and MobileActionsMenu are
  removed; MobileBuffDrawer is tablet-only now. Headers are 44-48px on phones,
  chat and clock labels come up to 12px, corner overlays sit at the edge.

Loading:
- LockInCountdown split out of DraftOverlay so the corner notice no longer
  pulls the whole overlay and its stylesheet into first paint; PassiveLayer
  loads lazily; sound preload waits for an idle callback; framer-motion added
  to optimizePackageImports.

Bug sweep (see the PR for the file list): 15+10 friend preset broke the
custom slider, settings writes ran inside setState updaters, rematch button
could stay disabled forever, inbox failed silently, poll writes after unmount,
uncleared flash timers, friendBusy not reset across profiles, silent friend
refresh failures, wrong queue fallback pool, details/open desync, case
sensitive own-seek check, guest accounts minted on a transient auth blip,
leaked seek timers.

Verified: tsc, eslint, check battery (emdash, rounded, buttons, reduced-motion,
animations, anim-props, board3d, sound, treatments, usage, clock-format).

## 2026-09-05 15:05 EDT

Redesign follow-up: defaults, premoves, dock, profile, search, balance pass

The default look is Lichess dark with the midnight board, premoves behave like Lichess, the dock has hotkeys and inline Use, the profile and search pages are fixed, and every card in play was re-priced against its own family. PR #482. OPEN. Bundle work in PR #483. OPEN.

Defaults:
- The site theme default goes back to Lichess dark; the board default is the dark grey-blue midnight set. The navy Midnight site theme stays as an option.

Draft and moves:
- The vault's rings and caps burn in the exact tier colour of the best card inside, the caption carries the tier numeral, and tier 9/10 cards get their own deal-glow rows (they fell back to brass before).
- Premoves are Lichess-exact: one slot, a new premove replaces it, and any click or refused drop that is not a premove cancels it.
- The dock flips between You and Them with y / t (shared across every mounted dock), and a collapsed row keeps its Use button.

Pages:
- Profile games tab: stat tiles, one labelled filter row, 48px grid rows; clubs are plain accent links.
- Hero TV frame is token-only, so no black halo on light and no doubled edge on dark.
- Friends list shows 12 with Show all, presence computed once, an overflow menu on narrow rails.
- Find a player: the search route ranked prefix matches only after a 50-row window that house accounts filled, so real players never appeared; it now ranks first, excludes house accounts, and the dropdown reopens on focus and retype.
- Codex lists only cards in play and no longer says Showing N of M; the show-retired toggle is gone.
- The Updates wall is generated from this changelog (`npm run gen:updates`, guarded by `test:updates`), with hand-written entries kept on top.

Balance, full pass: 334 tier moves through hand-audit.json, three reworks (Warp Home free action, Hard Reset freeze fallback, Lifebloom to rank 4 under a shield), 14 text rewrites, five retirements; ladder invariants pinned in `test:balance-pass`. Details in docs/overhaul-checklist.md.

Bundle (PR #483): the 1,539-icon lucide map loads on demand behind the category ring fallback; combo tags moved to a leaf module. Match routes drop from 1,539 statically reachable icons to 159.


## 2026-09-05 19:24 EDT

Round three: worker, engine and match-flow bug fixes

A second sweep over the areas the first two passes skipped: the game server's clock and rematch paths, the engine's chained-move guard and notation, and the match page's reconnect and draft flows. PR #484. OPEN.

Server and sync:
- A disconnect pause taken during a move or a draft deadline is billed again: both resume paths now check the live pause before restarting the clock, the same way draft actions did.
- Rematch requests claim the slot before any database await, so a double tap makes one rematch game and a cancel during the await is not lost; the cancel frame carries the canceller's colour so only the other side's offer resets.
- Aborting a game re-reads the match after the abort-history await, so a game that ended in between is not aborted twice.
- A resync clears the in-flight connect handle, so a reconnect no longer waits out the full eight-second fail timer.
- A move buffered during a disconnect is dropped along with any premove when the board rolls back, and sending now reports sent, held or failed so the optimistic board is only kept on sent.

Engine:
- A free action that grants no extra move (Warp Home) no longer arms the chained-move king guard, so the activator's own king capture stays legal. Covered in `test:balance-pass`.
- Move numbers no longer double-increment on two consecutive Black moves. Covered in `test:san`.
- Move-risk lookups key on castle and drop as well as from/to, so a castling move and a king step to the same square no longer share a risk badge.

Match page and settings:
- Settings pulled from the server are validated before they touch local storage, and pushes adopt the server's timestamp so a change no longer reverts on reload when the clocks disagree.
- The minimized draft panel has a Tuck control; its double-tap guard now measures real elapsed time. The phone move strip rests at the left edge when reviewing from the start of the line.
- Dock rows show one Use button, dragging a card with no target no longer fires it, and an expanded row stays open while a copy's countdown ticks.
- Analyze is hidden for card games (the analysis board would silently truncate them) and the analysis page says when a line stops early. Tournament pages clear a stale error on a successful load.

Checks: `test:retired` now enforces a floor of 12 cards per tier per mode; `test:glossary-effects` fails on an empty map.

Verified: tsc, eslint, the full check battery, Playwright (30 passed, 1 skipped).

## 2026-09-05 20:10 EDT

Round four: bot game, analysis, inbox, clubs and tournament fixes

Another sweep over the pages the earlier passes skipped. PR #485. OPEN.

Bot game and analysis:
- With premoves off, the board no longer shows premove dots during the bot's think, and the clock pill freezes at its live value across a draft pause instead of jumping back to the banked time (it used to read ahead of the real flag by whatever you had already spent that turn).
- The board's low-time effects now watch the live clock, waking exactly when the active side crosses the 15s line, rather than the banked figure that only moved after the pressure was over.
- The end screen no longer re-hides an opponent rule a reveal card already showed you all game.
- Arrow-key move review stays off while the result panel, buff targeting or a front-and-center draft owns the board, matching the wheel navigation.
- The analysis board's eval, bar and best-move squares only render for the position they were searched from, so a move no longer flips the eval sign for a frame or highlights a piece that is not there.
- Settings validation tests own keys only, so a stored "toString" theme can no longer strip the board colours; the Board section's Layout and Motion headings each appear once.

Inbox and notifications:
- The conversation list groups over every message, not a global newest-400 window, so an older thread with an unread message no longer vanishes behind a busy one, and unread counts are exact.
- Message bell entries are matched by the sender's id, so a renamed sender's notification clears when you read the thread and does not multiply.

Clubs and tournaments:
- Joining checks the stored finished status (an arena that played all its rounds early) and, for club events, club membership, the same rule creation already enforced.
- A refused create on the tournaments page no longer blanks the directory behind the form.
- Club pages show the true member count for clubs past the 200-row leaderboard and derive each event's phase from its schedule instead of printing a stale stored status.

Lobby and TV:
- Sub-minute and half-minute clocks (30s+0, 1.5+0) are labelled correctly in open challenges, live games, the watch rail and TV, instead of rounding to 1+0 and 2+0.
- Quick pairing shows "?" for a mode you have not played rather than the frozen legacy rating.

## 2026-09-05 20:50 EDT

Sweep-sized retiers, profile and notification fixes

The targeted win-rate re-measure of the 336 cards moved by the full pass is in, and four of them move one more step. PR #486. OPEN.

Balance:
- Two shards at 12 paired games per card measured all 336 moved cards; 334 fired and 18 resolved outside two standard errors. The tier ladder over the moved set rises from tier 1 to tier 8. Committed record: docs/card-winrate.targeted-2026-09-06.json.
- Sized up one step each on that data: Deal with the Devil to Tier 5, Ascension (small) to Tier 7, Dragon Pawn to Tier 4, Mirror of Souls to Tier 5. Each has a history note; the Dragon Pawn pin in `test:balance-pass` moves with it.
- Amazon Army measured against its holder and is flagged for a play-policy check before any tier change.

Profile and social:
- Game rows resolve which seat you held by user id, so a renamed player's history no longer shows every result flipped.
- The report dialog recovers from a failed request instead of sticking on Sending; a dead extra fetch on every profile view is gone.
- A renamed sender's bell entries swap only the leading name (a short name is also a substring of the copy).
- The leaderboard no longer pins a duplicate of your own row while your account loads.
- The codex tier filter resets when you switch between buffs and nerfs, so a tier the other family lacks cannot blank the list.

## 2026-09-06 01:20 EDT

Draft tier order, and animations off under 20 seconds

Draft:
- Every round now deals one tier for both players and both cards in the offer. The per-card top-tier slip gate is gone, so a round is never 7+6 for one side and 7+7 for the other.
- The first draft never jitters up: round 1 is always tier 1 (tier 2 at most after banking the opener). The stacked preset and forceTier cards remain the only other ways off the shared tier.
- REPLAY_VERSION 12 (the tier roll consumes fewer RNG draws). Engine and arena services need ENGINE_REPLAY_VERSION / ARENA_REPLAY_VERSION moved to 12 in lockstep.

Clocks:
- Animations switch off on their own while either clock is under 20 seconds and come back once both are above it again (increment). Works through the same html[data-anim] gate as the Settings switch, so a settings write during low time cannot turn motion back on.

## 2026-09-07 02:00 EDT

Route loading and error states

The five system states in docs/design-system.md section 8 were only half wired
at the route level: 62 routes had 8 loading.tsx files and one error.tsx (the
root one), so most routes either popped in with nothing in between or dead
ended on a render failure.

Loading:
- 21 new loading.tsx files, each a skeleton in the route's own final geometry:
  achievements, analysis, clubs/[slug], codex/suggest, the four codex card
  pages (buff, nerf, hex, boon), history/[id], inbox, inbox/[username],
  leaderboard, login, mod (the console frame all four mod screens share),
  play, profile, profile/edit, tournaments, tournaments/[id],
  tutorial/first-game, tutorial/walkthrough.
- Four of those existed only to stop a nested route inheriting the wrong
  skeleton: /clubs/[slug] was getting the club directory, /history/[id] the
  archive list, /codex/suggest and the card pages the nine-card library grid.
  A skeleton in the wrong geometry is worse than none.
- New SkeletonHeader (src/components/ui/Skeleton.tsx) replaces the top bar the
  eight existing skeletons had each copied. It stands at SiteHeader's real
  height (48px, 60px from sm), drops three inconsistent inline borderRadius
  values that the globals.css geometry rule overrides anyway, and retires the
  one remaining border-white/5 alpha hairline in the set.

Errors:
- 18 per-section error.tsx boundaries: achievements, analysis, clubs, codex,
  community, game, history, inbox, leaderboard, lobby, login, mod, play,
  profile, tournaments, tutorial, tv, u/[username]. Each names what actually
  failed, which the generic root boundary cannot.
- Shared body in src/components/ui/RouteError.tsx: plain-words sentence, the
  error digest when there is one, Retry, and a way out. Retry is wired to
  next 16.3's retry() (re-fetches the segment) rather than reset().
- Static marketing and guide pages, the dev harnesses, and the /friend and
  /stats redirect shims deliberately got neither.

Verified with npx tsc --noEmit, npm run lint, and the emdash, rounded, and
buttons guards.

---

## 2026-09-07 05:50 EDT

Continuous improvement run, PR #488 (OPEN), branch
`claude/ralph-loop-optimization-nl2902`. One commit per round; the standing
work list lives in `docs/ralph-backlog.md`.

Balance, the material ladder:
- The tier ladder was sublinear in material: a card handing you three points
  sat at tier 3, the third draft anyone sees, while a card handing you nine
  sat at tier 6. Nothing had caught it because no invariant anywhere covered
  spawn or revival material.
- `scripts/material-model.ts` scores every active card for effective material
  and charges a floor of half a tier per point, anchored on the two floors the
  2026-09 pass already pinned (extra piece-class tier 4, amazon-class tier 7)
  rather than fitted to the sim. The measurement can establish a direction and
  a lower bound but not a rate: its buckets hold 8 to 14 cards against a median
  error bar of 12.2 points. The script says so, and prints the fit that looks
  authoritative (a queen at tier 43) with a do-not-use beside it.
- 18 cards moved up. Ten of the 28 reported violations were parser bugs rather
  than library errors, including the worst one: `apotheosis` scored 8.55
  because "it leaves the board for a higher plane" sat past a colon, so the
  minor it spends was never subtracted. Corrected, it does not move.
- Pinned as section 1b of `scripts/test-balance-pass-2026-09.ts`: the ladder as
  data plus a monotone function, tied to the existing pins, 37 hand-checked
  cards, and ten ordering assertions stated without reference to any number so
  they still bind if every measurement turns out wrong.
- Recorded, not fixed: the pocket multiplier has the wrong sign. `legalMoves`
  appends drops AFTER every nerf and effect filter, onto any empty square, and
  counts them in `resolveNoMoves`, so a pocketed piece is strictly stronger
  than the same piece on the board and the model charges 0.95 for it. That is
  why `bn4_care_package` measures +41.7 at tier 3 while the model insists tier
  3 is right. Backlog A8; it moves a whole family and wants its own round.

Sound:
- `tone()` never applied `getVolume()` while `knock()` did, so every tonal
  voice in the app (check, game start and end, clock warnings, errors, every
  card chime and passive cue) ignored the volume slider outright. At volume 0.2
  a check rang at five times the move click beside it.
- Set spread falls from 17.3x to 6.8x on peak and 13.9x to 5.4x on RMS,
  measured with an offline WebAudio shim rather than by ear. New cues for
  castling, promotion, premove set and fired, illegal input, draw offers and
  outcome-aware endings, all wired to their events and verified firing by
  instrumenting AudioContext and matching frequency signatures.

Accessibility:
- The board is now playable from the keyboard. Squares carried
  `role="gridcell"` with no `role="grid"` parent, so the roles were orphaned
  and invalid, and there was no tabIndex and no keydown: not one move could be
  made without a pointer. Now a real grid with roving tabindex, a live region
  that names card state per square, a flip control with `f`, and a `?` sheet
  rendered from the keymap table so bindings and documentation cannot drift.
- Modal dialogs trap focus, which `aria-modal="true"` had been promising at
  nine dialogs without delivering. Restoring focus needed a recent-focus
  history rather than the obvious remembered element: the settings panel's
  opener is unmounted in the same React commit that opens the panel.
- Every rem-based touch target was 12.5 percent short. `html` is 14px and
  `tailwind.config.ts` never overrides `spacing`, so `h-11` is 38.5px. 24 call
  sites converted to literal pixels, matching the 85 already using
  `min-h-[44px]`.
- Eight routes rendered no `h1`. `/game` lost its heading the moment a game
  started, because the only one on the route is in the pre-game draft branch.

Design system:
- `--bg-raised` shipped a step lighter than section 1 documents, which by
  itself moved muted text from 4.57:1 to 3.94:1 on every menu, modal and
  hovered row. Light had the rungs out of order: raised was darker than the
  page it rises from. Both restored, `--bg-hover` documented for the first
  time, and the ladder now carries its measured contrast.
- Sentence case restored in the main nav and the quick-settings section heads,
  the last survivors of the letterspaced device section 3 retired sitewide.
  `.allcaps` deleted (zero call sites, and an unused retired utility is how a
  retired pattern returns). Guarded by `scripts/check-case.ts` with a
  shrink-only baseline, which immediately found a file the manual sweep missed.
- 301 sub-12px text sites fixed, 244 of them at once: `text-xs` resolved to
  10.5px because the root is 14px. `parchment-500` raised to clear AA in all
  three palettes; alpha-dimmed text retired, since the light theme's overrides
  never matched the alpha variants and those sites measured as low as 1.34:1.

Clocks:
- Urgency now scales with the time control (one eighth of the initial time,
  clamped 10 to 60 seconds, as lila does it) instead of a fixed 30 and 10
  seconds. In a 1+0 game 30 seconds is half the clock, so the warning was on
  for most of the game and meant nothing.
- The separator blinks while a clock is charging. It matters more here than on
  Lichess because this clock genuinely stops: a draft charges it and the
  first-move grace shields it.

Coverage:
- `e2e/sweep.spec.ts`: 48 routes, six widths, three themes, 828 cells, 13.5
  minutes. Infrastructure failures are excluded by construction, so an
  OOM-killed dev server cannot enter the backlog as a product defect.
- `docs/lichess-parity-2026-09.md`: a behaviour study read out of lila and
  chessground source, since lichess.org is blocked by the sandbox proxy. The
  useful half is what it says not to build.

Needs an owner decision (backlog C32): the whole spacing scale is 87.5 percent
of the px values the design system speaks in, because the root is 14px and
Tailwind's rem scale is never overridden. `p-4` is 14px where section 4 says
16. Correcting it centrally makes the app roughly 14 percent roomier, and
density is valued here on purpose.

---

## 2026-09-07 06:10 EDT

Tablet band (768 to 1279) on the match surfaces. The 640-to-1024 range had no
layout of its own: everything switched on at `sm` and did not adapt again until
`lg`. Measured on the local bot game, board width against the vertical space
left unused under it:

| viewport | board before | dead column below | board after |
|---|---|---|---|
| 768x1024 | 424px | 540px | 720px |
| 834x1112 | 490px | 562px | 720px |
| 900x1200 | 556px | 584px | 720px |
| 1024x1366 | 324px | 732px | 720px |

The board was width-bound by a 252px move rail every time while half the screen
went unpainted, and at 1024 the `lg` command rail landed on top of that and took
the board from 636px (at 980) down to 324px.

- `src/components/matchLayout.ts` (new): one place for the portrait-tablet band,
  `(min-width:768px) and (max-width:1279.98px) and (orientation:portrait)`, as
  literal class strings so the JIT emits them. The band is orientation-aware on
  purpose: in landscape the height is the scarce axis and a stacked column would
  push the game actions below the fold, so landscape keeps the rail.
- In the band both match views (`OnlineMatch`, `/game`) now use the column that
  design-system.md section 9 already describes for phones: board across the
  column, player strips with their clocks above and below, and `MobileMatchStack`
  under it carrying the actions, move strip, rule, dock, chat and stakes. Chat
  and the dock had no home at all between 640 and 1024 before this.
- The buff drawer stands down in the band (the dock is inline there) and is left
  to the sm..lg landscape range, per section 9.

Hit areas. Several controls used `sm:` as a proxy for "has a mouse", which is
wrong for every tablet. Measured at 768x1024 with a coarse pointer:

- `Button` size `md` rendered 40px (`sm:min-h-[40px]`). Now `(pointer: fine)`,
  which is what the comment above it already claimed. The history filter chips
  (36px), and the buff-targeting Done/Cancel buttons, get the same treatment.
- `MoveList` nav buttons measured 25px at 1024x768 (`sm:h-7`). Now 44px on touch.
- `h-11` is 38.5px at this interface's 14px root, not 44px (see backlog C32).
  `MoveStrip` (the phone move navigation) and the buff drawer's toggle now spell
  44px in pixels; the drawer's bar measures 46px and `mobileChrome` reserves
  exactly that, up from a 2.75rem reserve that was about 7px short.

Sub-44px controls on the touch sweep: history 8 to 4 at 768 and 834, game 9 to 5
at 1024x768, phone counts down across the board. No horizontal overflow at any
of the fifteen widths checked, and 1280 and up is byte-for-byte unchanged.

Not fixed, needs a decision: at 1024 to 1279 in LANDSCAPE the three-column
desktop layout still leaves the board 324px (at 1024x768) to 494px (at
1194x834), against 640px and 706px for the two-column shape at the same widths.
Moving the command rail to `xl` fixes it, but chat only exists in that rail and
in `MobileMatchStack`, so it would disappear for that band until chat has a
second home. See the report for the numbers.

## 2026-09-07 06:07 EDT

The two moments that carry this game: the card draft and the secret-nerf
reveal. Everything below is transform/opacity only, uses the `--ease-*` /
`--dur-*` vocabulary, respects `data-anim` and the low-time hold, and never
delays authoritative state. Not committed; working tree only.

The draft (`src/components/DraftOverlay.tsx`, `DraftOverlay.css`):
- The flight into the pocket was invisible. `.plate` sets `overflow-y: auto`,
  which forces the browser to compute `overflow-x` as `auto` too, so the
  confirmed card was hard-clipped at the panel's edge about a third of the way
  to the buff dock, every single time. The card is now handed to a fixed
  position layer outside the panel (its rect is measured at confirm time and
  the in-grid copy drops in the same frame), so the whole journey is on screen.
  Same 550ms, same commit-on-landing, same 900ms fallback.
- The flight is now an arc rather than a diagonal slide: the card swells for
  100ms, then x runs on `--ease-out` while y runs on `--ease-io`, so the axes
  fall out of step and the path bows. The flare and mote trail ride with it.
- The deal is ordered by tier, weakest first, so the beat builds to the card
  that matters. The old `tier * 12` nudge only biased a slot-ordered delay and
  routinely lost: a tier 1 card in the last slot flipped after a tier 10 in the
  first. The best card now lands last and turns over last, a beat slower.
- The card flip runs on `--ease-spring` (a reveal, one of the three sanctioned
  uses), so a card turns a few degrees past flat and rocks back. That is the
  settle the deal never had.
- Cards fade up as they fly instead of appearing pre-formed, so the stagger is
  something you can count.
- The vault used to burn out completely and leave the stage empty for about a
  quarter of a second before the first card appeared, even though its own
  stylesheet says the cards deal out of the light. The deal now starts 160ms
  early, while the core, flash and shockwave are still fading, and a new
  `.draft-deal-bloom` seam carries that light as the cards fly out of it.
- Selecting a card had no motion at all. A single ring now closes onto it over
  320ms; the check badge lands on `--ease-spring` at `--dur-2` instead of an
  off-vocabulary 160ms.
- Every anonymous bezier in the file was replaced by a named constant mirroring
  the CSS tokens.
- A pick committed mid-flight when motion is switched off (the low-time hold
  does exactly this under 20 seconds) now commits at once instead of waiting
  out the fallback timer.

The reveal (`src/components/GameOver.tsx`, `globals.css`):
- The secret nerf reveal was a React conditional. The sealed card was replaced
  by the rule between one frame and the next, with no transition of any kind.
  It now plays the same beats as the in-game nerf reveal, at 480ms instead of
  two seconds: the card rises and fades in over `--dur-3`, a tier tinted band
  sweeps down it, and the rule's NAME lands last on `--ease-spring`.
- It fires on both routes to the same moment: opening the "Rules this game"
  fold (the default path, which had no beat at all) and pressing the sealed
  card. Armed from render rather than from the click, so the animation starts
  when the fold opens rather than a frame late. It disarms after one play and
  spectators never arm it.
- The reveal is announced through `role="status"` in every motion mode, not
  only when the animation runs.

Route transitions: deliberately not added. See the report reasoning; the short
version is that every route already ships a `loading.tsx` skeleton in the final
geometry, and a transition would put frames between a player and a board whose
clock is running.

---

## 2026-09-07 12:20 UTC

Puzzles: the daily puzzle, capture-the-king shaped (roadmap Priority 1 item 2,
lichess-parity P1). Branch `claude/ralph-loop-optimization-nl2902`, `db76e0d`.

Why the formats are what they are. `docs/lichess-parity-2026-09.md` section 7 is
explicit that classic tactics puzzles do not transfer: there is no checkmate here
and no stable piece value, so an imported puzzle usually has no solution or
several. Three formats were built instead, and all three are proved rather than
asserted:

- `king-hunt` (28): capture the king in N under a named handicap. 25 are forced
  in two of the solver's own moves against every defence; 3 are one-movers, kept
  only where the handicap is what picks the move (several pieces could take the
  king and the rule allows exactly one of them).
- `card-choice` (31): two cards are offered mid-game, one of them wins. No chess
  analogue. The winning card is proved to create a forced king capture and the
  other is proved, by exhaustive search, not to.
- `only-move` (12): the handicap leaves exactly one legal move out of ten or more
  on the board. Reading your own rule is the puzzle.

How a solution is proved unique (`src/lib/puzzles/solve.ts`, imported by both the
generator and the route, so the code that proved a puzzle is the code that judges
the player):

- An AND/OR search over real `NerfGame` states through the real `legalMoves` and
  `playMove`, so every nerf filter, buff hook and loss condition is in force at
  every node. Nothing about the rules is re-modelled.
- The claim is "capture the king", not "win": a branch that ends with the
  defender losing to their own rule does NOT count, so the proven statement is
  narrower than the engine's idea of winning.
- Uniqueness means every other legal move at that node was played out and shown
  to fail, re-checked at every position the solver will be asked to move in, not
  only the first.
- A search that hits the node cap is discarded as unproven, so the cap can lose
  puzzles and can never invent one.

New files: `scripts/gen-puzzles.ts` (mines 2,451 real positions from 90 bot games
at two strengths, proves candidates, writes and then re-verifies the file it just
wrote by re-parsing it), `public/puzzle-data/puzzles.json` (71 puzzles, 266 KB,
37 distinct handicaps, no winning card used more than twice),
`src/lib/puzzles/{types,solve,daily,session,useCorpus}.ts`,
`src/components/puzzles/{PuzzleBoard,PuzzleRunner}.tsx`,
`src/app/puzzles/{page,layout,loading,error}.tsx`,
`src/app/puzzles/_components/PuzzleStates.tsx`,
`src/app/puzzles/[id]/{page,layout,loading,error}.tsx`.

Route surface: `/puzzles` is the daily (deterministic from the UTC date, so every
player worldwide is on the same one and no backend is involved; `?date=` opens an
earlier day) with the corpus folded behind a disclosure; `/puzzles/[id]` is any
single puzzle, shareable. Both carry a self-canonical, a `loading.tsx`, an
`error.tsx` and exactly one `h1`.

Small additions elsewhere: "Daily puzzle" in the Play nav menu and `/puzzles`
mapped to that section (`src/components/SiteHeader.tsx`); `/puzzles` in the
sitemap at daily change frequency (`src/app/sitemap.ts`).

The board is a new lightweight component rather than `Board.tsx`: a puzzle needs a
position, a click and an answer, and the match board would drag framer-motion and
the card database into a route whose job is to load fast for a search visitor.
Its squares are focusable `gridcell` controls with spoken names, so the route is
playable from the keyboard (verified), which `Board.tsx` still is not (X1).

Verified in a browser: solving and failing all three formats, an illegal-under-
the-rule move answered in the rule's own words, the daily stable across two loads
and different on six different dates against an independent implementation of the
selection, all five system states (loading, empty, error plus a working Retry,
disconnected, recovered), keyboard-only solving, reduced motion, mobile at 390px
with no horizontal scroll, and the unknown-id empty state.

---

## 2026-09-07 13:40 UTC

Two things: a stale-live-state fix with the 13px type floor behind it, and the
root cause of `amazon_army`'s -25.

### The connection banner, and where a connection banner is a lie

`design-system.md` section 8 asks every async surface for five states. The gap
audit said 18 routes were missing "disconnected" and "recovered". One got them.

The line drawn: states 1-3 (loading, empty, error) apply to any fetch. States 4
and 5 presuppose a *connection*, something repeating or persistent that can drop
and come back on its own. A route that fetches once can only error, and its
recovery is the reader pressing Retry, which is state 3 and already there. A
banner on such a route narrates a socket that does not exist.

`/inbox/[username]` was the real case: it polls every 5s, and its failure path
was `if (!loaded) setLoadError(true)`, i.e. **silent after the first successful
load**, so a dead connection looked like a quiet conversation.

`ConnectionBanner.tsx` was refactored so the phase machine and the pill are
shared and the signal source is pluggable: `ConnectionBanner({session})` is
unchanged for game and TV, new `PollConnectionBanner({healthy})` for polled
routes. Section 8.5's "silent when fast (under 2s)" is now honoured, which the
original did not do, so a sub-2s blip no longer flashes red then green.

The 17 skips, each with its reason, are in the round-6 report. The one worth
repeating: `/tournaments` has a `setInterval`, but it is a purely local 1s clock
tick that re-buckets rows, so the page *looks* live while its data is a one-shot
snapshot. Its staleness is by design; a banner would promise self-healing that
does not happen.

Verified in a browser across a full cycle: lost pill with a live counter,
`role="status" aria-live="polite"`, "Reconnected" on recovery, auto-dismiss.
The message bubble and the unsent composer draft both survived the outage.

### The 13px floor

Same probe over 42 routes, guest signed in.

| | before | after |
|---|---|---|
| sub-13px elements with their own text | 942 | 671 |
| of those, in an interactive context | 312 | 151 |

Biggest movers: `/codex` 186 to 66 (interactive 181 to 61), `/achievements` 327
to 208 (18 to 1), `/` 38 to 23 (20 to 6).

Fixed as body or interactive text: 102 achievement descriptions, 60 codex card
descriptions, 60 codex Copy buttons, and 48 `Button`/`LinkButton` and raw
`button`/`a`/`Link`/`summary` call sites whose `className` overrode the
primitive's own 13px with `text-xs` (Resign, Draw, Takeback, Abort, Accept,
Decline, Claim win, Confirm, four Retries, Reload, Mark all read, Send, View
all, Watch, Post). Also the home page's **local duplicate `SiteFooter`**, which
had drifted to 12px with no tap target while the shared one was already
13px/44px.

Left at 12px, as labels rather than body: rarity and tier chips, the header
Guest badge (it qualifies the username; the button's accessible name is the
username), the Bullet/Blitz/Rapid speed chips, 104 progress counters, 64 board
coordinates, 30 `/updates` timestamps, form labels, `kbd` hints, and On/Off
inside the privacy switch (a state readout, and 13px does not fit a 72px
control).

Every touch-target fix went behind `[@media(pointer:fine)]`, never `sm:`,
including `src/app/lobby/page.tsx`, which was tightening to 34px behind `sm:`
and so handed 34px targets to every tablet.

Two left for a decision: `.rule-ornament` in `globals.css` is a 12px uppercase
letterspaced section rule, and section 3 retires that device in favour of a
plain bold heading at body size, but restyling a shared ornament is not a type
fix. And `DraftOverlay.tsx:1796` has a 12px Skip button.

Also: `sr-only` `h1` added to the in-flight branch of `/clubs/[slug]` and
`/tournaments/[id]`. Frame-by-frame over a client-side navigation, 63 samples in
4s at 1920: zero frames with no `h1`.

### A6: `amazon_army` root-caused, and the hypothesis that was wrong

Round 5 left this open with a named hypothesis and the experiment that would
settle it. The experiment was run and the hypothesis was **wrong**, which is
worth as much as the answer.

`pickAIMove` now takes an optional write-only `SearchStats` reporting the
deepest ply it actually completed and the root move count, so "the bot played
worse while holding this" and "this card is bad" can be told apart. The guess
was that a 43% wider tree buys fewer plies out of the bot's 60ms floor budget.
Measured: depth 3 to 3 at medium/60ms, 3 to 3 at medium/700ms, 3 to 3 at
hard/60ms, 4 to 4 at hard/700ms. **Zero plies lost at every level and budget.**
Alpha-beta with move ordering absorbs the width, and `medium` is capped at
`maxDepth: 3` anyway, so 60ms was never the binding constraint.

The real mechanism is worse. `negamax` and `quiesce` take a bare `BoardState`.
Only the root calls `legalMoves(game)`, and `legalMoves` is the only place
`def.augmentMoves` runs:

```
ply 0   legalMoves(game)      57 moves, 17 of them granted by the card
ply 1+  generateMoves(board)  42 moves, 0 of them granted by the card
```

Both lines are the same position, two of White's turns into a three-turn card.
The bot plays a move that exists **only** because of the card, then evaluates
every follow-up as if the piece were an ordinary knight. It cannot see a plan
needing the buff twice, cannot see the opponent's buffed replies at all, and
never models expiry in either direction. Holding a move-granting card makes the
bot's own move real and its picture of the future false, which is worse than not
holding it. That is enough to turn a strictly-additive card negative.

It is not one card. It is every move-granting card in the library. **Do not
retier one downward on win-rate evidence** until the search is fixed.

Not fixed here, deliberately: the per-node augment closure has three hazards and
the second is disqualifying for an unsupervised change. `makeBuffApi` captures
`game.board` by value, so a per-node augment means rebuilding a 20-closure
object per node or mutating a shared one. Not every `augmentMoves` generator is
board-pure, and one touching `api.rng` would advance the game's RNG stream once
per searched node, which is what `test:desync`, `test:snapshot` and
`test:spectator-sync` exist to catch and would corrupt live games rather than
mis-score them. And applying the augment at every ply ignores expiry, so a
12-ply `hard` search would over-value a three-turn card instead of
under-valuing it.

New guard `npm run test:search-buffs`
(`scripts/test-search-buff-visibility.ts`) is a known-issue lock, not a red
guard: it states the defect, pins its size at 17 granted moves in a fixed
position so the file cannot quietly stop measuring anything, keeps the refuted
depth hypothesis refuted, and inverts its own message the moment the search
starts seeing buffs. Verified to fail when the pin is moved by one.

---

## 2026-09-07 15:10 UTC

Round 7. The search-blindness finding confirmed from the data, the board made
keyboard-playable end to end, `/settings` given a real URL, and a measurement
harness caught measuring the wrong thing twice.

### A6 confirmed from the win-rate data, by the interaction it predicts

Round 6 established from the source that `negamax` cannot see buff-granted
moves below the root. `scripts/analyze-search-bias.ts` asks whether that leaves
a fingerprint in the 617 measured cards. It is a harder question than it looks,
because the obvious comparison proves nothing: move-granting cards do measure
below everything else (+2.6 against +5.8, widening to -19.1 at t7), but at
those tiers the comparison group is mass-removal and spawn cards which are
genuinely enormous.

The obvious test fails too. If invisible moves alone made a card measure badly,
the residual would scale with the grant. It does not (1.2 sigma), and a
threshold split PEAKS at 12 granted moves and decays above it, which no real
dose-response does. The three largest grants in the library are `warp_step`
(108 moves), `overclock_major` (39) and `reposition` (37), with residuals -8.6,
-5.1 and **+19.4**. Those should be the worst cards on the board.

The reason is in their text: "once", "for 1 turn". A card spent on the turn it
fires cannot be hurt by a search that forgets it one ply down, because there is
no future left to get wrong. A card that lasts three turns is wrong about every
ply it searches. So the defect predicts an interaction, not a main effect.

| | slope, points per granted move | sigma | n | r2 | mean residual |
|---|---|---|---|---|---|
| expires in 2 to 4 turns | **-1.26 +-0.28** | **4.5** | 20 | 0.53 | -6.1pt |
| never expired in the probe | -0.38 +-1.04 | 0.4 | 6 | 0.03 | **+10.1pt** |
| spent on the turn it fires | -0.05 +-0.09 | 0.5 | 18 | 0.02 | -1.2pt |

Duration alone is 0.3 sigma and grant size alone is 1.2 sigma. The signal lives
entirely in their interaction. The permanent row is the third leg and it
sharpens the story: no expiry to miss, and a buffed root on every move of the
game rather than two or three, so the search's wrongness never has to be cashed
into a plan. **The penalty is worst exactly where a card demands a multi-turn
plan**, which is the one thing a search that forgets the buff after one ply
cannot build.

`amazon_army` grants 17 moves over three turns: 1.26 x 17 is about 21 points
against a measured -25.

Section 1c of the balance pass now holds a tier FLOOR for all 26 affected
cards, so a later blanket wave cannot cut one on numbers that are an artefact
of the instrument. The asymmetry is deliberate: the bias only pushes
measurements down, so a card here that still measures well may be raised
freely. The block retires when A13 lands.

The ladder was checked for contamination and cleared. The biased cards carry no
material, so they sit in the M=0 baseline the tier floor is fitted against;
excluding all 26 moves that baseline from +3.99 to **+4.06**. A6 corrupts one
family's per-card readings and does not reach the ladder.

One measurement trap, recorded because it inverted the answer on the first
attempt: probing a card's duration by playing QUIET moves reports a "once" card
as permanent, because its charge is spent by playing the granted move, not by
taking a turn. The probe has to play the card's own moves.

### A8 closed: the pocket discount is not backwards

The plan said "measure the family, then move the multiplier". The family was
measured and the multiplier stays. Pocket cards sit at **+1.1pt** residual
against their own tier (n=13); the other 71 material-carrying cards sit at
**+7.3pt**; the difference is **-6.3 +-5.0pt, 1.3 sigma**, in the opposite
direction to the hypothesis and unresolvable either way.

The hypothesis came from one row, `bn4_care_package` at +41.7 +-14.9, which is
the top of a spread reaching down to `legendary_forge` at -16.7. Those two
carry the same payload class and sit 58 points apart on 12 pairs each. That is
the error bar, the same one round 1 found between `legendary_forge` and
`bodyguard`. The mechanical argument for the change is still good and the sweep
may simply not resolve 5%, but repricing a whole family on the largest number
in a noisy column is the failure mode the model exists to avoid.

### The sweep was measuring touch targets with a mouse

The 44px rule is about a finger. Playwright's default context is a desktop
mouse, so `pointer: fine` matched, so every `[@media(pointer:fine)]:min-h-*`
step-down applied, so a control CORRECTLY fixed to 44px-on-touch was still
counted as a defect. On one tree that is **258 findings at 360 with a fine
pointer against 81 with a coarse one.** The fine number is not a stricter
version of the right answer; it is an answer to a different question, and
`sweep-baseline.json` had been encoding it.

Two more things were wrong with the same check. It ran only at widths <= 390,
so the whole 768 to 1024 tablet band went unchecked, and a 1024px tablet is a
coarse pointer with no keyboard. And it read its numbers off the same per-cell
report as everything else, so the pass was tied to the theme loop even though a
hit area does not change colour.

Now: one pass per route, in its own `hasTouch: true` context, across 360, 390,
768 and 1024, theme-independent. Measured after: `/guide/glossary` goes 19
touch-target findings to **0** (those controls were fixed and the sweep was
still reporting them), `/play` goes 8 to 16 (four real defects, now also seen
at 768 and 1024) and then to **0** once they were fixed.

CDP looked like the cheap way to do this and does not work: with
`Emulation.setEmulatedMedia` sent `{name:"pointer", value:"coarse"}`,
`matchMedia("(pointer: coarse)")` still reports false. A sweep built on it
would have gone on reporting fine-pointer numbers under a coarse-pointer label.
Both paths were measured before the change was written.

The inline-in-prose exemption was too narrow for the third time. It was
`tagName === "A"` (241 false positives), then a `closest("p, li, ...")` list,
which missed "New here? [Take the tour]: a guided first game" because that
sentence lives in a `<span>` inside a `role="note"`. It now tests the property
itself: does the control sit among real text in its own parent? Whitespace
between two nav links does not count.

### The board is playable without a pointer, and reachable on a phone

`BoardTools` (flip, `f`, a shortcuts sheet) was already on `/game`, but the rail
is `hidden sm:grid`, so at 360 the flip button measured **0.0 x 0.0**: a phone
had a keyboard shortcut and no button, which is the whole of what the backlog
item complained about. `FlipBoardButton` is extracted (button only, no keymap,
so a second mount cannot double-bind `useBoardKeys` and turn `f` into a no-op)
and placed in the mobile player strip, exactly complementary to the rail. Now
44 x 44 coarse at 360/390/768/1024 and 36 x 36 fine.

Keyboard play was already correct and is now measured rather than assumed: a
real move lands on board state (`sq12` white pawn to `sq28`) at 1440 fine and
390 coarse, in both orientations, and the arrow keys move in SCREEN space
(`ArrowRight dx=+87.1 dy=0` with either colour at the bottom), with exactly one
`[tabindex="0"]` per board. `f` is also bound on `/analysis`, locally, because
its flip is local state and must not write the global `flipBoard`.

The last `role="lead"` is gone (it was in `src/app/dev/plays/PlaysGallery.tsx`,
latent rather than live, one `{...props}` from the DOM), and the `/analysis`
nav buttons went from 31.5 x 31.5 to 44 x 44 on coarse pointers at every width.

`/game/[id]` served no `h1` while connecting, which is where a nonexistent game
id sits until the socket gives up. Every terminal branch had one. Fixed, and
measured across 14 samples over 5.6s: zero frames without an `h1`.

### Touch targets, by shape

The wordmark link was 147.3 x **34** on every one of 39 routes: 37 of the 81
coarse findings were that one control. New shared `Breadcrumbs` and
`SearchInput` primitives replace one hand-rolled breadcrumb (19.5px) and four
hand-rolled search boxes (19.5 to 40.5px); the min-height goes on the INPUT,
not the wrapper, because a 44px box around a 19.5px field is not a 44px target.

Two defects the route sweep structurally cannot see, found by hand: the desktop
nav dropdown rows are 194 x **35** and only exist while hovered, and the band
where they ARE the navigation is 768 to 1024, which is a tablet; and the header
icon buttons are `w-[44px]` flex items with no `shrink-0`, so a long generated
username squeezed all of them to **43.2px** on 34 routes in one probe run and 0
in the next. An intermittent 44px violation is the worst kind.

Coarse-pointer findings, same probe both times, 39 routes: **81 to 20 at 360**
and **122 to 29 at 1024**. The 1024 re-run is the proof that no width
breakpoint was used as a pointer proxy.

The home page's local `SiteFooter` copy had the height fixed and the WIDTH
never was, so "FAQ" was a 24.7px-wide target that happened to be 44px tall. The
padding cannot come out of the existing 16px gap without neighbouring hit areas
overlapping, and no padding that fits inside that gap gets a 24.7px word to 44,
so on a coarse pointer the links take their padding and the gap shrinks to
compensate, and on a fine pointer both revert exactly. Measured: six links all
44px+ at 360 coarse with zero overlaps across two wrapped rows, and byte-identical
geometry at 1440 fine.

### `/settings` is a real route

Settings lived only in a panel opened from the header, so they were not
linkable, bookmarkable or deep-linkable. `/settings` and `/settings/<section>`
now exist, and the deep link is a PATH segment rather than a fragment: a path
reaches the server, so a section gets its own title, its own canonical, browser
history, and a real 404 for an unknown name.

Sync is structural rather than copied. The entire settings surface moved out of
`SettingsPanel.tsx` into `src/components/settings/rows.tsx` (the model, the one
switch over `Control.kind`, every picker, the row layout), leaving the panel as
dialog chrome only: **901 lines to 178**. Both surfaces read the same config and
the same controls, and the model subscribes to `SETTINGS_CHANGED_EVENT`, so a
write on either lands on the other with nothing passed between them. Verified
both directions, including a route row flipping live behind the open modal.

Two measured trade-offs. `/settings/nope` returned **200 plus a soft 404** at
first, because a `loading.tsx` puts a Suspense boundary above the section route
and `notFound()` then fires after the shell has started streaming. Moving the
index into a `(all)` route group scopes that boundary to `/settings` only:
measured 200 before, **404 after**, with the specific 404 UI intact.
`dynamicParams = false` also gave a 404 but discarded the specific UI. And
`/settings#appearance` did not scroll, because the browser resolves the
fragment while parsing, before the rows exist behind the hydration gate:
measured `#appearance` at 2680px down with `scrollY: 0`, and after the fix
section top 14px, `scrollY` 2681.

### 404s, and one route that was 404ing on every load

`src/app/not-found.tsx` plus segment boundaries for `/u/[username]`,
`/game/[id]`, `/tournaments/[id]` and `/settings/[section]`. Each says what was
not found in that thing's own words: "No player by that name", "No game with
that id". All five measured at 360 and 1440, dark and light: 404 status, one
`h1`, zero overflow, zero sub-44px targets.

`/api/lobby` was 404ing twice per load on 8 routes under `next dev`:
`lobbyClient.ts` fetches it and only `worker.ts` served it. A handler now
exists, rather than teaching the client to swallow a 404, because a deaf client
would also go quiet on a real routing regression in production. Production is
untouched: the worker matches `/api/lobby` before falling through to Next, and
the handler returns 503 under `NODE_ENV=production` rather than inventing an
empty lobby on a live site. Lobby-related console errors per load: **4 to 0**.

### Board feel, measured

`e2e/feel.spec.ts` plays a real game and puts numbers on what a player notices.
What is already right, now pinned so nobody "fixes" it: legal-move dots appear
**50 to 79ms after pointerdown**, not pointerup, which is the Lichess behaviour;
a move commits in **171 to 272ms** with origin and destination updating in the
same frame; the easy bot replies in **807 to 826ms** including any draft its
move triggers; the clock reads `5:00` on a five-minute game and `0:08.0` inside
the emergency band.

Three findings filed. Every buff game opens with a modal over the board for
about **4.6 seconds** (4571 / 4577 / 5258ms across three runs) before a move is
possible, because the cards are not interactive until the deal finishes. Draft
cards carry no `aria-pressed` or `aria-selected`, so the only signal a card is
chosen is the commit button renaming itself. And badge spans concatenate with no
separator, so a card announces as "Walking Pace,
PleaseMovementPassiveITrivialOnce, your a-file..." and the live region as
"black knight g8 to f6 | Special OrderIBot played a buffYour next draft is
dealt from tier 2."

### Notes for the next session

Six verification probes were wrong before the code was, every one of them
because the probe measured the wrong thing rather than because the measurement
was hard. The board's squares carry `data-sq` as a numeric index and are
addressable only by `aria-label`. Draft cards are inert until the decision
timer appears, and clicking early silently does nothing. The commit button
renames itself on selection, so matching its first label waits forever. `t` is
SECONDS per side, so `t=1` is a one-second game. The clock digits change size
deliberately between phone and desktop, which reads as a broken arbitrary value
if you check the computed size without the classes. And an overlap check that
sorts hit areas by `left` reports a false positive the moment the row wraps.

`next dev` leaks: after about seven hours it held **9.1 GB resident**, 57% of
the box, and was the whole of a near-OOM this round. Killing it took available
memory from 1.1 GB to 12.9 GB in three seconds, before anything else was
touched. Check `ps -eo rss,args --sort=-rss | head` before blaming the workers.
When memory does get tight, `pkill` and `pkill -9` themselves fail or return
144, and `pgrep -f pat | xargs -r kill -9` works where `pkill -f pat` does not.

### Contrast, and the variants that were never re-tinted for paper

`--bg-zebra` in dark had drifted to 19% lightness, ABOVE the 18% raised rung,
so a tinted table row was lighter than a modal. That was the single largest
contrast failure on the site: `parchment-400` measured **4.44:1** on it across
269 rendered elements (codex rows, lobby chips, every glossary disclosure). Now
16%, measuring 4.96.

The worse class of bug was in the light theme. The five
`html[data-light] .text-parchment-*` rules match only the BARE class, and
Tailwind compiles `hover:text-parchment-100` and `text-parchment-400/60` to
their own class names, so **none of the 78 hover call sites or the three alpha
modifiers was ever re-tinted for paper.** They kept the dark ramp on white.
Driven with a real mouse over real elements, the header "Sign in" link measured
**1.03:1 on hover** in light, and a `/tv` icon button 1.71:1. Both are now over
13:1. The new rules were read out of the compiled bundle rather than guessed at,
so they cover every spelling Tailwind actually emits.

Also: `html[data-light] ::placeholder` outranks all 13
`placeholder:text-parchment-*` utilities, so it alone decides placeholder colour
on paper, and it was hard-coded to a colour measuring 3.14:1. And light `--brag`
was a 48%-lightness brass used as text, at 2.93:1 on both page and panel.

Sitewide AA failures, same probe over 22 routes: **dark 390 to 130**. Light went
238 to 210, and the small delta is honest rather than flattering: all 34 brag
dates went, and the seven apparent new failures are one pre-existing element
appearing on more routes because the second session was signed out. No element
class regressed in either theme. The surface ladder is still strictly ordered
(dark page 0.0075 < panel 0.0178 < zebra 0.0225 < raised 0.0286 < hover 0.0413).

C31 closed as a clean negative with evidence: `--bg-hover` has **zero permanent
consumers**. All eight uses sit behind a `hover:` variant, `--surface-hover`
(the token 20 call sites actually spell) resolves to `--bg-raised` instead, and
the real-pointer table shows every one of them lifting its text on hover rather
than leaving muted text resting there. The documented 3.94:1 is never a resting
state.

### The button rule that was replacing heights, not raising floors

The `@media (max-width: 640px)` button min-height flagged during the round is
now a pointer query, plus an unconditional 36px for the other half of the same
defect: section 7 asks for 36px on a mouse and those sites measured **29.5px at
every fine-pointer width**, which the width query had only ever hidden below
640.

Two things the measurement caught that would otherwise have shipped:

- A plain `.btn-ghost { min-height: 44px }` has the same specificity as
  Tailwind's `.min-h-[52px]` and comes later in the bundle, so it does not raise
  a floor, it **replaces a height**. The home and lobby primary CTAs went 52px
  to 45px. The old width query had been doing exactly that to phones all along.
- A blanket `:not([class*="min-h-"])` then dropped the home page's two "Play"
  chips from 44px to 36px on touch, because they pin themselves to
  `min-h-[36px]`. The exclusion now names only the sizes that already clear the
  floor.

Matrix over 7 routes x 4 widths x 2 pointer contexts: coarse at 768/1024/1440
goes from a 29.5px minimum with 11 controls under 44 to **44px and zero**, fine
goes from 29.5 to 36 with zero under 36. 80 buttons grew and 17 "shrank", every
one of the 17 confined to fine@360, which is a mouse in a 360px window and
exactly the case the width query was wrongly treating as a phone. Zero
horizontal overflow in any of the eight contexts, before or after.

### What was deliberately left, with numbers

The largest remaining contrast block is the tier chips: dark tier-8 at
**3.26:1** across 32 elements on `/codex`, light tier-9 at **1.42:1** across 18,
and the `/achievements` rarity chips in light at 1.58 to 3.01. All are 12px, so
4.5:1 applies. The fix is either a per-theme tier palette or a change to the
`.tier-bg-*` fill alphas, and both are design-system decisions the doc pins
("Card tiers everywhere, no exceptions"). Getting one wrong is visible on every
card in the game, so it wants an owner rather than a unilateral edit.

The 12px absolute floor moved 54 source sites to 34, and the RENDERED count did
not move at all: 24 per theme before and after. All 24 are the same six
`ModShell.tsx` rail labels at 11px repeated across four `/mod` routes, and every
site fixed sits on a state the crawler cannot reach (the error boundary, page
bodies behind auth, in-game card overlays, and one component with no importer).
It cannot move until `ModShell.tsx` does.

### The sweep, re-run against a coarse pointer

A full 47-route sweep at six widths and three themes, with the touch-target
pass rebuilt, and `e2e/sweep-baseline.json` regenerated on it. **26
touch-target findings across the whole site**, down from a baseline that
encoded hundreds of fine-pointer measurements. Zero `h1`, overflow, focus,
contrast-token and system-state findings in the entire run.

Chasing the last of them turned up four more detector gaps and four more
half-fixes, all the same shape as the rest of the round:

- `RailResizeHandle` measured 3.5px wide while its own comment said it had "an
  oversized invisible hit area". It does: `<span class="absolute inset-y-0
  -left-1.5 -right-1.5">`, a CHILD rather than a pseudo-element. The detector
  now unions in absolutely-positioned children of the control itself, which is
  the more common spelling of the same pattern. It also exempts
  `role="separator"`: a drag gutter is not a tap target, and a 44px one would
  be a 44px stripe of dead space between two panels.
- The move strip's SAN buttons were 33.9 x **44**: height fixed, width never
  looked at, on the control you scrub a game with on a phone.
- `PlayerLink` was 66.1 x 18 everywhere it appears, which is every player name
  on the site outside running prose.
- The `/tv` channel switcher (30px), the `/analysis` FEN field (30.5px), the
  `/achievements` signed-out call to action (41.3 x 19.5), and a FOURTH copy of
  the 16px range shape, this one the in-game effects slider, where a mis-drag
  costs a turn.

`/settings`' filter now goes through the shared `SearchInput` rather than being
a sixth hand-rolled search box. Its 44px floor was already right; four of the
others were not, and one of each is the point of the primitive. It gains a
clear button it did not have (verified 44 x 44 at 360 with the filter and the
empty state both working).

28 findings remain, on three routes, and they are named in the backlog.
`/tutorial/first-game` is flaky by nature: its findings differ run to run
because the game state differs, so it needs a seeded position before its count
means anything.

---

## 2026-09-07 17:30 UTC

The bot's search can see buff-granted moves now. Landing it refuted three
things this session had written down as established, so those come first.

### The RNG hazard did not exist, and it was the one called disqualifying

Round 6 declined to attempt this fix and gave three reasons. The second was
that a generator touching `api.rng` "would advance the game's RNG stream once
per searched node", corrupting live games rather than merely mis-scoring them.

`api.rng` is `fxRng(game, me)` (`game.ts:879`), which builds a **fresh** RNG on
every call, seeded from the board signature, the ply, the colour and a digest
of the public card state. There is no persistent stream to advance. The note
predated that redesign and was never checked against it.

A purity audit of all **283** cards defining `augmentMoves`
(`npm run audit:augment-purity`, which drives each hook through a
Proxy-instrumented `BuffApi` against a before/after snapshot in three
positions) found **zero** RNG draws, **zero** board-mutator calls and **zero**
unstable outputs.

It found a real hazard nobody had named: **10 cards write `inst.state` from
inside `augmentMoves`.** `lossyAugment` sets `inst.state.armed` and
`dryad_grove` sets `inst.state.offered` when the move is merely on offer, so
per node that would arm a live card off a hypothetical position and burn its
charge in the real game. The ten are `dryad_grove`, `ghost_legion`,
`op_colts_gallop`, `op_drawbridge_in`, `op_fire_escape`, `op_freight_elevator`,
`op_grand_march`, `op_old_post_road`, `op_palace_gate`, `op_viziers_errand`.

### The fix

`buildSearchBuffs` / `applySearchAugments` in `game.ts`, `genMoves` replacing
`generateMoves` inside `negamax` and `quiesce` in `ai.ts`.

The impurity is handled structurally rather than by an allowlist, because 71 of
the 283 hooks never produced a move in any probe position and are therefore
**unproven, not proven pure** -- an allowlist would have been a guess about
those. Instead the search runs against a private view: cloned instances, cloned
match state, cloned captured pools and player slots. A generator that reaches
for a mutator writes into a throwaway. It can mis-score a search; it cannot
reach the game.

Expiry is modelled rather than ignored, which was the third hazard. The side to
move at ply p has played `p >> 1` of its own moves, which is exactly what
`tickTurns` would have decremented, so per-ply instances carry pre-aged
counters and drop out when they expire. Charge-limited augments (133 of 283)
carry a bit in a mask threaded down each line, so playing the granted move
stops it being offered deeper.

Allocation was the second hazard and the answer was two `BuffApi`s per SEARCH
rather than per node, over mutable view games, retargeting only `.board` per
node.

### It costs a ply, and that is not buried

| card | level | budget | depth | nodes | ms |
|---|---|---|---|---|---|
| none | medium | 60ms | 3 to 3 | **identical (10479)** | -10 |
| `amazon_army` | medium | 60ms | **3 to 2** | -4% | +27 |
| none | medium | 700ms | 3 to 3 | **identical** | -15 |
| `amazon_army` | medium | 700ms | 3 to 3 | +65% | +58 |
| none | hard | 2000ms | 5 to 5 | **identical (523739)** | -707 |
| `amazon_army` | hard | 2000ms | **5 to 4** | +31% | +241 |

One ply at the 60ms floor and one at hard's 2000ms, for a holder of a
move-granting card. Zero cost otherwise, proved by identical node counts. The
fixed-depth decomposition says where it goes: nodes 1.61 to 1.65x,
microseconds per node 0.99 to 1.06x. Essentially all of it is the genuinely
wider tree and none is augment overhead.

### The null, which corrects the round-7 claim

A paired A/B, same seeds, White holding the card in BOTH arms and only its
searcher differing (`npm run test:search-buff-strength`):

| card | pairs | buff-aware minus blind |
|---|---|---|
| `amazon_army` (3 turns) | 120 | **-0.9 +-3.6 pt** (0.2 sigma) |
| `twin_knights` (permanent) | 80 | -4.4 +-4.8 pt (0.9 sigma) |

The arms diverged in 33% of pairs, so the design had signal capacity. Round 7
scaled the observational interaction to about **21 points** for `amazon_army`
(1.26 x 17 granted moves). At +-3.6 this had the power to see 21 points and
did not.

**The code defect was real and is fixed. The causal story attached to it is not
confirmed.** The 4.5-sigma interaction is still in the data and still wants an
explanation, but "the search cannot see the card" is no longer that explanation
on the strength of a direct experiment. Worth testing before anyone believes
the interaction again: timed multi-turn cards with large grants may simply be
designed weaker, and the two harnesses differ (this one grants the card after a
random 8-ply opening, the win-rate harness grants at ply 0 from the standard
start), which is a real difference rather than a dismissal.

The project's own harness at its recorded settings moved `amazon_army` **-25.0
to -20.8**, `onslaught` -4.2 to -4.2, `twin_knights` +25 to +12.5, all inside
its own +-9.7 error bar, so it cannot resolve this either.

**The section 1c tier quarantine stays.** It says "retire when A13 lands", and
A13 has landed, but the family has not been re-measured and the honest reading
is that the bias is smaller than believed rather than absent. Retiring a guard
on an unmeasured assumption is the thing the guard exists to prevent.

### And the test could never have reported success

`test-search-buff-visibility.ts`'s success branch was unreachable by
construction: assertion 1 required `generateMoves` NOT to return granted moves,
while assertion 2's victory branch required exactly that. It could report the
defect and could never report the fix. Rewritten to drive `buildSearchBuffs` +
`applySearchAugments`, which is what `negamax` actually calls, with an expiry
assertion (live at plies 0, 2 and 4; gone at 6) and the depth cost pinned at
its measured size rather than asserted to be zero.

Guards: `test:desync` (sample hash `5579b1a5`, unchanged), `test:snapshot`,
`test:spectator-sync`, `test:apex`, `test:lab` (2112/2112), `test:rules`,
`test:balance-pass`, `test:ai-activation`, `test:search-buffs`.

Still invisible below the root and out of scope: nerf filters, shields, walls
and zone effects. `analyzeBoard` stays buff-free, since it is deliberately
plain-chess analysis over a bare board.
