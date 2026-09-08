import type { Metadata } from "next";

// Per-user surface: kept out of the index (robots.ts also disallows it) and
// given its own canonical so it does not inherit the root "/".
export const metadata: Metadata = {
  title: "Play with a friend",
  description: "Create a private Nerf Chess game and send the link to a friend. Pick the mode and time control, then play in the browser.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/friend" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
