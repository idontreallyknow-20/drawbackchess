"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MailPlus, WifiOff } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { EmptyState } from "@/components/EmptyState";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerSearch } from "@/components/PlayerSearch";
import { AccountUser, fetchMe } from "@/lib/authClient";

type Conversation = {
  username: string;
  avatar: string | null;
  lastText: string;
  lastAt: number;
  fromMe: boolean;
  unread: number;
};

function formatWhen(at: number): string {
  const d = new Date(at);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function InboxPage() {
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  // A failed conversations fetch shows a retry instead of an endless skeleton.
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const retry = useCallback(() => {
    setLoadError(false);
    setConversations(null);
    setReloadTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      setUser(me ?? null);
      if (!me) return;
      fetch("/api/messages")
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ conversations: Conversation[] }>;
        })
        .then((data) => {
          if (!cancelled) setConversations(data.conversations);
        })
        .catch(() => {
          if (!cancelled) setLoadError(true);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <section className="max-w-2xl mx-auto px-5 sm:px-6 py-8">
        <h1 className="page-title">Inbox</h1>

        {user === null && (
          <p className="mt-4 text-parchment-300">
            <Link href="/login?next=/inbox" className="text-gold-leaf hover:underline">
              Sign in
            </Link>{" "}
            to message other players.
          </p>
        )}

        {user && (
          <>
            <div className="mt-5">
              <PlayerSearch className="max-w-sm" />
              <p className="mt-1.5 text-sm text-parchment-400">
                Find a player and message them from their profile.
              </p>
            </div>

            {loadError ? (
              <EmptyState
                className="mt-6"
                icon={WifiOff}
                title="Could not load your inbox"
                body="Check your connection and try again."
                action={{ onClick: retry, label: "Retry" }}
              />
            ) : !conversations ? (
              <ul className="mt-6 plate divide-y divide-[color:var(--edge)]" aria-hidden>
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-9 w-9 shrink-0 bg-[color:var(--bg-raised)] animate-pulse" />
                    <div className="min-w-0 flex-1">
                      <div className="h-3 w-28 bg-white/[0.07] animate-pulse" />
                      <div className="mt-2 h-2.5 w-44 max-w-full bg-[color:var(--bg-raised)] animate-pulse" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : conversations.length === 0 ? (
              <EmptyState
                className="mt-6"
                icon={MailPlus}
                title="No conversations yet"
                body="Find a player above and say hello."
                action={{ href: "/community", label: "Browse players" }}
              />
            ) : (
              <ul className="mt-6 plate divide-y divide-[color:var(--edge)]">
                {conversations.map((c) => (
                  <li key={c.username}>
                    <Link
                      href={`/inbox/${encodeURIComponent(c.username)}`}
                      className="flex min-h-[44px] items-center gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--bg-raised)]"
                    >
                      <PlayerAvatar name={c.username} avatar={c.avatar} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={"truncate text-[13px] " + (c.unread ? "font-semibold text-parchment-50" : "text-parchment-100")}>
                            {c.username}
                          </span>
                          <span className="shrink-0 text-[12px] text-parchment-400">{formatWhen(c.lastAt)}</span>
                        </div>
                        <div className={"mt-0.5 truncate text-[13px] " + (c.unread ? "text-parchment-100" : "text-parchment-400")}>
                          {c.fromMe ? "You: " : ""}
                          {c.lastText}
                        </div>
                      </div>
                      {c.unread > 0 && (
                        <span className="grid min-w-[18px] shrink-0 place-items-center rounded-none bg-oxblood-glow px-1.5 font-mono text-[12px] leading-[18px] text-white">
                          {c.unread}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}
