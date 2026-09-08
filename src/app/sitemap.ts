import type { MetadataRoute } from "next";
import { ALL_BUFFS } from "@/engine/buffs/library";
import { ALL_NERFS } from "@/engine/nerfs/library";
import { cardPath } from "@/lib/cardCodex";
import { isRetired } from "@/engine/retired";

const BASE = "https://nerfchess.com";

// Served at /sitemap.xml. Static public routes plus one entry per drafted card:
// per-user pages (profile, history, inbox) and the thousands of possible codex
// filter/query URLs are still left out, but every implemented buff and nerf has
// its own crawlable detail page (/codex/buff/[id], /codex/nerf/[id]) and is
// listed here so crawlers find all of them without executing the client codex.
export default function sitemap(): MetadataRoute.Sitemap {
  const entry = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  ): MetadataRoute.Sitemap[number] => ({
    url: `${BASE}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  });

  // Only cards that actually appear in drafts are indexed; unimplemented cards
  // render (so internal links never 404) but carry a noindex and stay out here.
  const cardEntries: MetadataRoute.Sitemap = [
    // cardPath sends hexes and boons to their family namespaces; plain buffs
    // and items stay at /codex/buff. Only canonical paths are listed.
    ...ALL_BUFFS.filter((b) => b.implemented && !isRetired(b.id)).map((b) => entry(cardPath(b), 0.4, "monthly")),
    ...ALL_NERFS.filter((n) => n.implemented && !isRetired(n.id)).map((n) => entry(`/codex/nerf/${n.id}`, 0.4, "monthly")),
  ];

  return [
    entry("/", 1, "weekly"),
    entry("/play", 0.9, "monthly"),
    entry("/lobby", 0.9, "monthly"),
    entry("/codex", 0.9, "weekly"),
    // The daily puzzle changes every day and needs no account, so it is the
    // strongest recurring-crawl target on the site after the lobby. Individual
    // /puzzles/[id] pages are not listed: the corpus is regenerated in batches
    // and those ids do not survive a regeneration.
    entry("/puzzles", 0.9, "daily"),
    entry("/updates", 0.7, "weekly"),
    entry("/tutorial", 0.8, "monthly"),
    entry("/tutorial/walkthrough", 0.6, "monthly"),
    entry("/tutorial/first-game", 0.6, "monthly"),
    entry("/analysis", 0.5, "monthly"),
    // The guide: evergreen explainer pages written for search and AI answers.
    entry("/guide", 0.8, "monthly"),
    entry("/guide/how-to-play", 0.8, "monthly"),
    entry("/guide/nerf-mode", 0.7, "monthly"),
    entry("/guide/buff-mode", 0.7, "monthly"),
    entry("/guide/chess-with-power-ups", 0.7, "monthly"),
    entry("/guide/capture-the-king", 0.7, "monthly"),
    entry("/guide/chess-roguelike", 0.7, "monthly"),
    entry("/guide/chess-variants", 0.7, "monthly"),
    entry("/guide/glossary", 0.6, "monthly"),
    // Info and community surfaces.
    entry("/about", 0.6, "yearly"),
    entry("/faq", 0.6, "monthly"),
    entry("/leaderboard", 0.5, "daily"),
    entry("/tournaments", 0.5, "daily"),
    entry("/community", 0.5, "weekly"),
    entry("/clubs", 0.5, "weekly"),
    entry("/achievements", 0.4, "monthly"),
    entry("/tv", 0.4, "daily"),
    entry("/codex/suggest", 0.4, "yearly"),
    entry("/contact", 0.3, "yearly"),
    entry("/guidelines", 0.3, "yearly"),
    entry("/privacy-policy", 0.2, "yearly"),
    entry("/terms-of-service", 0.2, "yearly"),
    ...cardEntries,
  ];
}
