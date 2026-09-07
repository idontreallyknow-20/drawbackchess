/// <reference types="@cloudflare/workers-types" />

// House players: a fixed roster of engine-driven accounts that keep the queue
// warm so a new player always finds a game. They hold real user rows (rated
// games, profiles, and the leaderboard work unchanged), sit in the two queue
// pools as seeks, pick up humans who queue, and occasionally play each other
// so the lobby and TV never look dead. They present exactly like regular
// players (their accounts still hold "_flower" avatar preset ids as an
// internal marker, but no visible mark is drawn from them anymore).

import { pickAIMove, defaultSearchShape, type AILevel, type WeakenParams } from "../../engine/ai";
import { moveToUCI } from "../../engine/board";
import { legalMoves, type NerfGame } from "../../engine/game";
import { triggersOwnNerfLoss } from "../../engine/moveSafety";
import type { DraftMode } from "../../engine/buff";
import type { Color, Move } from "../../engine/types";
import { HOUSE_PFP_IDS, HOUSE_PFP_NAMES, HOUSE_PFP_PREFIX } from "../avatars";

// Absolute ceiling for a house-player search running ON THE DO ITSELF (local
// fallback, when the OCI engine is off/unreachable/version-mismatched). The
// Durable Object is single-threaded: while a search runs, no socket upgrade,
// move, or lobby poll is answered. 80ms per action, paced 1-4s apart and
// serialized (never two searches in one tick), keeps the thread effectively
// free. Never raise this without load-testing the DO — it's the default
// ceiling every caller gets unless it explicitly passes a higher one (only
// the OCI engine service does, since search there costs the DO nothing).
export const HOUSE_SEARCH_CEILING_MS = 80;

// Skill tiers. Below 1750, strength comes from search budget and blunder
// probability, not deep search. At 1750+ the budgets below are what the OCI
// engine service actually searches with (idle box CPU, no DO thread at
// stake); a local DO fallback still clamps every one of them down to
// HOUSE_SEARCH_CEILING_MS via houseMoveBudgetMs's default ceiling, so a
// remote outage degrades to the old capped strength rather than stalling the
// DO. Roughly geometric growth: each rating step needs increasingly more
// search time for the same strength gain (diminishing Elo per ply).
//
// BUDGETS ARE NOW WALL TIME, AND THAT IS WHY THESE NUMBERS DOUBLED.
//
// This block used to say negamax's timeout fires at `budget * 2`, so actual
// wall time ran 1.5-2.5x the nominal budgetMs, and these tiers were sized
// around that hidden multiplier. As of the 2026-09 deadline change negamax
// hard-deadlines at the number the caller asked for: measured over 27 midgame
// positions, wall time is 1.0-1.1x the ask at every budget, where it had been
// 2.0x in 52 of 54 samples.
//
// So every tier here was DOUBLED, and the real think time is unchanged. Only
// the label moved. That was measured rather than assumed: at an equal wall
// ceiling the hard deadline reaches the same depth (asked 120 at 1x reaches
// depth 3.1, exactly what asked 60 at 2x reached), so the old headroom was
// buying nothing except an unpredictable number at every call site.
//
// The slowest tier (2200) is now a BOUNDED ~1.8s plus network rather than a
// measured 1.8-2.25s, which is more margin below the Worker's 3000ms
// HOUSE_ENGINE_TIMEOUT_MS than before, not less.
//
// Two ceilings gate these and both had to move together:
// engine-service/server.ts's REMOTE_SEARCH_CEILING_MS (900 -> 1800) and
// WEAKEN_CLAMP.budgetMs below. Either one alone is harmless -- a ceiling only
// ever clamps down -- so the two can deploy in any order, but the tiers are
// not at full strength until both have.
//
// Still true: measure against engine.nerfchess.com/move rather than
// localhost:8787 before raising any of these. A localhost-only measurement
// understated the old numbers by about 600ms of tunnel and network overhead.
export type HouseSkill =
  | 800
  | 900
  | 1050
  | 1200
  | 1350
  | 1450
  | 1550
  | 1650
  | 1750
  | 1900
  | 1950
  | 2000
  | 2050
  | 2100
  | 2150
  | 2200
  | 2400
  | 2500
  | 2600
  | 2700;

// Baked per-tier profile. The weakening fields are OPTIONAL and every baked
// tier below leaves them unset, so a fresh install resolves to topK:1 / no
// noise — i.e. the exact pre-weakening search. Weakening is applied at runtime
// as a moderator override (app_settings.house_skill_overrides), never baked, so
// it reverts from the /mod dashboard in one click. See docs/bot-weakening-spec.md.
type SkillProfile = {
  level: AILevel;
  budgetMs: number;
  blunderChance: number;
  // --- Optional weakening knobs (see WeakenParams in ai.ts). Unset = default. ---
  maxDepth?: number;
  extendedEval?: boolean;
  topK?: number;
  temperatureCp?: number;
  sampleWindowCp?: number;
  evalNoiseCp?: number;
};

// A profile with every field resolved (no optionals): the shape the engine and
// the moderator dashboard both work in.
export type ResolvedSkillProfile = {
  level: AILevel;
  budgetMs: number;
  blunderChance: number;
  maxDepth: number;
  extendedEval: boolean;
  topK: number;
  temperatureCp: number;
  sampleWindowCp: number;
  evalNoiseCp: number;
};

// 2026-07 strength uplift: every legacy tier's advertised rating moved up a
// deterministic +300..400 (see houseSeedBase), so every tier's REAL strength
// moves with it — more search budget, fewer outright blunders, deeper limits.
// The DO local fallback still clamps to HOUSE_SEARCH_CEILING_MS, so these
// budgets only bite on the OCI engine path; budgets stay within
// WEAKEN_CLAMP.budgetMs and under the worker's 3000ms engine timeout
// (nominal x1.0-1.1 measured wall time since the deadline change — see the
// note above; it was x1.5-2.5 when these tiers were first sized).
//
// The 900-1200 tiers are new with the 2026-07 roster expansion: genuinely
// beginner-strength bots (shallow search, baked move-quality noise, frequent
// blunders) so low-rated humans finally have peers. Their displayed rating
// matches their strength directly (no legacy uplift stack — see houseSeedBase).
export const HOUSE_SKILL_PROFILES: Record<HouseSkill, SkillProfile> = {
  800: { level: "easy", budgetMs: 24, blunderChance: 0.28, maxDepth: 2, topK: 7, temperatureCp: 320, evalNoiseCp: 150, extendedEval: false },
  900: { level: "easy", budgetMs: 30, blunderChance: 0.22, maxDepth: 2, topK: 6, temperatureCp: 260, evalNoiseCp: 120, extendedEval: false },
  1050: { level: "easy", budgetMs: 40, blunderChance: 0.16, maxDepth: 2, topK: 5, temperatureCp: 200, evalNoiseCp: 90, extendedEval: false },
  1200: { level: "medium", budgetMs: 40, blunderChance: 0.12, maxDepth: 3, topK: 4, temperatureCp: 150, evalNoiseCp: 70, extendedEval: false },
  1350: { level: "medium", budgetMs: 120, blunderChance: 0.05 },
  1450: { level: "medium", budgetMs: 180, blunderChance: 0.035 },
  1550: { level: "hard", budgetMs: 240, blunderChance: 0.02 },
  1650: { level: "hard", budgetMs: 400, blunderChance: 0.01 },
  1750: { level: "hard", budgetMs: 600, blunderChance: 0.003 },
  1900: { level: "hard", budgetMs: 760, blunderChance: 0.002 },
  1950: { level: "hard", budgetMs: 960, blunderChance: 0.002 },
  2000: { level: "hard", budgetMs: 1160, blunderChance: 0.001 },
  2050: { level: "hard", budgetMs: 1360, blunderChance: 0.001 },
  2100: { level: "hard", budgetMs: 1520, blunderChance: 0.001 },
  2150: { level: "hard", budgetMs: 1680, blunderChance: 0.0005 },
  2200: { level: "hard", budgetMs: 1800, blunderChance: 0.0005 },
  // The 2400+ band, added with the 2026-07 rating spread so the roster has a
  // credible elite tail (about 10% of it). HONEST LIMITATION: budgetMs cannot
  // usefully climb past 900 today. The remote engine clamps every request to
  // REMOTE_SEARCH_CEILING_MS (engine-service/server.ts), now 1800, and wall
  // time is 1.0x the nominal budget since the deadline change, so 1800 sits at
  // roughly the same real spend these tiers always had against the Worker's
  // 3000ms HOUSE_ENGINE_TIMEOUT_MS. These tiers therefore differ from 2200 only
  // by having no forced blunder at all, which means they ADVERTISE more strength
  // than the engine can currently back. Their live ratings will drift down
  // toward what they actually play, which is the self-correcting outcome. Making
  // them genuinely 2400+ needs a bigger service ceiling AND a raised worker
  // timeout, measured against the public URL first (see the note above).
  2400: { level: "hard", budgetMs: 1800, blunderChance: 0.0002 },
  2500: { level: "hard", budgetMs: 1800, blunderChance: 0.0001 },
  2600: { level: "hard", budgetMs: 1800, blunderChance: 0 },
  2700: { level: "hard", budgetMs: 1800, blunderChance: 0 },
};

// ---------------------------------------------------------------------------
// Skill resolution & runtime overrides.
//
// A moderator tunes strength live by storing a JSON override map in
// app_settings (house_skill_overrides): a partial patch per tier. The DO reads
// it (cached ~15s) and resolves each persona's profile fresh per move, so a
// change reaches live games within a tick without a redeploy. Every numeric
// field is clamped on the way in, and a missing/garbage field falls back to the
// baked value field-by-field, so no stored value can drive the bots into a
// broken (or thread-stalling) search — the worst a bad save does is default
// strength. See docs/bot-weakening-spec.md §4-5.
// ---------------------------------------------------------------------------

// Inclusive clamp ranges for every tunable field. Exported so the engine
// service (which independently re-clamps whatever the DO sends) stays in lockstep
// with these bounds from the shared module rather than a hand-copied constant.
export const WEAKEN_CLAMP = {
  budgetMs: [10, 1800],
  blunderChance: [0, 0.25],
  maxDepth: [1, 12],
  topK: [1, 8],
  temperatureCp: [0, 400],
  sampleWindowCp: [0, 1000],
  evalNoiseCp: [0, 200],
} as const satisfies Record<string, readonly [number, number]>;

function clampField(key: keyof typeof WEAKEN_CLAMP, v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const [lo, hi] = WEAKEN_CLAMP[key];
  // maxDepth/topK are integer knobs; the rest are fine as-is.
  const n = key === "maxDepth" || key === "topK" ? Math.round(v) : v;
  return Math.max(lo, Math.min(hi, n));
}

/** The baked profile for a tier, fully resolved (optionals filled from the
 * level's default search shape). This is the "no overrides" strength. */
export function bakedResolvedProfile(skill: HouseSkill): ResolvedSkillProfile {
  const base = HOUSE_SKILL_PROFILES[skill];
  const shape = defaultSearchShape(base.level);
  return {
    level: base.level,
    budgetMs: base.budgetMs,
    blunderChance: base.blunderChance,
    maxDepth: base.maxDepth ?? shape.maxDepth,
    extendedEval: base.extendedEval ?? shape.extendedEval,
    topK: base.topK ?? 1,
    temperatureCp: base.temperatureCp ?? 0,
    sampleWindowCp: base.sampleWindowCp ?? 150,
    evalNoiseCp: base.evalNoiseCp ?? 0,
  };
}

// Apply a single untrusted patch object onto a resolved base, clamping every
// numeric field and ignoring anything unrecognized. Shared by resolveSkillProfile
// (moderator overrides, keyed by tier) and the engine service (a flat profile
// the DO already resolved and sent). `level` is never overridable — it selects
// eval terms/heuristics and is an engine concern, not a strength dial.
function applyProfilePatch(base: ResolvedSkillProfile, patch: unknown): ResolvedSkillProfile {
  if (!patch || typeof patch !== "object") return base;
  const p = patch as Record<string, unknown>;
  return {
    level: base.level,
    budgetMs: clampField("budgetMs", p.budgetMs, base.budgetMs),
    blunderChance: clampField("blunderChance", p.blunderChance, base.blunderChance),
    maxDepth: clampField("maxDepth", p.maxDepth, base.maxDepth),
    extendedEval: typeof p.extendedEval === "boolean" ? p.extendedEval : base.extendedEval,
    topK: clampField("topK", p.topK, base.topK),
    temperatureCp: clampField("temperatureCp", p.temperatureCp, base.temperatureCp),
    sampleWindowCp: clampField("sampleWindowCp", p.sampleWindowCp, base.sampleWindowCp),
    evalNoiseCp: clampField("evalNoiseCp", p.evalNoiseCp, base.evalNoiseCp),
  };
}

/** Parse the raw app_settings JSON string into an override map, or null. Never
 * throws: an unparseable value reads as "no overrides". */
