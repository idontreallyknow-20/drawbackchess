import type { Metadata } from "next";

// Per-user surface: kept out of the index (robots.ts also disallows it) and
// given its own canonical so it does not inherit the root "/".
export const metadata: Metadata = {
  title: "Inbox",
  description: "Direct messages, challenges, and notifications from other Nerf Chess players.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/inbox" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
