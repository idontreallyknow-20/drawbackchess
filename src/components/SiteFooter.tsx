import Link from "next/link";

// Shared site footer for non-game public pages. The in-game screens are
// full-bleed and intentionally omit this; it is opted into per page (and by
// InfoPageLayout) rather than mounted globally, so the board view stays clean.
const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/guidelines", label: "Guidelines" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy-policy", label: "Privacy policy" },
  { href: "/terms-of-service", label: "Terms of service" },
];

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-5xl px-6 py-8">
      <nav
        aria-label="Footer"
        className="flex flex-wrap items-center justify-center text-[13px] text-parchment-400"
      >
        {FOOTER_LINKS.map((link, index) => (
          <span key={link.href} className="flex items-center">
            {index > 0 && (
              <span aria-hidden="true" className="opacity-50">
                |
              </span>
            )}
            {/* These are nav links, not prose links, so the 44px rule applies
                and they were 16 to 18px tall. The height comes from padding
                rather than a min-height so the separators still sit on the
                text baseline; the negative margin keeps the row the same
                visual density it had, since the padding is now doing the work
                the gap used to do. */}
            <Link
              href={link.href}
              className="-my-1 flex min-h-[44px] items-center px-3 transition-colors hover:text-parchment"
            >
              {link.label}
            </Link>
          </span>
        ))}
      </nav>
      <div className="mt-3 text-center text-[13px] text-parchment-400">
        <span className="opacity-70">Nerf Chess</span>
      </div>
    </footer>
  );
}
