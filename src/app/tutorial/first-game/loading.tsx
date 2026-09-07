// Route skeleton for /tutorial/first-game.
//
// The guided tour renders the real /game page with coach marks on top, so its
// loading geometry is the game's loading geometry. Reusing the game skeleton
// rather than copying it keeps the two from drifting apart, and mirrors how
// the page itself composes: it imports @/app/game/page.

import GameLoading from "@/app/game/loading";

export default function Loading() {
  return <GameLoading />;
}
