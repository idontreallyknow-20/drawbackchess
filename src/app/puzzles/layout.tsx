import type { Metadata } from "next";

// The puzzle routes are client-rendered (the engine runs in the page), so the
// section's title, description and self-canonical live here. Several routes
// were found inheriting the root canonical; this one owns its own.
export const metadata: Metadata = {
  title: "Daily chess puzzle: capture the king under a handicap",
  description:
    "A new Nerf Chess puzzle every day, free and with no account. There is no checkmate here, so every puzzle ends with the king captured: force the win under a secret handicap, find the one move your rule allows, or pick which of two drafted cards wins the game.",
  keywords: [
    "daily chess puzzle",
    "chess variant puzzle",
    "capture the king puzzle",
    "nerf chess puzzle",
    "chess puzzle no checkmate",
  ],
  alternates: { canonical: "/puzzles" },
  openGraph: {
    title: "Daily Nerf Chess puzzle",
    description:
      "One proven puzzle a day: capture the king under a handicap, read your own rule, or pick the card that wins.",
    url: "/puzzles",
  },
};

export default function PuzzlesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
