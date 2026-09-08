import type { Metadata } from "next";

// /history is a client component showing the signed-in player's own games;
// this server layout supplies its metadata. The page is user-specific, so it
// stays out of the index, and the self-canonical stops it inheriting the root
// layout's canonical "/".
export const metadata: Metadata = {
  title: "Game history",
  description: "Your finished Nerf Chess games: replay any game move by move and see how the cards played out.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/history" },
};

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
