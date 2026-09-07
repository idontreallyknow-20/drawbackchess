import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { PlayerAvatar } from "./PlayerAvatar";

// Placeholder/anonymous names that render as plain text instead of a profile
// link (they resolve to no account). Real guest accounts have ordinary
// two-word usernames and ARE linkable.
const NON_LINKABLE = new Set(["anonymous", "opponent", "guest", "waiting", "?"]);

/** Whether a rendered name points at a real profile. False for empty,
 *  whitespace, placeholder/anonymous names, and anything outside the username
 *  charset (spaces, punctuation) that could not resolve at /u/<name>. */
export function isLinkablePlayerName(name: string | null | undefined): boolean {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return false;
  if (NON_LINKABLE.has(trimmed.toLowerCase())) return false;
  return /^[A-Za-z0-9_]{3,20}$/.test(trimmed);
}

export interface PlayerLinkProps {
  name: string | null | undefined;
  avatar?: string | null;
  flair?: string | null;
  /** Avatar size in px when `avatar` is provided (default 20). */
  avatarSize?: number;
  className?: string;
  /** Force plain-text rendering even for a linkable name (e.g. in-board rows
   *  during your own active game, where a click must not leave the game). */
  disableLink?: boolean;
  children?: ReactNode;
}

// Standard clickable username: a Link to /u/<name> (encodeURIComponent) with an
// optional avatar/flair, a hover underline, and stopPropagation so it works
// inside larger clickable rows. Non-linkable names fall back to plain text with
// the same layout. Use this everywhere a username is rendered.
export function PlayerLink({
  name,
  avatar,
  flair,
  avatarSize = 20,
  className,
  disableLink,
  children,
}: PlayerLinkProps) {
  const label = (name ?? "").trim();
  const content = (
    <>
      {avatar !== undefined && (
        <PlayerAvatar name={label || "?"} avatar={avatar} flair={flair} size={avatarSize} />
      )}
      <span className="truncate">{children ?? label}</span>
    </>
  );

  if (disableLink || !isLinkablePlayerName(label)) {
    return (
      <span className={`inline-flex min-w-0 items-center gap-1.5 ${className ?? ""}`}>{content}</span>
    );
  }

  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <Link
      href={`/u/${encodeURIComponent(label)}`}
      onClick={stop}
      // 66.1x18 wherever it appears, which is every player name on the site
      // that is not inside running prose: tournament standings, club member
      // lists, the profile rail. The negative margin gives the pixels back so
      // a dense list keeps its rhythm, and both relax on a fine pointer.
      className={`-my-3 inline-flex min-h-[44px] min-w-0 items-center gap-1.5 hover:underline [@media(pointer:fine)]:my-0 [@media(pointer:fine)]:min-h-0 ${className ?? ""}`}
    >
      {content}
    </Link>
  );
}
