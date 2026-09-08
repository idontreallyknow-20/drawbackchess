import type { Metadata } from "next";
import Link from "next/link";
import { InfoPageLayout, InfoSection } from "@/components/InfoPageLayout";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The rules for using nerfchess.com: accounts, fair play, acceptable conduct, content you post, and how the free service is provided.",
  alternates: { canonical: "/terms-of-service" },
};

function ContactLink({ children }: { children: React.ReactNode }) {
  return (
    <Link href="/contact" className="text-gold-leaf hover:underline">
      {children}
    </Link>
  );
}

export default function TermsOfServicePage() {
  return (
    <InfoPageLayout
      eyebrow="terms of service"
      title="Terms of service"
      intro={
        <>
          These Terms of Service (the &ldquo;Terms&rdquo;) govern your use of Nerf
          Chess at nerfchess.com and its related services (the &ldquo;Service&rdquo;).
          Nerf Chess is a free online chess variant. By creating an account or using
          the Service, you agree to these Terms. If you do not agree, please do not
          use the Service. Last updated: July 15, 2026.
        </>
      }
    >
      <InfoSection title="Using the Service">
        <p>
          Nerf Chess is provided free of charge for personal, non-commercial play.
          You may use it only in ways that are lawful and that respect other players.
          We may add, change, or remove features at any time, and we may limit or
          suspend access where needed to keep the Service running and fair.
        </p>
        <p>
          The Service is not directed at children under the age of 13. If you are
          under the age of majority where you live, you may use the Service only with
          the involvement of a parent or guardian.
        </p>
      </InfoSection>

      <InfoSection title="Your account">
        <p>
          Creating an account requires only a username and a password. You are
          responsible for keeping your password secure and for everything that
          happens under your account. Do not share your account, and do not use
          another player&apos;s account without their permission. If you believe your
          account has been accessed without authorization, please{" "}
          <ContactLink>contact us</ContactLink>.
        </p>
        <p>
          Choose a username that is not offensive, misleading, or impersonating
          another person. We may reclaim or rename accounts whose usernames break
          these rules.
        </p>
      </InfoSection>

      <InfoSection title="Fair play and no cheating">
        <p>
          Nerf Chess is a game of skill, and fair play is the heart of it. When you
          play, you agree not to:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            Use chess engines, bots, solvers, or any outside assistance to choose or
            make your moves in games meant to be played by a human;
          </li>
          <li>
            Manipulate ratings, leaderboards, or results through collusion,
            sandbagging, arranged wins and losses, or multiple accounts;
          </li>
          <li>
            Interfere with matchmaking, stall or abandon games to waste an
            opponent&apos;s time, or otherwise disrupt other players&apos; games;
          </li>
          <li>
            Attempt to access, probe, or tamper with the Service&apos;s servers,
            game logic, or other users&apos; accounts and data.
          </li>
        </ul>
        <p>
          We may investigate suspected cheating and, at our discretion, adjust
          ratings, void results, remove content, or restrict, suspend, or close
          accounts to protect the integrity of the Service.
        </p>
      </InfoSection>

      <InfoSection title="Community conduct and user content">
        <p>
          You are responsible for the content you add, including your username, bio,
          profile picture, chat messages, and any other material you submit. You
          agree not to post content that is illegal, hateful, harassing, sexually
          explicit, deceptive, or that infringes anyone&apos;s rights, and to follow
          our{" "}
          <Link href="/guidelines" className="text-gold-leaf hover:underline">
            community guidelines
          </Link>
          .
        </p>
        <p>
          You keep ownership of the content you create. By submitting content, you
          grant us a non-exclusive, worldwide, royalty-free license to host, store,
          display, and distribute it as needed to operate the Service, such as
          showing your profile and game history to other players. We may remove
          content that breaks these Terms and take action on the accounts involved.
        </p>
      </InfoSection>

      <InfoSection title="Intellectual property">
        <p>
          The Service, including its name, design, code, card library, artwork, and
          other materials we provide, belongs to Nerf Chess or its licensors and is
          protected by law. We grant you a personal, non-transferable, revocable
          permission to use the Service for play. You may not copy, resell, or
          create derivative products from the Service except as allowed by law or
          with our written permission.
        </p>
      </InfoSection>

      <InfoSection title="Service availability">
        <p>
          The Service is provided as-is and as-available. Nerf Chess is a free,
          hobby-scale project, and we do not promise that it will always be online,
          uninterrupted, error-free, or that game data, ratings, and history will
          always be preserved. We may modify, suspend, or discontinue any part of the
          Service at any time.
        </p>
      </InfoSection>

      <InfoSection title="Disclaimer of warranties">
        <p>
          To the fullest extent permitted by law, the Service is provided without
          warranties of any kind, whether express or implied, including implied
          warranties of merchantability, fitness for a particular purpose, and
          non-infringement. We do not warrant that the Service will meet your
          expectations or that any defects will be corrected.
        </p>
      </InfoSection>

      <InfoSection title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, Nerf Chess and the people who run
          it will not be liable for any indirect, incidental, special, consequential,
          or punitive damages, or for any loss of data, ratings, progress, or
          goodwill, arising out of or related to your use of the Service. Because the
          Service is provided free of charge, our total liability for any claim
          relating to the Service is limited to the amount you paid to use it, which
          is zero. Some jurisdictions do not allow certain limitations, so parts of
          this section may not apply to you.
        </p>
      </InfoSection>

      <InfoSection title="Suspension and termination">
        <p>
          You may stop using the Service at any time and may request deletion of your
          account as described in our{" "}
          <Link href="/privacy-policy" className="text-gold-leaf hover:underline">
            Privacy Policy
          </Link>
          . We may suspend or close accounts that break these Terms, harm other
          players, or put the Service at risk. Provisions that by their nature should
          survive, such as the sections on intellectual property, disclaimers, and
          limitation of liability, continue to apply after your access ends.
        </p>
      </InfoSection>

      <InfoSection title="Changes to these terms">
        <p>
          We may update these Terms from time to time. When we do, we will post the
          revised version on this page and update the &ldquo;Last updated&rdquo; date
          above. Your continued use of the Service after changes take effect means
          you accept the updated Terms. If you do not agree to a change, please stop
          using the Service.
        </p>
      </InfoSection>

      <InfoSection title="Contact us">
        <p>
          If you have questions about these Terms, please reach out through our{" "}
          <ContactLink>contact page</ContactLink>.
        </p>
      </InfoSection>
    </InfoPageLayout>
  );
}
