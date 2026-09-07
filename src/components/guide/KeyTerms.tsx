import Link from "next/link";
import { entryForSlug, glossaryHref, type GlossaryEntry } from "@/lib/glossary";

/**
 * A compact "key terms" chip row for guide pages: each chip deep-links to the
 * matching entry's anchor on /guide/glossary (where the entry auto-expands).
 * Server component — plain Links, no client JS. Unknown slugs are dropped
 * silently so a renamed entry can never crash a page.
 */
export function KeyTerms({ slugs, title = "key terms" }: { slugs: string[]; title?: string }) {
  const entries = slugs
    .map(entryForSlug)
    .filter((e): e is GlossaryEntry => e != null);
  if (entries.length === 0) return null;
  return (
    <div>
      <div className="text-[12px] text-parchment-400">{title}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {entries.map((e) => (
          <Link
            key={e.slug}
            href={glossaryHref(e)}
            title={e.def}
            className="rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-zebra)] px-3 py-1 font-display text-sm text-parchment-200 hover:border-coral/60 hover:text-coral motion-safe:transition-colors"
          >
            {e.term}
          </Link>
        ))}
      </div>
    </div>
  );
}
