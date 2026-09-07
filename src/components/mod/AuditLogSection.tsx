"use client";

// Every moderator action, newest first. The old tab was an unfiltered wall; the
// filter row here narrows to a kind of action (the question is almost always
// "who has been banned lately", not "what happened"), and the free-text box
// matches a moderator or a target name.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { HistoryEntry } from "./types";
import { Empty, FilterChip, Loading, Pill, untilShort, when, whenShort } from "./ui";

type Kind = "all" | "ban" | "mute" | "warn" | "role";

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ban", label: "Bans" },
  { value: "mute", label: "Mutes" },
  { value: "warn", label: "Warnings" },
  { value: "role", label: "Roles & names" },
];

function kindOf(action: string): Exclude<Kind, "all"> | null {
  const a = action.toLowerCase();
  if (a.includes("ban")) return "ban";
  if (a.includes("mute")) return "mute";
  if (a.includes("warn")) return "warn";
  if (a.includes("role") || a.includes("name")) return "role";
  return null;
}

function toneOf(action: string): "warn" | "mute" | "neutral" {
  const kind = kindOf(action);
  if (action.toLowerCase().startsWith("un")) return "neutral";
  return kind === "ban" ? "warn" : kind === "mute" ? "mute" : "neutral";
}

export function AuditLogSection() {
  const [log, setLog] = useState<HistoryEntry[] | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/mod/log").then(async (res) => {
      if (res.ok) setLog(((await res.json()) as { log: HistoryEntry[] }).log);
    });
  }, []);

  const rows = useMemo(() => {
    if (!log) return [];
    const needle = q.trim().toLowerCase();
    return log.filter((e) => {
      if (kind !== "all" && kindOf(e.action) !== kind) return false;
      if (!needle) return true;
      return (
        e.mod_name.toLowerCase().includes(needle) ||
        (e.target_name ?? "").toLowerCase().includes(needle) ||
        e.action.toLowerCase().includes(needle) ||
        (e.note ?? "").toLowerCase().includes(needle)
      );
    });
  }, [log, kind, q]);

  if (!log) return <Loading what="the audit log" />;
  if (log.length === 0) return <Empty>No moderation actions yet.</Empty>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <FilterChip key={k.value} active={kind === k.value} onClick={() => setKind(k.value)}>
            {k.label}
          </FilterChip>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name or note…"
          className="plate w-full bg-transparent px-3 py-2 text-sm outline-none focus:border-[color:var(--edge-strong)] sm:ml-auto sm:max-w-xs sm:py-1.5"
        />
      </div>

      {rows.length === 0 ? (
        <Empty>Nothing matches that filter.</Empty>
      ) : (
        <div className="plate divide-y divide-[color:var(--edge)]">
          {rows.map((entry, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3 text-sm">
              <span className="font-display font-semibold">{entry.mod_name}</span>
              <Pill tone={toneOf(entry.action)}>{entry.action}</Pill>
              {entry.target_name && (
                <Link
                  href={`/u/${entry.target_name}`}
                  className="font-display font-semibold hover:underline"
                >
                  {entry.target_name}
                </Link>
              )}
              {entry.expires_at && (
                <span className="text-parchment-400">{untilShort(entry.expires_at)}</span>
              )}
              {entry.note && <span className="text-parchment-400">“{entry.note}”</span>}
              <span
                className="w-full text-[12px] text-parchment-400 sm:ml-auto sm:w-auto sm:text-sm"
                title={when(entry.created_at)}
              >
                {whenShort(entry.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[12px] text-parchment-500">
        Showing {rows.length} of {log.length} recorded actions.
      </p>
    </div>
  );
}
