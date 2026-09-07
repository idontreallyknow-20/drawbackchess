// What each kind of missing thing is called, and what to offer instead.
//
// A 404 is a piece of copy, not a status code, and "Page not found" is the
// answer to a question nobody asked: the reader knows the page did not load,
// what they want to know is whether the PLAYER exists, whether the GAME is
// over, whether they mistyped the tournament link. So each family of URL gets
// its own words and its own way onward.
//
// Kept as data, and separate from the panel that renders it, so the root
// not-found (which picks a kind from the path) and a segment's own
// not-found.tsx (which knows its kind statically) say the identical thing.

export interface NotFoundCopy {
  title: string;
  detail: string;
  action: { href: string; label: string };
  secondary?: { href: string; label: string };
}

export const NOT_FOUND_COPY = {
  player: {
    title: "No player by that name",
    detail:
      "Nobody on Nerf Chess is signed up under that username. Names are case-insensitive but otherwise exact, so a stray character in the link is the usual cause.",
    action: { href: "/leaderboard", label: "Browse players" },
    secondary: { href: "/lobby", label: "Back to lobby" },
  },
  game: {
    title: "No game with that id",
    detail:
      "That game id does not match anything on the server. Finished games move to your history after a while, and private links expire with the game.",
    action: { href: "/play", label: "Start a game" },
    secondary: { href: "/tv", label: "Watch a live game" },
  },
  tournament: {
    title: "No tournament with that id",
    detail:
      "That tournament id does not match an event. Finished events are cleared out, so a link from a while ago may simply have aged out.",
    action: { href: "/tournaments", label: "See all tournaments" },
    secondary: { href: "/lobby", label: "Back to lobby" },
  },
  card: {
    title: "No card with that id",
    detail:
      "The codex has no buff, hex, boon or nerf under that id. Retired cards keep their pages, so a broken link is more likely a typo than a removal.",
    action: { href: "/codex", label: "Open the codex" },
    secondary: { href: "/guide/glossary", label: "Read the glossary" },
  },
  puzzle: {
    title: "No puzzle with that id",
    detail:
      "That puzzle is not in the current set. The corpus is regenerated in batches, and ids do not survive a regeneration.",
    action: { href: "/puzzles", label: "Today's puzzles" },
    secondary: { href: "/lobby", label: "Back to lobby" },
  },
  club: {
    title: "No club at that address",
    detail: "No club uses that link. Clubs can be renamed, which changes their address.",
    action: { href: "/clubs", label: "Browse clubs" },
    secondary: { href: "/lobby", label: "Back to lobby" },
  },
  page: {
    title: "That page is not here",
    detail:
      "The address does not match anything on Nerf Chess. It may have been renamed, or the link may have picked up a stray character.",
    action: { href: "/", label: "Go to the home page" },
    secondary: { href: "/lobby", label: "Back to lobby" },
  },
} satisfies Record<string, NotFoundCopy>;

export type NotFoundKind = keyof typeof NOT_FOUND_COPY;

/** Which kind of thing the reader was looking for, from the address alone.
 *  Only the first segment is consulted: /u/<name> is a player whether or not
 *  the rest of the path makes sense. */
export function notFoundKindForPath(pathname: string | null | undefined): NotFoundKind {
  const first = (pathname ?? "").split("/").filter(Boolean)[0]?.toLowerCase();
  switch (first) {
    case "u":
      return "player";
    case "game":
      return "game";
    case "tournaments":
      return "tournament";
    case "codex":
      return "card";
    case "puzzles":
      return "puzzle";
    case "clubs":
      return "club";
    default:
      return "page";
  }
}