export function parseSkillOverrides(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Resolve a tier's effective profile: baked default merged with the (clamped)
 * moderator override for that tier, if any. `overrides` is the parsed map (or
 * null); accepts either the parsed object or the raw JSON string. */
export function resolveSkillProfile(
  skill: HouseSkill,
  overrides: Record<string, unknown> | string | null | undefined,
): ResolvedSkillProfile {
  const map = typeof overrides === "string" ? parseSkillOverrides(overrides) : overrides ?? null;
  const base = bakedResolvedProfile(skill);
  return map ? applyProfilePatch(base, map[String(skill)]) : base;
}

/** Re-clamp a resolved profile the DO sent to the engine service. Any missing
 * or out-of-range field falls back to that tier's baked value, so a version-
 * skewed or malformed payload degrades to baked strength, never to a broken
 * search. */
export function sanitizeResolvedProfile(skill: HouseSkill, raw: unknown): ResolvedSkillProfile {
  return applyProfilePatch(bakedResolvedProfile(skill), raw);
}

/** The WeakenOptions params carried into pickAIMove for a resolved profile. */
function weakenParamsOf(p: ResolvedSkillProfile): WeakenParams {
  return {
    maxDepth: p.maxDepth,
    extendedEval: p.extendedEval,
    topK: p.topK,
    temperatureCp: p.temperatureCp,
    sampleWindowCp: p.sampleWindowCp,
    evalNoiseCp: p.evalNoiseCp,
  };
}

/** Every house skill tier, ascending — the unit the dashboard and overrides map
 * are keyed by. Derived from the profile map so it never drifts. */
export const HOUSE_SKILLS: HouseSkill[] = (Object.keys(HOUSE_SKILL_PROFILES) as unknown[])
  .map(Number)
  .sort((a, b) => a - b) as HouseSkill[];

// The tunable numeric fields (level is engine-only, extendedEval is boolean).
const WEAKEN_NUM_FIELDS = [
  "budgetMs",
  "blunderChance",
  "maxDepth",
  "topK",
  "temperatureCp",
  "sampleWindowCp",
  "evalNoiseCp",
] as const;

/** Sanitize an untrusted per-tier patch down to the recognized, clamped fields
 * actually present (sparse — the shape stored in the overrides map). Numeric
 * fields are clamped to WEAKEN_CLAMP; unknown keys and non-finite values are
 * dropped. Used by the /mod save path so stored overrides are always sane. */
export function cleanSkillPatch(raw: unknown): Partial<SkillProfile> {
  if (!raw || typeof raw !== "object") return {};
  const p = raw as Record<string, unknown>;
  const out: Record<string, number | boolean> = {};
  for (const k of WEAKEN_NUM_FIELDS) {
    const v = p[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      const [lo, hi] = WEAKEN_CLAMP[k];
      const n = k === "maxDepth" || k === "topK" ? Math.round(v) : v;
      out[k] = Math.max(lo, Math.min(hi, n));
    }
  }
  if (typeof p.extendedEval === "boolean") out.extendedEval = p.extendedEval;
  return out as Partial<SkillProfile>;
}

// Named preset the /mod "Weakened (50/30/20)" button writes into the override
// map: ~50% of the roster (1350-1900) significantly weaker, ~30% (1950-2050)
// weaker, the 2100-2200 top band untouched (absent = baked).
//
// Calibration note (2026-07-12, scripts/sim-house-bots.ts --roundrobin + the
// control run): mirror self-play SATURATES — two unweakened engines draw every
// game, so any weakening flips draws into losses and even a mild topK:2/temp:60
// tier scored ~4% against an unweakened peer. That test confirms direction and
// monotonicity but cannot resolve the bands or predict strength vs HUMANS (who
// also err). These numbers are therefore a GRADED ramp (subtle at the top of
// the weakened range, clearly weak at the bottom), softened from the first cut,
// not tuned to a self-play win rate. Treat as a starting point: enable, watch
// real rating drift (spec §6), and hand-tune any field live from /mod.
export const WEAKENED_PRESET: Partial<Record<HouseSkill, Partial<SkillProfile>>> = {
  // "significantly worse": reliably beatable by a decent player.
  1350: { blunderChance: 0.08, maxDepth: 3, topK: 4, temperatureCp: 130, evalNoiseCp: 60, extendedEval: false },
  1550: { blunderChance: 0.05, maxDepth: 3, topK: 4, temperatureCp: 110, evalNoiseCp: 50, extendedEval: false },
  1750: { blunderChance: 0.03, maxDepth: 4, topK: 3, temperatureCp: 90, evalNoiseCp: 40, extendedEval: false, budgetMs: 120 },
  1900: { blunderChance: 0.02, maxDepth: 5, topK: 3, temperatureCp: 70, evalNoiseCp: 30, extendedEval: false, budgetMs: 150 },
  // "worse": subtle — the odd inaccuracy, not a handicap match.
  1950: { blunderChance: 0.005, maxDepth: 6, topK: 2, temperatureCp: 45, evalNoiseCp: 18 },
  2000: { blunderChance: 0.005, maxDepth: 7, topK: 2, temperatureCp: 35, evalNoiseCp: 14 },
  2050: { blunderChance: 0.005, maxDepth: 8, topK: 2, temperatureCp: 25, evalNoiseCp: 10 },
};

// A harder preset the /mod "Very weak" button writes: weakens the whole roster
// (including the top band), for testing or a deliberately beginner-friendly
// lobby. Also starting numbers, tunable live.
export const VERY_WEAK_PRESET: Partial<Record<HouseSkill, Partial<SkillProfile>>> = {
  1350: { blunderChance: 0.16, maxDepth: 2, topK: 6, temperatureCp: 260, evalNoiseCp: 120, extendedEval: false },
  1550: { blunderChance: 0.12, maxDepth: 2, topK: 6, temperatureCp: 230, evalNoiseCp: 110, extendedEval: false },
  1750: { blunderChance: 0.1, maxDepth: 3, topK: 5, temperatureCp: 200, evalNoiseCp: 100, extendedEval: false, budgetMs: 80 },
  1900: { blunderChance: 0.08, maxDepth: 3, topK: 5, temperatureCp: 180, evalNoiseCp: 90, extendedEval: false, budgetMs: 90 },
  1950: { blunderChance: 0.06, maxDepth: 3, topK: 4, temperatureCp: 150, evalNoiseCp: 70, extendedEval: false },
  2000: { blunderChance: 0.05, maxDepth: 4, topK: 4, temperatureCp: 130, evalNoiseCp: 60, extendedEval: false },
  2050: { blunderChance: 0.04, maxDepth: 4, topK: 3, temperatureCp: 110, evalNoiseCp: 50 },
  2100: { blunderChance: 0.03, maxDepth: 5, topK: 3, temperatureCp: 90, evalNoiseCp: 40 },
  2150: { blunderChance: 0.02, maxDepth: 5, topK: 3, temperatureCp: 80, evalNoiseCp: 35 },
  2200: { blunderChance: 0.02, maxDepth: 6, topK: 2, temperatureCp: 70, evalNoiseCp: 30 },
};

export type HousePersona = {
  name: string;
  userId: string;
  skill: HouseSkill;
  avatar: string;
  location: string;
};

// The roster's target rating curve (2026-07 spread). Weights are percentages and
// must sum to 100.
//
// The field is deliberately bottom-heavy: about 85% of the roster sits under
// 2000 and only ~9% at 2400 or above, because a lobby whose bots all played
// 1500-2200 left genuinely new players with nobody at their level. A persona's
// tier is derived from its own name hash against this table
// (houseSkillForName), so it is stable forever and adding names later never
// reshuffles anyone else. Every tuple in PERSONA_DEFS below carries the tier
// this table produces, and scripts/audit-house-bots.ts asserts that agreement —
// so the declared numbers can never quietly drift from the curve.
export const HOUSE_SKILL_WEIGHTS: ReadonlyArray<readonly [HouseSkill, number]> = [
  [800, 11], [900, 9], [1050, 9], [1200, 9], [1350, 8], [1450, 8], [1550, 8],
  [1650, 7], [1750, 6], [1900, 5], [1950, 4],
  [2000, 2], [2050, 2], [2100, 1], [2150, 1],
  [2400, 4], [2500, 3], [2600, 2], [2700, 1],
];

/** The tier a persona name maps to on the curve above. Pure and stable. */
export function houseSkillForName(name: string): HouseSkill {
  let roll = nameHash(name + "|tier2026") % 100;
  for (const [skill, weight] of HOUSE_SKILL_WEIGHTS) {
    if (roll < weight) return skill;
    roll -= weight;
  }
  return HOUSE_SKILL_WEIGHTS[HOUSE_SKILL_WEIGHTS.length - 1][0];
}

const PERSONA_DEFS: Array<[name: string, skill: HouseSkill]> = [
  // ~1550
  ["pawnstorm77", 1200],
  ["coffeeknight", 900],
  ["blitzbrain", 1900],
  ["night0wl", 1350],
  ["sarah92", 800],
  // ~1750
  ["kev_in99", 1050],
  ["frostbyte", 1050],
  ["sleepyknight", 1550],
  ["omar_23", 2700],
  ["CHECKMATE99", 1200],
  ["discocheck", 1950],
  // ~1900
  ["alexk2004", 2600],
  ["natalie88", 2500],
  ["forkmaster", 1900],
  ["e4e5nf3", 1550],
  ["capitals", 900],
  // ~1950
  ["matt_b44", 1450],
  ["veselin88", 1450],
  ["priya_r", 800],
  // ~2000
  ["tom_lee23", 2100],
  ["endgamegrace", 1650],
  ["petrosianfan", 800],
  // ~2050
  ["riptide", 1200],
  ["KINGSLAYER", 1200],
  // 2100-2200
  // (Three of this band's original handles read as obvious joke names —
  // "Stickygamer123", "ilovewhitestickystuff", "ilovemysister" — and were
  // rewritten to realistic chess-site handles. New names mean new hp_ user
  // ids, so worker.ts's houseSeededKey was bumped to v4; the old accounts
  // stay orphaned in the DB, harmless, same as the v3 renames.)
  ["passed_pawn", 2000],
  ["e4enjoyer", 900],
  ["mellowmove", 2400],
  ["viktor_m85", 900],
  ["cobrakai", 800],
  ["KnightSlayer99", 1650],

  // ~1550
  ["lukas_j", 1450],
  ["mira_k", 900],
  ["casualcastle", 1550],
  ["h4habit", 1950],
  ["teatimechess", 2600],
  ["chessnoob2012", 2150],
  // ~1750
  ["dev_e4", 1900],
  ["rybkafan", 1550],
  ["quietqueen", 1200],
  ["sam_b12", 1050],
  ["boardsnack", 1050],
  ["midnightblitz", 1550],
  // ~1900
  ["tanya_v", 1650],
  ["forkfiend", 800],
  ["karpov_enjoyer", 2400],
  ["elena_88", 1900],
  ["coffeehousepro", 1900],
  // ~1950
  ["yasser64", 2150],
  ["coldblood_c", 2600],
  ["maya_r2", 1650],
  ["jess2001", 2500],
  // ~2000
  ["marat90", 900],
  ["sasha_p", 1750],
  ["thefianchetto", 2100],
  ["sacpawn", 1900],
  // ~2050
  ["nadia_x", 2400],
  ["crushingpawns", 1200],
  ["stefan_bg", 1450],
  // 2100-2200 top band
  ["quietstormq", 1650],
  ["apexpawn", 1450],

  // --- Expansion wave: 150 more personas so the roster is 210 deep, letting
  // the daily active window (60-90) cycle through a large, ever-changing
  // crowd instead of always showing the same faces. Skills span the full
  // 1350-2200 range; handles are in the same Lichess-style mix. New handles
  // mean new hp_ ids, so worker.ts's houseSeededKey is bumped to create them.
  ["kaij25", 1450],
  ["swiftblitz", 1450],
  ["chenj48", 1650],
  ["najdorfflag", 2500],
  ["grinddragon9", 1350],
  ["swiftlondon", 1550],
  ["clock90", 2400],
  ["crushh4ing", 1200],
  ["pressgambiting", 1900],
  ["slavpetroff", 1200],
  ["e4gambit", 1450],
  ["irina26", 1650],
  ["hannah35", 800],
  ["crushskewer", 1900],
  ["chloe_sergei", 1200],
  ["flickd4", 1950],
  ["mike_mila", 2050],
  ["carlosc90", 1550],
  ["bjornm21", 900],
  ["pedro_mateo", 2000],
  ["hans_pat", 1200],
  ["slav30", 800],
  ["goran59", 800],
  ["d427", 2500],
  ["tim_alex", 1200],
  ["olga_mila", 1350],
  ["c4castle", 900],
  ["stalemateg6", 1900],
  ["boris_j37", 1550],
  ["raul19", 800],
  ["sergei_luca", 1350],
  ["dodgecometz", 900],
  ["javierj54", 1550],
  ["hangslavz", 1650],
  ["novaecho", 2050],
  ["dodgebullet14", 1050],
  ["adam_javier", 2150],
  ["blitz68", 1050],
  ["stackclocking", 800],
  ["paolot44", 1200],
  ["dawn77", 1200],
  ["coldgrind", 1450],
  ["priya_kenji", 2150],
  ["silentbaitz", 800],
  ["john_b2011", 1650],
  ["baitf6er", 1750],
  ["erik15", 1200],
  ["rajb31", 900],
  ["priya13", 900],
  ["rajc2007", 1750],
  ["finn_m64", 1050],
  ["boldblunder", 1350],
  ["teae4", 900],
  ["luke37", 1650],
  ["presstempo", 2500],
  ["hannah55", 2100],
  ["kenji_sergei", 1200],
  ["grimstackz", 1950],
  ["humblefrost", 1550],
  ["bjorn79", 1750],
  ["lena_omar", 900],
  ["luke95", 800],
  ["boris87", 1550],
  ["slav85", 1750],
  ["dodgeskewerer", 800],
  ["sleepycomet", 1650],
  ["catalan28", 2000],
  ["gambitopening", 2400],
  ["catalan2", 1200],
  ["coldendgame", 800],
  ["leo38", 800],
  ["shinyhunt", 2600],
  ["humbletrapz", 2050],
  ["echoknight", 1950],
  ["flagb6", 2500],
  ["petroffecho", 1200],
  ["tim_t6", 2050],
  ["grimhangz", 1550],
  ["chloe_b81", 1900],
  ["vikram_g23", 800],
  ["crushlufter", 2000],
  ["arjun_alex", 1050],
  ["grimdragon", 1750],
  ["tariq_diego", 1350],
  ["sleepysniper", 900],
  ["openingdraw", 2100],
  ["cozyoutpost", 1750],
  ["sleepyd4", 1050],
  ["dmitri55", 1450],
  ["trapdrawing", 2500],
  ["layla_w8", 1450],
  ["tempoecho", 1950],
  ["diego_j26", 900],
  ["king4", 1350],
  ["bullet72", 1750],
  ["dan_k60", 1200],
  ["frost21", 2600],
  ["silverskewer", 1650],
  ["mattw34", 1050],
  ["g673", 1200],
  ["latte76", 800],
  ["snipelufting", 1050],
  ["matt_v46", 1050],
  ["gambitd4", 800],
  ["silverd4", 1350],
  ["caro56", 800],
  ["sergei_mila", 1550],
  ["cozystorm", 2400],
  ["skewermate", 1750],
  ["sneakybaitr", 1550],
  ["chris77", 1750],
  ["sharpdrift", 2150],
  ["stormmate", 1550],
  ["layla_marco", 1050],
  ["humbleecho", 900],
  ["trapmateer", 1550],
  ["slaylondon", 1050],
  ["blunderdrifter", 1200],
  ["olga_nina", 900],
  ["stackzug", 1650],
  ["finn_marco", 1550],
  ["hassan_t64", 1200],
  ["embernova", 1050],
  ["wei_max", 2100],
  ["bishop95", 2400],
  ["coldpunishr", 1350],
  ["vera_raul", 1200],
  ["frostpetroff", 1050],
  ["blunderpining", 2150],
  ["sneakyhuntr", 1550],
  ["convertf6z", 1650],
  ["lazydodge", 1350],
  ["silverconvert", 1650],
  ["quietsnipez", 1650],
  ["carlos_chris", 800],
  ["warmhang", 1050],
  ["outpost33", 1200],
  ["slowzug", 1750],
  ["aleks_alex", 1950],
  ["flickdawner", 1650],
  ["silentpressr", 1950],
  ["jordan24", 2600],
  ["ren60", 2050],
  ["gracew16", 900],
  ["ren59", 800],
  ["kenji11", 900],
  ["steve77", 1050],
  ["cozyslay", 1950],
  ["wei52", 900],
  ["paolo2002", 900],
];

// ---------------------------------------------------------------------------
// 2026-07 expansion wave: 300 more house bots, spanning genuine beginner
// strength (the new 900-1200 tiers) through elite (2200). Handles follow the
// same varied register the legacy roster uses (name+number combos, opening
// references, lowercase phrases, the occasional underscore) so the wave reads
// like any other slice of the player base. Their displayed rating tracks
// their tier directly (no legacy uplift stack — see houseSeedBase). Exactly
// the even-index half (150 of 300) carries a short casual bio (EXPANSION_BIOS
// below, one unique line each); the odd-index half stays blank, like real
// users who never bothered. New names mean new hp_ ids: worker.ts's
// houseSeededKey is bumped so the accounts are created on the next cold start.
// ---------------------------------------------------------------------------
const EXPANSION_DEFS: Array<[name: string, skill: HouseSkill]> = [
  // --- beginner: 900 (35) ---
  ["tomas_r7", 2100],
  ["emilylovescats", 1550],
  ["justvibing64", 2500],
  ["marcus2011", 1350],
  ["pineapplepawn", 800],
  ["sofie_kk", 1750],
  ["deniz_04", 1650],
  ["lowkeylearning", 800],
  ["rainydaymoves", 2600],
  ["benji_h", 1200],
  ["chessafterwork", 1050],
  ["mia_rose22", 2400],
  ["pawnandorder", 1750],
  ["arlo_finn", 800],
  ["sleepysunday9", 1450],
  ["katya_m8", 1950],
  ["bignoobenergy", 1550],
  ["leo_dubs", 1200],
  ["strawberryking", 1950],
  ["hannah_bee3", 2400],
  ["couchplayer99", 2000],
  ["oskar_pl", 900],
  ["checkpleaseok", 800],
  ["tiredteacher77", 1550],
  ["lunapark12", 1550],
  ["whatevermate", 2150],
  ["rileyq_", 2000],
  ["dad_of_three", 900],
  ["zeynep_a", 800],
  ["grumpygrandpa1", 1200],
  ["firstyearuni", 1200],
  ["bo_jax88", 1650],
  ["milkteamoves", 1050],
  ["pdx_rainplayer", 900],
  ["sam_i_am_99", 1900],
  // --- beginner: 1050 (35) ---
  ["kevin_t99", 1050],
  ["midnightcaro", 900],
  ["anya_petrova11", 1550],
  ["e4e5whatnow", 900],
  ["quietcornercafe", 1650],
  ["dylan_t20", 1200],
  ["rustyandback", 1050],
  ["nightshiftnurse2", 800],
  ["pawnstorm_92", 1550],
  ["gabe_2007", 900],
  ["sundaymornings4", 900],
  ["lichenmoss4", 1200],
  ["tariq_zz", 800],
  ["mollys_dad", 1050],
  ["brokenclockwins", 1050],
  ["ines_lisboa", 1050],
  ["halfcaffholly", 2400],
  ["rando_cal77", 2050],
  ["jules_vr", 1950],
  ["stonecoldpawn", 900],
  ["tinytownchamp", 1750],
  ["priya_sings", 2100],
  ["losingstreak12", 1650],
  ["mika_polar", 1900],
  ["caffeineandchess", 900],
  ["ollie_oxen3", 1050],
  ["slowtrainrider", 900],
  ["fernwood_78", 1350],
  ["chess_and_chill", 1750],
  ["tuck_everlast", 1450],
  ["nightowl_nadia", 2400],
  ["bricklayerbrett", 2400],
  ["vanillalatte7", 1550],
  ["georgie_pie", 2400],
  ["apartment4b", 1350],
  // --- beginner-plus: 1200 (30) ---
  ["zwischenzug77", 2600],
  ["ruben_dario5", 2050],
  ["londonsystemfan", 1550],
  ["clara_bell12", 1650],
  ["knightowl_23", 1650],
  ["caro_kann_stan", 1050],
  ["felix_the_2nd", 2150],
  ["bulletproofbex", 1050],
  ["skatepark_sasha", 1650],
  ["gambitgremlin", 1650],
  ["marseille_mo", 2500],
  ["offbeatopenings", 1450],
  ["theo_v12", 1450],
  ["chai_and_chess", 1050],
  ["rainyrook", 1650],
  ["dario_88", 2400],
  ["stalemate_steph", 1450],
  ["pnw_hiker42", 1650],
  ["vince_van_go", 900],
  ["slowcookedwins", 1050],
  ["basia_k", 800],
  ["fried_liver_fan", 1200],
  ["murathan_35", 1200],
  ["grindcoregreg", 1350],
  ["josie_moves", 900],
  ["halfpastblitz", 1550],
  ["nordicwinters", 1450],
  ["tomek_pl99", 800],
  ["bookishbrooke", 800],
  ["subwaysolver", 1050],
  // --- casual: 1350 (25) ---
  ["sicilian_sisters", 1050],
  ["andres_1998", 1200],
  ["blitzntears", 2100],
  ["quiet_riot88", 1550],
  ["matcha_mate", 1050],
  ["leftybishop", 1550],
  ["warsaw_wanderer", 1200],
  ["keegan_77", 1750],
  ["vegan_gambit", 1900],
  ["rue_de_rivoli", 2500],
  ["smotheredhopes", 1750],
  ["danny_twopawns", 1900],
  ["elif_yildiz3", 900],
  ["garagebandgary", 1650],
  ["nihal_x", 1350],
  ["offseasonhooper", 800],
  ["bird_gang44", 2050],
  ["prettygoodatthis", 2400],
  ["marcin_k2", 2100],
  ["latenightlaszlo", 1350],
  ["tempo_tantrum", 1750],
  ["saltlakesolo", 2100],
  ["fiona_h20", 1550],
  ["secondhandbooks", 800],
  ["rowdyrook55", 1050],
  // --- casual: 1450 (25) ---
  ["najdorfandchill", 1200],
  ["petra_svit", 1650],
  ["glasgow_g1", 1350],
  ["hypermodernhank", 1750],
  ["crimsonfile", 1200],
  ["yusuf_bey7", 1050],
  ["blitzburgh412", 1050],
  ["quietmovequinn", 1650],
  ["antwerp_ace", 1750],
  ["el_blunderino", 2400],
  ["sofia_bg1988", 1750],
  ["graveyardshift64", 900],
  ["pawnbrokerphil", 1200],
  ["mangolassi22", 1750],
  ["tundraking77", 2400],
  ["rios_r9", 1450],
  ["cornfieldchess", 2500],
  ["velvetknight", 1650],
  ["arjun_kt", 2400],
  ["doubleespresso2", 2000],
  ["winterberlin", 1200],
  ["slipperyelo", 900],
  ["nadia_pm", 1550],
  ["heavypieces", 1750],
  ["last_rank_larry", 1050],
  // --- intermediate: 1550 (20) ---
  ["catalan_dreams", 1350],
  ["boris_not_that1", 1900],
  ["slavdefender", 1900],
  ["marina_vl", 1450],
  ["benoni_blues", 2050],
  ["kolya_k77", 1200],
  ["stonewall_dutch", 800],
  ["hansen_hs", 1950],
  ["nimzoindianfan", 1200],
  ["closedsicilian", 1550],
  ["tarrasch_talks", 1950],
  ["mehmet_efe1", 1050],
  ["kingsindianattack", 1050],
  ["lena_bxh7", 800],
  ["scandi_main", 1450],
  ["old_benoni", 1750],
  ["diegof_1989", 1050],
  ["hippo_setup", 800],
  ["reti_forever", 2000],
  ["engine_says_no", 1950],
  // --- intermediate: 1650 (20) ---
  ["rookonseventh", 2700],
  ["tempo_thief", 800],
  ["milan_c4", 900],
  ["badbishopclub", 1650],
  ["outpost_hermit", 1950],
  ["sylvia_r66", 2150],
  ["openfileaddict", 1650],
  ["overprotection", 2700],
  ["hangingpawnsok", 1750],
  ["darjeelingdraw", 900],
  ["marco_lt17", 1200],
  ["isolani_life", 900],
  ["spacegrabber", 1050],
  ["fianchettofiend", 900],
  ["aksel_no", 2400],
  ["twobishopsplease", 1900],
  ["middlegamemess", 1750],
  ["rooklifts4days", 1550],
  ["chessdadof2", 1050],
  ["tightsqueeze77", 1650],
  // --- advanced: 1750 (20) ---
  ["endgamegrinder", 1550],
  ["bridgebuilder64", 1900],
  ["karpov_stan99", 800],
  ["quietmoves_only", 1550],
  ["zugzwang_artist", 1750],
  ["renata_cz", 1200],
  ["fortress_or_bust", 1050],
  ["twoweaknesses", 900],
  ["igor_bp", 900],
  ["passedpawnpusher", 1900],
  ["triangulate_this", 1650],
  ["rookendingsdrawn", 1350],
  ["opposition_guru", 1350],
  ["vasyl_uv", 1650],
  ["knightvsbishop", 1550],
  ["wrongbishop", 1650],
  ["technique_tbd", 2600],
  ["grindtilldawn", 800],
  ["helen_e6", 800],
  ["practicalplay", 2400],
  // --- advanced: 1900 (20) ---
  ["novelty_on_nine", 900],
  ["theoryhound", 900],
  ["carlsbad_grip", 2400],
  ["hedgehog_life", 1050],
  ["maroczy_wall", 1350],
  ["anti_berlin", 1200],
  ["katarina_2k", 1050],
  ["sacthexchange", 1550],
  ["dubov_lines", 1350],
  ["meran_madness", 2400],
  ["zaitsev_files", 2500],
  ["botvinnik_lab", 1650],
  ["marshall_denier", 1750],
  ["structure_nerd", 900],
  ["ivan_ivanov19", 1350],
  ["chigorin_soul", 2400],
  ["c_file_junkie", 2150],
  ["lena_prep", 1750],
  ["middlegamemaps", 1900],
  ["najdorf_lifer", 1900],
  // --- expert: 1950 (15) ---
  ["no_bad_pieces", 1050],
  ["forcinglines", 2000],
  ["alexey_v88", 1200],
  ["tiniestedge", 1750],
  ["smalledgegrind", 2100],
  ["defends_anything", 2000],
  ["miguel_santos7", 1050],
  ["accuracy_junkie", 2050],
  ["stonepatience", 1050],
  ["fiftygoodmoves", 1350],
  ["karolina_ww", 1050],
  ["silentgrind", 1200],
  ["tablebase_ted", 900],
  ["defensivegenius", 1750],
  ["win_the_won_game", 1200],
  // --- expert: 2000 (12) ---
  ["titled_someday", 1450],
  ["blindfold_bruno", 2500],
  ["simul_ghost", 2500],
  ["threecandidates", 800],
  ["dmitry_dk", 1450],
  ["patternhoarder", 900],
  ["visualizer_v", 2400],
  ["attack_f7", 1950],
  ["sacs_on_sight", 1050],
  ["irina_wins", 900],
  ["prep_and_pray", 1050],
  ["no_draws_today", 800],
  // --- expert: 2050 (10) ---
  ["boa_constrictor", 2000],
  ["stalkingbishop", 1550],
  ["marat_ke", 900],
  ["repertoirewall", 1750],
  ["deepcalc_dana", 1750],
  ["novelty_sniper", 1650],
  ["edgehunterx", 1950],
  ["initiative_only", 1200],
  ["sofia_grinds", 1900],
  ["momentum_merchant", 1200],
  // --- elite: 2100 (12) ---
  ["relentlessgrind", 1350],
  ["fortresscracker", 1200],
  ["cleansheetchess", 2600],
  ["passers_united", 2500],
  ["diagonal_doom", 2400],
  ["anaconda_style", 1450],
  ["endgame_surgeon", 1900],
  ["autopilot_wins", 1650],
  ["praxisfirst", 1950],
  ["abyssal_prep", 2700],
  ["mia_gm_track", 800],
  ["cold_technique", 900],
  // --- elite: 2150 (10) ---
  ["totalcontrol64", 1650],
  ["surgical_rook", 800],
  ["vise_grip_vic", 1050],
  ["prep_leviathan", 1050],
  ["lasersharplines", 1200],
  ["fullboardvision", 1350],
  ["ironclad_endings", 900],
  ["anna_in_the_lab", 1900],
  ["theorycrusher", 1450],
  ["immortal_grind", 1650],
  // --- elite: 2200 (11) ---
  ["apex_predator64", 1650],
  ["silent_titan", 1550],
  ["finalboss_e4", 1200],
  ["endgame_oracle", 1200],
  ["deepest_prep", 1750],
  ["grandsqueeze", 800],
  ["absolute_zero64", 1750],
  ["ghost_king64", 2500],
  ["the_last_rank", 1750],
  ["summit_seeker", 1200],
  ["zerocounterplay", 2100],
];

// The names of the 2026-07 expansion wave, for the "is this a new-wave
// persona" checks in houseSeedBase / personaBio.
const EXPANSION_NAME_SET = new Set(EXPANSION_DEFS.map(([name]) => name));

// 150 original, casual, deliberately imperfect one-liners in the register real
// chess-site bios use: lowercase, short, no emojis, no marketing voice. One
// line per bio-carrying expansion bot (the even-index half of EXPANSION_DEFS),
// each used exactly once, so no two bots share a bio.
const EXPANSION_BIOS: string[] = [
  "i play way too much blitz",
  "mostly here for the weird cards",
  "trying not to hang my queen again",
  "d4 when i remember my prep",
  "still figuring out endgames",
  "one more game then bed",
  "knights over bishops, always",
  "no clue what im doing half the time",
  "chess after work, most days",
  "premoves are my downfall",
  "slowly climbing, mostly falling",
  "e4 every single game",
  "here since the beta",
  "caro kann and chill",
  "resigning is for other people",
  "my rating is a rollercoaster",
  "blitz brain, rapid rating",
  "puzzle streak enjoyer",
  "flagging people is my cardio",
  "i blame mouse slips",
  "learning the sicilian, badly",
  "endgames scare me",
  "will trade queens for no reason",
  "london system apologist",
  "somehow always in time trouble",
  "just here to push pawns",
  "queen sac enthusiast",
  "castle early, panic late",
  "gambit first, think later",
  "my openings are held together with tape",
  "playing since last winter",
  "the eval bar lies to me",
  "back rank checkmates haunt me",
  "chess between lectures",
  "fianchetto everything",
  "cant stop playing bullet",
  "hydrate and rook lifts",
  "always down for a rematch",
  "lost to scholars mate once. never again",
  "openings memorized: one",
  "i peaked in a puzzle rush",
  "en passant is my favorite rule",
  "team knight",
  "chess podcasts while i work",
  "the board sees all my mistakes",
  "quiet moves make me nervous",
  "still waiting for my brilliant move",
  "average c player energy",
  "counting to ten before every move, allegedly",
  "born to gambit, forced to defend",
  "morning coffee and a rapid game",
  "cards make everything chaotic and i love it",
  "trying the nerf ladder this month",
  "my prep ends at move six",
  "resident of time trouble",
  "won once against a 1900, still bragging",
  "stalemate specialist, not on purpose",
  "if it looks like a trap it probably is",
  "middlegames are just vibes",
  "opening names are half the fun",
  "perpetual check, perpetual cope",
  "never resign, always suffer",
  "sixty percent of the time i castle every time",
  "rooks belong on open files apparently",
  "keep hanging knights on f5",
  "played chess irl once, terrifying",
  "the horse does the L thing",
  "check first, ask questions later",
  "smothered mate is the dream",
  "my endgame plan is hope",
  "just discovered the stafford",
  "pawn storms fix everything",
  "here for hexes and bad decisions",
  "grinding to 1500, eta unknown",
  "the queen is a rook and bishop glued together",
  "friendly games only, until i lose",
  "sometimes i premove the wrong piece",
  "you miss all the forks you dont take",
  "bishop pair believer",
  "draws feel like homework",
  "my clock management is a war crime",
  "still salty about a stalemate from march",
  "opening theory is a suggestion",
  "buff mode turned me into a gambler",
  "netflix and blunder",
  "yes i saw the mate in one. after i moved",
  "will play anything with a knight on rim",
  "pet opening: the wayward queen",
  "chess first, sleep second",
  "1200 with the heart of a 2000",
  "i just like the little horses",
  "tilted since tuesday",
  "longtime lurker, recent blunderer",
  "shoutout to whoever invented castling",
  "my favorite square is e5",
  "escaping bullet, one rapid game at a time",
  "took a break, came back worse",
  "the pin is mightier than the sword",
  "always one tempo short",
  "accidentally decent at endgames",
  "banking drafts like a coward",
  "if chess is art im finger painting",
  "certified pawn grabber",
  "i study tactics and then ignore them",
  "playing until the tilt wears off",
  "self taught and it shows",
  "somewhere between patzer and fine",
  "checkmate is just spicy check",
  "rooks on the seventh or nothing",
  "i respect the fifty move rule",
  "gambiteer in recovery",
  "the knight fork found me again",
  "chess with tea, always",
  "lowkey scared of the dragon",
  "my repertoire is a rumor",
  "promoted a pawn to a knight once. worth it",
  "running on caffeine and cheap tactics",
  "career highlight: beat my uncle",
  "the h pawn is my emotional support pawn",
  "opening principles are more like guidelines",
  "hex me once, shame on you",
  "1 minute games, 10 minute tilt",
  "spectating my own decline",
  "castling queenside feels illegal",
  "the real chess was the blunders we made along the way",
  "every game a new way to lose a rook",
  "doubling pawns recreationally",
  "trying to make f4 work",
  "zugzwang is my native language",
  "collect knights, drop queens",
  "gave up bullet for lent, relapsed",
  "half my wins are flags",
  "swindle artist in training",
  "pawn endings are pure fear",
  "playing the position, losing the game",
  "big fan of the little center",
  "will punish greek gifts, eventually",
  "back after a long break, rusty",
  "the c file is home",
  "underpromotion appreciation account",
  "blundered here first",
  "warmup games are my main games",
  "safety first, tactics eventually",
  "greetings from the losing side of theory",
  "was winning. history will remember",
  "my kings walk more than i do",
  "trading pieces to feel something",
  "student of the game, repeat year",
  "arrived for chess, stayed for the cards",
  "small brain, big center",
];

// Exactly the even-index half of the expansion wave carries a bio, each a
// UNIQUE line from EXPANSION_BIOS (index i -> bio i/2). 300 defs, 150 bios.
const EXPANSION_BIO_BY_NAME: Map<string, string> = new Map(
  EXPANSION_DEFS.filter((_, i) => i % 2 === 0).map(
    ([name], j) => [name, EXPANSION_BIOS[j] ?? EXPANSION_BIOS[j % EXPANSION_BIOS.length]] as [string, string],
  ),
);


// ---------------------------------------------------------------------------
// WAVE 3 (2026-07): 390 further personas, taking the roster to 900.
//
// The roster had to grow because the ONLINE-presence window is bounded by the
// roster length, and the site now shows a population that breathes between
// HOUSE_ONLINE_MIN and HOUSE_ONLINE_MAX. Names follow the same
// lichess-account register as the rest of the file: lowercase handles, number
// suffixes, deliberate mashes and misspellings, opening puns, the occasional
// shouty one. Nothing that reads as a bot, nothing that reads as a chess-site
// house account. Tiers are name-derived (see HOUSE_SKILL_WEIGHTS), which is why
// they are grouped rather than hand-chosen.
//
// These personas carry no fictional location and no baked bio, like the wave-2
// expansion: a blank profile is the commonest shape on a real chess site.
// ---------------------------------------------------------------------------
const WAVE3_DEFS: Array<[name: string, skill: HouseSkill]> = [
  // --- 800 (55) ---
  ["tempoforever", 800],
  ["itwasadraw", 800],
  ["navidmoth", 800],
  ["sneakycrow", 800],
  ["mai_magpie", 800],
  ["maya_vole", 800],
  ["yannis_h69", 800],
  ["colleandy", 800],
  ["finnplaysfianchetto", 800],
  ["miles_65", 800],
  ["lankypuffin", 800],
  ["jonas_42", 800],
  ["fatima31", 800],
  ["pinmerchant", 800],
  ["READTHECARD", 800],
  ["nico_r90", 800],
  ["endgamehelp", 800],
  ["eunbi_gecko", 800],
  ["meera_shrew", 800],
  ["NOTLIKETHIS", 800],
  ["bishopnever", 800],
  ["idontknowopenings", 800],
  ["taeyangraccoon", 800],
  ["taeyangtoaster", 800],
  ["giorgia_puffin", 800],
  ["berlindiehard", 800],
  ["nick63", 800],
  ["funkylemur1996", 800],
  ["onur77", 800],
  ["radu69", 800],
  ["goofycapybara", 800],
  ["grumpytoaster", 800],
  ["SIXSEVENAGAIN", 800],
  ["martina_magpie", 800],
  ["blundergaming", 800],
  ["carorespecter", 800],
  ["lukeplaystilt", 800],
  ["jakub63", 800],
  ["pinhelp", 800],
  ["camila_possum", 800],
  ["knightenjoyer", 800],
  ["arda_j0", 800],
  ["dai_m78", 800],
  ["maxmoth", 800],
  ["reza_50", 800],
  ["miles40", 800],
  ["pekka18", 800],
  ["anders8", 800],
  ["ana1995", 800],
  ["sneakytern", 800],
  ["mai_beetle", 800],
  ["thu_beetle", 800],
  ["grumpyshrew9", 800],
  ["heronenjoyer", 800],
  ["jiwoo_tern", 800],
  // --- 900 (30) ---
  ["clara_crow", 900],
  ["vlad_n1996", 900],
  ["frida_weasel", 900],
  ["isla_crow", 900],
  ["thu_weasel", 900],
  ["megan_newt", 900],
  ["stefan_h80", 900],
  ["nikosplaysgambit", 900],
  ["maria_walrus", 900],
  ["miles_2000", 900],
  ["joonatern", 900],
  ["callum49", 900],
  ["moodypossum", 900],
  ["smithaddict", 900],
  ["lankywalrus", 900],
  ["rookhelp", 900],
  ["nick2000", 900],
  ["whyisthislegal", 900],
  ["wobblypigeon91", 900],
  ["saltymagpie81", 900],
  ["yuki63", 900],
  ["sana_capybara", 900],
  ["londonmerchant", 900],
  ["crustyraccoon", 900],
  ["fiftymoverule", 900],
  ["rani1", 900],
  ["eino_3", 900],
  ["tempomerchant", 900],
  ["weaselenjoyer", 900],
  ["deniz57", 900],
  // --- 1050 (39) ---
  ["gambithelp", 1050],
  ["tapirenjoyer", 1050],
  ["ivanpigeon", 1050],
  ["FLAGGEDAGAIN", 1050],
  ["stavros_30", 1050],
  ["sean_a2008", 1050],
  ["dailimpet", 1050],
  ["maria_weasel", 1050],
  ["dragonandy", 1050],
  ["flaggedonpurpose", 1050],
  ["mert_2003", 1050],
  ["toastyferret", 1050],
  ["grumpylimpet2011", 1050],
  ["goodgamewelp", 1050],
  ["bruno_h89", 1050],
  ["jonas1990", 1050],
  ["tilthelp", 1050],
  ["ternenjoyer", 1050],
  ["funkybeetle", 1050],
  ["knighthaver", 1050],
  ["seantern", 1050],
  ["taimanovfan", 1050],
  ["sleepyheron", 1050],
  ["capybaraenjoyer", 1050],
  ["onurplaysknight", 1050],
  ["olivia_walrus", 1050],
  ["clumsyraccoon", 1050],
  ["perpetualtilt", 1050],
  ["arjunplayspawn", 1050],
  ["enpassantorlose", 1050],
  ["stonewalllover", 1050],
  ["roisin_wombat", 1050],
  ["moderntruther", 1050],
  ["reza40", 1050],
  ["clockedmyself", 1050],
  ["zestymagpie02", 1050],
  ["tamar98", 1050],
  ["jun_s96", 1050],
  ["jelena9", 1050],
  // --- 1200 (27) ---
  ["joona53", 1200],
  ["niklas_n1996", 1200],
  ["chiara_lemur", 1200],
  ["clumsynewt99", 1200],
  ["hana_tern", 1200],
  ["bishophelp", 1200],
  ["bruna_newt", 1200],
  ["fianchettoalways", 1200],
  ["ville_n1", 1200],
  ["rhys_e61", 1200],
  ["aditya90", 1200],
  ["garethsnail", 1200],
  ["felix_73", 1200],
  ["gloomytapir", 1200],
  ["feralferret", 1200],
  ["modernlover", 1200],
  ["hazywombat7", 1200],
  ["alexplaysknight", 1200],
  ["petarplaysqueen", 1200],
  ["ryanplaysgambit", 1200],
  ["benonidiehard", 1200],
  ["anhplaysqueen", 1200],
  ["magpieenjoyer", 1200],
  ["foggyquokka92", 1200],
  ["dragonenjoyer", 1200],
  ["zestyweasel67", 1200],
  ["reza_46", 1200],
  // --- 1350 (31) ---
  ["jiwoo50", 1350],
  ["amir_62", 1350],
  ["giulia4", 1350],
  ["fianchettomerchant", 1350],
  ["crankycrow", 1350],
  ["zoe_badger", 1350],
  ["alex_s1996", 1350],
  ["artemsnail", 1350],
  ["spookypossum", 1350],
  ["pavel_1997", 1350],
  ["pleasedontresign", 1350],
  ["crankypossum", 1350],
  ["signe2001", 1350],
  ["mattia_l2", 1350],
  ["karan_r94", 1350],
  ["sillynewt", 1350],
  ["hana_newt", 1350],
  ["aino_tern", 1350],
  ["onur_b39", 1350],
  ["pawnenjoyer", 1350],
  ["THATWASMATE", 1350],
  ["lasse_v8", 1350],
  ["rohan_46", 1350],
  ["hazygoose65", 1350],
  ["andreiplaysrook", 1350],
  ["tomasplayspawn", 1350],
  ["ines7", 1350],
  ["ihatethiscard", 1350],
  ["omarplaysrook", 1350],
  ["zara29", 1350],
  ["BONGCLOUDONLY", 1350],
  // --- 1450 (19) ---
  ["stoppremoving", 1450],
  ["tereza_magpie", 1450],
  ["badgerenjoyer", 1450],
  ["frida46", 1450],
  ["nam1996", 1450],
  ["ingrid9", 1450],
  ["clara74", 1450],
  ["nam_e15", 1450],
  ["gooseenjoyer", 1450],
  ["ruyenjoyer", 1450],
  ["bishopgaming", 1450],
  ["diegoshrew", 1450],
  ["lucapuffin", 1450],
  ["siobhan04", 1450],
  ["tiltedagain", 1450],
  ["lena_beetle", 1450],
  ["quirkystoat", 1450],
  ["cantstoplosing", 1450],
  ["wobblyferret86", 1450],
  // --- 1550 (28) ---
  ["sveshrespecter", 1550],
  ["sleepyvole2010", 1550],
  ["nico50", 1550],
  ["saga60", 1550],
  ["petarplaystempo", 1550],
  ["puffinenjoyer", 1550],
  ["ben_82", 1550],
  ["ana86", 1550],
  ["omar_6", 1550],
  ["kalashtruther", 1550],
  ["elena5", 1550],
  ["petar54", 1550],
  ["deniz33", 1550],
  ["goofygecko98", 1550],
  ["pedro_2005", 1550],
  ["wobblypossum", 1550],
  ["jihoonplaystempo", 1550],
  ["sillyotter", 1550],
  ["sofia1997", 1550],
  ["pinenjoyer", 1550],
  ["crispyferret", 1550],
  ["fianchettoplease", 1550],
  ["bayu_a15", 1550],
  ["idris_a3", 1550],
  ["hugo_s07", 1550],
  ["tereza_vole", 1550],
  ["anders_2000", 1550],
  ["IWASWINNING", 1550],
  // --- 1650 (27) ---
  ["amirplaysskewer", 1650],
  ["mossyraccoon52", 1650],
  ["blunderforever", 1650],
  ["emma27", 1650],
  ["possumenjoyer", 1650],
  ["STOPFREEZINGME", 1650],
  ["sneakyquokka9", 1650],
  ["ryan6", 1650],
  ["roisin_puffin", 1650],
  ["ville7", 1650],
  ["wombatenjoyer", 1650],
  ["tamar08", 1650],
  ["hugoweasel", 1650],
  ["reedbadger", 1650],
  ["sarah_moth", 1650],
  ["yael_heron", 1650],
  ["funkynewt", 1650],
  ["nikostern", 1650],
  ["morraandy", 1650],
  ["spookymagpie", 1650],
  ["yael_goose", 1650],
  ["najdorfrespecter", 1650],
  ["moiraplaysknight", 1650],
  ["yusuf_07", 1650],
  ["dario_j6", 1650],
  ["forkenjoyer", 1650],
  ["crowenjoyer", 1650],
  // --- 1750 (22) ---
  ["milesplaysking", 1750],
  ["stefanplaysrook", 1750],
  ["spicytapir1999", 1750],
  ["chunkysnail01", 1750],
  ["mia55", 1750],
  ["olivia8", 1750],
  ["ioana0", 1750],
  ["saltyotter", 1750],
  ["nikos_2000", 1750],
  ["olavplayspin", 1750],
  ["bishopplease", 1750],
  ["queennever", 1750],
  ["artemotter", 1750],
  ["rossolimoguy", 1750],
  ["crankypigeon", 1750],
  ["ewanmarmot", 1750],
  ["spicycrow", 1750],
  ["junotter", 1750],
  ["dina_magpie", 1750],
  ["funkymoth31", 1750],
  ["astrid_crow", 1750],
  ["NOMORENERFS", 1750],
  // --- 1900 (22) ---
  ["zara_pigeon", 1900],
  ["finnplaysknight", 1900],
  ["JUSTONEMOREGAME", 1900],
  ["frostypuffin44", 1900],
  ["berlinenjoyer", 1900],
  ["emma58", 1900],
  ["pedro6", 1900],
  ["kaan_d4", 1900],
  ["zestystoat", 1900],
  ["ENPASSANTNOW", 1900],
  ["niklas_p2000", 1900],
  ["nuttycrow7", 1900],
  ["callum2002", 1900],
  ["mossyotter10", 1900],
  ["dewi_lemur", 1900],
  ["paula_limpet", 1900],
  ["petar_n54", 1900],
  ["andrei_50", 1900],
  ["readthecardagain", 1900],
  ["rhys2007", 1900],
  ["zestybeetle", 1900],
  ["almostslept", 1900],
  // --- 1950 (19) ---
  ["mothenjoyer", 1950],
  ["zestymagpie", 1950],
  ["rani1999", 1950],
  ["zara_weasel", 1950],
  ["sillygannet", 1950],
  ["nick_a09", 1950],
  ["daria_goose", 1950],
  ["zara_limpet", 1950],
  ["tobiasplayspin", 1950],
  ["walrusenjoyer", 1950],
  ["nobodyresigns", 1950],
  ["taeyang_1999", 1950],
  ["sofia_tern", 1950],
  ["taeyang_2002", 1950],
  ["renplaysrook", 1950],
  ["moodywombat6", 1950],
  ["maya_otter", 1950],
  ["frida1995", 1950],
  ["vladplaysendgame", 1950],
  // --- 2000 (10) ---
  ["chunkyshrew", 2000],
  ["sanjay57", 2000],
  ["pawnforever", 2000],
  ["finn_8", 2000],
  ["forkplease", 2000],
  ["andersmarmot", 2000],
  ["sarah2003", 2000],
  ["lemurenjoyer", 2000],
  ["valeria57", 2000],
  ["joona_s46", 2000],
  // --- 2050 (7) ---
  ["budapestrespecter", 2050],
  ["julia74", 2050],
  ["hanna68", 2050],
  ["maria26", 2050],
  ["onurgannet", 2050],
  ["nuttyraccoon", 2050],
  ["haoplaystilt", 2050],
  // --- 2100 (4) ---
  ["googleenpassant", 2100],
  ["paolo5", 2100],
  ["aoife42", 2100],
  ["colegoose", 2100],
  // --- 2150 (4) ---
  ["lasseplayspawn", 2150],
  ["petarplayspawn", 2150],
  ["jonas22", 2150],
  ["mossynewt", 2150],
  // --- 2400 (20) ---
  ["kasper_2003", 2400],
  ["backtoblitz", 2400],
  ["voleenjoyer", 2400],
  ["newtenjoyer", 2400],
  ["jihoon54", 2400],
  ["kingenjoyer", 2400],
  ["scandihater", 2400],
  ["feralcrow78", 2400],
  ["ardaplaysbishop", 2400],
  ["ferretenjoyer", 2400],
  ["funkywombat52", 2400],
  ["onur_r8", 2400],
  ["andrei4", 2400],
  ["tiltgaming", 2400],
  ["hakimotter", 2400],
  ["toastyweasel", 2400],
  ["stavros_m2", 2400],
  ["imalwaysdown", 2400],
  ["leila_gannet", 2400],
  ["paolo2007", 2400],
  // --- 2500 (11) ---
  ["budapestfan", 2500],
  ["ryan_j93", 2500],
  ["giulia56", 2500],
  ["lukeplaysknight", 2500],
  ["rossolimoaddict", 2500],
  ["mynerfwasfine", 2500],
  ["ivanplaysrook", 2500],
  ["forkmerchant", 2500],
  ["shrewenjoyer", 2500],
  ["seojunwombat", 2500],
  ["adibgecko", 2500],
  // --- 2600 (9) ---
  ["daria_lemur", 2600],
  ["actuallyitsforced", 2600],
  ["holyhellagain", 2600],
  ["MYROOKWASFINE", 2600],
  ["itsjustachess", 2600],
  ["tarek9", 2600],
  ["felix03", 2600],
  ["bishopandy", 2600],
  ["hugoplayszug", 2600],
  // --- 2700 (6) ---
  ["stefanheron", 2700],
  ["einoplaysking", 2700],
  ["LETHIMCOOKNOW", 2700],
  ["duc_p64", 2700],
  ["astrid_lemur", 2700],
  ["yuna_gecko", 2700],
];

// Fold the expansion waves into the roster proper.
PERSONA_DEFS.push(...EXPANSION_DEFS, ...WAVE3_DEFS);

// Flowered avatar presets (see lib/avatars.ts): the ordinary piece-on-plate
// look plus a small flower mark. Never offered to real accounts (isAvatarId
// rejects them), so the flower stays a reliable internal house mark everywhere
// an avatar renders from server data. The FULL flowered catalog (8 palettes x
// 6 pieces = 48 looks) is used, assigned by name hash, so the roster reads as
// a varied crowd instead of the same few plates cycling in order. The mark
// itself is drawn small and muted by PlayerAvatar (owner: the old bloom was
// too loud).
const FLOWER_PALETTES = ["gold", "verdigris", "bruise", "oxblood", "slate", "copper", "moss", "plum"] as const;
const FLOWER_PIECES = ["p", "n", "b", "r", "q", "k"] as const;
const FLOWER_AVATARS: string[] = FLOWER_PALETTES.flatMap((palette) =>
  FLOWER_PIECES.map((piece) => `${palette}_${piece}_flower`),
);

// Curated, thematic pfp assignments: where a persona's name suggests an image
// it gets that one (teatimechess -> tea_set, night0wl -> city_night). Every
// OTHER persona now also gets an image pfp (a name-hashed one, see
// personaAvatar) rather than the piece-on-plate flower preset, so the whole
// roster reads like real users who uploaded a random photo (a beach, a coffee
// mug, a houseplant). Keyed by persona name (stable across roster reordering);
// the value is the pfp's <name>, turned into a "house_pfp:<name>" avatar id
// below. Every listed persona name must exist in PERSONA_DEFS and every pfp
// name must exist in lib/avatars' HOUSE_PFP_NAMES.
const HOUSE_PFP_ASSIGN: Record<string, string> = {
  coffeeknight: "coffee_mug",
  teatimechess: "tea_set",
  night0wl: "city_night",
  midnightblitz: "rainy_neon",
  coffeehousepro: "record_player",
  sarah92: "flower_vase",
  natalie88: "lavender_field",
  priya_r: "koi_pond",
  elena_88: "sunflowers",
  maya_r2: "monstera",
  tanya_v: "succulents",
  mira_k: "potted_cactus",
  nadia_x: "beach_sunset",
  jess2001: "palm_beach",
  quietqueen: "bookshelf",
  frostbyte: "snowy_peak",
  riptide: "sailboat",
  discocheck: "hot_air_balloons",
  blitzbrain: "aurora",
  mellowmove: "mountain_lake",
  sleepyknight: "tent_stars",
  karpov_enjoyer: "forest_path",
  casualcastle: "lake_cabin",
  boardsnack: "fruit_bowl",
  pawnstorm77: "waterfall",
  omar_23: "desert_dunes",
  lukas_j: "bicycle",
  stefan_bg: "lighthouse",
  crushingpawns: "autumn_leaves",
  // Character/meme-wave picks (third curated wave in lib/avatars.ts), matched
  // to the persona the subject fits: the baiter gets the troll grin, the dev
  // gets the rubber duck, the doge pun writes itself.
  sneakybaitr: "troll_face",
  e4e5nf3: "speed_cube",
  lazydodge: "shiba_wow",
  coldblood_c: "moai_statue",
  dev_e4: "rubber_ducky",
  KnightSlayer99: "pixel_knight",
  chessnoob2012: "nerd_glasses",
  cobrakai: "cool_cat",
};

// UNIQUE per-persona pfp assignment. Owner ask: no two bots may share a pfp.
// The catalog (HOUSE_PFP_NAMES: ~60 curated + 200 generated = 260) is larger
// than the ~210-deep roster, so a distinct pfp exists for every persona. The
// assignment is deterministic and stable across deploys:
//   1. Curated thematic picks (HOUSE_PFP_ASSIGN) are claimed first, in roster
//      order, each taken by at most one persona.
//   2. Every remaining persona hashes its name into the catalog and linear-
//      probes to the first still-unclaimed slot.
// Because the catalog outnumbers the roster, step 2 always finds a free slot,
// so the result is a true injection (no duplicates). Flower presets remain a
// valid house look (still in the /mod editor and held by any persona an admin
// switches back to one), just never the default.
const HOUSE_PFP_CATALOG_SET = new Set<string>(HOUSE_PFP_NAMES);

function assignHousePfps(names: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  // 1. Curated thematic picks, claimed once each.
  for (const name of names) {
    const pfp = HOUSE_PFP_ASSIGN[name];
    if (pfp && HOUSE_PFP_CATALOG_SET.has(pfp) && !used.has(pfp)) {
      out.set(name, HOUSE_PFP_PREFIX + pfp);
      used.add(pfp);
    }
  }
  // 2. Everyone else: hash into the catalog, probe to the first free slot.
  const len = HOUSE_PFP_NAMES.length;
  for (const name of names) {
    if (out.has(name)) continue;
    let idx = nameHash(name) % len;
    while (used.has(HOUSE_PFP_NAMES[idx])) idx = (idx + 1) % len;
    out.set(name, HOUSE_PFP_PREFIX + HOUSE_PFP_NAMES[idx]);
    used.add(HOUSE_PFP_NAMES[idx]);
  }
  return out;
}

const HOUSE_PFP_ASSIGNMENTS = assignHousePfps(PERSONA_DEFS.map(([name]) => name));

/** A persona's baked, UNIQUE pfp id (see assignHousePfps). */
function personaAvatar(name: string): string {
  // Falls back to a name-hashed catalog pick for any name not in the roster
  // (defensive; every roster name is in the map).
  return (
    HOUSE_PFP_ASSIGNMENTS.get(name) ??
    HOUSE_PFP_PREFIX + HOUSE_PFP_NAMES[nameHash(name) % HOUSE_PFP_NAMES.length]
  );
}

// Short, generic, SFW blurbs — the kind a real player might jot on their profile.
// Deliberately name-agnostic (assigned by hash), so any bio fits any persona.
// Roughly half the roster gets one (personaBio); the rest stay blank, like real
// users where some wrote something and some never bothered. A moderator's bio
// override (houseIdentity) still wins over the baked one.
const HOUSE_BIOS: string[] = [
  "here for the blitz",
  "London System enjoyer",
  "1. e4 and pray",
  "coffee then chess",
  "always down for a rematch",
  "bullet addict, sorry",
  "trying to hit 2000 someday",
  "endgames are underrated",
  "gambit or bust",
  "just vibing",
  "chess is my cardio",
  "will trade queens for peace",
  "premove enthusiast",
  "still learning the Sicilian",
  "flag me if you can",
  "rapid > blitz, fight me",
  "chess and dogs",
  "here to blunder in style",
  "one more game, always",
  "knight before bishop, usually",
  "casual player, competitive heart",
  "back-rank mates ruin my day",
  "opening theory? never heard of it",
  "grinding the ladder slowly",
  "tea, rain, and a good game",
  "chess club refugee",
  "weekends only",
  "hoping for a brilliant move someday",
  "draws are a state of mind",
  "student by day, patzer by night",
  "traveling and playing",
  "self-taught, still trying",
  "long games, short patience",
  "here for the vibes and the wins",
  "Fischer random is real chess",
  "will resign gracefully, eventually",
  "checkmate or bust",
  "the pieces move themselves",
  "down bad in the endgame",
  "chess over everything",
];

/** A persona's baked bio. 2026-07 expansion wave: exactly half (150 of 300)
 * carry one unique line each from EXPANSION_BIOS; the other half stay blank.
 * Legacy roster keeps its stable hashed blurb for ~45% of personas. All
 * deterministic per name, so nothing flickers across deploys. Used as the
 * fallback under any staff bio override. */
export function personaBio(persona: HousePersona): string | null {
  if (EXPANSION_NAME_SET.has(persona.name)) {
    return EXPANSION_BIO_BY_NAME.get(persona.name) ?? null;
  }
  if (nameHash(persona.name + "|hasbio") % 100 >= 45) return null;
  return HOUSE_BIOS[nameHash(persona.name + "|bio") % HOUSE_BIOS.length];
}

/** True for a 2026-07 wave-2 expansion persona. Exported for the roster audit,
 * which checks that wave's own invariants (bio count, blank location). */
export function isExpansionPersona(name: string): boolean {
  return EXPANSION_NAME_SET.has(name);
}

const WAVE3_NAME_SET = new Set(WAVE3_DEFS.map(([name]) => name));

/** True for a 2026-07 wave-3 persona. */
export function isWave3Persona(name: string): boolean {
  return WAVE3_NAME_SET.has(name);
}

/** True for any 2026-07 wave persona (2 or 3). These carry NO fictional
 * location: an invented hometown on hundreds of accounts reads as generated,
 * and a blank location is the commonest shape on a real chess site anyway. Only
 * the original roster keeps its /mod-editor location labels. */
export function isNewWavePersona(name: string): boolean {
  return EXPANSION_NAME_SET.has(name) || WAVE3_NAME_SET.has(name);
}

/** Expansion-wave seeding facts, exported for the roster audit script. */
export const EXPANSION_SIZE = EXPANSION_DEFS.length;
export const EXPANSION_BIO_COUNT = EXPANSION_BIO_BY_NAME.size;
export const EXPANSION_BIO_POOL_SIZE = EXPANSION_BIOS.length;

// The avatar id space a house persona may hold: the full flowered catalog plus
// the house-pfp catalog. Exported for the /mod/house admin editor (its avatar
// picker offers exactly these, and the save route validates against this set),
// so an admin edit can move a persona between any two house looks but never
// outside the house-only avatar space.
export const HOUSE_AVATAR_IDS: readonly string[] = [...HOUSE_PFP_IDS, ...FLOWER_AVATARS];

// One plausible home base per persona (owner report: every bot showed the
// same location). Spread world-wide so the crowd reads like a real player base
// (assigned by roster index; the list wraps for the 210-deep roster, so some
// repeat). Shown only as a label in the /mod/house editor; it
// is NOT written into the profile bio anymore (that read as a weird
// auto-generated description). A bot's bio is empty until a moderator sets one
// (see HouseIdentityOverride / ensureHouseUsers / syncHouseRatings).
const HOUSE_LOCATIONS: string[] = [
  "🇧🇷 Curitiba, Brazil",
  "🇩🇪 Leipzig, Germany",
  "🇵🇭 Cebu City, Philippines",
  "🇺🇸 Columbus, Ohio",
  "🇵🇱 Wrocław, Poland",
  "🇮🇳 Pune, India",
  "🇬🇧 Sheffield, England",
  "🇦🇷 Rosario, Argentina",
  "🇨🇦 Halifax, Canada",
  "🇫🇷 Nantes, France",
  "🇺🇦 Lviv, Ukraine",
  "🇯🇵 Sendai, Japan",
  "🇪🇸 Zaragoza, Spain",
  "🇳🇴 Trondheim, Norway",
  "🇲🇽 Guadalajara, Mexico",
  "🇮🇹 Bologna, Italy",
  "🇹🇷 Izmir, Türkiye",
  "🇦🇺 Adelaide, Australia",
  "🇷🇸 Novi Sad, Serbia",
  "🇺🇸 Tacoma, Washington",
  "🇳🇱 Utrecht, Netherlands",
  "🇮🇩 Bandung, Indonesia",
  "🇨🇱 Valparaíso, Chile",
  "🇨🇿 Brno, Czechia",
  "🇿🇦 Durban, South Africa",
  "🇰🇷 Daejeon, South Korea",
  "🇵🇹 Braga, Portugal",
  "🇷🇴 Cluj-Napoca, Romania",
  "🇺🇸 Madison, Wisconsin",
  "🇬🇷 Thessaloniki, Greece",
  "🇻🇳 Da Nang, Vietnam",
  "🇸🇪 Gothenburg, Sweden",
  "🇨🇴 Medellín, Colombia",
  "🇭🇺 Debrecen, Hungary",
  "🇬🇧 Dundee, Scotland",
  "🇺🇸 Boise, Idaho",
  "🇦🇹 Graz, Austria",
  "🇲🇾 Penang, Malaysia",
  "🇵🇪 Arequipa, Peru",
  "🇫🇮 Tampere, Finland",
  "🇮🇳 Kochi, India",
  "🇮🇪 Galway, Ireland",
  "🇧🇬 Plovdiv, Bulgaria",
  "🇺🇸 Tucson, Arizona",
  "🇩🇪 Bremen, Germany",
  "🇹🇭 Chiang Mai, Thailand",
  "🇨🇦 Winnipeg, Canada",
  "🇭🇷 Split, Croatia",
  "🇪🇬 Alexandria, Egypt",
  "🇱🇹 Kaunas, Lithuania",
  "🇺🇾 Montevideo, Uruguay",
  "🇸🇰 Košice, Slovakia",
  "🇳🇿 Christchurch, New Zealand",
  "🇯🇵 Fukuoka, Japan",
  "🇧🇪 Ghent, Belgium",
  "🇺🇸 Richmond, Virginia",
  "🇪🇪 Tartu, Estonia",
  "🇲🇦 Casablanca, Morocco",
  "🇨🇭 Basel, Switzerland",
  "🇱🇻 Riga, Latvia",
];

export function nameHash(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash;
}

export const HOUSE_ROSTER: HousePersona[] = PERSONA_DEFS.map(([name, skill], i) => ({
  name,
  // 'hp_' prefix: distinct from real accounts (random hex ids) and from the
  // retired roster's 'bot_' ids, which migration 0008 deletes by prefix.
  userId: `hp_${name.toLowerCase()}`,
  skill,
  // The whole roster debuts with a "real uploaded-looking" scenic/object pfp:
  // a curated one (HOUSE_PFP_ASSIGN) where the name fits, else a name-hashed
  // one from the catalog. Stable per persona and varied across the roster.
  avatar: personaAvatar(name),
  // Legacy personas keep their /mod-editor location label. The 2026-07
  // expansion wave carries NO fictional location: a blank location is the
  // commonest shape on real chess sites anyway, and it keeps the expansion
  // personas from accumulating invented biography beyond their short bios.
  location: isNewWavePersona(name) ? "" : HOUSE_LOCATIONS[i % HOUSE_LOCATIONS.length],
}));

const HOUSE_USER_IDS = new Set(HOUSE_ROSTER.map((p) => p.userId));

/** house user id -> engine skill tier. The tier lives in code, never in the
 * database, so anything that wants to group archived games by tier (the
 * moderator overview's house-vs-human win rate) has to fold the rows in
 * TypeScript against this map rather than GROUP BY a column. */
export const HOUSE_BY_ID_SKILL: ReadonlyMap<string, HouseSkill> = new Map(
  HOUSE_ROSTER.map((p) => [p.userId, p.skill]),
);
const HOUSE_BY_ID = new Map(HOUSE_ROSTER.map((p) => [p.userId, p]));

// ---------------------------------------------------------------------------
// Per-persona style. Two bots on the same skill tier should not play (or pace)
// identically: each persona derives a stable style from its name — think tempo,
// how often it fires a held buff, how willing it is to bank a draft, and an
// aggression/risk lean that jitters the search's move-quality knobs. All
// deterministic (name-hashed), so a persona plays the same "personality" every
// session and across deploys.
// ---------------------------------------------------------------------------

export type HouseStyle = {
  /** Multiplier on think pacing: 0.75 (snappy) .. 1.35 (deliberate). */
  tempo: number;
  /** Chance per turn to fire a held activated buff instead of moving:
   * 0.25 .. 0.55 (the old roster-wide coin was a flat 0.40). */
  activationChance: number;
  /** Extra probability of banking a buff draft for a higher tier next round:
   * 0 .. 0.25. Cautious personas bank more, greedy ones almost never. */
  bankBias: number;
  /** 0..1 aggression/risk lean; drives the search jitter below. */
  aggression: number;
  /** How often this persona plays a recapture instantly, as if it had a premove
   * queued: 0.15 .. 0.50. See houseSnapReplyMs. */
  snapAppetite: number;
  /** Preferred first move as White (UCI), tried when legal. */
  openingWhite: string;
  /** Preferred reply to 1.e4 / 1.d4 as Black (UCI), tried when legal. */
  openingBlackVsE4: string;
  openingBlackVsD4: string;
};

const OPENING_WHITE = ["e2e4", "d2d4", "c2c4", "g1f3", "b2b3", "f2f4", "g2g3", "b1c3"];
const OPENING_BLACK_E4 = ["e7e5", "c7c5", "e7e6", "c7c6", "d7d6", "g7g6", "b8c6", "d7d5"];
const OPENING_BLACK_D4 = ["g8f6", "d7d5", "e7e6", "f7f5", "g7g6", "c7c5", "d7d6", "b8c6"];

export function houseStyle(persona: HousePersona): HouseStyle {
  const h = (salt: string, mod: number) => nameHash(persona.name + "|" + salt) % mod;
  return {
    tempo: 0.75 + h("tempo", 61) / 100, // 0.75..1.35
    activationChance: 0.25 + h("act", 31) / 100, // 0.25..0.55
    bankBias: h("bank", 26) / 100, // 0..0.25
    aggression: h("aggro", 101) / 100, // 0..1
    snapAppetite: 0.15 + h("snap", 36) / 100, // 0.15..0.50
    openingWhite: OPENING_WHITE[h("openw", OPENING_WHITE.length)],
    openingBlackVsE4: OPENING_BLACK_E4[h("openbe", OPENING_BLACK_E4.length)],
    openingBlackVsD4: OPENING_BLACK_D4[h("openbd", OPENING_BLACK_D4.length)],
  };
}

/** Apply a persona's style to a resolved profile: aggressive personas search a
 * touch hotter (more temperature — sharper, riskier picks), cautious ones a
 * touch colder, plus a small stable eval-noise jitter so same-tier personas
 * don't play move-for-move identical chess. Deterministic per persona; bounded
 * so it never leaves the sane clamp ranges. */
export function applyPersonaStyle(
  persona: HousePersona,
  profile: ResolvedSkillProfile,
): ResolvedSkillProfile {
  const style = houseStyle(persona);
  const tempJitter = Math.round((style.aggression - 0.5) * 60); // -30..+30
  const noiseJitter = nameHash(persona.name + "|noise") % 13; // 0..12
  return {
    ...profile,
    temperatureCp: Math.max(0, Math.min(400, profile.temperatureCp + tempJitter)),
    evalNoiseCp: Math.max(0, Math.min(200, profile.evalNoiseCp + noiseJitter)),
  };
}

// House-bot presence has TWO tiers, both drawn as a ROTATING, DAY-VARYING window
// of the full roster (same day offset, so the smaller set is always a
// prefix of the larger — no persona is "playing" without also being "online"):
//   • ACTIVE: the bots that actually seek, get picked up, and play filler.
//     The moderator does not thin this set; lobby load is tuned via the
//     concurrent house-GAMES target instead (HOUSE_GAMES_* / house_games).
//   • ONLINE: how many bots SHOW in the lobby's online list at once.
//     The active ones among them read as playing/searching; the rest just idle
//     "online" for a fuller lobby (they don't seek or play).
// The window's start advances each day (step coprime with the roster) so the
// site cycles through every persona over time. Every persona still holds a seeded
// account, so its profile/rating/leaderboard entry stay intact whether or not it
// is currently in a window.
// With the 2026-07 waves the roster is ~900 deep, and marking all of them
// online at once would read as absurd (and be one). The ACTIVE window (bots
// that seek / get picked up / play filler) breathes daily between 260 and 380
// — comfortably above the seat budget the filler-games cap needs (2 seats x
// HOUSE_GAMES_MAX = 280) plus pickup headroom — and the presence LIST shows at
// most HOUSE_PRESENCE_LIST_MAX at a time. Both windows rotate daily
// (houseWindowStart), so every persona cycles through availability over time:
// a believable "some regulars are on tonight, some aren't" schedule.
export const HOUSE_COUNT_MIN = 260;
export const HOUSE_COUNT_MAX = 380;

// --- The shown population ---------------------------------------------------
//
// Two different numbers, and it matters which is which:
//
//   HOUSE_PRESENCE_LIST_MAX  how many personas are ENUMERATED into the lobby's
//                            online list. Bounded on purpose: every entry is a
//                            row in the shared lobby snapshot, so this is the
//                            payload cost, and nobody scrolls past a few
//                            hundred names anyway.
//   houseOnlineCount(now)    the COUNT the site displays, which breathes
//                            between HOUSE_ONLINE_MIN and HOUSE_ONLINE_MAX.
//                            The DO pads the anonymous tally up to it
//                            (worker.ts), the same mechanism that used to hold
//                            a flat floor of 280.
//
// Separating them is what lets the shown population run to 800 without turning
// every lobby poll into a 60KB list.
// 400, not 300: the ACTIVE window must stay a subset of the presence list (the
// windows share a day offset so active is a prefix of online), and the active
// window has to cover 2 seats x HOUSE_GAMES_MAX plus pickup headroom. 400 rows
// costs roughly 32KB per lobby snapshot, up from 22KB at the old 280.
export const HOUSE_PRESENCE_LIST_MAX = 400;
export const HOUSE_ONLINE_MIN = 350;
export const HOUSE_ONLINE_MAX = 800;

/**
 * How many players the site reads as online at a given moment.
 *
 * Breathes on two cycles so the number drifts rather than stepping: a
 * time-of-day curve (a trough in the small hours, a peak in the evening, both
 * UTC) and a per-day scale so no two days peak identically. Deterministic in
 * `nowMs` alone, so every viewer polling at the same moment sees the same
 * number, and it never needs storing.
 */
export function houseOnlineCount(nowMs: number): number {
  const dayMs = 86_400_000;
  const dayIndex = Math.floor(nowMs / dayMs);
  const minuteOfDay = Math.floor((nowMs % dayMs) / 60_000);
  // 0 at 05:00 UTC (the trough), 1 at 17:00 UTC (the peak), smooth between.
  const phase = (((minuteOfDay - 300) % 1440) + 1440) % 1440;
  const tod = 0.5 - 0.5 * Math.cos((phase / 1440) * 2 * Math.PI);
  // 0.90..1.00: a quiet day tops out a little lower than a busy one.
  const dayScale = 0.9 + (nameHash("house-online:" + dayIndex) % 101) / 1000;
  const span = HOUSE_ONLINE_MAX - HOUSE_ONLINE_MIN;
  const n = Math.round(HOUSE_ONLINE_MIN + span * tod * dayScale);
  return Math.max(HOUSE_ONLINE_MIN, Math.min(HOUSE_ONLINE_MAX, n));
}

export function clampHouseCount(n: number): number {
  return Number.isFinite(n)
    ? Math.max(HOUSE_COUNT_MIN, Math.min(HOUSE_COUNT_MAX, Math.floor(n)))
    : HOUSE_COUNT_MIN;
}

/** The active count for a given day: a deterministic value in [MIN, MAX] that
 * changes daily so the house population breathes day to day. `dayIndex` = whole
 * days since the epoch (Math.floor(Date.now() / 86400000)); the DO passes it in so
 * this module stays clock-free (Date is unavailable in some call contexts). */
export function dailyHouseCount(dayIndex: number): number {
  const span = HOUSE_COUNT_MAX - HOUSE_COUNT_MIN + 1;
  return HOUSE_COUNT_MIN + (nameHash("house-count:" + Math.floor(dayIndex)) % span);
}

// The rotating window start for a day. Shared by the active and online windows so
// the active set is always a prefix of the online set. The step is coprime with a
// 210-deep roster (see HOUSE_WINDOW_STEP), so all offsets are visited over time —
// which is what guarantees EVERY persona rotates into the active window (and so
// becomes eligible for filler games) rather than a fixed subset always playing.
export const HOUSE_WINDOW_STEP = 31;
export function houseWindowStart(dayIndex: number): number {
  return (Math.floor(dayIndex) * HOUSE_WINDOW_STEP) % HOUSE_ROSTER.length;
}

/** A `size`-persona window starting at the day's rotating offset, wrapping the
 * roster. Clamped to the roster length; returns the whole roster when size >= it. */
function houseWindow(size: number, dayIndex: number): HousePersona[] {
  const len = HOUSE_ROSTER.length;
  const n = Math.max(0, Math.min(Math.floor(size), len));
  if (n >= len) return HOUSE_ROSTER.slice();
  const start = houseWindowStart(dayIndex);
  const out: HousePersona[] = [];
  for (let i = 0; i < n; i++) out.push(HOUSE_ROSTER[(start + i) % len]);
  return out;
}

/** The ACTIVE house personas for a day (seek / pickup / filler): a window of
 * `count` (clamped to 60-120), rotating daily. `dayIndex` defaults to 0 (a stable
 * first-N window) for pure/test callers that don't rotate. */
export function activeHouseRoster(count: number, dayIndex = 0): HousePersona[] {
  return houseWindow(clampHouseCount(count), dayIndex);
}

/** The ONLINE-presence personas for a day: the active window PLUS extra idle bots,
 * up to HOUSE_PRESENCE_LIST_MAX, sharing the same day offset so the active set is
 * a prefix. Used only for the lobby "online" LIST — the extra ones never
 * seek/play, and the shown COUNT comes from houseOnlineCount(), not from the
 * length of this list. */
export function onlineHouseRoster(dayIndex = 0): HousePersona[] {
  return houseWindow(HOUSE_PRESENCE_LIST_MAX, dayIndex);
}

export function isHouseUserId(id: string | null | undefined): boolean {
  return !!id && HOUSE_USER_IDS.has(id);
}

// ---------------------------------------------------------------------------
// Staff identity overrides (username / avatar / bio), stored in D1
// (house_identity_overrides, migrations/0025 + 0028's bio column) and edited
// from /mod/house by any moderator or admin.
// Resolution is always `override ?? default`: a NULL column (or a missing row)
// falls through to the baked persona constant (empty for bio — the roster no
// longer bakes a bio). The save route also writes the persona's users row, so
// every surface that reads identity from the database (profiles, leaderboard,
// lobby online list, seat attach) picks an edit up without a deploy; these
// helpers exist for the surfaces that would otherwise read the code constant
// (the /mod editor itself and syncHouseRatings, which must not clobber a
// staff-set avatar or bio on the next identity re-sync).
// ---------------------------------------------------------------------------

export type HouseIdentityOverride = {
  username: string | null;
  avatar: string | null;
  bio: string | null;
  // A hand-set rating (both modes and the legacy column) that survives resyncs;
  // null = no override, so the bot keeps its roster seed. See syncHouseRatings.
  rating: number | null;
};

/** All stored identity overrides, keyed by persona user id. Never throws: a
 * missing table (pre-migration database) or read failure reads as "no
 * overrides". Rows for ids no longer in the roster are ignored. */
export async function loadHouseIdentityOverrides(
  db: D1Database,
): Promise<Map<string, HouseIdentityOverride>> {
  try {
    const rows = await db
      .prepare(`SELECT user_id, username, avatar, bio, rating FROM house_identity_overrides`)
      .all<{
        user_id: string;
        username: string | null;
        avatar: string | null;
        bio: string | null;
        rating: number | null;
      }>();
    const map = new Map<string, HouseIdentityOverride>();
    for (const row of rows.results) {
      if (!HOUSE_USER_IDS.has(row.user_id)) continue;
      map.set(row.user_id, {
        username: row.username ?? null,
        avatar: row.avatar ?? null,
        bio: row.bio ?? null,
        rating: typeof row.rating === "number" ? row.rating : null,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

/** A persona's effective display identity: override ?? baked default. Bio falls
 * back to the persona's baked blurb (personaBio — set for ~45% of the roster,
 * null for the rest) when no staff override exists. */
export function houseIdentity(
  persona: HousePersona,
  override: HouseIdentityOverride | undefined | null,
): { name: string; avatar: string; bio: string | null } {
  return {
    name: override?.username || persona.name,
    avatar: override?.avatar || persona.avatar,
    bio: override?.bio || personaBio(persona),
  };
}

export function housePersona(userId: string): HousePersona | undefined {
  return HOUSE_BY_ID.get(userId);
}

export type BotDifficulty = "easy" | "medium" | "hard";

// The "Play vs bot" difficulty picker maps onto the house roster by advertised
// rating band, so a harder choice stakes more of your rating (the roster's real
// strength is capped by the DO search ceiling, but the rating on the line is
// what a rated game turns on). Easy takes the 1550 floor, hard the 1950+ top;
// medium the middle. Picks a persona NOT already seated in a live game (busy),
// falling back to any free persona when the band is fully committed, and null
// only when the entire roster is busy. Pure: the caller supplies both the busy
// set and the RNG so it stays deterministic and DO-state-free.
export function pickHouseBotByDifficulty(
  difficulty: BotDifficulty,
  busy: ReadonlySet<string>,
  rand: (n: number) => number,
  roster: readonly HousePersona[] = HOUSE_ROSTER,
): HousePersona | null {
  const inBand: Record<BotDifficulty, (skill: HouseSkill) => boolean> = {
    easy: (skill) => skill <= 1550,
    medium: (skill) => skill >= 1650 && skill <= 1900,
    hard: (skill) => skill >= 1950,
  };
  const free = roster.filter((persona) => !busy.has(persona.userId));
  if (!free.length) return null;
  const banded = free.filter((persona) => inBand[difficulty](persona.skill));
  const pool = banded.length ? banded : free;
  return pool[rand(pool.length)];
}

// ---------------------------------------------------------------------------
// Fair bot-vs-bot pairing.
//
// Filler (house-vs-house) games are what keep TV and the lobby full, and every
// persona holds a real leaderboard row, so a roster where the same handful of
// bots play constantly while others sit at zero games reads as fake. Pairing is
// therefore biased toward the personas with the FEWEST games played
// (weight ~ 1/(1+games)): a bot that is behind is picked more often, so counts
// converge over time and no bot lingers at zero. Rotation of the daily active
// window (houseWindowStart) is what eventually brings EVERY persona — including
// ones outside today's window — into the free pool this picks from.
// ---------------------------------------------------------------------------

// The second seat is kept within this many skill points of the first so a
// filler game is never a wild rating mismatch on the leaderboard/TV. Falls back
// to the whole pool when nobody sits in band.
export const HOUSE_FILLER_SKILL_WINDOW = 300;

/** Weighted pick of ONE index from `pool`, biased toward the lowest game count
 * (weight = 1/(1+games)). Pure: the caller supplies the RNG (an integer draw in
 * [0, n), matching randomInt / the sim's random). Returns -1 for an empty pool. */
function weightedFewestGamesIndex(
  pool: readonly HousePersona[],
  gamesOf: (userId: string) => number,
  rand: (max: number) => number,
): number {
  if (!pool.length) return -1;
  const weights = pool.map((p) => 1 / (1 + Math.max(0, gamesOf(p.userId))));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return rand(pool.length);
  // Scale a uniform draw in [0,1) up to [0,total). rand only yields integers, so
  // draw against a large modulus for enough resolution.
  let roll = (rand(1_000_000) / 1_000_000) * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return pool.length - 1;
}

/** Pick two DISTINCT personas for a bot-vs-bot filler game, both weighted toward
 * the fewest games played so games spread evenly across the roster over time,
 * with the second seat kept within a plausible skill band (HOUSE_FILLER_SKILL_
 * WINDOW) of the first. Pure — the caller supplies the free pool, a games lookup,
 * and the RNG. Returns null when fewer than two personas are free. */
export function pickHouseFillerPair(
  free: readonly HousePersona[],
  gamesOf: (userId: string) => number,
  rand: (max: number) => number,
): [HousePersona, HousePersona] | null {
  if (free.length < 2) return null;
  const i = weightedFewestGamesIndex(free, gamesOf, rand);
  const a = free[i];
  const rest = free.filter((_, idx) => idx !== i);
  const inBand = rest.filter((p) => Math.abs(p.skill - a.skill) <= HOUSE_FILLER_SKILL_WINDOW);
  const pool = inBand.length ? inBand : rest;
  const b = pool[weightedFewestGamesIndex(pool, gamesOf, rand)];
  return [a, b];
}

// Every persona now ADVERTISES its own tier, plus a stable name-hashed jitter of
// about +-40 so the roster does not debut as blocks of identical numbers. A
// 800-tier bot reads ~800, a 2500-tier bot reads ~2500.
//
// This replaced a three-layer stack that applied only to the legacy half of the
// roster (a +100 spread, sub-1600 tiers dropping 100-150, an owner boost of
// +100..+300, and a 2026-07 uplift of a further +300..+400). The stack made the
// advertised field impossible to reason about or to aim: two personas on the
// same tier could read 400 apart, and no tier's displayed band matched its
// engine strength. With the ratings tied to the tier, the ROSTER's distribution
// is set in one place (HOUSE_SKILL_WEIGHTS) and asserted by the audit, which is
// what lets the field be weighted toward genuine beginners.
function houseSeedBase(persona: HousePersona): number {
  return persona.skill - 40 + (nameHash(persona.name) % 81); // skill +-40 jitter
}

/** A bot's Nerf and Buff ratings differ by up to ~100 (like a real player who is
 * stronger at one mode): a stable 0..50 spread applied +/- around the base, with a
 * per-persona direction, so the two modes sit symmetric about houseSeedBase and
 * never more than 100 apart. Deterministic — re-derived identically on every sync. */
export function houseSeedRatingForMode(persona: HousePersona, mode: DraftMode): number {
  const spread = nameHash(persona.name + "|spread") % 51; // 0..50
  const buffHigher = nameHash(persona.name + "|dir") % 2 === 0;
  const delta = (mode === "buff") === buffHigher ? spread : -spread;
  return Math.max(100, houseSeedBase(persona) + delta);
}

/** The mode-neutral seeded rating: the base. Written to the legacy users.rating
 * column and used as the fallback wherever a live per-mode bucket isn't loaded. */
export function houseSeedRating(persona: HousePersona): number {
  return Math.max(100, houseSeedBase(persona));
}

/** D1 allows at most 100 bound parameters per query, and the roster is 210
 * deep — so any `IN (...)` bound over the FULL roster always throws, and since
 * every such call site catches defensively, the failure is silent: names fall
 * back to the baked persona constants and ratings to the seeds (the reported
 * "renamed a bot / rating moved, but the lobby's online list never updates").
 * Every roster-sized id list must be queried in chunks of this size and the
 * results merged. */
export const D1_MAX_IN_IDS = 90;

/** Split an id list into D1-safe chunks (see D1_MAX_IN_IDS). */
export function chunkIds<T>(ids: readonly T[], size = D1_MAX_IN_IDS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size) as T[]);
  return out;
}

/** Batch a large statement list in bounded chunks (the 210-deep roster produces
 * ~630 statements; D1 batches have practical size limits, so never send them all
 * at once). Order within a chunk is preserved; chunks run sequentially. */
async function batchInChunks(
  db: D1Database,
  statements: D1PreparedStatement[],
  size = 90,
): Promise<void> {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}

// House accounts seed as SETTLED ratings: RD 60 (a lichess-like floor for an
// active regular; the human floor is RD_MIN 45) and volatility 0.06. They are
// established residents of the ladder, not provisional accounts — a settled RD
// keeps their seeded numbers (and the roster's spread) stable instead of
// letting the first few games fling them hundreds of points, and keeps a
// provisional "?" off every bot profile. Never seed at or above
// PROVISIONAL_RD (110).
export const HOUSE_SEED_RD = 60;
export const HOUSE_SEED_VOL = 0.06;

// Create any missing house accounts, with both per-mode rating buckets seeded
// at the persona's skill. The password hash is unparseable on purpose
// (verifyPassword requires a "pbkdf2:" prefix), so nobody can sign in as one.
// Idempotent (INSERT OR IGNORE): safe to run on every cold start. Seeds with
// the staff identity override (username/avatar/bio) when one exists, so an edit
// saved before the account row existed (fresh database) still lands. A fresh
// bot with no bio override debuts with an empty bio (the roster no longer seeds
// its location as a bio).
export async function ensureHouseUsers(db: D1Database): Promise<void> {
  const now = Date.now();
  const overrides = await loadHouseIdentityOverrides(db);
  const statements = HOUSE_ROSTER.flatMap((persona) => {
    const override = overrides.get(persona.userId);
    // A hand-set rating override (rare here — the account usually predates any
    // edit) wins over the seed, so a rating saved before the row existed still
    // lands, mirroring how the identity override is applied.
    const base = override?.rating ?? houseSeedRating(persona);
    const identity = houseIdentity(persona, override);
    return [
      db
        .prepare(
          `INSERT OR IGNORE INTO users (id, username, username_lower, password_hash, created_at, rating, rd, vol, avatar, bio)
           VALUES (?, ?, ?, ?, ?, ?, ${HOUSE_SEED_RD}, ${HOUSE_SEED_VOL}, ?, ?)`,
        )
        .bind(persona.userId, identity.name, identity.name.toLowerCase(), "unusable", now, base, identity.avatar, identity.bio),
      // Nerf and Buff seed at DIFFERENT numbers (houseSeedRatingForMode), so a bot
      // reads like a real player who is stronger in one mode than the other — but
      // a hand-set override collapses both modes to that one number.
      ...(["nerf", "buff"] as const).map((mode) => {
        const r = override?.rating ?? houseSeedRatingForMode(persona, mode);
        return db
          .prepare(
            `INSERT OR IGNORE INTO user_ratings (user_id, category, rating, rd, vol, peak)
             VALUES (?, ?, ?, ${HOUSE_SEED_RD}, ${HOUSE_SEED_VOL}, ?)`,
          )
          .bind(persona.userId, mode, r, r);
      }),
    ];
  });
  await batchInChunks(db, statements);
}

/** The number of personas in the current roster — the target account count. */
export const HOUSE_ROSTER_SIZE = HOUSE_ROSTER.length;

/** How many of the CURRENT roster's accounts already exist in the users table.
 * Counts only the live roster's ids (not orphaned ids from retired rosters), so
 * it is an exact "how many personas are still missing an account" signal. One
 * cheap COUNT; the id list is the bounded roster size. Used to make seeding
 * self-healing: if this is below HOUSE_ROSTER_SIZE, personas are missing accounts
 * (a freshly grown roster, or a partial/failed prior seed) and ensureHouseUsers
 * must run to create them — the fix for "house bots with no account (ghosts)". */
export async function countSeededHouseUsers(db: D1Database): Promise<number> {
  try {
    // Chunked: the 210-id roster exceeds D1's bound-parameter cap in one IN().
    let n = 0;
    for (const chunk of chunkIds(HOUSE_ROSTER.map((p) => p.userId))) {
      const placeholders = chunk.map(() => "?").join(",");
      const row = await db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE id IN (${placeholders})`)
        .bind(...chunk)
        .first<{ n: number }>();
      n += row?.n ?? 0;
    }
    return n;
  } catch {
    // A read failure reads as "assume missing" so seeding runs rather than skips.
    return 0;
  }
}

// Re-point every EXISTING house account's rating (and its per-mode buckets) at
// the current houseSeedRating, and circulate identity revisions (avatar, bio).
// ensureHouseUsers only ever INSERTs (OR IGNORE), so once an account exists a
// roster revision never reaches it; this bounded UPDATE is what actually
// circulates one. House users only (every id comes from HOUSE_ROSTER), and
// idempotent: it writes the same deterministic values every time and peak only
// ever ratchets up (MAX). Bio handling: when a staff bio override exists it is
// written verbatim (a resync never clobbers it); with no override, any bio that
// still exactly equals the persona's baked location string is CLEARED (so older
// deployments that seeded the location-as-bio get cleaned up on the next
// resync), while any other non-empty bio is left untouched. The caller gates it
// behind a versioned cold-start key so it runs once per revision rather than
// every tick. Staff identity overrides (/mod/house) win over the baked avatar
// here, so a roster identity revision never undoes a moderator's edit.
export async function syncHouseRatings(db: D1Database): Promise<void> {
  const overrides = await loadHouseIdentityOverrides(db);
  const statements = HOUSE_ROSTER.flatMap((persona) => {
    const override = overrides.get(persona.userId);
    // A hand-set rating override wins over the roster seed for BOTH the legacy
    // users.rating and each mode bucket, so a rating edited from the House bot
    // menu is not reverted here on the next roster revision. No override = seed.
    const base = override?.rating ?? houseSeedRating(persona);
    const identity = houseIdentity(persona, override);
    return [
      // With a bio (staff override or the baked blurb), write it; otherwise clear
      // any leftover location-as-bio (older seed) and leave a real bio alone.
      // rd = MIN(rd, seed) settles any bot still carrying a wide seeded/legacy
      // deviation (older deployments seeded RD 150 — provisional!) without
      // undoing a LOWER rd a bot earned by actually playing.
      identity.bio !== null
        ? db
            .prepare(
              `UPDATE users SET rating = ?, rd = MIN(rd, ${HOUSE_SEED_RD}), avatar = ?, bio = ? WHERE id = ?`,
            )
            .bind(base, identity.avatar, identity.bio, persona.userId)
        : db
            .prepare(
              `UPDATE users SET rating = ?, rd = MIN(rd, ${HOUSE_SEED_RD}), avatar = ?, bio = CASE WHEN bio = ? THEN NULL ELSE bio END WHERE id = ?`,
            )
            .bind(base, identity.avatar, persona.location, persona.userId),
      // Re-point each mode bucket at its own per-mode number — or the hand-set
      // override, which collapses both modes to one number (peak only ratchets up).
      ...(["nerf", "buff"] as const).map((mode) => {
        const r = override?.rating ?? houseSeedRatingForMode(persona, mode);
        return db
          .prepare(
            `UPDATE user_ratings SET rating = ?, rd = MIN(rd, ${HOUSE_SEED_RD}), peak = MAX(peak, ?) WHERE user_id = ? AND category = ?`,
          )
          .bind(r, r, persona.userId, mode);
      }),
    ];
  });
  await batchInChunks(db, statements);
}

// ---------------------------------------------------------------------------
// The "OG NERFCHESS USERS" club — a big veteran club whose membership is a
// large share of the house roster, so the clubs directory has one obviously
// large, established club. Seeded idempotently (INSERT OR IGNORE) into the same
// clubs/club_members tables a real club uses (migrations/0005), so it renders,
// counts members, and shows a leaderboard exactly like a user-made club. Gated
// in worker.ts behind a SELF-HEALING count (countOgClubMembers < expected), not
// a one-shot key: a one-shot key that got set after a partial/empty seed (club
// row created, membership never landed, or members referenced not-yet-created
// ghost accounts) sticks forever and leaves the club permanently empty — the
// exact failure the house *accounts* had before the countSeededHouseUsers fix.
// Runs after ensureHouseUsers has guaranteed every persona's users row exists
// (the FKs on clubs.owner_user_id and club_members.user_id require it).
// ---------------------------------------------------------------------------

export const OG_CLUB_ID = "club_og_nerfchess";
export const OG_CLUB_SLUG = "og-nerfchess-users";
export const OG_CLUB_NAME = "OG NERFCHESS USERS";
const OG_CLUB_DESCRIPTION =
  "The veterans who were here from the start. Grizzled blitzers, endgame grinders, and gambit diehards who have seen every nerf come and go.";
// Curated club icon (see lib/clubIcons.ts): a gold crown for the founding crew.
const OG_CLUB_ICON = "Crown|gold";

/** The house personas that belong to the OG club: a deterministic ~65% slice of
 * the roster (plus the owner), so it reads as a large, long-established club.
 * Stable across deploys (name-hashed), and always includes the owner. */
export function ogClubMembers(): { owner: HousePersona; members: HousePersona[] } {
  // Owner: the highest advertised-rating persona (ties broken by name) — a
  // fitting "founder" for the veterans' club, and always present in the roster.
  const owner = [...HOUSE_ROSTER].sort(
    (a, b) => houseSeedRating(b) - houseSeedRating(a) || (a.name < b.name ? -1 : 1),
  )[0];
  const members = HOUSE_ROSTER.filter(
    (p) => p.userId === owner.userId || nameHash(p.name + "|ogclub") % 100 < 65,
  );
  return { owner, members };
}

/** Create (or ADOPT) the OG club and enroll its (large) house-bot membership.
 *
 * The target club is resolved by SLUG, not by our hardcoded id. `clubs.slug` is
 * NOT NULL UNIQUE (migrations/0005), so at most one club can hold OG_CLUB_SLUG —
 * and that club may be one a REAL USER created with this exact slug before the
 * seed ever ran. When that happens, our own `INSERT OR IGNORE` keyed by
 * OG_CLUB_ID conflicts on the slug and is silently ignored, our id never gets a
 * row, and the old `WHERE id = OG_CLUB_ID` guard bailed — leaving the named
 * veterans' club permanently bot-less (the live bug). So instead:
 *   • If a club already holds the slug, ADOPT it: enroll the house personas into
 *     THAT club id as plain 'member' rows. We NEVER rewrite its owner, name,
 *     description, or icon — a user-made club keeps its own identity; adoption
 *     only ADDS bot members. The existing owner's row is left untouched (and we
 *     skip inserting one for it, so it is never duplicated or downgraded).
 *   • If NO club holds the slug, create ours (id=OG_CLUB_ID, owner=apexpawn) and
 *     seed apexpawn as 'owner' plus the rest as 'member' — the original behavior.
 *
 * Idempotent: INSERT OR IGNORE throughout, so re-running never duplicates rows,
 * disturbs a membership a user joined, or overwrites a club's identity. Safe to
 * run on every cold start (adopting an already-populated club is a no-op). */
export async function ensureOgClub(db: D1Database): Promise<void> {
  const now = Date.now();
  const { owner, members } = ogClubMembers();
  // Resolve the target by SLUG. An existing row here may be user-made (a
  // different id and a real, non-bot owner) or a prior seed of ours.
  let target = await db
    .prepare("SELECT id, owner_user_id FROM clubs WHERE slug = ?")
    .bind(OG_CLUB_SLUG)
    .first<{ id: string; owner_user_id: string }>();
  if (!target) {
    // Nobody holds the slug yet: create ours exactly as before.
    await db
      .prepare(
        `INSERT OR IGNORE INTO clubs (id, slug, name, description, icon, owner_user_id, owner_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(OG_CLUB_ID, OG_CLUB_SLUG, OG_CLUB_NAME, OG_CLUB_DESCRIPTION, OG_CLUB_ICON, owner.userId, owner.name, now)
      .run();
    // Re-read by slug (a concurrent seed could have raced us to it).
    target = await db
      .prepare("SELECT id, owner_user_id FROM clubs WHERE slug = ?")
      .bind(OG_CLUB_SLUG)
      .first<{ id: string; owner_user_id: string }>();
    if (!target) return;
  }
  // "Our own" club: our canonical id owned by the founder persona. Only then is
  // apexpawn seeded as 'owner'; when adopting any other club, every persona
  // (apexpawn included) joins as a plain 'member' and the club's real owner row
  // is left alone.
  const isOurClub = target.id === OG_CLUB_ID && target.owner_user_id === owner.userId;
  const clubId = target.id;
  const clubOwnerId = target.owner_user_id;
  const statements = members
    // Never write a membership row for the adopted club's existing owner — its
    // own owner row stays as-is (INSERT OR IGNORE would ignore a duplicate PK,
    // but skipping makes "no downgrade / no duplicate" explicit).
    .filter((p) => isOurClub || p.userId !== clubOwnerId)
    .map((p) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO club_members (club_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`,
        )
        .bind(clubId, p.userId, isOurClub && p.userId === owner.userId ? "owner" : "member", now),
    );
  await batchInChunks(db, statements);
}

/** How many members the OG club would actually render: club_members rows whose
 * user_id resolves to a LIVE users row — the same INNER JOIN the club detail
 * route uses, so this counts exactly what the page would show. The club is
 * resolved by SLUG first (mirroring the detail route and ensureOgClub), so this
 * measures whichever club holds OG_CLUB_SLUG — including a user-made club we
 * ADOPT — and therefore converges: once the bots are enrolled into that club the
 * count exceeds the expected membership and the self-healing gate stops re-
 * running. When NO club holds the slug yet, returns 0 so the seed runs and
 * creates it. Used to make OG-club seeding self-healing (mirrors
 * countSeededHouseUsers): below the expected membership size means empty or
 * partial (a stuck one-shot seed, a failed/partial club_members batch, or
 * members that referenced not-yet-created ghost accounts) and ensureOgClub must
 * re-run. A read failure reads as "assume empty" so seeding runs rather than
 * skips. */
export async function countOgClubMembers(db: D1Database): Promise<number> {
  try {
    const club = await db
      .prepare("SELECT id FROM clubs WHERE slug = ?")
      .bind(OG_CLUB_SLUG)
      .first<{ id: string }>();
    if (!club) return 0;
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM club_members cm JOIN users u ON u.id = cm.user_id WHERE cm.club_id = ?`,
      )
      .bind(club.id)
      .first<{ n: number }>();
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Populate EVERY OTHER club with a plausible house-bot membership.
//
// The OG club (ensureOgClub above) is the one big, hand-owned veterans' club.
// Every OTHER club in the table -- user-made ones, or any seeded elsewhere --
// otherwise reads as dead in the clubs directory: an owner and nobody else.
// This seeds each such club with a DETERMINISTIC 10-20 house-bot slice enrolled
// as plain 'member' rows, so the directory looks alive without touching a
// club's owner row, its identity (name/description/icon), or any real user's
// membership. INSERT OR IGNORE throughout, and the slice is a stable function
// of the club's slug, so re-running never duplicates rows or shifts who is in a
// club -- it only fills gaps (self-healing, like ensureHouseUsers/ensureOgClub).
// Runs after ensureHouseUsers so every persona's users row exists (the
// club_members.user_id FK needs it). A bot may belong to several clubs; that is
// fine and reads like a real regular who joined a few.
// ---------------------------------------------------------------------------

/** Inclusive per-club bot-membership target band. Every non-OG club is filled
 * to a deterministic count in [CLUB_FILL_MIN, CLUB_FILL_MAX]. */
export const CLUB_FILL_MIN = 10;
export const CLUB_FILL_MAX = 20;

/** A club's deterministic bot-membership target in [CLUB_FILL_MIN,
 * CLUB_FILL_MAX], hashed from its slug so it is stable across cold starts and
 * varies club to club (so the directory shows a range of club sizes). */
export function clubBotTargetCount(slug: string): number {
  const span = CLUB_FILL_MAX - CLUB_FILL_MIN + 1;
  return CLUB_FILL_MIN + (nameHash(slug + "|clubfill") % span);
}

/** The DETERMINISTIC house-bot slice for a club: `count` personas chosen by
 * hashing each persona's name against the club slug and taking the lowest-hash
 * `count`. Stable across deploys (name/slug hash, no RNG) and well spread across
 * the roster (a different club draws a different slice). Never exceeds the
 * roster. Bots may recur across clubs -- there is no cross-club exclusivity. */
export function clubBotMembers(slug: string, count: number): HousePersona[] {
  const n = Math.max(0, Math.min(Math.floor(count), HOUSE_ROSTER.length));
  return [...HOUSE_ROSTER]
    .sort((a, b) => {
      const ha = nameHash(a.name + "|" + slug);
      const hb = nameHash(b.name + "|" + slug);
      return ha - hb || (a.name < b.name ? -1 : 1);
    })
    .slice(0, n);
}

/** Enroll a deterministic 10-20 house-bot membership into EVERY club except the
 * OG club (which ensureOgClub owns, with its own larger membership). For each
 * club, the slice from clubBotMembers is inserted as plain 'member' rows with
 * INSERT OR IGNORE, skipping the club's own owner row so an owner is never
 * duplicated or downgraded (real or bot). Real members' rows are never touched
 * (we only ever INSERT house-bot ids, and OR IGNORE leaves any existing row as
 * is). Idempotent and self-healing: safe to run on every cold start. */
export async function ensureClubsPopulated(db: D1Database): Promise<void> {
  const clubs = await db
    .prepare("SELECT id, slug, owner_user_id FROM clubs")
    .all<{ id: string; slug: string; owner_user_id: string }>();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const club of clubs.results) {
    // The OG club keeps its own (larger) seed via ensureOgClub; never shrink or
    // re-seed it here.
    if (club.slug === OG_CLUB_SLUG) continue;
    const members = clubBotMembers(club.slug, clubBotTargetCount(club.slug));
    for (const p of members) {
      // Never write a membership row for the club's existing owner (bot or real):
      // its owner row stays exactly as-is.
      if (p.userId === club.owner_user_id) continue;
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO club_members (club_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`,
          )
          .bind(club.id, p.userId, now),
      );
    }
  }
  if (statements.length) await batchInChunks(db, statements);
}

/** How many non-OG clubs currently have FEWER live house-bot members than their
 * target -- the self-healing gate for ensureClubsPopulated (mirrors
 * countOgClubMembers). Counts only club_members whose user_id is a house bot AND
 * resolves to a live users row (the same INNER JOIN the detail route renders),
 * so a club short of its target -- freshly created, or a partial prior seed --
 * is detected and re-seeded. A read failure reads as "assume short" (returns a
 * positive number) so seeding runs rather than skips. Returns 0 when every club
 * is already at or above its target (the steady state), so the seed becomes a
 * no-op without touching D1. */
export async function countUnderpopulatedClubs(db: D1Database): Promise<number> {
  try {
    const clubs = await db
      .prepare("SELECT id, slug FROM clubs")
      .all<{ id: string; slug: string }>();
    const targets = clubs.results.filter((c) => c.slug !== OG_CLUB_SLUG);
    if (!targets.length) return 0;
    // Chunked: the 210-id roster exceeds D1's bound-parameter cap in one IN();
    // per-club counts from each chunk sum to the same total.
    const byClub = new Map<string, number>();
    for (const chunk of chunkIds(HOUSE_ROSTER.map((p) => p.userId))) {
      const placeholders = chunk.map(() => "?").join(",");
      const rows = await db
        .prepare(
          `SELECT cm.club_id AS club_id, COUNT(*) AS n
           FROM club_members cm JOIN users u ON u.id = cm.user_id
           WHERE cm.user_id IN (${placeholders})
           GROUP BY cm.club_id`,
        )
        .bind(...chunk)
        .all<{ club_id: string; n: number }>();
      for (const r of rows.results) byClub.set(r.club_id, (byClub.get(r.club_id) ?? 0) + r.n);
    }
    let short = 0;
    for (const club of targets) {
      if ((byClub.get(club.id) ?? 0) < clubBotTargetCount(club.slug)) short++;
    }
    return short;
  } catch {
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Seek selection: which pool and mode a house player advertises.
// ---------------------------------------------------------------------------

// Blitz-heavy, like real traffic, and short enough that a bot-vs-bot game
// never ties up a roster seat (or its move alarms) for long.
const HOUSE_POOL_WEIGHTS: Array<[pool: string, weight: number]> = [
  ["1+0", 1],
  ["2+1", 1],
  ["3+0", 3],
  ["3+2", 3],
  ["5+0", 2],
  ["5+3", 2],
];

// Filler (bot-vs-bot) games pace their moves several times slower than a
// human-facing bot (worker.ts houseFillerThinkMultiplier) to keep 40+ of them
// affordable on the single-threaded DO, so the ultra-short pools (1+0, 2+1)
// would flag after a handful of moves and read as broken on TV. Filler games
// draw from the longer blitz pools instead.
const HOUSE_FILLER_POOL_WEIGHTS: Array<[pool: string, weight: number]> = [
  ["3+0", 1],
  ["3+2", 2],
  ["5+0", 3],
  ["5+3", 3],
];

function weightedPoolRoll(
  weights: Array<[pool: string, weight: number]>,
  random: (max: number) => number,
): string {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random(total);
  for (const [name, weight] of weights) {
    roll -= weight;
    if (roll < 0) return name;
  }
  return "3+2";
}

/** Pool + mode for a new house seek: weighted blitz pools, an even 50/50
 * split of Buff and Nerf so neither queue is starved. */
export function pickHouseSeek(random: (max: number) => number): { pool: string; mode: DraftMode } {
  return {
    pool: weightedPoolRoll(HOUSE_POOL_WEIGHTS, random),
    mode: random(2) === 0 ? "buff" : "nerf",
  };
}

/** Pool + mode for a bot-vs-bot filler game: the longer blitz pools only (the
 * slower filler move pacing would flag out a 1+0 game almost immediately). */
export function pickHouseFillerSeek(random: (max: number) => number): { pool: string; mode: DraftMode } {
  return {
    pool: weightedPoolRoll(HOUSE_FILLER_POOL_WEIGHTS, random),
    mode: random(2) === 0 ? "buff" : "nerf",
  };
}

/** Card ids that must NEVER be drafted or played in a bot-vs-bot FILLER game.
 * Chess Diff (id "chess_diff") pauses the running game and spawns a whole fresh
 * game of chess on top of it (see its def in engine/buffs/library.ts and
 * ChessDiffState in buff.ts): a board-rewriting mechanic that has caused
 * spectator (TV) reconstruction problems. Filler games are pure lobby/TV
 * decoration, so it is simply removed from their draft pool -- worker.ts folds
 * these into the filler match's draft-pool override `off` set, exactly like a
 * moderator-disabled card, so they are never OFFERED (hence never picked or
 * cast) in a filler game. Human-vs-bot and human games are unaffected: this set
 * is applied ONLY to bot-only filler matches, never to a human's match. The card
 * itself is not touched globally -- it stays draftable everywhere else. */
export const FILLER_EXCLUDED_CARD_IDS: readonly string[] = ["chess_diff"];

// ---------------------------------------------------------------------------
// Filler concurrency targets (owner spec): the Watch tab / TV should always
// show a busy site, so the steady state is 80-120 SIMULTANEOUS bot-vs-bot games
// (160-240 seated bots), never dipping below the floor while the house is
// enabled. Shared between worker.ts (the spawner) and the sim so the sim
// asserts the exact production numbers.
//
// 2026-07: raised from 40-55. This is safe ONLY because filler no longer runs
// inside the game-server Durable Object: arena-service owns it
// (ARENA_OWNS_FILLER, with the DO standing down at worker.ts's arena-health
// check), and the arena runs each search on a worker_threads pool rather than
// its own event loop. The DO's per-tick caps (houseMaxActionsPerTick,
// houseTickBudgetMs, HOUSE_SEARCH_CEILING_MS) are unchanged and still govern the
// fallback path, so a dead arena degrades to the old, slow, DO-local behaviour
// instead of stalling the single thread.
// ---------------------------------------------------------------------------

/** Minimum concurrent bot-vs-bot games at steady state. */
export const HOUSE_VS_HOUSE_FLOOR = 80;
/** Hard cap on concurrent bot-vs-bot games (natural variance runs 80-120). */
export const HOUSE_VS_HOUSE_CAP = 120;
/** Spawn-ahead hysteresis: the spawner keeps ramping quickly until this many
 * games ABOVE the floor are live, so the count settles comfortably above the
 * floor and a normal trickle of games ending never drops it below the floor
 * before the next spawn lands. Sized well above the floor (not just +4): filler
 * games end in short bursts (a wave spawned during ramp-up flags out around the
 * same time), so the steady band must sit high enough that a whole burst ending
 * still leaves the count above 40. */
export const HOUSE_FILLER_SPAWN_BUFFER = 10;

// ---------------------------------------------------------------------------
// Moderator "Active games" target (app_settings.house_games).
//
// How many house-vs-house FILLER games to keep live at once — the games that
// make the Watch tab / lobby look busy — pinned from the /mod slider in
// [HOUSE_GAMES_MIN, HOUSE_GAMES_MAX]. The game-server DO reads it per tick
// (houseGamesTarget, cached ~15s) and clamps it against the live seat budget
// (2 bots per filler game) before spawning, so a pin can never oversubscribe the
// roster. An unset / blank / garbage value falls back to HOUSE_GAMES_DEFAULT (the
// long-standing 40-55 band's ceiling), so out of the box nothing changes. 0 is a
// valid pin: no filler games at all (human-vs-bot pickups still work, since the
// spawner keeps separate headroom for them).
// ---------------------------------------------------------------------------
export const HOUSE_GAMES_MIN = 0;
export const HOUSE_GAMES_MAX = 140;
/** The default concurrent-filler target when a moderator has not pinned one: the
 * historical cap, so unpinned behaviour stays the familiar 40-55 band. */
export const HOUSE_GAMES_DEFAULT = HOUSE_VS_HOUSE_CAP;
/** Clamp a raw games target into [HOUSE_GAMES_MIN, HOUSE_GAMES_MAX]; a non-finite
 * value reads as the default. */
export function clampHouseGames(n: number): number {
  return Number.isFinite(n)
    ? Math.max(HOUSE_GAMES_MIN, Math.min(HOUSE_GAMES_MAX, Math.floor(n)))
    : HOUSE_GAMES_DEFAULT;
}

/** How many times slower a bot-vs-bot filler game paces its moves than a bot
 * facing a human (passed to houseThinkMs as thinkMultiplier). Filler is
 * lobby/TV decoration; slowing it keeps 40+ concurrent games affordable on the
 * single-threaded DO. Exported so worker.ts (the spawner) and the sim (which
 * derives realistic filler game lifetimes from it) share one source of truth. */
export const HOUSE_FILLER_THINK_MULTIPLIER = 8;

/** Delay until the NEXT filler spawn given how many bot-vs-bot games are live
 * after this one. Below floor+buffer: a brisk 1.5-3s stagger, so a cold start
 * ramps to the 40-game floor over ~2 minutes (one bounded spawn per tick, never
 * a 40-game burst) and a dip recovers within seconds. At/above: a moderate
 * 4-8s spacing -- fast enough to outpace the rate blitz filler games end at
 * (they flag or finish in a few minutes, so turnover across ~50 live games is
 * brisk), keeping the population pressed up into the high-40s/low-50s band
 * rather than bleeding below the floor between spawns. The seek reserve and the
 * seat/game caps in worker.ts bound the top of the band. */
export function houseFillerSpawnDelayMs(
  liveFillerGames: number,
  random: (max: number) => number,
): number {
  return liveFillerGames < HOUSE_VS_HOUSE_FLOOR + HOUSE_FILLER_SPAWN_BUFFER
    ? 1500 + random(1501)
    : 4000 + random(4001);
}

// ---------------------------------------------------------------------------
// Pacing: how long a house player "thinks" before an action lands.
// ---------------------------------------------------------------------------

/** Move pacing: uniform 1-4s, with roughly 1 move in 10 tanking 6-10s. The
 * delay is clamped hard once the bot's own clock runs low so pacing can never
 * flag a bot that still has bank left.
 *
 * `thinkMultiplier` (default 1) slows the BASE think for bot-vs-bot filler games
 * (worker.ts houseFillerThinkMultiplier), keeping 40+ of them affordable on the
 * single-threaded DO. It is applied to the base delay HERE, BEFORE the low-clock
 * clamps below, so a slowed filler bot is still bounded by its own remaining
 * clock and cannot overthink itself into a premature flag. (The multiply used to
 * live at the call site, AFTER the clamp, so it multiplied the clamp too -- a
 * filler bot's "safe" move could reach ~1.6x its remaining clock and it flagged
 * out within a handful of moves, collapsing steady-state concurrency far below
 * the floor.) */
export function houseThinkMs(
  random: (max: number) => number,
  myClockMs: number,
  timeSec: number,
  thinkMultiplier = 1,
  /** Persona tempo (houseStyle().tempo, 0.75-1.35): a stable per-bot pacing
   * lean, applied with the filler multiplier BEFORE the low-clock clamps so a
   * deliberate persona still can never overthink itself into a flag. */
  tempo = 1,
): number {
  const hasClock = timeSec > 0;
  // Fast time controls (1+0, 2+1, 3+0 and the like, base <= 3 min): the bot
  // answers snappily in 1-3s so a bullet/blitz game against a bot feels live and
  // never drags. Slower controls keep the more humanlike, occasionally-longer
  // think below.
  const fast = hasClock && timeSec <= 180;
  let delay: number;
  if (fast) delay = 1000 + random(2001); // 1-3s
  else if (random(10) < 9) delay = 1000 + random(3001); // 1-4s
  else delay = 6000 + random(4001); // 6-10s

  // Filler pacing slows the base think, and the persona tempo leans it, but
  // both are still bounded by the clock clamps below, so neither can cause a
  // premature flag.
  if (thinkMultiplier > 1) delay = Math.round(delay * thinkMultiplier);
  if (tempo !== 1) delay = Math.round(delay * Math.max(0.5, Math.min(1.5, tempo)));

  if (hasClock) {
    if (myClockMs < 10_000) delay = Math.min(delay, 300 + random(501));
    else if (myClockMs < 25_000) delay = Math.min(delay, 700 + random(801));
    else if (delay > myClockMs / 5) delay = Math.max(500, Math.floor(myClockMs / 5));
  }
  return delay;
}

/**
 * The "I had that premoved" reply: a near-instant 120-350ms delay instead of the
 * normal think, played SOMETIMES and only when there was nothing to think about.
 *
 * Real players queue premoves, and the tell is unmistakable: the recapture comes
 * back before you have let go of the mouse. House bots never did this — every
 * move took at least a second, which is a giveaway in the other direction, and
 * the one place it reads worst is a trade, where a human answers instantly and a
 * bot sat there "thinking" about its only sensible move.
 *
 * Returns a snap delay, or null to pace normally. Conditions, all required:
 *   - the opponent's last move was a CAPTURE on a square this bot can recapture
 *     (or the bot has exactly one legal move, which is the other case a human
 *     always premoves), and
 *   - the persona's own appetite roll comes up. Appetite is 0.15-0.50 per
 *     persona, so the same bot is consistently snappy or consistently
 *     deliberate, and no bot snaps EVERY time — a bot that always premoved the
 *     recapture would be as robotic as one that never did.
 *
 * Deliberately NOT a strength change: the move still comes from the normal
 * search, with the same blunder roll. This only changes how long the bot waits
 * before playing it, so a snapped recapture can still be the wrong recapture.
 */
export function houseSnapReplyMs(
  persona: HousePersona,
  random: (max: number) => number,
  opts: {
    /** The square the opponent just captured on, if their last move was a capture. */
    capturedOn: number | null;
    /** Squares this bot could recapture on (the `to` of each of its legal captures). */
    myCaptureTargets: readonly number[];
    /** How many legal moves this bot has. */
    legalCount: number;
  },
): number | null {
  const forced = opts.legalCount === 1;
  const recapture =
    opts.capturedOn != null && opts.myCaptureTargets.includes(opts.capturedOn);
  if (!forced && !recapture) return null;
  const appetite = houseStyle(persona).snapAppetite;
  // A forced move is premoved far more often than a discretionary recapture:
  // there is literally nothing else to play.
  const chance = forced ? Math.min(0.9, appetite + 0.4) : appetite;
  if (random(1000) >= Math.round(chance * 1000)) return null;
  return 120 + random(231); // 120-350ms
}

/**
 * Gather what houseSnapReplyMs needs from a live position: whether the opponent
 * just captured, where, which squares this side could recapture on, and how many
 * legal moves it has.
 *
 * Kept beside houseSnapReplyMs (rather than duplicated in the DO and the arena)
 * so both callers ask the question the same way. Costs one legal-move
 * generation, so only call it where the position is already in hand.
 */
export function snapContext(
  game: NerfGame,
  me: Color,
): { capturedOn: number | null; myCaptureTargets: number[]; legalCount: number } {
  const history = game.board.history;
  const last = history.length ? history[history.length - 1] : null;
  const capturedOn = last && last.color !== me && last.captured ? last.to : null;
  const mine = legalMoves(game);
  return {
    capturedOn,
    myCaptureTargets: capturedOn == null ? [] : mine.filter((m) => m.captured).map((m) => m.to),
    legalCount: mine.length,
  };
}

/** Draft pacing: 2-8s before a pick lands, comfortably inside the 15s
 * lock-in window (the server's deadline auto-resolve is the backstop). */
export function houseDraftThinkMs(random: (max: number) => number): number {
  return 2000 + random(6001);
}

// House social responses — accepting a friend request or a direct challenge —
// land after a short, humanlike beat rather than instantly: a bot that friended
// or accepted you the millisecond you asked would read as a machine. ~8-20s
// (centered near ~14s), jittered so a burst of requests never resolves in
// lockstep.
export const HOUSE_SOCIAL_MIN_DELAY_MS = 8_000;
export const HOUSE_SOCIAL_MAX_DELAY_MS = 20_000;

/** The accept delay for one bot social action, ~8-20s, derived DETERMINISTICALLY
 * from a stable per-request seed (e.g. the request's ids + created_at). The
 * server polls pending requests rather than holding a timer, so the delay must
 * be the same on every tick — a fresh random each poll would keep moving the
 * finish line. Compare `now - requestedAt >= houseSocialDelayMs(seed)`. */
export function houseSocialDelayMs(seed: string): number {
  const span = HOUSE_SOCIAL_MAX_DELAY_MS - HOUSE_SOCIAL_MIN_DELAY_MS + 1;
  return HOUSE_SOCIAL_MIN_DELAY_MS + (nameHash(seed) % span);
}

// ---------------------------------------------------------------------------
// Move selection.
// ---------------------------------------------------------------------------

/** Search budget for one house move: the resolved profile's budget, shrunk
 * when the clock runs low, and never above `ceilingMs` (default: the DO-safe
 * ceiling — pass a higher one only where the search can't stall a shared
 * thread, i.e. the OCI engine service). */
export function houseMoveBudgetMs(
  budgetMs: number,
  remainingClockMs?: number,
  ceilingMs: number = HOUSE_SEARCH_CEILING_MS,
): number {
  let budget = Math.min(budgetMs, ceilingMs);
  if (remainingClockMs != null && remainingClockMs < 30_000) budget = Math.min(budget, 25);
  return Math.max(10, budget);
}

/** Pick the house player's move. Strength comes from the resolved profile's
 * budget, blunder probability, and move-quality weakening (topK/temperature/
 * noise). Pass `profile` to use a moderator-resolved strength (the DO does, per
 * move); omit it and the baked profile for the tier is used, so every existing
 * caller (DO local fallback, arena service, sim script) is unchanged.
 * `ceilingMs` defaults to the DO-safe cap; only the OCI engine service passes a
 * higher one, since search there costs the DO nothing.
 * Returns null only when the position has no legal move at all. */
export function pickHouseMove(
  game: NerfGame,
  skill: HouseSkill,
  random: (max: number) => number,
  remainingClockMs?: number,
  ceilingMs?: number,
  profile?: ResolvedSkillProfile,
  persona?: HousePersona,
): Move | null {
  let p = profile ?? bakedResolvedProfile(skill);
  // Persona style: a stable per-bot jitter on the search's move-quality knobs,
  // so same-tier personas don't play move-for-move identical chess.
  if (persona) p = applyPersonaStyle(persona, p);
  const all = legalMoves(game);
  if (!all.length) return null;
  // Opening preference: on each side's FIRST move a persona usually (70%)
  // reaches for its pet opening when that move is legal, so different bots
  // steer games into different structures instead of all converging on the
  // search's one favorite line. Draft cards can rewrite the opening position,
  // in which case the preferred square may be illegal and the search decides.
  if (persona && game.board.history.length < 2 && random(10) < 7) {
    const style = houseStyle(persona);
    const last = game.board.history[0];
    const preferred =
      game.board.history.length === 0
        ? style.openingWhite
        : last && moveToUCI(last) === "e2e4"
        ? style.openingBlackVsE4
        : last && moveToUCI(last) === "d2d4"
        ? style.openingBlackVsD4
        : null;
    if (preferred) {
      const move = all.find((m) => moveToUCI(m) === preferred);
      if (move && !triggersOwnNerfLoss(game, move)) return move;
    }
  }
  if (random(10_000) < Math.round(p.blunderChance * 10_000)) {
    const safe = all.filter((m) => !triggersOwnNerfLoss(game, m));
    const moves = safe.length ? safe : all;
    return moves[random(moves.length)];
  }
  const budget = houseMoveBudgetMs(p.budgetMs, remainingClockMs, ceilingMs);
  return pickAIMove(game, p.level, budget, { params: weakenParamsOf(p), random });
}

/** Opening nerf pick: between the two dealt options, prefer the lower tier
 * (the milder handicap); random on a tie. Pure so a deadline re-roll lands
 * the same way. `tiers` are looked up by the caller (worker has the library). */
export function houseNerfPickIndex(tiers: [number, number], random: (max: number) => number): 0 | 1 {
  if (tiers[0] < tiers[1]) return 0;
  if (tiers[1] < tiers[0]) return 1;
  return random(2) as 0 | 1;
}
