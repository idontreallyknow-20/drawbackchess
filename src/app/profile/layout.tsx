import type { Metadata } from "next";

// Per-user surface: kept out of the index (robots.ts also disallows it) and
// given its own canonical so it does not inherit the root "/".
export const metadata: Metadata = {
  title: "Your profile",
  description: "Your Nerf Chess profile: ratings, recent games, achievements, friends, and settings.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/profile" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
