import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { JetBrains_Mono, Noto_Sans } from "next/font/google";
import { AchievementToast } from "@/components/AchievementToast";
import { SettingsBootstrap } from "@/components/SettingsBootstrap";
import "./globals.css";
import "./zen.css";

// ---------------------------------------------------------------------------
// Typefaces.
//
// Lichess sets the whole interface in Noto Sans, and so do we: one face for
// headings and body alike, with weight doing the hierarchy. JetBrains Mono
// carries the tabular chrome (clocks, ratings, ids, board coordinates).
//
// Each face still gets its OWN variable (--f-*) rather than being wired
// straight to --font-display / --font-body. The roles live in :root in
// globals.css, so a component asks for a role and never for a face.
// ---------------------------------------------------------------------------

const notoSans = Noto_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--f-noto",
});

// Clocks, ratings, ids and board coordinates. --font-mono used to be a system
// stack ("Cascadia Mono", "JetBrains Mono", Consolas), and none of those ship
// on Linux or on phones, so tabular figures fell through to generic monospace
// and the clock's digits stopped lining up. Self-hosted, the face is real
// everywhere.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--f-mono",
});

/** Every face variable, for the <html> class list. */
const FONT_VARS = [notoSans, jetbrainsMono].map((f) => f.variable).join(" ");

// Site analytics: Cloudflare Web Analytics. Chosen because it is cookieless and
// keeps no per-visitor identifier, so the privacy policy's "one essential
// cookie, no tracking cookies" promise stays true and no consent banner is
// owed. The beacon only renders when a token is baked in at build time
// (NEXT_PUBLIC_CF_BEACON_TOKEN, from the Cloudflare dashboard's Web Analytics
// page), so a build without one ships exactly what shipped before. The CSP in
// next.config.mjs allow-lists the beacon's script and report origins.
const CF_BEACON_TOKEN = (process.env.NEXT_PUBLIC_CF_BEACON_TOKEN ?? "").trim();

export const metadata: Metadata = {
  metadataBase: new URL("https://nerfchess.com"),
  title: {
    default: "Nerf Chess · chess with power-ups, a free online chess variant",
    template: "%s · Nerf Chess",
  },
  description:
    "Nerf Chess is chess with power-ups: a free online chess variant. Draft power-up cards every 5 moves in Buff mode, or carry a secret handicap and hex your opponent in Nerf mode (in the spirit of drawback chess). Win by capturing the king. Play in your browser, no download.",
  keywords: [
    "nerf chess",
    "drawback chess",
    "chess variant online",
    "chess with power ups",
    "chess cards game",
    "chess with secret rules",
    "free chess variant",
    "play chess variants online",
    "buff chess",
    "chess handicap game",
  ],
  applicationName: "Nerf Chess",
  alternates: { canonical: "/" },
  category: "game",
  // Google only shows a favicon in search results if it can crawl one in a
  // 48px-multiple raster size; the SVG alone gets ignored and the result
  // shows the default globe.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icon-48.png", type: "image/png", sizes: "48x48" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
      { url: "/logo.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon-180.png", type: "image/png", sizes: "180x180" }],
  },
  // No images here on purpose: the file-based src/app/opengraph-image.tsx
  // supplies a proper 1200x630 preview site-wide, and the codex card routes
  // each render their own per-card image. Twitter falls back to og:image.
  openGraph: {
    type: "website",
    siteName: "Nerf Chess",
    url: "https://nerfchess.com",
    title: "Nerf Chess · chess with power-ups, a free online chess variant",
    description:
      "Chess with power-ups: a free online chess variant. Draft power-up cards every 5 moves in Buff mode, take a secret handicap in Nerf mode, and win by capturing the king.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Nerf Chess · chess with power-ups, a free online chess variant",
    description:
      "Chess with power-ups: a free online chess variant. Draft power-up cards every 5 moves in Buff mode, take a secret handicap in Nerf mode, and win by capturing the king.",
  },
};

