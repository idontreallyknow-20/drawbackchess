import type { Metadata } from "next";

// A personal surface: the values on it are read from this device's storage and
// mean nothing to a crawler, so it is kept out of the index the same way
// /profile and /game are. It is very much meant to be linkable BY PEOPLE —
// that is the whole point of the route — which is a different thing from being
// indexable.
export const metadata: Metadata = {
  title: "Settings",
  description:
    "Board and piece themes, sound, motion, accessibility and gameplay preferences for Nerf Chess.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/settings" },
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
