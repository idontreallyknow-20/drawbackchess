// 404 for an unknown settings section.
//
// Unlike the other segment boundaries this one is on a live path: the section
// page is a server component that validates the segment against SECTIONS and
// calls notFound(), so /settings/nope renders this with a real 404 status.
//
// A reader here has almost certainly mistyped one of a known, short list, so the
// list itself is the answer. It is generated from the same config the panel and
// the route render, which means a new section appears here without anyone
// remembering to add it.

import { SECTIONS } from "@/components/settings/config";
import { NotFoundPanel } from "@/app/_components/NotFoundPanel";

export default function NotFound() {
  return (
    <NotFoundPanel
      title="No settings section by that name"
      detail="Settings are split into the sections below. Pick one, or open the full page to see them all at once."
      action={{ href: "/settings", label: "All settings" }}
      secondary={{ href: "/lobby", label: "Back to lobby" }}
      suggestions={SECTIONS.map((s) => ({ href: `/settings/${s.id}`, label: s.title }))}
    />
  );
}
