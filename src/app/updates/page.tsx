import type { Metadata } from "next";
import Link from "next/link";
import { UPDATES, formatUpdateDate } from "@/lib/updates";
import { SiteHeader } from "@/components/SiteHeader";
import { BreadcrumbJsonLd } from "../guide/shared";

export const metadata: Metadata = {
  title: "Updates: what's new in Nerf Chess",
  description:
    "The latest additions to Nerf Chess: hundreds of new buff and nerf cards, bigger card animations, rebalanced tiers, clearer card wording, spectators, and more. A running log of what changed.",
  alternates: { canonical: "/updates" },
};

// Full write-ups keyed by the timeline anchor (src/lib/updates.ts carries the
// date, title and one-line summary). Each entry is one card on the wall; the
// card opens to its paragraphs, so the page reads as a wall, not an essay.
// Entries generated from the changelog carry their bullet points instead.
const BODY: Record<string, React.ReactNode> = {
  "a-tighter-card-pool": (
    <>
      <p>
        The pool had grown to about 2,450 cards, and hundreds of them were the same idea with a
        different name, a strictly worse rung of another card, or a rule too long to read at the
        board. Those are now retired: they no longer come up in a draft, old games that used them
        still replay exactly, and each keeps its codex page (reachable by its link) with a pointer
        to the card that covers the same ground.
      </p>
    </>
  ),
  "new-look": (
    <p>
      The whole site sits on flat warm greys with square corners, metal buttons and a 60px top
      bar, laid out the way Lichess lays out a page. Boxes are boxes, links are blue, dates and
      ranks are brass, and nothing glows.
    </p>
  ),
  "hundreds-of-new-cards": (
    <>
      <p>
        Four themed sets joined the pool: elemental (fire, ice, storm, earth, tide, growth),
        warfare (charges, sieges, formations, reinforcements), arcane (teleports, time-stops,
        transmutation, meta effects), and chaos (slapstick and curses with a real bite). Every one
        reuses the engine&apos;s existing mechanics, and each is tuned to a tier that matches its
        real power. Browse the whole library in the{" "}
        <Link href="/codex" className="underline">codex</Link>.
      </p>
    </>
  ),
  "bigger-more-distinct-animations": (
    <p>
      Cards that used to share one look now each get their own. Freezes split into an ice-shatter,
      a chain-freeze, a deep glacier and a snap-frost; the petrify family got its own gorgon and
      stone looks; and the marquee cards, board-wipes, sieges, meteors and transforms all got
      dedicated spectacles. Every animation plays for both players and respects reduced motion.
    </p>
  ),
  "balance-and-clarity": (
    <p>
      A full re-audit corrected dozens of card tiers so that cards doing the same thing sit at the
      same tier, and descriptions were rewritten to say exactly what a card does, to whom, and for
      how long. Protection cards state whether your king is covered, and an uncapturable piece can
      no longer be the one that captures the enemy king.
    </p>
  ),
  "lobby-and-matches": (
    <p>
      You can see who is spectating your game, and a handful of match bugs were fixed. New here?
      Start with{" "}
      <Link href="/guide/how-to-play" className="underline">how to play</Link>.
    </p>
  ),
};

export default function UpdatesPage() {
  return (
    <>
      <SiteHeader />
    <main className="mx-auto w-full max-w-[1300px] px-3 py-6 sm:px-5">
      <BreadcrumbJsonLd title="Updates" path="/updates" />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-parchment-50">What&apos;s new</h1>
        <p className="text-[13px] text-parchment-400">A running log of the biggest changes to the game.</p>
      </div>
      {/* The wall: one box per update, newest first, the date in brass like a
          Lichess blog list. Details fold open in place. */}
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {UPDATES.map((u) => (
          <li key={u.anchor} id={u.anchor} className="plate flex flex-col p-4">
            <time dateTime={u.date} className="text-[12px] uppercase tracking-[0.05em] text-brag">
              {formatUpdateDate(u.date)}
            </time>
            <h2 className="mt-1 text-[16px] font-semibold text-parchment-50">{u.title}</h2>
            <p className="mt-1.5 text-[13px] leading-snug text-parchment-300">{u.summary}</p>
            {(BODY[u.anchor] || (u.bullets && u.bullets.length > 0)) && (
              <details className="mt-3 text-[13px] leading-relaxed text-parchment-200 [&_p+p]:mt-2">
                {/* inline-flex plus a min-height rather than padding: a <summary> is the
                    disclosure control, and this one was 21px tall. The negative
                    margin keeps the card's spacing where it was. */}
                <summary className="-my-2 inline-flex min-h-[44px] cursor-pointer select-none items-center text-[13px] text-[color:var(--accent)] hover:underline">
                  Read more
                </summary>
                {BODY[u.anchor] && <div className="mt-2">{BODY[u.anchor]}</div>}
                {u.bullets && u.bullets.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {u.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
              </details>
            )}
          </li>
        ))}
      </ul>
    </main>
    </>
  );
}
