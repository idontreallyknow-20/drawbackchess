"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LinkButton } from "@/components/ui/Button";

// The four rule families a player can suggest. Nerfs are the secret handicaps;
// buffs are Buff-mode draft cards; boons are Nerf-mode relief cards; hexes are
// the curses cast on an opponent in Nerf mode.
type RuleType = "nerf" | "buff" | "boon" | "hex";

const RULE_TYPES: { id: RuleType; label: string }[] = [
  { id: "nerf", label: "Nerf" },
  { id: "buff", label: "Buff" },
  { id: "boon", label: "Boon" },
  { id: "hex", label: "Hex" },
];

// Copy and styling for each type. Nerfs and hexes wear the warm nerf identity
// (both live in Nerf mode); buffs and boons wear the blue buff identity.
const TYPE_CONFIG: Record<
  RuleType,
  {
    warm: boolean;
    intro: string;
    nameLabel: string;
    namePlaceholder: string;
    descLabel: string;
    descPlaceholder: string;
  }
> = {
  nerf: {
    warm: true,
    intro: "A new secret rule.",
    nameLabel: "Nerf name",
    namePlaceholder: "e.g. Pawn Pacifist",
    descLabel: "The nerf",
    descPlaceholder:
      "Describe what the rule does: what it restricts, forces, or how you lose. Example: “Your bishops melt after 3 captures.”",
  },
  buff: {
    warm: false,
    intro: "A new draft card.",
    nameLabel: "Buff name",
    namePlaceholder: "e.g. Second Wind",
    descLabel: "The buff",
    descPlaceholder:
      "Describe what the card lets you do: the boost, when it triggers, any cost. Example: “Once per game, move a pawn two squares sideways.”",
  },
  boon: {
    warm: false,
    intro: "A relief card offered mid-game in Nerf mode.",
    nameLabel: "Boon name",
    namePlaceholder: "e.g. Second Wind",
    descLabel: "The boon",
    descPlaceholder:
      "Describe the relief it gives: what it softens or undoes for you, when it triggers, any cost. Example: “Once, ignore your nerf for a single move.”",
  },
  hex: {
    warm: true,
    intro: "A curse to cast on your opponent in Nerf mode.",
    nameLabel: "Hex name",
    namePlaceholder: "e.g. Walnut Queen",
    descLabel: "The hex",
    descPlaceholder:
      "Describe the curse: what it does to the opponent's pieces or position, when it triggers, how long it lasts. Example: “Freeze an enemy knight for two turns.”",
  },
};

// How each UI type maps onto the stored suggestion. The API records the kind
// ('nerf' | 'buff' | 'hex') and, for buff-family ideas, the pool ('buff' = Buff
// mode card, 'boon' = Nerf-mode relief boon).
function payloadForType(type: RuleType): { kind: string; pool?: string } {
  switch (type) {
    case "buff":
      return { kind: "buff", pool: "buff" };
    case "boon":
      return { kind: "buff", pool: "boon" };
    case "hex":
      return { kind: "hex" };
    default:
      return { kind: "nerf" };
  }
}

function isRuleType(v: string | null): v is RuleType {
  return v === "nerf" || v === "buff" || v === "boon" || v === "hex";
}

