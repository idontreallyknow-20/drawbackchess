"use client";

// Dev gallery for PLAY signatures (the flagship cast animations), the sibling
// of /dev/effects (which covers the passive layer). Renders any card's
// signature visual on a lone demo square so designers can review and compare
// flagship animations across tiers — and spot two cards that read the same.
// Plugin cards route through the merged registry ("x:<id>" visuals); core
// cards render their SIGNATURES visual key. Board-context choreography
// (orderings, per-square staggers, canvas VFX, sounds) is out of scope here:
// this reviews the per-square scene art itself.

import * as React from "react";
import { ALL_BUFFS } from "@/engine/buffs/library";
import { TIER_ROMAN } from "@/lib/tiers";
import {
  SIGNATURES,
  prefetchSignatureVisuals,
  type SigVisual,
} from "@/components/effects/BoardEffects";
import { SignatureCut } from "@/components/board/SignatureCut";
import { PLUGIN_ID_SET, PLUGIN_SIGNATURES } from "@/components/effects/sigPlugins";
import {
  boardAnchoredGeo,
  boardCentreShift,
  cellPos,
  geoVars,
  cellDelta,
  neutralGeo,
} from "@/components/effects/geometry";
import type { Square } from "@/engine/types";

/** "anchors" shows one scene at five squares side by side; "single" is the
 *  compact grid for scanning many cards at once. */
type Mode = "anchors" | "single";

interface Row {
  id: string;
  name: string;
  tier: number;
  category: string;
  visual: string; // SigVisual key ("x:<id>" for plugin cards)
  kind: "core" | "plugin";
  /** The scene's declared anchor, so a reviewer can tell at a glance whether a
   *  tile is SUPPOSED to stay on its square or take the board. */
  anchor: string;
}

function rows(): Row[] {
  const out: Row[] = [];
  // Tiers 9 and 10 are included: they are the marquee set that deliberately
  // keeps the whole board, and "did the marquee cards stay board-scale" is
  // exactly what a reviewer needs to check alongside the anchored ones.
  for (const b of ALL_BUFFS) {
    if (!b.implemented || b.tier < 1) continue;
    const core = SIGNATURES[b.id];
    if (core) {
      out.push({
        id: b.id,
        name: b.name,
        tier: b.tier,
        category: b.category,
        visual: core.visual,
        kind: "core",
        anchor: core.anchor ?? "board",
      });
    } else if (PLUGIN_ID_SET.has(b.id)) {
      out.push({
        id: b.id,
        name: b.name,
        tier: b.tier,
        category: b.category,
        visual: `x:${b.id}`,
        kind: "plugin",
        // The plugin's own config lives in the lazy chunk, so the eager side
        // cannot read its anchor. PLUGIN_SIGNATURES is populated in place once
        // that chunk evaluates, which it has by the time this renders.
        anchor: PLUGIN_SIGNATURES[b.id]?.anchor ?? "board",
      });
    }
  }
  return out.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
}

/** Squares a reviewer needs to see: three corners, an edge, and the middle.
 *  Anchoring is only visible by comparison, and the corners are where the old
 *  clipping bug lived, so they are the default view rather than an option. */
const PROBE_SQUARES: { label: string; sq: number }[] = [
  { label: "a1", sq: 0 },
  { label: "h1", sq: 7 },
  { label: "e4", sq: 28 },
  { label: "a8", sq: 56 },
  { label: "h8", sq: 63 },
];

/**
 * One scene, staged on a real 8x8 board at a real square.
 *
 * The gallery used to render each scene on a lone 144px square with no board
 * around it, which cannot show the thing this branch changed: whether a scene
 * happens where the card was played, whether it clips at an edge, or which way
 * it aims. So each tile is a whole board with the scene mounted in one cell,
 * publishing the same geometry vars Board publishes.
 */
/**
 * A victim square for each probe, so the aim vars are REAL.
 *
 * neutralGeo reports angle 0 and length 0, which is correct for a play with no
 * travel but makes an "aim" scene unreviewable: a beam sized to --fx-len is
 * zero cells long and a rotation of --fx-ang points nowhere. Every probe now
 * also names a target, so the gallery publishes the same angle and distance
 * Board would for a real play.
 */
const PROBE_TARGET: Record<number, number> = {
  0: 27, // a1 -> d4, a long diagonal
  7: 31, // h1 -> h4, straight up the file
  28: 60, // e4 -> e8
  56: 35, // a8 -> d5
  63: 32, // h8 -> a5, across the board
};

