import type { Metadata } from "next";
import Link from "next/link";
import { GlossaryText } from "@/components/GlossaryText";
import { KeyTerms } from "@/components/guide/KeyTerms";
import { InfoPageLayout, InfoSection } from "@/components/InfoPageLayout";
import { BreadcrumbJsonLd, FaqSection, GuideFooter } from "../shared";

export const metadata: Metadata = {
  title: "Chess roguelike and chess card game: Nerf Chess",
  description:
    "Nerf Chess is chess crossed with a card game: draft from a tiered deck of 1,000+ cards every 5 moves, with escalating power like a roguelike. Learn how the drafting works and play free in your browser.",
  keywords: [
    "chess roguelike",
    "chess card game",
    "chess deckbuilder",
    "roguelike chess",
    "chess with cards",
    "chess drafting game",
    "deckbuilding chess",
    "chess card drafting",
  ],
  alternates: { canonical: "/guide/chess-roguelike" },
};

export default function ChessRoguelikePage() {
  return (
    <InfoPageLayout
      eyebrow="guide"
      title="Chess meets the card game"
      intro="Nerf Chess borrows the best idea from card games and roguelikes: a draft. On a normal chess board, both players build a hand of escalating cards as the game runs, so no two games play out the same way."
    >
      <BreadcrumbJsonLd title="Chess roguelike" path="/guide/chess-roguelike" />

      <InfoSection title="Chess with a card draft">
        <p>
          <GlossaryText text="Every 5 of your own moves, Nerf Chess deals you a draft: two cards, pick one, or skip it to bank a stronger offer, or spend your reroll for a fresh pair." />{" "}
          In{" "}
          <Link href="/guide/buff-mode" className="underline">Buff mode</Link> those cards are
          power-ups you keep for yourself; in{" "}
          <Link href="/guide/nerf-mode" className="underline">Nerf mode</Link> they are mostly
          hexes you cast on your opponent, plus boons and items. The card layer sits on top of an
          ordinary chess game, so the pieces and the board are familiar, but the toolkit you build
          from the deck is different every match.
        </p>
      </InfoSection>

      <InfoSection title="Escalating power, like a run">
        <p>
          What gives Nerf Chess its roguelike feel is the escalation. Cards are graded into eight
          difficulty <Link href="/guide/glossary#tier" className="underline">tiers</Link>
          <GlossaryText text=", from I (Trivial) to VIII (Unhinged), and the draft climbs that curve as the game goes on: the offers roll around tiers I, II, III, V, then VII and up to the VIII cap. Early offers are mild; late-game offers can be board-warping. One shared wobble of plus or minus one tier is rolled per round (18 percent each way), so both players always see the same tier. You can skip a draft to bank it and roll your next offer one tier higher, a timing gamble that rewards patience. The legendary bands (apex at tier 9 and mythic at tier 10) never roll in the normal draft at all: they must be earned, by banking a tier-8 offer, winning a Chess Diff, or gambling on a Jackpot." />
        </p>
      </InfoSection>

      <InfoSection title="A thousand-card deck to draft from">
        <p>
          The card pool is large and browsable. Over 1,000 cards and rules, power-up buffs, secret
          nerfs, offensive hexes, and relieving boons, live in the{" "}
          <Link href="/codex" className="underline">codex</Link>, each with its tier and full
          text. If you like deckbuilders and drafting games, the draft is the part of Nerf Chess
          that will feel like home, even though there is no deck to build before the match: your
          &quot;deck&quot; is assembled live, one draft at a time.
        </p>
      </InfoSection>

      <InfoSection title="How it differs from a pure roguelike">
        <p>
          Nerf Chess is not a single-player run against escalating floors: it is a two-player game
          where both sides draft, and skill at reading the board and the cards decides it. What it
          shares with roguelikes and deckbuilders is the shape of the fun, drafting under
          uncertainty and adapting to what you draw, applied to a{" "}
          <Link href="/guide/chess-variants" className="underline">chess variant</Link> where you
          win by <Link href="/guide/capture-the-king" className="underline">capturing the king</Link>.
        </p>
        <p>
          Try a draft-heavy game against the bot at{" "}
          <Link href="/play" className="underline">/play</Link> or against a real opponent in the{" "}
          <Link href="/lobby" className="underline">lobby</Link>.
        </p>
      </InfoSection>

      <KeyTerms
        slugs={[
          "draft",
          "tier",
          "bank",
          "reroll",
          "apex",
          "mythic",
          "take-both",
          "blocked-draft",
          "forced-tier",
        ]}
      />

      <FaqSection
        items={[
          {
            question: "Is Nerf Chess a chess roguelike?",
            answer:
              "It borrows the roguelike and deckbuilder feel: you draft from a tiered deck of 1,000+ cards, and the power of the offers escalates as the game goes on. Unlike a single-player roguelike, it is a two-player chess variant where both players draft.",
          },
          {
            question: "Is there a chess card game?",
            answer:
              "Nerf Chess is one. It plays on a standard chess board, but every 5 moves you draft a card, buffs, hexes, or boons, and those cards shape the match. There are over 1,000 cards in the library.",
          },
          {
            question: "Do I build a deck before the game?",
            answer:
              "No. There is no pre-game deckbuilding. Your hand is drafted live, one pick every 5 moves, from offers that climb in difficulty tier as the game progresses.",
          },
          {
            question: "Where can I play this chess card game for free?",
            answer:
              "At nerfchess.com. It is free, runs in the browser, and needs no account for bot games or friend games.",
          },
        ]}
      />

      <GuideFooter current="/guide/chess-roguelike" />
    </InfoPageLayout>
  );
}