// "Suggest a rule": players describe any rule idea and it lands in the site
// owner's inbox (and the rule_suggestions table, so nothing is ever lost). One
// form serves all four rule types, chosen with the type selector below.
export default function SuggestRulePage() {
  const [type, setType] = useState<RuleType>("nerf");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Links can preselect the type (?type=hex). The legacy ?kind=buff link, from
  // before this form grew a full type selector, still resolves to the buff type.
  useEffect(() => {
    queueMicrotask(() => {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("type");
      if (isRuleType(t)) setType(t);
      else if (params.get("kind") === "buff") setType("buff");
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          contact,
          type,
          ...payloadForType(type),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not send your suggestion.");
      setState("sent");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Could not send your suggestion.");
    }
  };

  const cfg = TYPE_CONFIG[type];

  return (
    <main className="min-h-screen pb-20">
      <nav className="flex items-center justify-between px-6 sm:px-10 py-6 sm:py-7">
        <Link href="/" className="font-display text-2xl tracking-tight">
          nerf<span className="text-gold-leaf">chess</span>
        </Link>
        <Link href="/codex" className="px-3 py-1.5 rounded-none text-sm font-display hover:bg-[color:var(--bg-raised)] text-parchment">
          ← All the rules
        </Link>
      </nav>

      <section className="max-w-2xl mx-auto px-6">
        <h1 className="page-title">Suggest a rule</h1>
        <p className="mt-3 text-parchment-200">
          Describe your idea. It goes straight to the nerfchess team, and the best ones get built.
        </p>

        {/* Type selector: nerf and hex ideas wear the warm nerf identity, buff
            and boon ideas the blue. */}
        <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label="What are you suggesting?">
          {RULE_TYPES.map((rt) => {
            const selected = type === rt.id;
            const warm = TYPE_CONFIG[rt.id].warm;
            const activeClass = warm
              ? "border border-mode-nerf/50 bg-mode-nerf/10 text-mode-nerfGlow"
              : "border border-mode-buff/50 bg-mode-buff/10 text-mode-buffGlow";
            return (
              <Button
                key={rt.id}
                onClick={() => setType(rt.id)}
                aria-pressed={selected}
                tone={selected ? "quiet" : "ghost"}
                className={selected ? activeClass : ""}
              >
                {rt.label}
              </Button>
            );
          })}
        </div>
        <p className="mt-2 text-[13px] text-parchment-400">{cfg.intro}</p>

        {state === "sent" ? (
          <div className="mt-7 plate p-6 text-center">
            <div className="font-display text-2xl text-gold-leaf">Sent. Thank you!</div>
            <p className="mt-2 text-sm text-parchment-200">
              Your idea is in the queue. If it makes the cut you&apos;ll see it in the Codex.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Button tone="ghost"
               
                onClick={() => {
                  setName("");
                  setDescription("");
                  setState("idle");
                }}
                className="px-5 py-2.5 text-sm">
                Suggest another
              </Button>
              <LinkButton tone="leaf" href="/codex" className="px-5 py-2.5 text-sm font-semibold">
                Back to the rules
              </LinkButton>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-7 plate p-5 sm:p-6 space-y-5">
            <div>
              <label className="text-[12px] text-parchment-400 mb-1 block" htmlFor="rule-name">
                {cfg.nameLabel} <span className="opacity-60">(optional)</span>
              </label>
              <input
                id="rule-name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 80))}
                placeholder={cfg.namePlaceholder}
                className="bg-[color:var(--bg-base)] border border-[color:var(--edge)] rounded-none min-h-[44px] px-4 py-2 text-base font-display w-full focus:outline-none focus:border-[color:var(--edge-strong)] text-parchment placeholder:text-parchment-500 [@media(pointer:fine)]:min-h-0"
              />
            </div>

            <div>
              <label className="text-[12px] text-parchment-400 mb-1 block" htmlFor="rule-desc">
                {cfg.descLabel}
              </label>
              <textarea
                id="rule-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
                required
                rows={5}
                placeholder={cfg.descPlaceholder}
                className="bg-[color:var(--bg-base)] border border-[color:var(--edge)] rounded-2xl px-4 py-3 text-sm w-full focus:outline-none focus:border-[color:var(--edge-strong)] text-parchment placeholder:text-parchment-500 resize-y"
              />
              <div className="mt-1 text-right font-mono text-[12px] text-parchment-500">
                {description.length}/1000
              </div>
            </div>

            <div>
              <label className="text-[12px] text-parchment-400 mb-1 block" htmlFor="rule-contact">
                How to credit / reach you <span className="opacity-60">(optional)</span>
              </label>
              <input
                id="rule-contact"
                value={contact}
                onChange={(e) => setContact(e.target.value.slice(0, 120))}
                placeholder="username, email, discord…"
                className="bg-[color:var(--bg-base)] border border-[color:var(--edge)] rounded-none min-h-[44px] px-4 py-2 text-sm w-full focus:outline-none focus:border-[color:var(--edge-strong)] text-parchment placeholder:text-parchment-500 [@media(pointer:fine)]:min-h-0"
              />
            </div>

            {error && <div className="text-sm text-oxblood-glow">{error}</div>}

            <Button tone="cta"
              type="submit"
              disabled={state === "sending" || description.trim().length < 10}
              className="w-full px-6 py-3 text-base font-semibold disabled:opacity-50">
              {state === "sending" ? "Sending…" : `Send ${type} suggestion`}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
