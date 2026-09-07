import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GlossaryText } from "@/components/GlossaryText";
import { InfoPageLayout, InfoSection } from "@/components/InfoPageLayout";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import type { Buff } from "@/engine/buff";
import type { Nerf } from "@/engine/nerf";
import { ALL_BUFFS } from "@/engine/buffs/library";
import { ALL_NERFS } from "@/engine/nerfs/library";
import {
  type CardType,
  type RelatedCard,
  buffCategory,
  buffModes,
  buffType,
  cardPath,
  modeLabel,
  nerfCategoryLabels,
  relatedBuffs,
  relatedNerfs,
  tierMeaning,
  tierName,
  turnCostMeaning,
} from "@/lib/cardCodex";
import { buffCollection, nerfCollection } from "@/lib/cardCollections";
import { historyFor } from "@/data/cardHistory";
import { CardInsights } from "@/components/codex/CardInsights";
import { retirementOf } from "@/engine/retired";
import { BUFF_BY_ID } from "@/lib/cardCodex";

// Server-rendered detail page for a single card, shared by /codex/buff/[id]
// and /codex/nerf/[id]. Everything here is plain HTML (no client component),
// so the full name, effect, and context of all ~1000 cards ship in the crawled
// markup: the codex list itself is a client component and never was.

// BreadcrumbList structured data: Home > Codex > (Buffs|Nerfs) > card.
function CardBreadcrumbJsonLd({ section, name, path }: { section: string; name: string; path: string }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Nerf Chess", item: "https://nerfchess.com" },
      { "@type": "ListItem", position: 2, name: "Codex", item: "https://nerfchess.com/codex" },
      { "@type": "ListItem", position: 3, name: section, item: "https://nerfchess.com/codex" },
      { "@type": "ListItem", position: 4, name, item: `https://nerfchess.com${path}` },
    ],
  };
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
  );
}

// The codex tab each family opens on, so the breadcrumb's family link lands
// on the right list. Items browse under the Buff tab, matching the browser.
const SECTION_TAB: Record<string, string> = {
  Buffs: "buffs",
  Items: "buffs",
  Hexes: "hexes",
  Boons: "boons",
  Nerfs: "rules",
};

// The visible breadcrumb trail: Codex > family > this card. Mirrors the
// BreadcrumbList JSON-LD below so readers and crawlers see the same path.
function CardBreadcrumb({ section, name }: { section: string; name: string }) {
  const tab = SECTION_TAB[section] ?? "buffs";
  const familyHref = tab === "buffs" ? "/codex" : `/codex?tab=${tab}`;
  // The trail's markup, separators and hit areas live in one place now
  // (components/ui/Breadcrumbs). This was the only visible breadcrumb on the
  // site and its links measured 19.5px tall against the 44px floor.
  return (
    <Breadcrumbs
      items={[
        { label: "Home", href: "/" },
        { label: "Codex", href: "/codex" },
        { label: section, href: familyHref },
        { label: name },
      ]}
    />
  );
}

// Prev / next within the card's own family (alphabetical, the codex's A-Z
// order), so a reader can leaf through the library without going back to the
// list. Ends do not wrap; the missing side simply is not rendered.
type NeighborCard = { name: string; path: string };

