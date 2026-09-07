import { NextResponse } from "next/server";
import type { MPLobby } from "@/lib/multiplayer";

export const dynamic = "force-dynamic";

// GET /api/lobby — the lobby snapshot, FOR LOCAL DEVELOPMENT ONLY.
//
// WHY THIS FILE EXISTS
//
// In production this path never reaches Next at all. worker.ts matches
// `/api/lobby` at the very top of its fetch handler and answers it from
// handleLobbyEdge (the time-bucketed edge cache in front of the game-server
// Durable Object) before falling through to the Next handler, so the worker
// stays the single source of truth for the real snapshot and this route is
// unreachable there. Nothing about production behaviour changes.
//
// Under `next dev` there is no worker, so `/api/lobby` 404'd. That is not
// cosmetic: lobbyClient.ts polls it every 3 to 10 seconds from the home page's
// live strip, the lobby, TV and five other routes, which meant two failed
// requests per page load in the console on eight routes AND the live strip
// pinned in a state (the poller's `failed` branch, or a permanent skeleton)
// that could not be exercised locally at all. A designed empty state that
// nobody can reach is a designed state nobody can check.
//
// WHY A HANDLER RATHER THAN SILENCING THE CLIENT
//
// The alternative was to make lobbyClient.ts swallow a 404 quietly. That trades
// a visible dev-only wart for a permanently deaf client: a real 404 in
// production (a routing regression in the worker, say) would then also be
// silent, and the strip would sit empty with nothing to say why. The fetch
// stays strict; the environment gets the endpoint it was missing.
//
// WHAT IT SERVES
//
// The worker's exact client-facing response shape: an MPLobby body,
// application/json, `cache-control: no-store` (see the long note above
// handleLobbyEdge on why no cache in front of the worker may ever hold a lobby
// copy). If LOBBY_ORIGIN names a server that speaks the DO's `GET /lobby`, the
// body is that server's, unmodified. Otherwise it is an empty-but-valid
// snapshot: no players, no games, nothing waiting. Which is TRUE on a dev box
// with no game server running, and drives the strip's real empty state rather
// than a lie about who is online.

/** The DO's own HTTP lobby endpoint, when one is reachable from the dev box.
 *  `npm run server:start` (server/index.ts) serves only the WebSocket, so this
 *  is normally unset; point it at a `wrangler dev` worker or a deployed origin
 *  to develop against live counts. */
const LOBBY_ORIGIN = (process.env.LOBBY_ORIGIN ?? "").trim().replace(/\/$/, "");

/** The worker's client header set, byte for byte. */
const HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
} as const;

const EMPTY: MPLobby = { players: [], anonymous: 0, games: [], challenges: [], seeks: [] };

export async function GET() {
  // Belt and braces. The worker makes this unreachable in production, and if
  // that ever stopped being true this route must not start inventing an empty
  // lobby on a live site: 503 is what the worker itself returns when it cannot
  // reach the game server, and lobbyClient.ts already degrades from it by
  // keeping its last snapshot.
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("lobby unavailable", { status: 503, headers: HEADERS });
  }

  if (LOBBY_ORIGIN) {
    try {
      const res = await fetch(`${LOBBY_ORIGIN}/lobby`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) {
        return new NextResponse(await res.text(), { status: 200, headers: HEADERS });
      }
    } catch {
      // Fall through to the empty snapshot: a dev box whose game server is
      // down should see the empty state, not a console full of failures.
    }
  }

  return new NextResponse(JSON.stringify(EMPTY), { status: 200, headers: HEADERS });
}
