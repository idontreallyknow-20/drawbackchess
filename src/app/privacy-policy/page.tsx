import type { Metadata } from "next";
import Link from "next/link";
import { InfoPageLayout, InfoSection } from "@/components/InfoPageLayout";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Nerf Chess collects (a username, hashed password, and game records), the single essential cookie it sets, and how to delete your account.",
  alternates: { canonical: "/privacy-policy" },
};

function ContactLink({ children }: { children: React.ReactNode }) {
  return (
    <Link href="/contact" className="text-gold-leaf hover:underline">
      {children}
    </Link>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <InfoPageLayout
      eyebrow="privacy policy"
      title="Privacy policy"
      intro={
        <>
          This Privacy Policy explains how Nerf Chess (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;, or &ldquo;our&rdquo;) collects, uses, and protects your
          information when you use nerfchess.com and its related services (the
          &ldquo;Service&rdquo;). By using the Service, you agree to the practices
          described in this policy. Last updated: July 11, 2026.
        </>
      }
    >
      <InfoSection title="Information we collect">
        <p>
          We collect only the information needed to operate the Service. When you
          create an account, we store your username, a cryptographically hashed
          version of your password (we never store or have access to your password
          itself), your account creation date, and your rating data.
        </p>
        <p>
          Depending on how you use the Service, we may also store:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-parchment">Profile content</strong> you choose
            to add, such as a bio or profile picture. This content is displayed
            publicly on your player page.
          </li>
          <li>
            <strong className="text-parchment">Gameplay data</strong>, including
            the moves, participants, time control, result, and rating changes of
            finished online games. This powers game history, replays, statistics,
            and the leaderboard.
          </li>
          <li>
            <strong className="text-parchment">Communications</strong>, including
            direct messages you exchange with other players (along with read
            status), challenges you send, and notifications addressed to you.
            In-game chat is relayed live and is not generally retained; messages
            flagged by our automated profanity filter are kept for moderator
            review.
          </li>
          <li>
            <strong className="text-parchment">Moderation records</strong>, such
            as player reports you submit or that are submitted about you, and any
            resulting moderation actions.
          </li>
        </ul>
        <p>
          We do not collect email addresses, real names, phone numbers, payment
          information, or precise location data. Creating an account requires only
          a username and password.
        </p>
      </InfoSection>

      <InfoSection title="How we use your information">
        <p>We use the information described above to:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Provide, maintain, and improve the Service;</li>
          <li>
            Operate matchmaking, calculate ratings, and display game history,
            statistics, and leaderboards;
          </li>
          <li>
            Enforce our community standards, investigate reports, and keep the
            Service safe and fair through moderation;
          </li>
          <li>Respond to inquiries and requests you send us.</li>
        </ul>
        <p>
          We do not use your information for advertising, and we do not build
          marketing profiles of our users.
        </p>
      </InfoSection>

      <InfoSection title="Cookies and local storage">
        <p>
          We use a single essential cookie: an httpOnly session cookie that keeps
          you signed in to your account. It is set when you sign in and removed
          when you sign out. We do not use tracking, advertising, or third-party
          analytics cookies.
        </p>
        <p>
          To understand which pages are visited and how the site performs, we may
          use Cloudflare Web Analytics. It is cookieless: it does not set any
          cookie, does not fingerprint your device, and does not build a profile
          of you. It records only aggregate page views and performance timings.
        </p>
        <p>
          We also use your browser&apos;s local storage to save preferences on
          your device, such as board appearance, sound settings, custom rules, and
          your practice rating against the bots. This information never leaves
          your device, works without an account, and can be removed at any time by
          clearing site data in your browser.
        </p>
      </InfoSection>

      <InfoSection title="How we share information">
        <p>
          We do not sell your personal information, and we do not share it with
          advertisers or third-party analytics providers. Information is shared
          only in the following limited circumstances:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-parchment">Publicly, by design.</strong> Your
            username, rating, game record, statistics, and any optional profile
            content are visible to other users of the Service.
          </li>
          <li>
            <strong className="text-parchment">Service providers.</strong> We rely
            on infrastructure providers (such as our hosting provider) that
            process data on our behalf solely to run the Service.
          </li>
          <li>
            <strong className="text-parchment">Legal requirements.</strong> We may
            disclose information if required to do so by law or in response to a
            valid legal request.
          </li>
        </ul>
      </InfoSection>

      <InfoSection title="Data retention">
        <p>
          We retain your information for as long as your account is active or as
          needed to provide the Service. Completed game records are retained to
          preserve the integrity of ratings, statistics, and opponents&apos; game
          histories. Moderation records may be retained after account closure
          where necessary to keep the platform safe, such as to enforce bans.
        </p>
      </InfoSection>

      <InfoSection title="Security">
        <p>
          We take reasonable measures to protect your information. Passwords are
          stored only in hashed form, and connections to the Service are encrypted
          in transit using HTTPS. However, no method of transmission or storage is
          completely secure, and we cannot guarantee absolute security. Please use
          a strong, unique password for your account.
        </p>
      </InfoSection>

      <InfoSection title="Your rights and choices">
        <p>
          You can view the information shown publicly about you on your player
          page, and you can edit or remove your optional profile content at any
          time from your profile settings.
        </p>
        <p>
          To request deletion of your account or the personal information
          associated with it, contact us via the{" "}
          <ContactLink>contact page</ContactLink> and we will process your request.
          Depending on where you live, you may have additional rights under
          applicable data protection law, such as the right to access, correct, or
          delete your personal information; you can exercise these rights the same
          way.
        </p>
      </InfoSection>

      <InfoSection title="Children's privacy">
        <p>
          The Service is not directed at children under the age of 13, and we do
          not knowingly collect personal information from them. Because accounts
          require only a username and password, we collect minimal information
          from all users. If you believe a child under 13 has provided us with
          personal information, please contact us and we will remove it.
        </p>
      </InfoSection>

      <InfoSection title="Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. When we do, we will
          post the revised version on this page and update the &ldquo;Last
          updated&rdquo; date above. Your continued use of the Service after
          changes take effect constitutes acceptance of the updated policy.
        </p>
      </InfoSection>

      <InfoSection title="Contact us">
        <p>
          If you have questions about this Privacy Policy or how your information
          is handled, please reach out through our{" "}
          <ContactLink>contact page</ContactLink>.
        </p>
      </InfoSection>
    </InfoPageLayout>
  );
}