function neighborsOf(
  list: { id: string; name: string }[],
  id: string,
  pathOf: (i: number) => string,
) {
  const sorted = list
    .map((c, i) => ({ id: c.id, name: c.name, i }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const at = sorted.findIndex((c) => c.id === id);
  const prev = at > 0 ? sorted[at - 1] : null;
  const next = at >= 0 && at < sorted.length - 1 ? sorted[at + 1] : null;
  return {
    prev: prev ? { name: prev.name, path: pathOf(prev.i) } : null,
    next: next ? { name: next.name, path: pathOf(next.i) } : null,
  };
}

function buffNeighbors(buff: Buff): { prev: NeighborCard | null; next: NeighborCard | null } {
  const type = buffType(buff);
  const family = ALL_BUFFS.filter((b) => {
    const t = buffType(b);
    // Items and buffs share the Buff tab, so they leaf together too.
    if (type === "Buff" || type === "Item") return t === "Buff" || t === "Item";
    return t === type;
  });
  return neighborsOf(family, buff.id, (i) => cardPath(family[i]));
}

function nerfNeighbors(nerf: Nerf): { prev: NeighborCard | null; next: NeighborCard | null } {
  return neighborsOf(ALL_NERFS, nerf.id, (i) => `/codex/nerf/${ALL_NERFS[i].id}`);
}

function PrevNextNav({
  prev,
  next,
  noun,
}: {
  prev: NeighborCard | null;
  next: NeighborCard | null;
  noun: string;
}) {
  if (!prev && !next) return null;
  const cell =
    "flex min-w-0 items-center gap-2 rounded-none border border-[color:var(--edge)] px-3 py-2.5 transition hover:border-[color:var(--edge-strong)] hover:bg-[color:var(--bg-raised)]";
  return (
    <nav aria-label={`Browse ${noun} cards`} className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
      {prev ? (
        <Link href={prev.path} className={cell}>
          <ChevronLeft size={16} aria-hidden className="shrink-0 text-parchment-400" />
          <span className="min-w-0">
            <span className="block text-[13px] text-parchment-400">Previous {noun}</span>
            <span className="block truncate font-display text-[14px] text-parchment-100">{prev.name}</span>
          </span>
        </Link>
      ) : (
        <span aria-hidden className="hidden sm:block" />
      )}
      {next ? (
        <Link href={next.path} className={cell + " justify-end text-right sm:col-start-2"}>
          <span className="min-w-0">
            <span className="block text-[13px] text-parchment-400">Next {noun}</span>
            <span className="block truncate font-display text-[14px] text-parchment-100">{next.name}</span>
          </span>
          <ChevronRight size={16} aria-hidden className="shrink-0 text-parchment-400" />
        </Link>
      ) : null}
    </nav>
  );
}

function TypeBadge({ type }: { type: CardType }) {
  return (
    <span className="inline-flex items-center rounded-none border border-[color:var(--edge)] px-2 py-0.5 text-[12px] text-parchment-300">
      {type}
    </span>
  );
}

// One row of the "At a glance" definition list.
function GlanceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="text-[12px] text-parchment-400 sm:w-32 sm:shrink-0 sm:pt-0.5">{label}</dt>
      <dd className="text-[15px] text-parchment-100">{children}</dd>
    </div>
  );
}

// A retired card stays readable (old games and links keep working) but says
// so, and points at the active card that covers the same ground.
function RetiredNote({ id }: { id: string }) {
  const r = retirementOf(id);
  if (!r) return null;
  const targetBuff: Buff | undefined = r.mergedInto ? BUFF_BY_ID[r.mergedInto] : undefined;
  const targetNerf: Nerf | undefined = r.mergedInto && !targetBuff ? ALL_NERFS.find((n) => n.id === r.mergedInto) : undefined;
  const target = targetBuff ?? targetNerf;
  const targetPath = targetBuff ? cardPath(targetBuff) : targetNerf ? `/codex/nerf/${targetNerf.id}` : null;
  const why: Record<string, string> = {
    duplicate: "it did the same thing as another card",
    dominated: "a cheaper card did the same thing",
    "near-duplicate": "it was too close to another card",
    "too-complex": "its rule ran too long to read at the board",
    hand: "it was cut in the hand audit for being unclear, a twin of another card, or wrong for its tier",
    "category-cap": "its category had more variations than the game needed",
  };
  return (
    <div className="plate border-l-2 border-l-brag p-4 text-[14px] text-parchment-200">
      <strong className="text-parchment-50">Retired.</strong> This card is no longer dealt: {why[r.reason] ?? "it was retired"}.
      {target && targetPath && (
        <>
          {" "}
          See{" "}
          <Link href={targetPath} className="text-gold-leaf hover:underline">
            {target.name}
          </Link>{" "}
          instead.
        </>
      )}
    </div>
  );
}

function NotDraftedNote() {
  return (
    <p className="mb-4 rounded-none border border-sun/30 bg-sun/5 px-4 py-2 text-sm text-parchment-200">
      This card is written but not yet appearing in drafts. Its wording and tier may still change.
    </p>
  );
}

// "July 5, 2026" from an ISO date, with fixed month names so server output
// never depends on runtime locale.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function formatHistoryDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

