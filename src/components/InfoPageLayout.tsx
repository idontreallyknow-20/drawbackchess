import type { ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

type InfoPageLayoutProps = {
  eyebrow: string;
  title: string;
  // ReactNode (not just string) so a page can pass a glossary-wrapped intro;
  // plain strings, which every other caller passes, remain valid.
  intro: ReactNode;
  children: ReactNode;
  // Optional trailing slot rendered inside the reading column, after the card
  // body. The codex detail pages pass the AffectedPieces strip here so it sits
  // in the same column as the detail instead of below the site footer.
  extra?: ReactNode;
  // Optional breadcrumb trail rendered above the eyebrow, inside the reading
  // column. The codex detail pages pass a Home / Codex / family trail here.
  breadcrumb?: ReactNode;
};

export function InfoPageLayout({
  eyebrow,
  title,
  intro,
  children,
  extra,
  breadcrumb,
}: InfoPageLayoutProps) {
  return (
    <main className="min-h-screen pb-20">
      {/* The standard site nav on every reading page (design system §9: the top
          nav is identical on every page), not a logo-only stub. */}
      <SiteHeader />

      <section className="mx-auto max-w-[1100px] px-6 pt-4 sm:px-8">
        {breadcrumb && <div className="mb-3">{breadcrumb}</div>}
        {/* Fluid display ramp instead of ad-hoc sizes; the prose column below
            stays narrower than the card grid so long lines remain readable. */}
        <h1 className="page-title">{title}</h1>
        <p className="mt-3 max-w-3xl text-[15px] leading-[1.6] text-parchment-300">{intro}</p>
        <div className="mt-9 space-y-4">
          {children}
          {extra}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function InfoSection({
  title,
  id,
  children,
}: {
  title: string;
  /** Anchor id; defaults to a slug of the title. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id ?? slugify(title)} className="plate scroll-mt-20 p-6 sm:p-7">
      <h2 className="font-display text-[1.25rem] font-medium text-parchment-50">{title}</h2>
      <div className="mt-3 max-w-3xl space-y-3 text-[15px] leading-relaxed text-parchment-200">
        {children}
      </div>
    </section>
  );
}
