import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import Link from "next/link";
import { FIRST_GAME_TOUR_HREF } from "@/components/tutorial/tourState";
import { LinkButton } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Nerf Chess tutorial: the five house rules and card types",
  description:
    "Learn to play Nerf Chess in minutes. The five house rules (win by capturing the king, no checkmate, secret nerfs) and the four card types: nerf, buff, hex, and boon. Then jump into a game.",
  keywords: [
    "how to play nerf chess",
    "nerf chess rules",
    "nerf chess tutorial",
    "chess with power ups how to play",
    "capture the king chess rules",
    "chess variant rules",
  ],
  alternates: { canonical: "/tutorial" },
};

// HowTo structured data: a short, honest step list for onboarding a new
// player. Google can surface it as a how-to result and AI engines can cite
// the steps directly.
const howToJsonLd = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to play Nerf Chess",
  description:
    "Nerf Chess is a chess variant with two modes. Win by capturing the king; there is no checkmate. Draft cards every 5 moves.",
  totalTime: "PT5M",
  step: [
    {
      "@type": "HowToStep",
      position: 1,
      name: "Pick a mode",
      text: "Choose Buff mode to draft power-up cards with no handicaps, or Nerf mode to carry a secret handicap you pick from two cards.",
      url: "https://nerfchess.com/tutorial#modes",
    },
    {
      "@type": "HowToStep",
      position: 2,
      name: "Play chess, with two changes",
      text: "Pieces move as in normal chess, but there is no checkmate or stalemate and the king is a capturable piece that may move into attacked squares.",
      url: "https://nerfchess.com/tutorial#rules",
    },
    {
      "@type": "HowToStep",
      position: 3,
      name: "Draft a card every 5 moves",
      text: "Every 5 of your own moves you are offered two cards and pick one: a buff for yourself, a hex to curse your opponent, or a boon to soften your nerf. Skip to bank a stronger offer.",
      url: "https://nerfchess.com/tutorial#cards",
    },
    {
      "@type": "HowToStep",
      position: 4,
      name: "Capture the king to win",
      text: "The game ends when a king is physically captured, a nerf's lose condition fires, or a player resigns. Read your opponent and take the king.",
      url: "https://nerfchess.com/tutorial#win",
    },
  ],
};

const CARD_TYPES = [
  {
    tag: "Nerf",
    who: "handicaps you",
    d: "Your secret rule in Nerf mode, chosen from two cards before the first move. It restricts how you are allowed to play, or invents a fresh way for you to lose. You always see your own nerf; your opponent never does. Example: \"You can't capture queens.\" The drawback is yours to carry all game.",
    example: null,
  },
  {
    tag: "Buff",
    who: "helps you",
    d: "A straight power-up, and the whole of Buff mode: both players draft one every 5 moves and build the stronger army. Some work quietly while you hold them, some fire the instant you pick them, and some wait until you spend them. Nobody is handicapped in Buff mode.",
    example: null,
  },
  {
    tag: "Hex",
    who: "handicaps your opponent",
    d: "The offensive card, and the most common thing your Nerf-mode draft offers. A nerf hurts you; a hex is a curse you cast on the other player. You pick it, they suffer it, and they only learn it landed when the effect shows up on their board. It is a temporary handicap you inflict, not one you take.",
    example: "Cold Feet: your opponent's pawns cannot capture for their next 3 turns. You spend your draft to tie their hands, then press the attack while they are stuck.",
  },
  {
    tag: "Boon",
    who: "softens your own nerf",
    d: "A rarer draft pick that turns your handicap down. Where a hex is aimed at your opponent, a boon is aimed at your own nerf: it suspends the rule, removes part of it, or waits for a condition and then lifts it. It is the only card that gives you relief from the drawback you started with.",
    example: "Reprieve suspends your nerf for your next 2 turns, so you can make the move it normally forbids. Others are conditional: Small Mercies waits until your opponent captures your pieces, then suspends your nerf on the turns that follow.",
  },
];

export default function TutorialPage() {
  return (
    <main className="min-h-screen pb-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
      />
      <SiteHeader />
      <section className="max-w-3xl mx-auto px-6 pt-4">
        <h1 className="page-title mt-1">House rules</h1>
        <p className="mt-5 text-[16px] leading-[1.7] text-parchment-200">
          Nerf Chess is chess, until it isn&apos;t. Five house rules are everything you need to know.
          Everything else depends on your mode: in Nerf mode, your secret handicap and the hexes,
          boons, and items you draft; in Buff mode, the buff cards both players draft every 5 moves.
        </p>
        {/* Primary entry: the guided first game. A real bot game (weakest
            bot, no clock, buff mode) with coach marks over the live board. */}
        <div className="mt-8 plate border-gold/40 bg-gold/5 p-5 sm:p-6">
          <h2 className="font-display text-[1.35rem] font-medium">
            Learn in 3 minutes: play your first draft
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-parchment-200">
            A guided real game against the easiest bot: make moves, watch the draft counter,
            pick (or bank) your first card, and read the auras it leaves on the board. The
            tour points at everything as it happens, and you can skip it any time.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <LinkButton tone="leaf" href={FIRST_GAME_TOUR_HREF} className="px-6 py-3">
              Play your first draft
            </LinkButton>
            <LinkButton tone="ghost" href="/tutorial/walkthrough" className="px-6 py-3">
              Interactive lessons
            </LinkButton>
          </div>
        </div>
        {/* The five house rules live in full in the guide; one line here keeps
            the tutorial from restating them. */}
        <div className="mt-9 plate p-5 sm:p-6">
          <p className="text-[15px] leading-relaxed text-parchment-200">
            No checkmate, a capturable king, secret nerfs, pre-filtered moves, Chebyshev
            distances: read the five house rules in the{" "}
            <Link href="/guide/how-to-play" className="font-semibold text-gold-leaf hover:underline">
              how-to-play guide
            </Link>
            .
          </p>
        </div>
        <div className="mt-14">
          <h2 className="font-display text-[1.35rem] font-medium">Nerf, buff, hex, boon</h2>
          <p className="mt-4 text-[15px] leading-[1.7] text-parchment-200">
            Every card in the game is one of these four. The trick is who each one lands on: a nerf and
            a boon act on your side of the board, while a hex acts on your opponent&apos;s. Buffs belong
            to Buff mode; the other three shape a Nerf-mode game.
          </p>
          <div className="mt-6 space-y-3">
            {CARD_TYPES.map((c) => (
              <div key={c.tag} className="plate p-5 sm:p-6">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-display text-2xl text-gold-leaf">{c.tag}</span>
                  <span className="text-[12px] text-parchment-400">{c.who}</span>
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-parchment-200">{c.d}</p>
                {c.example && (
                  <p className="mt-3 text-[14px] leading-relaxed text-parchment-200 border-l border-gold-leaf/40 pl-3">
                    <span className="text-[12px] text-parchment-400">for example</span>
                    <br />
                    {c.example}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-9 flex flex-wrap gap-3">
          <LinkButton tone="leaf"
            href="/tutorial/walkthrough"
            className="px-6 py-3">
            Try the interactive lessons
          </LinkButton>
          <LinkButton tone="ghost"
            href="/play"
            className="px-6 py-3">
            Skip and play
          </LinkButton>
          <LinkButton tone="ghost"
            href="/codex"
            className="px-6 py-3">
            Browse all rules
          </LinkButton>
        </div>
      </section>
    </main>
  );
}