// A plate section that opens on demand. Native <details>, so the content is
// still server-rendered and crawlable (the SEO reason this page exists) while
// the default view stays short — playtest feedback was that the card page
// buried the rule under reference material.
function DisclosureSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="plate group">
      <summary className="cursor-pointer list-none p-6 outline-none focus-visible:text-coral sm:p-7 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-3">
          <span className="display-3 text-parchment">{title}</span>
          <span
            aria-hidden
            className="shrink-0 text-parchment-400 motion-safe:transition-transform group-open:rotate-90"
          >
            &#9656;
          </span>
        </span>
      </summary>
      <div className="space-y-3 px-6 pb-6 text-[15px] leading-relaxed text-parchment-200 sm:px-7 sm:pb-7">
        {children}
      </div>
    </details>
  );
}

// Editorial timeline (introduction wave + curated balance notes), rendered on
// the server so every card page ships unique crawlable history prose. Runtime
// moderator changes are appended client-side by CardInsights.
function HistoryTimeline({ kind, card }: { kind: "buff" | "nerf"; card: Buff | Nerf }) {
  const events = historyFor(kind, card);
  return (
    <DisclosureSection title="History">
      <ol className="space-y-3">
        {events.map((e, i) => (
          <li key={i} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <span className="text-[12px] text-parchment-400 sm:w-32 sm:shrink-0 sm:pt-0.5">
              {formatHistoryDate(e.date)}
            </span>
            <span className="text-[15px] text-parchment-100">
              {e.note}
              {e.pr !== undefined && <span className="text-parchment-400"> (PR #{e.pr})</span>}
            </span>
          </li>
        ))}
      </ol>
    </DisclosureSection>
  );
}

function RelatedGrid({ title, cards }: { title: string; cards: RelatedCard[] }) {
  if (cards.length === 0) return null;
  return (
    <InfoSection title={title}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.id}
            href={c.path}
            // The related-card rows measured 40.4px tall, four short of the
            // floor, and there are twelve of them on every card page. A
            // min-height rather than more padding, and no `sm:` step-down: a
            // tablet is a coarse pointer, and the desktop row is only 3.6px
            // tighter anyway, so it keeps the 44px on a mouse too.
            className="flex min-h-[44px] items-center justify-between gap-3 rounded-none border border-[color:var(--edge)] px-3 py-2 transition hover:border-[color:var(--edge-strong)] hover:bg-[color:var(--bg-raised)]"
          >
            <span className="font-display text-parchment-100">{c.name}</span>
            {/* 12px tier chip carrying the tier's own color (tier-bg + tier),
                the shared tier-chip pattern, not a colorless 10px smallcap. */}
            <span
              className={`shrink-0 rounded-none border px-1.5 py-px font-display text-[12px] font-bold tier-bg-${c.tier} tier-${c.tier}`}
            >
              {tierName(c.tier)}
            </span>
          </Link>
        ))}
      </div>
    </InfoSection>
  );
}

