import type { Metadata } from "next";

// Per-user surface: kept out of the index (robots.ts also disallows it) and
// given its own canonical so it does not inherit the root "/".
export const metadata: Metadata = {
  title: "Game in progress",
  description: "A live Nerf Chess game. Draft a card every five moves and capture the king to win.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/game" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
