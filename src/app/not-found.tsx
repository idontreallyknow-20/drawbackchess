"use client";

// The site's 404.
//
// There was none, so every unmatched address on nerfchess.com fell through to
// Next's built-in page: an unstyled "404 | This page could not be found" that
// follows the OS colour scheme rather than the site's, carries no navigation,
// and reads as a hole in the app rather than a part of it.
//
// The root not-found is the boundary for TWO things (see next/docs
// 01-app/03-api-reference/03-file-conventions/not-found.md): any URL that
// matches no route at all, and any notFound() thrown in a segment that has no
// closer boundary of its own. Both arrive here, and the two look nothing alike
// to a reader: one is a typo in the address bar, the other is a real page for a
// thing that turned out not to exist. So the words are chosen from the path.
// /u/<name> says no player by that name; /codex/buff/<id> says no card with
// that id (that one is live today: the codex routes call notFound()).
//
// This is the one 404 that needs the client, and only for usePathname; the
// panel it renders is a plain server component. Reading the path on the client
// is what the Next docs prescribe for exactly this case.

import { usePathname } from "next/navigation";
import { NotFoundPanel } from "./_components/NotFoundPanel";
import { NOT_FOUND_COPY, notFoundKindForPath } from "./_components/notFoundCopy";

export default function NotFound() {
  const pathname = usePathname();
  const copy = NOT_FOUND_COPY[notFoundKindForPath(pathname)];
  return (
    <NotFoundPanel
      title={copy.title}
      detail={copy.detail}
      action={copy.action}
      secondary={copy.secondary}
    />
  );
}
