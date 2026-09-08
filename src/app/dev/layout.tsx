import type { Metadata } from "next";

// Per-user surface: kept out of the index (robots.ts also disallows it) and
// given its own canonical so it does not inherit the root "/".
export const metadata: Metadata = {
  title: "Dev tools",
  description: "Internal galleries and labs used while building Nerf Chess.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/dev" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
