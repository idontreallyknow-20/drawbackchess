import type { Metadata } from "next";

// /stats is a client component that forwards players to their own profile
// statistics; this server layout supplies its metadata. It is a user-specific
// redirect surface, so it stays out of the index, and the self-canonical stops
// it inheriting the root layout's canonical "/".
export const metadata: Metadata = {
  title: "Your statistics",
  description: "Your Nerf Chess statistics: rating history, win rates by mode, and the cards you play best with.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/stats" },
};

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
