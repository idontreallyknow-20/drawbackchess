// The shared body of every 404 on the site.
//
// It is the counterpart of components/ui/RouteError: the three halves of a
// designed missing-thing state (what is missing, in that thing's own words; why
// you might be here; a way onward that is never a dead end) authored once, so
// each `not-found.tsx` supplies only the sentence that is actually specific to
// it and cannot be got wrong twice.
//
// Deliberately a server component. Nothing here needs the client, and a 404 is
// the one page that must render when everything else has failed to; the root
// not-found is the only one that reaches for the client, and only because it
// has to read the path to know what was being looked for.

import { LinkButton } from "@/components/ui/Button";

export interface NotFoundLink {
  href: string;
  label: string;
}

export function NotFoundPanel({
  title,
  detail,
  action = { href: "/lobby", label: "Back to lobby" },
  secondary,
  suggestions,
}: {
  /** What is missing, as a short sentence. Sentence case (section 11). */
  title: string;
  /** One plain-words line on why the address might not resolve. */
  detail: string;
  /** The way onward. Defaults to the lobby, the site's home base. */
  action?: NotFoundLink;
  secondary?: NotFoundLink;
  /** Optional list of real places to go instead, for a 404 where the reader
   *  plainly meant one of a known set (a settings section, say). */
  suggestions?: NotFoundLink[];
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-6">
      <div className="plate w-full max-w-md p-5 sm:p-6">
        <div className="font-mono text-[12px] text-parchment-400">404</div>
        <h1 className="page-title mt-1">{title}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-parchment-300">{detail}</p>

        {suggestions && suggestions.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <li key={s.href}>
                {/* LinkButton, not a hand-rolled chip: these are controls, and
                    the sanctioned primitive is what carries the theme's button
                    material (docs/design-system.md §7). `sm` is the dense size
                    and still clears 44px on a coarse pointer. */}
                <LinkButton tone="default" size="sm" href={s.href}>
                  {s.label}
                </LinkButton>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <LinkButton tone="primary" href={action.href}>
            {action.label}
          </LinkButton>
          {secondary && (
            <LinkButton tone="default" href={secondary.href}>
              {secondary.label}
            </LinkButton>
          )}
        </div>
      </div>
    </main>
  );
}
