"use client";

import { useEffect, useRef, useState } from "react";
import { Color } from "@/engine/types";
import { MPChatMessage } from "@/lib/multiplayer";
import { loadSettings, saveSettings, SETTINGS_CHANGED_EVENT } from "@/lib/settings";
import { Button } from "@/components/ui/Button";

// In-game chat between the two players. The server relays and stores the
// last 50 messages, so a reload keeps the transcript. A mute toggle (persisted
// in settings) hides messages for players who don't want to see chat.
//
// `collapsible` mode (draft games, where the left column belongs to the buff
// dock): the panel rests as a one-line strip (last message preview + unread
// count) and expands in place to a fixed-height panel on demand. The same
// component works inside the mobile move drawer.
export function ChatPanel({
  messages,
  myColor,
  onSend,
  className = "",
  collapsible = false,
  expandedClassName = "h-56 max-h-[40dvh]",
}: {
  messages: MPChatMessage[];
  myColor: Color;
  onSend: (text: string) => void;
  className?: string;
  /** Start as a compact strip; an expand control opens the full panel. */
  collapsible?: boolean;
  /** Height classes applied while a collapsible panel is expanded. */
  expandedClassName?: string;
}) {
  const [draft, setDraft] = useState("");
  const [muted, setMutedState] = useState(false);
  const [expanded, setExpanded] = useState(!collapsible);
  // Messages already seen the last time the panel was open: anything past
  // this count is "unread" while collapsed. Seeded with the restored
  // transcript so a reload never claims the whole history is new.
  const [seenCount, setSeenCount] = useState(() => messages.length);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const sync = () => setMutedState(loadSettings().muteChat);
    queueMicrotask(sync);
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
  }, []);

  // Opening the panel (or new messages while open) marks chat read; adjusted
  // during render so the unread badge updates without an extra render.
  if (expanded && seenCount !== messages.length) setSeenCount(messages.length);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, muted, expanded]);

  // Keyboard-focus hygiene: the board's piece-grab calls preventDefault() on
  // pointerdown (it must, to run its own drag), which also suppresses the
  // browser's default focus transfer - so after typing in chat and clicking
  // the board, this input would silently KEEP focus and the move list's
  // window-level arrow-key handler would keep ignoring every keystroke as
  // "typing". Blur the input ourselves whenever a pointer goes down outside
  // the panel, so history navigation always works after touching the board.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const input = inputRef.current;
      if (!input || document.activeElement !== input) return;
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return;
      input.blur();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const toggleMute = () => {
    const settings = loadSettings();
    saveSettings({ ...settings, muteChat: !settings.muteChat });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  const unread = expanded ? 0 : Math.max(0, messages.length - seenCount);
  const lastMsg = messages[messages.length - 1] ?? null;

  if (collapsible && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        aria-label="Expand chat"
        className={
          "plate plate-hover flex w-full items-center gap-2 p-2 px-3 text-left " +
          className
        }
      >
        <span className="shrink-0 text-[12px] text-parchment-400">Chat</span>
        {unread > 0 && (
          <span className="grid h-4 min-w-[1rem] shrink-0 place-items-center rounded-[1px] bg-gold px-1 font-mono text-[12px] font-bold text-ink-950">
            {unread}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] text-parchment-300">
          {muted ? (
            <span className="text-parchment-500">Chat is muted.</span>
          ) : lastMsg ? (
            <>
              <span
                className={
                  "font-display font-semibold " +
                  (lastMsg.color === myColor ? "text-gold-leaf" : "text-bruise-glow")
                }
              >
                {lastMsg.name}
              </span>
              <span className="text-parchment-300"> {lastMsg.text}</span>
            </>
          ) : (
            <span className="text-parchment-500">Say hello…</span>
          )}
        </span>
        {/* Expand chevron (inline SVG, no glyph). */}
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          width="10"
          height="10"
          className="shrink-0 text-parchment-400"
        >
          <path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
    );
  }

  return (
    <div
      ref={rootRef}
      className={
        // Muted: the body is a single line, so drop the fixed expanded height
        // and let the panel shrink-wrap instead of reserving empty space.
        "plate flex min-h-0 flex-col p-2 " +
        (collapsible && !muted ? expandedClassName + " " : "") +
        className
      }
    >
      <div className="flex shrink-0 items-center justify-between px-1 pb-1">
        <span className="text-[12px] text-parchment-400">Chat</span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMute}
            className="inline-flex items-center -mx-1 -my-1 min-h-[44px] px-2 py-2 text-[12px] text-parchment-400 hover:text-parchment-100 transition-colors"
            title={muted ? "Show chat messages" : "Hide chat messages"}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          {collapsible && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Collapse chat"
              title="Collapse chat"
              className="inline-flex items-center -mx-1 -my-1 min-h-[44px] px-2 py-2 text-[12px] text-parchment-400 hover:text-parchment-100 transition-colors"
            >
              Collapse
            </button>
          )}
        </span>
      </div>
      {muted ? (
        <div className="shrink-0 px-1 pb-1 text-[12px] text-parchment-500">
          Chat is muted.
        </div>
      ) : (
        <>
          <div ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-1 text-[12px] leading-snug">
            {messages.length === 0 && (
              <div className="text-parchment-500">Say hello. Your opponent can read this.</div>
            )}
            {messages.map((m, i) => (
              <div key={`${m.at}-${i}`} className="break-words">
                <span
                  className={
                    "font-display font-semibold " +
                    (m.color === myColor ? "text-gold-leaf" : "text-bruise-glow")
                  }
                >
                  {m.name}
                </span>
                <span className="text-parchment-200"> {m.text}</span>
              </div>
            ))}
          </div>
          <form onSubmit={submit} className="mt-2 flex shrink-0 gap-1">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => {
                // Keep the input visible once the on-screen keyboard settles.
                const el = e.currentTarget;
                window.setTimeout(() => el.scrollIntoView({ block: "nearest" }), 250);
              }}
              maxLength={200}
              placeholder="Message…"
              aria-label="Chat message"
              // 16px on phones: anything smaller makes iOS Safari zoom the
              // page on focus, which is what used to box the input off-screen.
              className="min-w-0 flex-1 rounded-sm border border-white/15 bg-ink-900/60 px-2 py-1.5 text-base sm:text-[12px] text-parchment placeholder:text-parchment-500 focus:border-gold/60 focus:outline-none"
            />
            <Button tone="ghost"
              type="submit"
              disabled={!draft.trim()}
              className="shrink-0 px-3 py-1.5 text-[12px]">
              Send
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