export function BuffDetail({ buff, extra }: { buff: Buff; extra?: ReactNode }) {
  const type = buffType(buff);
  const cat = buffCategory(buff);
  const modes = buffModes(buff);
  const where = modeLabel(modes);
  const path = cardPath(buff);
  const section = type === "Hex" ? "Hexes" : type === "Boon" ? "Boons" : "Buffs";
  const isHex = buff.category === "hex";
  const draftLine = isHex
    ? `You draft ${buff.name} in Nerf mode and cast it on your opponent.`
    : `You draft ${buff.name} in ${where === "Buff mode and Nerf mode" ? "either mode" : where}.`;

  const { prev, next } = buffNeighbors(buff);

  return (
    <InfoPageLayout
      eyebrow={`codex · ${type.toLowerCase()}`}
      title={buff.name}
      intro={<GlossaryText text={buff.description} />}
      extra={extra}
      breadcrumb={<CardBreadcrumb section={section} name={buff.name} />}
    >
      <CardBreadcrumbJsonLd section={section} name={buff.name} path={path} />
      {!buff.implemented && <NotDraftedNote />}
      <RetiredNote id={buff.id} />

      <InfoSection title="At a glance">
        <dl className="space-y-3">
          <GlanceRow label="Type"><TypeBadge type={type} /></GlanceRow>
          <GlanceRow label="Tier">
            {tierName(buff.tier)}
            <span className="mt-0.5 block text-[13px] text-parchment-400">{tierMeaning(buff.tier)}</span>
          </GlanceRow>
          <GlanceRow label="Category">{cat.label}</GlanceRow>
          <GlanceRow label="Collection">{buffCollection(buff)}</GlanceRow>
          <GlanceRow label="Appears in">{where}</GlanceRow>
        </dl>
      </InfoSection>

      {buff.implemented && <CardInsights kind="buff" id={buff.id} codeTier={buff.tier} noun={type.toLowerCase()} />}

      <InfoSection title="How it works">
        <p>
          {draftLine} {turnCostMeaning(buff)}
        </p>
        <p>As a {cat.label.toLowerCase()} card, it {cat.blurb}</p>
        {buff.tip && (
          <p>
            <span className="text-parchment-400">Tip</span>{" "}
            <GlossaryText text={buff.tip} />
          </p>
        )}
        {buff.flavor && <p className="border-l border-[color:var(--edge-strong)] pl-4 italic text-parchment-300">&ldquo;{buff.flavor}&rdquo;</p>}
      </InfoSection>

      <HistoryTimeline kind="buff" card={buff} />

      <RelatedGrid title="Related cards" cards={relatedBuffs(buff)} />

      <PrevNextNav prev={prev} next={next} noun={type.toLowerCase()} />
    </InfoPageLayout>
  );
}

export function NerfDetail({ nerf, extra }: { nerf: Nerf; extra?: ReactNode }) {
  const path = `/codex/nerf/${nerf.id}`;
  const cats = nerfCategoryLabels(nerf);
  const { prev, next } = nerfNeighbors(nerf);

  return (
    <InfoPageLayout
      eyebrow="codex · nerf"
      title={nerf.name}
      intro={<GlossaryText text={nerf.description} />}
      extra={extra}
      breadcrumb={<CardBreadcrumb section="Nerfs" name={nerf.name} />}
    >
      <CardBreadcrumbJsonLd section="Nerfs" name={nerf.name} path={path} />
      {!nerf.implemented && <NotDraftedNote />}
      <RetiredNote id={nerf.id} />

      <InfoSection title="At a glance">
        <dl className="space-y-3">
          <GlanceRow label="Type"><TypeBadge type="Nerf" /></GlanceRow>
          <GlanceRow label="Tier">
            {tierName(nerf.tier)}
            <span className="mt-0.5 block text-[13px] text-parchment-400">{tierMeaning(nerf.tier)}</span>
          </GlanceRow>
          {cats.length > 0 && <GlanceRow label="Focus">{cats.join(", ")}</GlanceRow>}
          <GlanceRow label="Collection">{nerfCollection(nerf)}</GlanceRow>
          <GlanceRow label="Appears in">Nerf mode</GlanceRow>
          <GlanceRow label="How it works">Passive and secret: it is always on, and your opponent cannot see it.</GlanceRow>
        </dl>
      </InfoSection>

      {nerf.implemented && <CardInsights kind="nerf" id={nerf.id} codeTier={nerf.tier} noun="nerf" />}

      <InfoSection title="How it works">
        <p>
          {nerf.name} is one of Nerf Chess&apos;s secret handicaps. In Nerf mode you choose one of two nerfs
          before the first move, in secret, and carry it for the whole game.
        </p>
        <p>
          The board quietly enforces it: any move it forbids is simply never offered, so you cannot break it
          by accident. Your opponent never sees which nerf you took until the game ends, so every move you
          make is also a clue they are trying to read.
        </p>
        {nerf.tip && (
          <p>
            <span className="text-parchment-400">Tip</span>{" "}
            <GlossaryText text={nerf.tip} />
          </p>
        )}
        {nerf.flavor && <p className="border-l border-[color:var(--edge-strong)] pl-4 italic text-parchment-300">&ldquo;{nerf.flavor}&rdquo;</p>}
      </InfoSection>

      <HistoryTimeline kind="nerf" card={nerf} />

      <RelatedGrid title="Related nerfs" cards={relatedNerfs(nerf)} />

      <PrevNextNav prev={prev} next={next} noun="nerf" />
    </InfoPageLayout>
  );
}
