// Socials chip row: Discord, Instagram, TikTok, and YouTube (the real @nerfchess
// accounts). The single source of truth for social links — the home page and the
// codex card both render this component, so the link set can never drift.
// No hooks, so it renders fine in both client and server component trees.
//
// Two variants:
//   "quiet"     — the codex card's muted ghost chips.
//   "prominent" — the home page's follow block: bigger chips, brand-tinted
//                 icons, and a heading that reads as an invitation instead of
//                 a footnote. Playtest feedback: the quiet row was invisible.

const SOCIALS: {
  href: string;
  label: string;
  /** Brand accent painted on the icon in the prominent variant only; the
   *  quiet variant stays currentColor so the codex card keeps its hush. */
  brand: string;
  icon: (size: number) => React.ReactNode;
}[] = [
  {
    href: "https://discord.gg/a5bJYFrTx",
    label: "Discord",
    brand: "#5865F2",
    icon: (size) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    ),
  },
  {
    href: "https://www.instagram.com/officialnerfchess",
    label: "Instagram",
    brand: "#E4405F",
    icon: (size) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
      </svg>
    ),
  },
  {
    href: "https://tiktok.com/@nerfchess",
    label: "TikTok",
    brand: "#5EE8E4",
    icon: (size) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
      </svg>
    ),
  },
  {
    href: "https://www.youtube.com/@OfficialNerfChess",
    label: "YouTube",
    brand: "#FF4E45",
    icon: (size) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
        <path d="m10 15 5-3-5-3z" />
      </svg>
    ),
  },
];

export function SocialsRow({
  label = "Socials",
  className = "mt-8",
  variant = "quiet",
}: {
  label?: string;
  className?: string;
  variant?: "quiet" | "prominent";
}) {
  if (variant === "prominent") {
    return (
      <div className={`text-center ${className}`}>
        <span className="block text-[12px] tracking-widest text-parchment-400">
          Follow the game
        </span>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
          {SOCIALS.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost flex items-center gap-3 px-6 py-3.5 font-display text-[17px] font-semibold no-underline"
            >
              <span style={{ color: s.brand }} className="flex items-center">
                {s.icon(26)}
              </span>
              {s.label}
            </a>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {label && <span className="mr-1 text-[12px] text-parchment-400">{label}</span>}
      {SOCIALS.map((s) => (
        <a
          key={s.label}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          // Social links are nav links, so 13px and a 44px target on touch;
          // the "Check out our socials" label beside them stays a 12px label.
          className="-my-1 flex min-h-[44px] items-center gap-1.5 text-[13px] text-parchment-400 no-underline transition-colors hover:text-parchment-100 [@media(pointer:fine)]:my-0 [@media(pointer:fine)]:min-h-0"
        >
          {s.icon(14)}
          {s.label}
        </a>
      ))}
    </div>
  );
}
