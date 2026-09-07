"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ExternalLink, Link2, X } from "lucide-react";
import { affectedLine } from "./affected";
import { entryPath, type CodexEntry } from "./codexData";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

// The full card renderers pull in framer-motion (NerfCard) and the heavier card
// faces; load them only when a row is actually expanded, so they stay out of
// the initial /codex bundle and the compact rows render instantly.
const NerfCard = dynamic(() => import("@/components/NerfCard").then((m) => m.NerfCard), {
  ssr: false,
});
const BuffCard = dynamic(() => import("@/components/BuffCard").then((m) => m.BuffCard), {
  ssr: false,
});

// The in-place expansion of a row: the full card face, a plain-language
// "affected pieces" line where derivable, and the affordances the design brief
// asks for (a visible copy-link, a link to the stable detail page, collapse).
export function ExpandedCard({
  entry,
  copied,
  onCopy,
  onCollapse,
}: {
  entry: CodexEntry;
  copied: boolean;
  onCopy: () => void;
  onCollapse: () => void;
}) {
  const path = entryPath(entry);
  const affected = affectedLine(entry.kind, entry.card);

  return (
    <div className="plate-raised rounded-none border border-[color:var(--edge-strong)] p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <LinkButton tone="ghost"
          href={path}
          className="px-3 py-1.5 text-[13px]">
          <ExternalLink size={14} aria-hidden />
          Open card page
        </LinkButton>
        <Button tone="ghost"
         
          onClick={onCopy}
          className="px-3 py-1.5 text-[13px]">
          <Link2 size={14} aria-hidden />
          {copied ? "Link copied" : "Copy link"}
        </Button>
        <Button tone="ghost"
         
          onClick={onCollapse}
          className="ml-auto px-3 py-1.5 text-[13px]">
          <X size={14} aria-hidden />
          Collapse
        </Button>
      </div>

      <div className="mx-auto max-w-md">
        {entry.kind === "nerf" ? (
          <NerfCard nerf={entry.card} dense />
        ) : (
          <BuffCard
            buff={entry.card}
            tier={entry.card.tier}
            status={entry.card.implemented ? null : "Not yet appearing in drafts"}
          />
        )}
      </div>

      {affected && (
        <p className="mx-auto mt-3 max-w-md text-[13px] text-parchment-300">
          <span className="mr-1 text-[12px] text-parchment-400">Affected pieces</span>
          {affected}
        </p>
      )}
    </div>
  );
}
