import type { Metadata } from "next";
import Link from "next/link";
import { GlossaryText } from "@/components/GlossaryText";
import { KeyTerms } from "@/components/guide/KeyTerms";
import { InfoPageLayout, InfoSection } from "@/components/InfoPageLayout";
import { BreadcrumbJsonLd, FaqSection, GuideFooter } from "../shared";

export const metadata: Metadata = {
  title: "Buff mode: chess with power-up cards",
  description:
    "Buff mode is chess with drafted power-up cards and no handicaps. Both players draft a buff every 5 moves, tiers climb from Trivial to Unhinged, and the strongest army wins. Rules and strategy.",
  alternates: { canonical: "/guide/buff-mode" },
};

export default function BuffModePage() {
  return (
    <InfoPageLayout
      eyebrow="guide"
      title="Buff mode: chess with power-up cards"
      intro="Buff mode is the sunny half of Nerf Chess. Nobody is handicapped and nothing is hidden about you: every 5 moves both players draft a power-up card, and the game becomes an arms race on a chessboard."
    >
      <BreadcrumbJsonLd title="Buff mode" path="/guide/buff-mode" />

      <InfoSection title="The draft loop">
        <p>
          <GlossaryText text="Every 5 of your own moves you receive an offer: two buff cards, pick one (in online games, within a 20-second lock-in window while the clocks pause). Buffs come in three kinds." />{" "}
          <strong>Passive</strong>{" "}
          <GlossaryText text="buffs work quietly while you hold them, like a piece gaining a new way to move." />{" "}
          <strong>Instant</strong>{" "}
          <GlossaryText text="buffs fire the moment you pick them, like a freeze or a reveal." />{" "}
          <strong>Activated</strong>{" "}
          <GlossaryText text="buffs wait until you choose to use them, and using one costs your turn (the extra-move family are free actions and resolve within your turn)." />
        </p>
        <p>
          <GlossaryText text="Instead of picking, you can skip a draft to bank it: your next offer rolls one tier higher. Banking never stacks beyond one tier, so the decision is a real gamble on timing rather than a snowball, with one jackpot case: bank an offer that contained a tier-8 card and your next offer becomes a guaranteed two-card apex (tier 9) offer, each slot with about a 10% chance to upgrade into a tier-10 mythic. You also start with one reroll, which swaps the offer for a fresh, guaranteed-different pair at the same tiers." />
        </p>
      </InfoSection>

      <InfoSection title="Tiers: from Trivial to Unhinged">
        <p>
          <GlossaryText text="Every card carries a tier from I to VIII: Trivial, Easy, Common, Severe, Brutal, Cruel, Punishing, Unhinged. Early drafts offer low tiers and the curve climbs round by round: I, II, III, V, then VII, VII, VII, and VIII from there on. One shared wobble is rolled per round, 18 percent up and 18 percent down, and it applies to both players and to both cards in an offer, so you and your opponent are always looking at the same tier. The first draft never wobbles up." />{" "}
          Browse the whole library, tier by tier, in the{" "}
          <Link href="/codex" className="underline">codex</Link>.
        </p>
      </InfoSection>

      <InfoSection title="Rules that keep it fair">
        <p>
          <GlossaryText text="A few engine rules keep Buff mode a chess game rather than pure chaos. Freezes and walnut hexes never affect kings, so the target of the game can always run. A shield never covers the king, and an uncapturable piece may never be the one that takes the enemy king: you must expose a piece to win. A player completely locked down by effects gets a forced pass instead of losing to &quot;no legal moves&quot;, and if both players are paralyzed the game is a draw." />{" "}
          And as everywhere in Nerf Chess, victory means{" "}
          <Link href="/guide/how-to-play" className="underline">capturing the king</Link>:
          buff-granted moves cannot dodge that goal, only race toward it.
        </p>
        <p>
          If you would rather have hidden information and mind games with your power curve,
          try <Link href="/guide/nerf-mode" className="underline">Nerf mode</Link>; the two
          modes share the draft engine but feel completely different to play.
        </p>
      </InfoSection>

      <KeyTerms
        slugs={[
          "buff",
          "draft",
          "tier",
          "bank",
          "reroll",
          "apex",
          "mythic",
          "take-both",
          "chess-diff",
          "forced-pass",
        ]}
      />

      <FaqSection
        items={[
          {
            question: "Does Buff mode have secret handicaps?",
            answer:
              "No. Buff mode has no nerfs at all. Both players start as equals and draft power-up cards every 5 moves; the drafting and the chess are the whole game.",
          },
          {
            question: "What happens when I use an activated buff?",
            answer:
              "Activating a buff costs your turn: after the effect resolves, play passes to your opponent. Extra-move cards are the exception and resolve within your turn.",
          },
          {
            question: "Should I ever skip a draft?",
            answer:
              "Sometimes. Skipping banks the draft so your next offer rolls one tier stronger. It never stacks past one tier, so skip when the current offer is weak or the position can wait.",
          },
          {
            question: "Can a buff freeze my king?",
            answer:
              "No. Freezes and similar lockdown effects never target kings, so you always keep a way to fight for your life.",
          },
          {
            question: "Is Buff mode rated separately?",
            answer:
              "Yes. Queue games are rated and Buff mode keeps its own rating pool, separate from Nerf mode.",
          },
        ]}
      />

      <GuideFooter current="/guide/buff-mode" />
    </InfoPageLayout>
  );
}
