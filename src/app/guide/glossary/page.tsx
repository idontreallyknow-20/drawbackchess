import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { InfoPageLayout, InfoSection } from "@/components/InfoPageLayout";
import { GlossaryHashJump } from "@/components/guide/GlossaryHashJump";
import {
  GLOSSARY_ENTRIES,
  GLOSSARY_GROUPS,
  entryForSlug,
  type GlossaryEntry,
} from "@/lib/glossary";
import { BreadcrumbJsonLd, GuideFooter } from "../shared";

export const metadata: Metadata = {
  title: "Glossary: nerf, buff, hex, boon, bank, and more",
  description:
    "Every Nerf Chess term defined in one place: nerf, buff, hex, boon, item, draft, bank, reroll, tier (up to Apex and Mythic), freeze, walnut, shield, Chess Diff, lock-in window, and the rest of the card vocabulary.",
  alternates: { canonical: "/guide/glossary" },
};

// Anchor id for a group heading (the term chips at the top jump to these).
function groupSlug(group: string): string {
  return "group-" + group.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Structured data straight from the single source of truth in
// src/lib/glossary.ts, so the page, the in-game tooltips, and the JSON-LD can
// never drift apart. Descriptions concatenate the one-liner with the detail.
const definedTermSetJsonLd = {
  "@context": "https://schema.org",
  "@type": "DefinedTermSet",
  name: "Nerf Chess glossary",
  url: "https://nerfchess.com/guide/glossary",
  hasDefinedTerm: GLOSSARY_ENTRIES.map((e) => ({
    "@type": "DefinedTerm",
    name: e.term,
    url: `https://nerfchess.com/guide/glossary#${e.slug}`,
    description: e.detail ? `${e.def} ${e.detail}` : e.def,
  })),
};

/** The cross-link row at the foot of an expanded entry. */
function RelatedTerms({ entry }: { entry: GlossaryEntry }) {
  const related = (entry.related ?? [])
    .map(entryForSlug)
    .filter((e): e is GlossaryEntry => e != null);
  if (related.length === 0) return null;
  return (
    <p className="text-sm text-parchment-300">
      <span className="text-[12px] text-parchment-400">related&nbsp;&nbsp;</span>
      {related.map((r, i) => (
        <Fragment key={r.slug}>
          {i > 0 && ", "}
          <a
            href={`#${r.slug}`}
            className="underline decoration-dotted decoration-parchment-500 underline-offset-2 hover:text-coral hover:decoration-coral/80"
          >
            {r.term}
          </a>
        </Fragment>
      ))}
    </p>
  );
}

/** One glossary entry. Entries with a detail/example/related body render as a
 * native <details> accordion (server-rendered and crawlable, clickable without
 * JS); short jargon entries render as a plain definition block. */
function Entry({ entry }: { entry: GlossaryEntry }) {
  const hasBody = Boolean(entry.detail || entry.example || entry.related?.length);
  const heading = (
    <>
      <span className="font-display text-lg text-parchment">{entry.term}</span>
      <span className="mt-0.5 block text-parchment-200">{entry.def}</span>
    </>
  );
  if (!hasBody) {
    return (
      <div
        id={entry.slug}
        className="scroll-mt-24 rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] px-4 py-3"
      >
        {heading}
      </div>
    );
  }
  return (
    <details
      id={entry.slug}
      className="group scroll-mt-24 rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] open:bg-[color:var(--bg-zebra)]"
    >
      <summary className="cursor-pointer list-none px-4 py-3 outline-none focus-visible:text-coral [&::-webkit-details-marker]:hidden">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0">{heading}</span>
          <span
            aria-hidden
            className="shrink-0 text-parchment-400 motion-safe:transition-transform group-open:rotate-90"
          >
            &#9656;
          </span>
        </span>
      </summary>
      <div className="space-y-2 px-4 pb-4 pt-1">
        {entry.detail && <p>{entry.detail}</p>}
        {entry.example && (
          <p className="italic text-parchment-300">Example: {entry.example}</p>
        )}
        <RelatedTerms entry={entry} />
      </div>
    </details>
  );
}

export default function GlossaryPage() {
  return (
    <InfoPageLayout
      eyebrow="guide"
      title="The Nerf Chess glossary"
      intro="Card text is short on purpose, so it leans on a shared vocabulary. Here is every recurring term, from the five card types to the effects they leave on the board. Click any entry to expand the fine print; the same definitions appear as tooltips inside the game."
    >
      <BreadcrumbJsonLd title="Glossary" path="/guide/glossary" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(definedTermSetJsonLd) }}
      />
      <GlossaryHashJump />

      <div className="flex flex-wrap gap-2">
        {GLOSSARY_GROUPS.map((group) => (
          <a
            key={group}
            href={`#${groupSlug(group)}`}
            className="rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] px-3 py-1 font-display text-sm text-parchment-200 hover:border-coral/60 hover:text-coral motion-safe:transition-colors"
          >
            {group}
          </a>
        ))}
      </div>

      {GLOSSARY_GROUPS.map((group) => (
        <div key={group} id={groupSlug(group)} className="scroll-mt-24">
          <InfoSection title={group}>
            <div className="space-y-3">
              {GLOSSARY_ENTRIES.filter((e) => e.group === group).map((e) => (
                <Entry key={e.slug} entry={e} />
              ))}
            </div>
          </InfoSection>
        </div>
      ))}

      <InfoSection title="See the terms in action">
        <p>
          The <Link href="/codex" className="underline">codex</Link> lists every card and rule
          with these terms highlighted, and the{" "}
          <Link href="/guide/how-to-play" className="underline">how-to-play guide</Link> shows
          how they fit together in a real game.
        </p>
      </InfoSection>

      <GuideFooter current="/guide/glossary" />
    </InfoPageLayout>
  );
}
