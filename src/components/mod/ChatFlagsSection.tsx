"use client";

// Chat the profanity filter caught. Every row is a judgement call, so each one
// carries both outcomes: mark it read, or jump straight to the author in the
// Players section with the search already filled in — the escalation path the
// old panel made you retype by hand.

import { useCallback, useEffect, useState } from "react";
import type { ChatFlag } from "./types";
import { Empty, FilterChip, Loading, ModButton, ModLinkButton, postJson, when, whenShort } from "./ui";

export function ChatFlagsSection({
  onHandled,
  onInspectPlayer,
}: {
  onHandled?: () => void;
  onInspectPlayer?: (username: string) => void;
}) {
  const [all, setAll] = useState(false);
  const [flags, setFlags] = useState<ChatFlag[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/mod/chat-flags${all ? "?all=1" : ""}`);
    if (res.ok) setFlags(((await res.json()) as { flags: ChatFlag[] }).flags);
  }, [all]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const review = async (id: string) => {
    setBusy(id);
    await postJson("/api/mod/chat-flags", { id });
    await load();
    setBusy(null);
    onHandled?.();
  };

  const reviewAll = async () => {
    setBusy("all");
    await postJson("/api/mod/chat-flags", { all: true });
    await load();
    setBusy(null);
    onHandled?.();
  };

  const pending = flags?.filter((f) => !f.reviewed).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={!all} onClick={() => setAll(false)}>
          Unreviewed
        </FilterChip>
        <FilterChip active={all} onClick={() => setAll(true)}>
          Everything
        </FilterChip>
        {pending > 0 && (
          <ModButton size="sm" className="ml-auto" disabled={busy === "all"} onClick={reviewAll}>
            Mark all {pending} reviewed
          </ModButton>
        )}
      </div>

      {!flags ? (
        <Loading what="chat flags" />
      ) : flags.length === 0 ? (
        <Empty>{all ? "Nothing has ever been flagged." : "Nothing waiting to be reviewed."}</Empty>
      ) : (
        <div className="space-y-2">
          {flags.map((f) => (
            <div key={f.id} className="plate p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-display font-semibold text-parchment-50">{f.username}</span>
                <span className="text-parchment-400" title={when(f.created_at)}>
                  {whenShort(f.created_at)}
                </span>
                {f.reviewed ? (
                  <span className="ml-auto text-[12px] text-parchment-400">reviewed</span>
                ) : null}
              </div>
              <p className="mt-2 break-words text-sm text-parchment-100">{f.text}</p>
              <p className="mt-1 text-xs text-oxblood-glow">matched: {f.matched_words}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {!f.reviewed && (
                  <ModButton
                    tone="primary"
                    size="sm"
                    disabled={busy === f.id}
                    onClick={() => review(f.id)}
                  >
                    Mark reviewed
                  </ModButton>
                )}
                {onInspectPlayer && (
                  <ModButton size="sm" onClick={() => onInspectPlayer(f.username)}>
                    Inspect {f.username}
                  </ModButton>
                )}
                <ModLinkButton href={`/game/${f.match_id}`} size="sm" tone="quiet">
                  Game {f.match_id.slice(0, 8)} ↗
                </ModLinkButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
