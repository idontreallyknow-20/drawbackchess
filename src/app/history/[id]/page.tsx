"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Board } from "@/components/Board";
import { BoardPlayerRow } from "@/components/BoardPlayerRow";
import { Logo } from "@/components/Logo";
import { MoveList } from "@/components/MoveList";
import { boardAtPly, replayUci } from "@/lib/gameReview";
import { CompletedGame, loadGameHistory, timeControlLabel } from "@/lib/gameHistory";
import { TIER_LABEL } from "@/lib/tiers";
import { LinkButton } from "@/components/ui/Button";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "no-moves"; game: CompletedGame }
  | { kind: "replay"; game: CompletedGame };

// Local replay of a game from this device's history. Entries recorded since
// replays shipped carry their UCI move list; older online games fall back to
// the server archive at /game/{id} when we know the match id.
export default function HistoryReplayPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const entryId = String(params.id ?? "");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    queueMicrotask(() => {
      const game = loadGameHistory().find((g) => g.id === entryId);
      if (!game) {
        setState({ kind: "missing" });
      } else if (game.moves && game.moves.length > 0) {
        setState({ kind: "replay", game });
      } else if (game.serverGameId) {
        router.replace(`/game/${game.serverGameId}`);
      } else {
        setState({ kind: "no-moves", game });
      }
    });
  }, [entryId, router]);

  if (state.kind === "replay") return <Replay game={state.game} />;

  return (
    <main className="min-h-screen">
      <nav className="flex items-center justify-between px-5 sm:px-10 py-6 sm:py-7">
        <Logo />
        <Link href="/history" className="px-3 py-1.5 text-sm hover:bg-[color:var(--bg-raised)] text-parchment-100">
          Back to history
        </Link>
      </nav>
      <section className="max-w-xl mx-auto px-6 py-16 text-center">
        {state.kind === "loading" ? (
          <div className="text-[12px] text-parchment-400">Loading…</div>
        ) : state.kind === "no-moves" ? (
          <>
            <h1 className="font-display text-3xl">No moves recorded</h1>
            <p className="mt-3 text-parchment-200">
              This game was saved before move replays existed, so only its summary is available.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-3xl">Game not found</h1>
            <p className="mt-3 text-parchment-200">
              Game history is stored per device; this game isn&apos;t saved on this one.
            </p>
          </>
        )}
        <LinkButton tone="leaf" href="/history" className="inline-block mt-8 px-5 py-2 font-body">
          Back to history
        </LinkButton>
      </section>
    </main>
  );
}

function Replay({ game }: { game: CompletedGame }) {
  const { history } = useMemo(() => replayUci(game.moves ?? []), [game.moves]);
  const [ply, setPly] = useState(history.length);
  const displayBoard = useMemo(() => boardAtPly(history, ply), [history, ply]);
  const lastMove = displayBoard.history[displayBoard.history.length - 1] ?? null;

  const oppColor = game.myColor === "w" ? "b" : "w";
  const outcomeLabel =
    game.outcome === "win" ? "You won" : game.outcome === "loss" ? "You lost" : "Draw";

  return (
    <main className="min-h-screen">
      <nav className="flex items-center justify-between px-5 sm:px-10 py-5">
        <Logo />
        <Link href="/history" className="px-3 py-1.5 text-sm hover:bg-[color:var(--bg-raised)] text-parchment-100">
          Back to history
        </Link>
      </nav>
      <div className="mx-auto w-full max-w-[1100px] px-3 pb-10 sm:px-6">
        <div className="mb-2 text-[12px] text-parchment-400">
          {outcomeLabel} · {game.reason} · {timeControlLabel(game.baseSec, game.incSec)} ·{" "}
          {new Date(game.endedAt).toLocaleDateString()}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <BoardPlayerRow
              board={displayBoard}
              playerColor={oppColor}
              myColor={game.myColor}
              name={game.opponent}
              className="min-w-0 !px-0 !py-1"
            />
            <div className="w-full max-w-[720px]">
              <Board
                board={displayBoard}
                legalMoves={[]}
                orientation={game.myColor}
                onMove={() => {}}
                myColor={game.myColor}
                lastMove={lastMove}
                disabled
              />
            </div>
            <BoardPlayerRow
              board={displayBoard}
              playerColor={game.myColor}
              myColor={game.myColor}
              name="You"
              className="min-w-0 !px-0 !py-1"
            />
            <div className="mt-2 space-y-1.5">
              {game.myNerf && <RuleLine label="Your rule" nerf={game.myNerf} />}
              {game.opponentNerf && <RuleLine label="Opponent rule" nerf={game.opponentNerf} />}
            </div>
          </div>
          <div className="sm:w-56 sm:shrink-0">
            <MoveList
              moves={history}
              currentPly={ply}
              onPlyChange={(p) => setPly(Math.max(0, Math.min(p, history.length)))}
              compact
            />
          </div>
        </div>
      </div>
    </main>
  );
}

function RuleLine({
  label,
  nerf,
}: {
  label: string;
  nerf: NonNullable<CompletedGame["myNerf"]>;
}) {
  return (
    <div className="plate p-2 px-3">
      <span className="text-[12px] text-parchment-400">{label} </span>
      <span className={`font-display text-sm font-semibold tier-${nerf.tier}`}>{nerf.name}</span>
      <span className="text-xs leading-snug text-parchment-300">
        : {nerf.description} <span className="text-parchment-400">({TIER_LABEL[nerf.tier] ?? ""})</span>
      </span>
    </div>
  );
}
