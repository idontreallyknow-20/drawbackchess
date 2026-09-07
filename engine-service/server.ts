// nerfchess house-bot engine service (Tier 1).
//
// Runs on the OCI box. Given a stored-match subset, it replays the position
// with the bundled engine and returns a house move — moving the (unbounded,
// CPU-heavy) engine search off the single-threaded game-server Durable Object.
// See docs/bot-offload-tier1-engine-service.md.
//
// Stateless. No DB. The only trust it grants is the shared bearer token.
// Build:  node build.mjs   ->  dist/server.mjs
// Run:    node dist/server.mjs   (env from /etc/nerfchess-engine.env)

import { createServer, type IncomingMessage } from "node:http";
import { replayToPosition, type EngineMatch } from "../src/engine/replay";
import {
  HOUSE_SKILL_PROFILES,
  pickHouseMove,
  sanitizeResolvedProfile,
  type HouseSkill,
} from "../src/lib/server/bots";

const TOKEN = process.env.HOUSE_ENGINE_TOKEN ?? "";
const REPLAY_VERSION = Number(process.env.ENGINE_REPLAY_VERSION ?? "0");
const PORT = Number(process.env.PORT ?? "8787");
// Unlike the DO, this box has no shared thread to protect — search here costs
// nothing else. This is a non-binding safety cap (today's tiers top out at
// 800ms, see bots.ts); actual wall time can run to ~2x nominal budgetMs
// (negamax's own timeout check fires at budget*2) plus ~600ms of tunnel/
// network overhead over the public path, so the real ceiling on worst-case
// latency is the per-tier budgetMs values, sized (and measured against the
// public URL) to leave margin under the Worker's HOUSE_ENGINE_TIMEOUT_MS
// (3000ms).
// Doubled from 900 with the 2026-09 deadline change. negamax used to abort at
// `budget * 2`, so a 900ms request really spent 1.8-2.25s; it now hard-deadlines
// at the ask, so 900 would have halved every house tier's think time. 1800 here
// is the same real spend these tiers always had, and it is now a BOUND rather
// than a midpoint, which is more margin below the worker's 3000ms
// HOUSE_ENGINE_TIMEOUT_MS than before. Moves in lockstep with
// HOUSE_SKILL_PROFILES and WEAKEN_CLAMP.budgetMs in src/lib/server/bots.ts;
// a ceiling only ever clamps down, so the two sides can deploy in any order.
const REMOTE_SEARCH_CEILING_MS = 1800;
// Derived from the roster's profile map so the accepted tiers never drift out
// of sync with bots.ts when the skill tiers change.
const VALID_SKILLS = new Set<HouseSkill>(
  (Object.keys(HOUSE_SKILL_PROFILES) as unknown[]).map(Number) as HouseSkill[],
);

// The blunder branch inside pickHouseMove is nondeterministic by design, so a
// local RNG is correct here — only the replayed BOARD must match the DO's, and
// that is guaranteed by the shared engine + the REPLAY_VERSION guard below.
const randomInt = (max: number) => Math.floor(Math.random() * max);

interface MoveRequest {
  match: EngineMatch;
  skill: HouseSkill;
  // Moderator-resolved strength the DO computed. Optional (older Workers omit
  // it) and re-clamped here field-by-field against the tier's baked profile, so
  // a malformed or version-skewed payload degrades to baked strength, never to
  // a broken search. Absent -> baked profile for `skill`.
  profile?: unknown;
  remainingClockMs?: number;
  replayVersion: number;
}

function readBody(req: IncomingMessage, limit = 2_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    if (req.method !== "POST" || req.url !== "/move") {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }

    const body = JSON.parse(await readBody(req)) as MoveRequest;

    // Version guard: if this box's engine is out of lockstep with the Worker's
    // REPLAY_VERSION, refuse rather than risk a desynced replay. The DO reads
    // 409 as "fall back to local".
    if (body.replayVersion !== REPLAY_VERSION) {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "replay_version", expected: REPLAY_VERSION }));
      return;
    }
    if (!VALID_SKILLS.has(body.skill)) {
      res.writeHead(400);
      res.end("bad skill");
      return;
    }

    // Honor the DO's resolved profile when present (re-clamped), else baked.
    const profile = body.profile != null ? sanitizeResolvedProfile(body.skill, body.profile) : undefined;
    const game = replayToPosition(body.match);
    const move = game
      ? pickHouseMove(game, body.skill, randomInt, body.remainingClockMs, REMOTE_SEARCH_CEILING_MS, profile)
      : null;

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ move }));
  } catch (err) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad_request", message: String(err) }));
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`nerfchess-engine listening on :${PORT} (REPLAY_VERSION=${REPLAY_VERSION})`);
});