// Site-wide structured data, one @graph so a single script tag carries it all:
// - Organization: tells Google which image is the site's logo, so search shows
//   it instead of the generic globe/placeholder.
// - WebSite + SearchAction: names the site and points crawlers at the codex
//   search (sitelinks search box eligibility).
// - VideoGame co-typed with WebApplication: Google only shows software rich
//   results when VideoGame is paired with an application type. Declares the
//   game free (offers price 0), browser-playable, and carries the
//   "Drawback Chess" alternate name AI answer engines associate with the
//   secret-handicap concept.
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://nerfchess.com/#org",
      name: "Nerf Chess",
      url: "https://nerfchess.com",
      logo: "https://nerfchess.com/icon-512.png",
    },
    {
      "@type": "VideoGame",
      "@id": "https://nerfchess.com/#game",
      name: "Nerf Chess",
      url: "https://nerfchess.com",
      description:
        "A free online chess variant: draft power-up cards every five moves in Buff mode, or carry a secret handicap and hex your opponent in Nerf mode. Win by capturing the king.",
      genre: ["Chess variant", "Strategy", "Board game"],
      gamePlatform: "Web browser",
      applicationCategory: "Game",
      operatingSystem: "Any",
      playMode: ["MultiPlayer", "SinglePlayer"],
      numberOfPlayers: { "@type": "QuantitativeValue", minValue: 1, maxValue: 2 },
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@id": "https://nerfchess.com/#org" },
    },
    {
      "@type": "WebSite",
      "@id": "https://nerfchess.com/#website",
      name: "Nerf Chess",
      url: "https://nerfchess.com",
      publisher: { "@id": "https://nerfchess.com/#org" },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "https://nerfchess.com/codex?search={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": ["VideoGame", "WebApplication"],
      "@id": "https://nerfchess.com/#game",
      name: "Nerf Chess",
      alternateName: ["Drawback Chess", "Buff Chess", "Power-up Chess"],
      url: "https://nerfchess.com",
      description:
        "A free online chess variant with two modes: Nerf mode gives every player a secret handicap revealed at game end, and Buff mode lets both players draft power-up cards every 5 moves. The game ends by capturing the king, not checkmate.",
      genre: ["Chess variant", "Board game", "Strategy", "Card game"],
      keywords:
        "chess variant, chess with power-ups, power-up chess, buff chess, drawback chess, chess with cards, capture the king chess, chess without checkmate, chess roguelike, chess card game",
      gamePlatform: "Web browser",
      applicationCategory: "GameApplication",
      applicationSubCategory: "Chess",
      operatingSystem: "Any",
      browserRequirements: "Requires a modern web browser with JavaScript",
      inLanguage: "en",
      isAccessibleForFree: true,
      playMode: ["MultiPlayer", "SinglePlayer"],
      numberOfPlayers: { "@type": "QuantitativeValue", minValue: 1, maxValue: 2 },
      image: "https://nerfchess.com/icon-512.png",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
      publisher: { "@id": "https://nerfchess.com/#org" },
    },
  ],
};

// resizes-content makes the mobile on-screen keyboard shrink the layout
// viewport, so bottom-fixed UI (the in-game move/chat drawer) stays visible
// above the keyboard instead of being covered by it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover lets the page paint into the display cutout / home-bar
  // area on notched phones, so the env(safe-area-inset-*) guards on fixed UI
  // have room to work. User zoom is intentionally left enabled (no
  // maximum-scale / user-scalable lock) for accessibility.
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme matches DEFAULT_SETTINGS.siteTheme ("dark") so first paint is
    // already the default; SettingsBootstrap then applies whatever the user
    // actually chose.
    // The face variables live on <html>, not <body>: --font-display and
    // --font-body are roles resolved in :root, and a value set on <body> would
    // beat them for everything inside it.
    <html lang="en" data-theme="dark" className={FONT_VARS}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </head>
      <body className="no-tap-highlight font-body">
        <SettingsBootstrap />
        {children}
        {/* Site-wide, desktop-only unlock popups (bottom right). */}
        <AchievementToast />
        {CF_BEACON_TOKEN && (
          <Script
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
