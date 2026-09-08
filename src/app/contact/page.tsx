import type { Metadata } from "next";
import Link from "next/link";
import { InfoPageLayout, InfoSection } from "@/components/InfoPageLayout";
import { LinkButton } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Contact",
  description: "Reach the Nerf Chess team on Discord, Instagram, TikTok, or YouTube with feedback, bug reports, and rule ideas.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <InfoPageLayout
      eyebrow="contact"
      title="Get in touch"
      intro="Have a rule idea, found a confusing position, or spotted something that needs fixing? Feedback is welcome as Nerf Chess develops."
    >
      <InfoSection title="Contact channel">
        <p>
          The best place to share feedback, report bugs, or talk strategy is the
          Nerf Chess Discord server. You can also find updates and clips on
          Instagram, TikTok, and YouTube.
        </p>
        <div className="pt-2 flex flex-wrap gap-3">
          <a
            href="https://discord.gg/a5bJYFrTx"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 rounded-none btn-leaf font-display"
          >
            Join the Discord
          </a>
          <a
            href="https://www.instagram.com/officialnerfchess"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 rounded-none btn-ghost font-display"
          >
            @officialnerfchess on Instagram
          </a>
          <a
            href="https://tiktok.com/@nerfchess"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 rounded-none btn-ghost font-display"
          >
            @nerfchess on TikTok
          </a>
          <a
            href="https://www.youtube.com/@OfficialNerfChess"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 rounded-none btn-ghost font-display"
          >
            @OfficialNerfChess on YouTube
          </a>
        </div>
      </InfoSection>

      <InfoSection title="Looking for help playing?">
        <p>
          The tutorial explains the changed win conditions and hidden-rule format, while
          the FAQ answers the most common first-game questions.
        </p>
        <div className="pt-2 flex flex-wrap gap-3">
          <LinkButton tone="leaf" href="/tutorial" className="px-5 py-2.5">
            How to play
          </LinkButton>
          <LinkButton tone="ghost" href="/faq" className="px-5 py-2.5">
            Read the FAQ
          </LinkButton>
        </div>
      </InfoSection>
    </InfoPageLayout>
  );
}