function BoardProbe({ row, sq, runKey }: { row: Row; sq: number; runKey: number }) {
  const { col, row: r } = cellPos(sq as Square, "w");
  const base = neutralGeo(sq as Square, "w");
  const to = PROBE_TARGET[sq];
  if (to != null) {
    const d = cellDelta(sq as Square, to as Square, "w");
    base.angDeg = d.angDeg;
    base.len = d.dist;
    if (d.dist > 0) {
      base.aimX = d.dx / d.dist;
      base.aimY = d.dy / d.dist;
    }
    base.n = 3;
  }
  const anchored = row.anchor !== "board";
  // Board's own placement rule, mirrored: an anchored scene stays on its cell
  // and the stage clamps itself; a board-anchored one re-centres, and once it
  // has, its board frame takes the fixed offset rather than the cast square's.
  // Getting that second half wrong here is worse than getting it wrong in
  // Board, because this gallery is what a reviewer trusts to tell them Board
  // is right.
  const geo = geoVars(anchored ? base : boardAnchoredGeo(base));
  const shift = anchored
    ? undefined
    : (() => {
        const { sx, sy } = boardCentreShift(sq as Square, "w");
        return { transform: `translate(${sx * 100}%, ${sy * 100}%)` };
      })();
  return (
    <div className="relative aspect-square w-full overflow-hidden border border-white/15">
      <div className="grid h-full w-full grid-cols-8 grid-rows-8">
        {Array.from({ length: 64 }, (_, i) => (
          <div
            key={i}
            className={(Math.floor(i / 8) + (i % 8)) % 2 ? "bg-[#3f3a33]" : "bg-[#5a5248]"}
          />
        ))}
      </div>
      <span
        key={runKey}
        className="fx-one-shot pointer-events-none absolute z-30 block"
        style={{ left: `${col * 12.5}%`, top: `${r * 12.5}%`, width: "12.5%", height: "12.5%", ...geo } as React.CSSProperties}
      >
        <span className="absolute inset-0 z-30 block" style={shift}>
          {/* `cut`, not `role`: the effects library's prop means "which cut of
              the sequence", and spelling it `role` at a call site is one
              careless `{...props}` away from putting an invalid ARIA role into
              the DOM. Board.tsx goes through the same wrapper; this was the
              last call site still spelling it the dangerous way. */}
          <SignatureCut visual={row.visual as SigVisual} cut="lead" delayMs={0} />
        </span>
      </span>
    </div>
  );
}

function Cell({ row, mode }: { row: Row; mode: Mode }) {
  // Remount key replays the one-shot scene.
  const [runKey, setRunKey] = React.useState(0);
  const squares = mode === "anchors" ? PROBE_SQUARES : PROBE_SQUARES.slice(2, 3);
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => setRunKey((k) => k + 1)}
        title={`${row.id}: click to replay`}
        className="w-full"
      >
        <div className={`grid gap-1 ${mode === "anchors" ? "grid-cols-5" : "grid-cols-1"}`}>
          {squares.map((p) => (
            <div key={p.label}>
              <BoardProbe row={row} sq={p.sq} runKey={runKey} />
              {mode === "anchors" && (
                <div className="text-center text-[12px] text-parchment-400">{p.label}</div>
              )}
            </div>
          ))}
        </div>
      </button>
      <div className="max-w-full truncate text-center text-[12px] text-parchment-200" title={row.name}>
        {row.name}
      </div>
      <div className="text-[12px] text-parchment-400">
        {TIER_ROMAN[row.tier]} · {row.kind} · {row.category} · anchor {row.anchor}
      </div>
    </div>
  );
}

export function PlaysGallery() {
  // Rebuilt AFTER the play modules land, not memoized on mount: a card's
  // declared anchor lives in its module, and PLUGIN_SIGNATURES is populated as
  // modules load. Reading it once at mount reported every card as "board",
  // which is the default for an unregistered card and exactly the thing this
  // page exists to check.
  const [all, setAll] = React.useState<Row[]>([]);
  const [q, setQ] = React.useState("");
  const [tier, setTier] = React.useState(0);
  // Anchor comparison is the default view: it is the only way to see whether a
  // scene happens where the card was played. "single" is for scanning many
  // cards at once.
  const [mode, setMode] = React.useState<Mode>("anchors");
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    // The gallery reviews the WHOLE library, so unlike a game board it wants
    // every play module, not just the ones in a hand.
    prefetchSignatureVisuals();
    void import("@/components/effects/sigPluginsMerged").then((m) =>
      m.loadAllPluginModules().then(() => {
        setAll(rows());
        setReady(true);
      }),
    );
  }, []);
  const shown = all.filter(
    (r) =>
      (tier === 0 || r.tier === tier) &&
      (q === "" || r.id.includes(q.toLowerCase()) || r.name.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="font-display text-xl font-bold text-parchment-100">Play signatures</h1>
      <p className="mt-1 text-sm text-parchment-300">
        Flagship cast art per card, staged on a real board at real squares. The five-board
        strip is the anchoring check: an anchored scene should visibly happen at a1 when cast
        on a1, and must never clip at an edge. A scene labelled <code>anchor board</code> is
        supposed to take the whole board from every square. Click to replay. See{" "}
        <code>/dev/effects</code> for the passive layer.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter by id or name"
          className="rounded-sm border border-white/15 bg-ink-900/60 px-2 py-1 text-sm text-parchment-100"
        />
        <button
          type="button"
          onClick={() => setMode((m) => (m === "anchors" ? "single" : "anchors"))}
          className="rounded-sm border border-gold/60 bg-gold/15 px-2 py-1 text-xs text-parchment-100"
        >
          {mode === "anchors" ? "a1 / h1 / e4 / a8 / h8" : "e4 only"}
        </button>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTier(t)}
            className={`rounded-sm border px-2 py-1 text-xs ${
              tier === t ? "border-gold/60 bg-gold/15 text-parchment-100" : "border-white/15 text-parchment-300"
            }`}
          >
            {t === 0 ? "All" : `T${t}`}
          </button>
        ))}
        <span className="text-xs text-parchment-400">{shown.length} cards</span>
      </div>
      {ready && (
        <div
          className={`mt-4 grid gap-4 ${
            mode === "anchors" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6"
          }`}
        >
          {shown.slice(0, mode === "anchors" ? 24 : 120).map((r) => (
            <Cell key={r.id} row={r} mode={mode} />
          ))}
        </div>
      )}
      {shown.length > (mode === "anchors" ? 24 : 120) && (
        <p className="mt-3 text-xs text-parchment-400">Showing the first page. Narrow the filter for more.</p>
      )}
    </main>
  );
}
