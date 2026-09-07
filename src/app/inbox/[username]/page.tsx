"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { PlayerLink } from "@/components/PlayerLink";
import { AccountUser, fetchMe } from "@/lib/authClient";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

type ThreadMessage = { id: string; fromMe: boolean; text: string; at: number };
type Thread = { peer: { username: string; avatar: string | null }; messages: ThreadMessage[] };

export default function ThreadPage() {
  const params = useParams<{ username: string }>();
  const username = String(params.username ?? "");
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [thread, setThread] = useState<Thread | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (!cancelled) setUser(me);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the thread, then poll it so replies appear without a refresh.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let loaded = false;
    let intervalId: number | undefined;
    const stop = () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    const load = async () => {
      // Do not re-hit a known-missing thread, and skip polls while the tab is
      // hidden so a backgrounded conversation stops burning requests.
      if (cancelled || (typeof document !== "undefined" && document.hidden)) return;
      try {
        const res = await fetch(`/api/messages/${encodeURIComponent(username)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setMissing(true);
          stop();
          return;
        }
        if (!res.ok) {
          // Only surface an error before the first successful load; a failed
          // poll on an open thread should stay quiet and retry on the next tick.
          if (!loaded) setLoadError(true);
          return;
        }
        loaded = true;
        setLoadError(false);
        const data = (await res.json()) as Thread;
        setThread((prev) => {
          if (!prev) return data;
          // Merge by id, not by length. A poll that started before a just-sent
          // message was persisted returns the pre-send list; replacing state
          // with it would drop the optimistic message for up to 5s. Keep any
          // local message the server response does not yet include.
          const serverIds = new Set(data.messages.map((m) => m.id));
          const localExtra = prev.messages.filter((m) => !serverIds.has(m.id));
          if (localExtra.length === 0 && prev.messages.length === data.messages.length) {
            // Nothing new: keep the same object so typing is not disturbed.
            return prev;
          }
          const merged = [...data.messages, ...localExtra].sort((a, b) => a.at - b.at);
          return { ...data, messages: merged };
        });
      } catch {
        if (!loaded) setLoadError(true);
      }
    };
    load();
    intervalId = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [user, username, reloadKey]);

  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(username)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: ThreadMessage; error?: string };
      if (!res.ok || !data.message) {
        setError(data.error || "Could not send that message.");
        return;
      }
      setDraft("");
      stickToBottom.current = true;
      setThread((prev) =>
        prev ? { ...prev, messages: [...prev.messages, data.message!] } : prev,
      );
    } catch {
      // fetch rejects when the network is down; surface it instead of leaving
      // the send to fail silently as an unhandled rejection.
      setError("Could not send that message. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <section className="max-w-2xl mx-auto px-5 sm:px-6 py-6">
        <div className="mb-4 flex min-w-0 items-center gap-3">
          <Link href="/inbox" className="text-sm text-parchment-400 hover:text-parchment-100">
            Inbox
          </Link>
          <span className="text-parchment-500">/</span>
          {thread && (
            <PlayerLink
              name={thread.peer.username}
              avatar={thread.peer.avatar}
              avatarSize={26}
              className="min-h-[44px] font-display text-lg text-parchment-50 hover:text-gold-leaf"
            />
          )}
          {!thread && !missing && <span className="text-[13px] text-parchment-400">{username}</span>}
        </div>

        {user === null && (
          <p className="text-parchment-300">
            <Link href={`/login?next=/inbox/${encodeURIComponent(username)}`} className="text-gold-leaf hover:underline">
              Sign in
            </Link>{" "}
            to read your messages.
          </p>
        )}
        {missing && <p className="text-parchment-300">No player with that name.</p>}

        {user && !missing && loadError && !thread && (
          <div className="plate flex flex-col items-start gap-3 p-4">
            <p className="text-[13px] text-parchment-300">
              We could not load this conversation. Check your connection and try again.
            </p>
            <div className="flex gap-2">
              <Button tone="leaf"
                onClick={() => {
                  setLoadError(false);
                  setReloadKey((k) => k + 1);
                }}
                className="px-5 text-[13px] font-semibold">
                Retry
              </Button>
              <LinkButton tone="ghost"
                href="/inbox"
                className="flex px-5 text-[13px]">
                Back to inbox
              </LinkButton>
            </div>
          </div>
        )}

        {user && !missing && !(loadError && !thread) && (
          <>
            <div
              className="plate h-[50dvh] overflow-y-auto p-4"
              onScroll={(e) => {
                const el = e.currentTarget;
                stickToBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
              }}
            >
              {!thread ? (
                <p className="text-sm text-parchment-400">Loading messages…</p>
              ) : thread.messages.length === 0 ? (
                <p className="text-sm text-parchment-400">No messages yet.</p>
              ) : (
                <ul className="space-y-2">
                  {thread.messages.map((m) => (
                    <li key={m.id} className={"flex " + (m.fromMe ? "justify-end" : "justify-start")}>
                      <div
                        className={
                          "max-w-[80%] border px-3 py-2 text-sm leading-snug " +
                          (m.fromMe
                            ? "border-[color:var(--edge-strong)] bg-[color:var(--bg-raised)] text-parchment-50"
                            : "border-[color:var(--edge)] bg-[color:var(--bg-zebra)] text-parchment-100")
                        }
                      >
                        <div className="whitespace-pre-wrap break-words">{m.text}</div>
                        <div className="mt-1 text-right font-mono text-[12px] text-parchment-400">
                          {new Date(m.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={`Message ${thread?.peer.username ?? username}`}
                maxLength={1000}
                aria-label={`Message ${thread?.peer.username ?? username}`}
                className="min-h-[44px] min-w-0 flex-1 rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-base)] px-4 py-3 text-[13px] text-parchment placeholder:text-parchment-500"
              />
              <Button tone="leaf"
                onClick={send}
                disabled={!draft.trim() || sending}
                className="px-5 text-[13px] font-semibold disabled:opacity-50">
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
            {error && <p className="mt-2 text-sm text-oxblood-glow">{error}</p>}
          </>
        )}
      </section>
    </main>
  );
}
