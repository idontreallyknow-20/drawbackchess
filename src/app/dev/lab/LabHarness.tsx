"use client";

// CARD LABORATORY (dev-only, /dev/lab): verify every card individually.
// Sibling of /dev/plays (cast art) and /dev/effects (passive layer); this one
// exercises the ENGINE: a real sandbox NerfGame with a real Board, per-card
// grant / activate / force-draft actions with full target collection, a live
// lifecycle panel, view controls (flip, size, spectator, reconnect, motion),
// and the run-all harness that grants + activates + plays out every
// implemented card and reports failures loudly. Never linked from any
// production navigation; the page gate lives in page.tsx.

import { useEffect, useMemo, useRef, useState } from "react";
import { Board } from "@/components/Board";
import { ALL_BUFFS, BUFF_BY_ID } from "@/engine/buffs/library";
import {
  NerfGame,
  UNRESTRICTED_NERF,
  acquireBuff,
  activateBuff,
  bankDraft,
  buffNextTarget,
  deserializeGame,
  enableDraftMode,
  legalMoves,
  newGame,
  pickDraftCard,
  playMove,
  serializeGame,
} from "@/engine/game";
import type { Buff, BuffInstance, BuffPick, BuffTarget, DraftMode } from "@/engine/buff";
import { turnCost } from "@/engine/buff";
import type { Color, Move, Square } from "@/engine/types";
import { squareName } from "@/engine/types";
import { draftZones } from "@/lib/draftOnline";
import { computeFxVisual, fxVisualFields } from "@/components/effects/fxZones";
import { FX_LEVELS, setFxLevel, useFxLevel, type FxLevel } from "@/lib/fxToggle";
import {
  LAB_KINDS,
  LAB_PRESETS,
  applyPreset,
  auditFlags,
  cardKind,
  fuzzyMatch,
  matchesKind,
  nerfModeOnly,
  type LabKind,
} from "./labData";
import {
  LAB_RUN_PLIES,
  LAB_RUN_SEED,
  rowFailed,
  runOneCard,
  runnableCards,
  summarize,
  type RunAllRow,
} from "./runAllCore";

const LAB_SEED = 0x1abcafe;

function errText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** html[data-anim] plumbing (settings.applyUiPrefs writes the same attr). */
function readAnimAttr(): "off" | "fast" | "normal" | null {
  const cur = document.documentElement.dataset.anim;
  return cur === "off" || cur === "fast" || cur === "normal" ? cur : null;
}
function writeAnimAttr(v: "off" | "fast" | "normal") {
  document.documentElement.dataset.anim = v;
}

interface LogEntry {
  n: number;
  msg: string;
  error: boolean;
}

interface Targeting {
  color: Color;
  buffIndex: number;
  picks: BuffPick[];
  target: BuffTarget;
}

type MechFilter = "all" | Buff["kind"];
type ImplFilter = "all" | "yes" | "no";

function makeSandbox(mode: DraftMode, presetId: string): NerfGame {
  const g = newGame(UNRESTRICTED_NERF, UNRESTRICTED_NERF, LAB_SEED);
  enableDraftMode(g, LAB_SEED + 1, { mode });
  if (g.buffs) {
    // The lab drives drafts by hand; clear the opener offers so the board is
    // immediately playable.
    g.buffs.players.w.offer = null;
    g.buffs.players.b.offer = null;
  }
  const preset = LAB_PRESETS.find((p) => p.id === presetId) ?? LAB_PRESETS[0];
  applyPreset(g.board, preset);
  return g;
}

const btn =
  "rounded-[1px] border border-white/15 px-2 py-1 text-xs text-parchment-200 hover:border-gold/50 hover:text-parchment-100";
const btnActive = "rounded-[1px] border border-gold/60 bg-gold/15 px-2 py-1 text-xs text-parchment-100";
const inputCls =
  "rounded-[1px] border border-white/15 bg-ink-900/60 px-2 py-1 text-sm text-parchment-100";
const selectCls =
  "rounded-[1px] border border-white/15 bg-ink-900/60 px-2 py-1 text-xs text-parchment-100";

export function LabHarness() {
  // --- Sandbox game ---------------------------------------------------------
  const [game, setGame] = useState<NerfGame | null>(null);
  const [mode, setMode] = useState<DraftMode>("buff");
  const [presetId, setPresetId] = useState("opening");
  const logSeq = useRef(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [targeting, setTargeting] = useState<Targeting | null>(null);
  const [selectedInst, setSelectedInst] = useState<{ color: Color; index: number } | null>(null);
  const sigKeyRef = useRef(0);
  const [sig, setSig] = useState<{ id: string; key: number } | null>(null);

  const appendLog = (msg: string, error = false) => {
    setLog((prev) => [...prev, { n: ++logSeq.current, msg, error }].slice(-200));
  };

  const resetSandbox = (nextMode = mode, nextPreset = presetId) => {
    setTargeting(null);
    setSelectedInst(null);
    setSig(null);
    setGame(makeSandbox(nextMode, nextPreset));
    appendLog(`sandbox reset: mode=${nextMode} preset=${nextPreset}`);
  };

  // Bootstrap client-side only (Date.now inside newGame must not run during
  // SSR/hydration). Deferred a microtask, same pattern as the game page.
  useEffect(() => {
    queueMicrotask(() => setGame(makeSandbox("buff", "opening")));
  }, []);

  /** Run an engine mutation against the live game, surfacing any throw. */
  const mutate = (label: string, fn: (g: NerfGame) => void) => {
    if (!game) return;
    try {
      fn(game);
      appendLog(label);
    } catch (e) {
      appendLog(`${label} threw: ${errText(e)}`, true);
    }
    setGame({ ...game });
  };

  const fireSignature = (id: string) => {
    setSig({ id, key: ++sigKeyRef.current });
  };

  // --- Derived, throw-safe reads -------------------------------------------
  const movesResult = useMemo(() => {
    if (!game || game.result) return { moves: [] as Move[], error: null as string | null };
    try {
      return { moves: legalMoves(game), error: null };
    } catch (e) {
      return { moves: [] as Move[], error: `legalMoves threw: ${errText(e)}` };
    }
  }, [game]);

  const visualResult = useMemo(() => {
    if (!game) return { visual: undefined, error: null as string | null };
    try {
      const zone = draftZones(game, game.board.turn);
      const fxZone = computeFxVisual(game);
      return {
        visual: {
          bannedSquares: zone.barred,
          frozenSquares: zone.frozen,
          frozenSkins: zone.frozenSkin,
          effectTurns: zone.turns,
          shieldedSquares: zone.shielded,
          wardSquares: zone.ward,
          strikeSquares: zone.strike,
          walnutSquares: zone.walnut,
          bananaSquares: zone.banana,
          trapSquares: zone.traps,
          doomSquares: zone.doom,
          lockedSquares: zone.locked,
          barredSquares: zone.barred,
          ...fxVisualFields(fxZone),
        },
        error: null,
      };
    } catch (e) {
      return { visual: undefined, error: `zone visuals threw: ${errText(e)}` };
    }
  }, [game]);

  // --- Moves ----------------------------------------------------------------
  const handleMove = (m: Move) => {
    mutate(
      `move ${squareName(m.from)}${squareName(m.to)}${m.promotion ? "=" + m.promotion : ""} (${m.color})`,
      (g) => {
        playMove(g, m);
      },
    );
  };

  const playRandomMove = () => {
    if (!game || movesResult.moves.length === 0) return;
    handleMove(pickRandom(movesResult.moves));
  };

  // --- Grant / draft / activate ---------------------------------------------
  const grant = (def: Buff, color: Color) => {
    if (!game?.buffs) return;
    const before = game.buffs.players[color].buffs.length;
    mutate(`grant ${def.id} to ${color === "w" ? "white" : "black"}`, (g) => {
      acquireBuff(g, color, def.id, def.tier);
      if (g.buffs!.players[color].buffs.length === before) {
        throw new Error("acquireBuff added no instance (unimplemented card?)");
      }
    });
    if (game.buffs.players[color].buffs.length > before) {
      setSelectedInst({ color, index: before });
      if (def.kind === "instant") fireSignature(def.id);
    }
  };

  const forceDraft = (def: Buff, color: Color) => {
    mutate(`force ${def.id} into ${color === "w" ? "white" : "black"}'s next draft`, (g) => {
      const ps = g.buffs!.players[color];
      ps.offer = {
        cards: [{ id: def.id, tier: def.tier }],
        index: ps.draftsTaken + 1,
      };
    });
  };

  const fireActivation = (color: Color, buffIndex: number, picks: BuffPick[]) => {
    if (!game) return;
    const inst = game.buffs?.players[color].buffs[buffIndex];
    mutate(
      `activate ${inst?.id ?? "?"} for ${color === "w" ? "white" : "black"} (${picks.length} picks)`,
      (g) => {
        const ok = activateBuff(g, color, buffIndex, picks);
        if (!ok) throw new Error("activateBuff returned false");
      },
    );
    if (inst) fireSignature(inst.id);
    setSelectedInst({ color, index: buffIndex });
  };

  const startUse = (color: Color, buffIndex: number) => {
    if (!game) return;
    try {
      const target = buffNextTarget(game, color, buffIndex, []);
      if (!target) {
        fireActivation(color, buffIndex, []);
        return;
      }
      setTargeting({ color, buffIndex, picks: [], target });
    } catch (e) {
      appendLog(`targets() threw for buff #${buffIndex} (${color}): ${errText(e)}`, true);
    }
  };

  const advanceTargeting = (picks: BuffPick[]) => {
    if (!game || !targeting) return;
    try {
      const next = buffNextTarget(game, targeting.color, targeting.buffIndex, picks);
      if (!next) {
        setTargeting(null);
        fireActivation(targeting.color, targeting.buffIndex, picks);
      } else {
        setTargeting({ ...targeting, picks, target: next });
      }
    } catch (e) {
      setTargeting(null);
      appendLog(`targets() threw mid-pick: ${errText(e)}`, true);
    }
  };

  const finishTargeting = () => {
    if (!targeting) return;
    if (targeting.target.kind === "square" && targeting.target.finishable) {
      const picks = targeting.picks;
      setTargeting(null);
      fireActivation(targeting.color, targeting.buffIndex, picks);
    }
  };

  // --- Card browser -----------------------------------------------------------
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | LabKind>("all");
  const [tierFilter, setTierFilter] = useState(0); // 0 = all, 9 = apex band
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [mechFilter, setMechFilter] = useState<MechFilter>("all");
  const [implFilter, setImplFilter] = useState<ImplFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(ALL_BUFFS.map((b) => b.category))].sort(),
    [],
  );
  const filtered = useMemo(
    () =>
      ALL_BUFFS.filter(
        (b) =>
          (query === "" || fuzzyMatch(query, b.name) || fuzzyMatch(query, b.id)) &&
          (kindFilter === "all" || matchesKind(b, kindFilter)) &&
          (tierFilter === 0 || (tierFilter === 9 ? b.tier >= 9 : b.tier === tierFilter)) &&
          (categoryFilter === "all" || b.category === categoryFilter) &&
          (mechFilter === "all" || b.kind === mechFilter) &&
          (implFilter === "all" || (implFilter === "yes") === b.implemented),
      ),
    [query, kindFilter, tierFilter, categoryFilter, mechFilter, implFilter],
  );
  const selected = selectedId ? BUFF_BY_ID[selectedId] : null;

  // --- View controls ----------------------------------------------------------
  const [orientation, setOrientation] = useState<Color>("w");
  const [boardWidth, setBoardWidth] = useState(480);
  const [spectator, setSpectator] = useState(false);
  const [reconnect, setReconnect] = useState<{ pass: boolean; detail: string } | null>(null);
  const fxLevel = useFxLevel();
  const [anim, setAnim] = useState<"off" | "fast" | "normal">("normal");
  useEffect(() => {
    queueMicrotask(() => {
      const cur = readAnimAttr();
      if (cur) setAnim(cur);
    });
  }, []);
  const applyAnim = (v: "off" | "fast" | "normal") => {
    // The exact mechanism the app uses (settings.applyUiPrefs): the whole CSS
    // animation system keys on html[data-anim].
    writeAnimAttr(v);
    setAnim(v);
    appendLog(`html[data-anim] = ${v}`);
  };

  const doReconnect = () => {
    if (!game) return;
    try {
      const fingerprint = (g: NerfGame) =>
        JSON.stringify({
          pieces: g.board.pieces,
          turn: g.board.turn,
          effects: g.buffs?.effects ?? [],
          held: {
            w: g.buffs?.players.w.buffs ?? [],
            b: g.buffs?.players.b.buffs ?? [],
          },
        });
      const before = fingerprint(game);
      // Serialize essential state, clone it (the "wire"), discard the live
      // object, and rebuild from the clone: the local reconnect simulation.
      const snap = structuredClone(serializeGame(game));
      const restored = deserializeGame(snap);
      if (!restored) {
        setReconnect({ pass: false, detail: "deserializeGame returned null" });
        appendLog("reconnect simulation FAILED: deserializeGame returned null", true);
        return;
      }
      const pass = fingerprint(restored) === before;
      setTargeting(null);
      setGame(restored);
      setReconnect({
        pass,
        detail: pass
          ? "board, turn, effects and held cards identical after restore"
          : "state mismatch after restore (see log)",
      });
      appendLog(pass ? "reconnect simulation PASS" : "reconnect simulation FAILED: state mismatch", !pass);
    } catch (e) {
      setReconnect({ pass: false, detail: errText(e) });
      appendLog(`reconnect simulation threw: ${errText(e)}`, true);
    }
  };

  const replayLastAnimation = () => {
    if (!sig) return;
    // Same id, fresh key: the Board treats the key advance as a new play and
    // remounts the signature layer.
    setSig({ id: sig.id, key: ++sigKeyRef.current });
    appendLog(`replay signature ${sig.id}`);
  };

  // --- Run-all harness ----------------------------------------------------------
  const [runRows, setRunRows] = useState<RunAllRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [onlyFailures, setOnlyFailures] = useState(false);
  const runAbortRef = useRef(false);

  const runAll = async () => {
    if (running) return;
    setRunning(true);
    runAbortRef.current = false;
    const cards = runnableCards();
    const rows: RunAllRow[] = [];
    setRunRows([]);
    appendLog(`run-all started: ${cards.length} implemented cards, seed ${LAB_RUN_SEED}, ${LAB_RUN_PLIES} plies each`);
    for (let i = 0; i < cards.length && !runAbortRef.current; i += 20) {
      for (const def of cards.slice(i, i + 20)) rows.push(runOneCard(def));
      setRunRows([...rows]);
      // Yield to the event loop so the page stays responsive.
      await new Promise((r) => setTimeout(r, 0));
    }
    setRunning(false);
    const s = summarize(rows);
    appendLog(
      `run-all finished: ${s.pass}/${s.total} pass, ${s.fail} fail, ${s.noValidUse} no-valid-use`,
      s.fail > 0,
    );
  };

  const runSummary = runRows ? summarize(runRows) : null;
  const shownRows = runRows ? (onlyFailures ? runRows.filter(rowFailed) : runRows) : null;

  // --- Error surface ---------------------------------------------------------
  const loggedErrors = log.filter((l) => l.error);
  const liveErrors = [
    ...(movesResult.error ? [movesResult.error] : []),
    ...(visualResult.error ? [visualResult.error] : []),
  ];

  const bs = game?.buffs ?? null;
  const selInst: BuffInstance | null =
    (selectedInst && bs?.players[selectedInst.color].buffs[selectedInst.index]) || null;
  const selInstDef = selInst ? BUFF_BY_ID[selInst.id] : null;

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6 text-parchment-200">
      <h1 className="font-display text-xl font-bold text-parchment-100">Card laboratory</h1>
      <p className="mt-1 text-sm text-parchment-300">
        Dev-only bench for verifying every card against a real sandbox engine. Siblings:{" "}
        <code>/dev/plays</code> (cast art), <code>/dev/effects</code> (passive layer).
      </p>

      {(liveErrors.length > 0 || loggedErrors.length > 0) && (
        <div className="plate mt-3 border border-red-500/60 bg-red-950/40 p-3">
          <div className="font-display text-sm font-bold text-red-300">
            Engine errors ({liveErrors.length + loggedErrors.length})
          </div>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-red-200">
            {liveErrors.map((e, i) => (
              <li key={`live-${i}`}>{e}</li>
            ))}
            {[...loggedErrors].reverse().map((l) => (
              <li key={l.n}>{l.msg}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)_minmax(300px,380px)]">
        {/* ------------------------------------------------ Card browser */}
        <section className="plate p-3">
          <h2 className="font-display text-sm font-bold text-parchment-100">Card browser</h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="fuzzy search: name or id"
            className={`${inputCls} mt-2 w-full`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as "all" | LabKind)}
              className={selectCls}
              title="Kind"
            >
              <option value="all">All kinds</option>
              {LAB_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(Number(e.target.value))}
              className={selectCls}
              title="Tier"
            >
              <option value={0}>All tiers</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((t) => (
                <option key={t} value={t}>
                  Tier {t}
                </option>
              ))}
              <option value={9}>Tier 9+</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className={selectCls}
              title="Category"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={mechFilter}
              onChange={(e) => setMechFilter(e.target.value as MechFilter)}
              className={selectCls}
              title="Mechanic"
            >
              <option value="all">All mechanics</option>
              <option value="instant">instant</option>
              <option value="activated">activated</option>
              <option value="passive">passive</option>
            </select>
            <select
              value={implFilter}
              onChange={(e) => setImplFilter(e.target.value as ImplFilter)}
              className={selectCls}
              title="Implemented"
            >
              <option value="all">Impl + not</option>
              <option value="yes">Implemented</option>
              <option value="no">Not implemented</option>
            </select>
          </div>
          <div className="mt-1 text-xs text-parchment-400">
            {filtered.length} of {ALL_BUFFS.length} cards
          </div>
          <ul className="mt-2 max-h-[380px] space-y-0.5 overflow-y-auto pr-1">
            {filtered.slice(0, 400).map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(b.id)}
                  className={`w-full rounded-[1px] border px-2 py-1 text-left text-xs ${
                    selectedId === b.id
                      ? "border-gold/60 bg-gold/10 text-parchment-100"
                      : "border-white/10 text-parchment-300 hover:border-white/30"
                  }`}
                >
                  <span className="font-semibold">{b.name}</span>
                  <span className="ml-1 text-parchment-400">
                    T{b.tier} {cardKind(b)} {b.kind}
                    {!b.implemented && " [stub]"}
                  </span>
                </button>
              </li>
            ))}
            {filtered.length > 400 && (
              <li className="px-2 py-1 text-xs text-parchment-400">
                ...{filtered.length - 400} more, narrow the filters
              </li>
            )}
          </ul>

          {selected && (
            <div className="mt-3 border-t border-white/10 pt-2">
              <div className="font-display text-sm font-bold text-parchment-100">
                {selected.name}{" "}
                <span className="text-xs font-normal text-parchment-400">
                  {selected.id} / T{selected.tier} / {selected.category} / {selected.kind} /{" "}
                  {turnCost(selected)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-snug text-parchment-300">{selected.description}</p>
              <div className="mt-1 flex flex-wrap gap-1 text-[12px] text-parchment-400">
                <span className="border border-white/10 px-1">{cardKind(selected)}</span>
                {nerfModeOnly(selected) && (
                  <span className="border border-white/10 px-1">nerf-mode-only</span>
                )}
                {!selected.implemented && (
                  <span className="border border-red-500/50 px-1 text-red-300">not implemented</span>
                )}
                {auditFlags(selected.id).map((f) => (
                  <span key={f} className="border border-amber-500/40 px-1 text-amber-300">
                    audit: {f}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className={btn} onClick={() => grant(selected, "w")}>
                  Grant to White
                </button>
                <button type="button" className={btn} onClick={() => grant(selected, "b")}>
                  Grant to Black
                </button>
                <button type="button" className={btn} onClick={() => forceDraft(selected, "w")}>
                  Force draft (W)
                </button>
                <button type="button" className={btn} onClick={() => forceDraft(selected, "b")}>
                  Force draft (B)
                </button>
              </div>
              {selected.kind === "passive" && (
                <p className="mt-1 text-[12px] text-parchment-400">
                  Passive: grant it, then watch its live status() line in the lifecycle panel while
                  you play moves.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ------------------------------------------------ Sandbox */}
        <section className="plate p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-sm font-bold text-parchment-100">Sandbox game</h2>
            <button
              type="button"
              className={mode === "buff" ? btnActive : btn}
              onClick={() => {
                setMode("buff");
                resetSandbox("buff");
              }}
            >
              Buff mode
            </button>
            <button
              type="button"
              className={mode === "nerf" ? btnActive : btn}
              onClick={() => {
                setMode("nerf");
                resetSandbox("nerf");
              }}
            >
              Nerf mode
            </button>
            <select
              value={presetId}
              onChange={(e) => {
                setPresetId(e.target.value);
                resetSandbox(mode, e.target.value);
              }}
              className={selectCls}
              title="Board preset"
            >
              {LAB_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" className={btn} onClick={() => resetSandbox()}>
              Reset game
            </button>
            <button type="button" className={btn} onClick={playRandomMove}>
              Random move
            </button>
          </div>

          {game && (
            <div className="mt-1 text-xs text-parchment-400">
              Turn: {game.board.turn === "w" ? "White" : "Black"} (you drive both sides), ply{" "}
              {game.board.history.length}
              {game.result &&
                `, RESULT: ${game.result.winner === "draw" ? "draw" : game.result.winner === "w" ? "white wins" : "black wins"} (${game.result.reason})`}
            </div>
          )}

          {targeting && (
            <div className="mt-2 border border-gold/50 bg-gold/10 p-2 text-xs">
              <span className="font-semibold text-parchment-100">Targeting:</span>{" "}
              {targeting.target.kind === "square" ? (
                <>
                  {targeting.target.label} ({targeting.picks.length} picked,{" "}
                  {targeting.target.squares.length} candidates)
                  {targeting.target.finishable && (
                    <button type="button" className={`${btn} ml-2`} onClick={finishTargeting}>
                      Done
                    </button>
                  )}
                </>
              ) : (
                <>
                  {targeting.target.label}:
                  {targeting.target.options.map((o) => (
                    <button
                      key={o.index}
                      type="button"
                      className={`${btn} ml-1`}
                      onClick={() => advanceTargeting([...targeting.picks, { buffIndex: o.index }])}
                    >
                      {o.name} (T{o.tier})
                    </button>
                  ))}
                </>
              )}
              <button type="button" className={`${btn} ml-2`} onClick={() => setTargeting(null)}>
                Cancel
              </button>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-start gap-4">
            <div style={{ width: boardWidth, maxWidth: "100%" }}>
              {game ? (
                <Board
                  board={game.board}
                  fxBoard={game.board}
                  legalMoves={targeting ? [] : movesResult.moves}
                  orientation={orientation}
                  onMove={handleMove}
                  myColor={game.board.turn}
                  visual={visualResult.visual}
                  lastMove={game.board.history[game.board.history.length - 1] ?? null}
                  disabled={!!game.result}
                  buffs={game.buffs}
                  passiveBuffs={game.buffs}
                  signatureCard={sig}
                  showCoordinates
                  pickSquares={
                    targeting?.target.kind === "square" ? targeting.target.squares : undefined
                  }
                  onPickSquare={
                    targeting?.target.kind === "square"
                      ? (sq: Square) => advanceTargeting([...targeting.picks, { square: sq }])
                      : undefined
                  }
                />
              ) : (
                <div className="grid h-64 place-items-center text-sm text-parchment-400">
                  Building sandbox...
                </div>
              )}
            </div>
            {spectator && game && (
              <div style={{ width: Math.min(360, boardWidth), maxWidth: "100%" }}>
                <div className="mb-1 text-xs text-parchment-400">Spectator view (read-only)</div>
                <Board
                  board={game.board}
                  fxBoard={game.board}
                  legalMoves={[]}
                  orientation={orientation === "w" ? "b" : "w"}
                  onMove={() => {}}
                  myColor={orientation === "w" ? "b" : "w"}
                  visual={visualResult.visual}
                  lastMove={game.board.history[game.board.history.length - 1] ?? null}
                  disabled
                  passiveBuffs={game.buffs}
                  showCoordinates={false}
                />
              </div>
            )}
          </div>

          {/* Held cards + pending offers, both sides */}
          {bs && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(["w", "b"] as const).map((color) => {
                const ps = bs.players[color];
                return (
                  <div key={color} className="border border-white/10 p-2">
                    <div className="text-xs font-semibold text-parchment-100">
                      {color === "w" ? "White" : "Black"} holds {ps.buffs.length}
                    </div>
                    {ps.offer && (
                      <div className="mt-1 border border-gold/40 bg-gold/5 p-1 text-[12px]">
                        Offer #{ps.offer.index}:{" "}
                        {ps.offer.cards.map((c, i) => (
                          <button
                            key={i}
                            type="button"
                            className={`${btn} mr-1`}
                            onClick={() =>
                              mutate(`pick offer card ${c.id} (${color})`, (g) =>
                                pickDraftCard(g, color, i),
                              )
                            }
                          >
                            Pick {BUFF_BY_ID[c.id]?.name ?? c.id} T{c.tier}
                          </button>
                        ))}
                        <button
                          type="button"
                          className={btn}
                          onClick={() => mutate(`bank offer (${color})`, (g) => bankDraft(g, color))}
                        >
                          Bank
                        </button>
                      </div>
                    )}
                    <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-[12px]">
                      {ps.buffs.map((inst, i) => {
                        const def = BUFF_BY_ID[inst.id];
                        const dead = inst.spent || inst.nullified || inst.usedActivation;
                        const isSel =
                          selectedInst?.color === color && selectedInst?.index === i;
                        return (
                          <li
                            key={i}
                            className={`flex items-center gap-1 border px-1 py-0.5 ${
                              isSel ? "border-gold/50" : "border-white/10"
                            }`}
                          >
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left hover:text-parchment-100"
                              onClick={() => setSelectedInst({ color, index: i })}
                              title="Inspect in lifecycle panel"
                            >
                              {def?.name ?? inst.id} T{inst.tier}
                              {dead && <span className="text-parchment-500"> [used]</span>}
                              {inst.nullified && <span className="text-red-300"> [nullified]</span>}
                            </button>
                            {def?.kind === "activated" && !dead && (
                              <button
                                type="button"
                                className={btn}
                                onClick={() => startUse(color, i)}
                              >
                                Use
                              </button>
                            )}
                            {def?.status && (
                              <span className="shrink-0 text-parchment-400">
                                {(() => {
                                  try {
                                    return def.status(inst) ?? "";
                                  } catch (e) {
                                    return `status() threw: ${errText(e)}`;
                                  }
                                })()}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ------------------------------------------------ Lifecycle + view controls */}
        <section className="space-y-4">
          <div className="plate p-3">
            <h2 className="font-display text-sm font-bold text-parchment-100">View controls</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={btn}
                onClick={() => setOrientation((o) => (o === "w" ? "b" : "w"))}
              >
                Flip ({orientation === "w" ? "white" : "black"} bottom)
              </button>
              <button
                type="button"
                className={spectator ? btnActive : btn}
                onClick={() => setSpectator((s) => !s)}
              >
                Spectator board
              </button>
              <button type="button" className={btn} onClick={doReconnect}>
                Reconnect sim
              </button>
              {reconnect && (
                <span
                  className={`text-xs font-bold ${reconnect.pass ? "text-green-400" : "text-red-400"}`}
                  title={reconnect.detail}
                >
                  {reconnect.pass ? "PASS" : "FAIL"}
                </span>
              )}
            </div>
            <label className="mt-2 block text-xs text-parchment-300">
              Board size: {boardWidth}px
              <input
                type="range"
                min={320}
                max={720}
                step={20}
                value={boardWidth}
                onChange={(e) => setBoardWidth(Number(e.target.value))}
                className="mt-1 w-full"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-parchment-400">Motion:</span>
              <button
                type="button"
                className={anim === "off" ? btnActive : btn}
                onClick={() => applyAnim("off")}
              >
                Reduced (off)
              </button>
              <button
                type="button"
                className={anim === "fast" ? btnActive : btn}
                onClick={() => applyAnim("fast")}
              >
                Fast
              </button>
              <button
                type="button"
                className={anim === "normal" ? btnActive : btn}
                onClick={() => applyAnim("normal")}
              >
                Normal
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
              <span className="text-parchment-400">FX intensity:</span>
              {FX_LEVELS.map((l, i) => (
                <button
                  key={l.label}
                  type="button"
                  className={fxLevel === i ? btnActive : btn}
                  onClick={() => setFxLevel(i as FxLevel)}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="mt-2">
              <button type="button" className={btn} onClick={replayLastAnimation} disabled={!sig}>
                Replay last animation{sig ? ` (${sig.id})` : ""}
              </button>
            </div>
          </div>

          <div className="plate p-3">
            <h2 className="font-display text-sm font-bold text-parchment-100">Lifecycle</h2>
            {selInst ? (
              <div className="mt-1 text-xs">
                <div className="text-parchment-100">
                  {selInstDef?.name ?? selInst.id}{" "}
                  <span className="text-parchment-400">
                    ({selectedInst!.color === "w" ? "white" : "black"} #{selectedInst!.index})
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[12px]">
                  <span className={`border px-1 ${selInst.spent ? "border-red-400/50 text-red-300" : "border-white/10 text-parchment-400"}`}>
                    spent: {String(!!selInst.spent)}
                  </span>
                  <span className={`border px-1 ${selInst.usedActivation ? "border-amber-400/50 text-amber-300" : "border-white/10 text-parchment-400"}`}>
                    usedActivation: {String(!!selInst.usedActivation)}
                  </span>
                  <span className={`border px-1 ${selInst.nullified ? "border-red-400/50 text-red-300" : "border-white/10 text-parchment-400"}`}>
                    nullified: {String(!!selInst.nullified)}
                  </span>
                </div>
                {selInstDef?.status && (
                  <div className="mt-1 text-parchment-300">
                    status():{" "}
                    {(() => {
                      try {
                        return selInstDef.status!(selInst) ?? "(null)";
                      } catch (e) {
                        return `threw: ${errText(e)}`;
                      }
                    })()}
                  </div>
                )}
                <pre className="mt-1 max-h-40 overflow-auto border border-white/10 bg-ink-900/60 p-1 text-[12px] leading-tight">
                  {JSON.stringify(selInst.state, null, 1)}
                </pre>
              </div>
            ) : (
              <p className="mt-1 text-xs text-parchment-400">
                Grant a card or click a held card to inspect its live instance state.
              </p>
            )}
            <div className="mt-2 text-xs font-semibold text-parchment-100">
              Active effects ({bs?.effects.length ?? 0})
            </div>
            <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[12px] text-parchment-300">
              {(bs?.effects ?? []).map((e, i) => (
                <li key={i} className="border border-white/10 px-1 py-0.5">
                  {e.kind}
                  {"sq" in e && typeof e.sq === "number" && ` @ ${squareName(e.sq)}`}
                  {"squares" in e &&
                    Array.isArray(e.squares) &&
                    ` @ [${e.squares.map((s: number) => squareName(s)).join(" ")}]`}
                  {"owner" in e && ` owner=${e.owner}`}
                  {"against" in e && ` against=${e.against}`}
                  {", turns: "}
                  {e.turns == null ? "permanent" : e.turns}
                </li>
              ))}
              {(bs?.effects.length ?? 0) === 0 && (
                <li className="text-parchment-500">none</li>
              )}
            </ul>
            <div className="mt-2 text-xs font-semibold text-parchment-100">Mutation log</div>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-[12px]">
              {[...log].reverse().map((l) => (
                <li key={l.n} className={l.error ? "text-red-300" : "text-parchment-400"}>
                  #{l.n} {l.msg}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------ Run-all harness */}
      <section className="plate mt-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-sm font-bold text-parchment-100">
            Run-all harness
          </h2>
          <button type="button" className={btn} onClick={runAll} disabled={running}>
            {running ? "Running..." : `Run all ${runnableCards().length} implemented cards`}
          </button>
          {running && (
            <button
              type="button"
              className={btn}
              onClick={() => {
                runAbortRef.current = true;
              }}
            >
              Stop
            </button>
          )}
          <button
            type="button"
            className={onlyFailures ? btnActive : btn}
            onClick={() => setOnlyFailures((v) => !v)}
          >
            Only failures
          </button>
          {runSummary && (
            <span className="text-xs">
              <span className="text-green-400">{runSummary.pass} pass</span>
              {" / "}
              <span className={runSummary.fail > 0 ? "font-bold text-red-400" : "text-parchment-400"}>
                {runSummary.fail} fail
              </span>
              {" / "}
              <span className="text-parchment-400">{runSummary.noValidUse} no-valid-use</span>
              {" of "}
              {runSummary.total}
            </span>
          )}
          <span className="text-[12px] text-parchment-500">
            Headless twin: npm run test:lab (scripts/lab-run-all.ts)
          </span>
        </div>
        {shownRows && (
          <div className="mt-2 max-h-[420px] overflow-auto">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead className="sticky top-0 bg-ink-900">
                <tr className="text-parchment-400">
                  <th className="border-b border-white/10 px-2 py-1">Card</th>
                  <th className="border-b border-white/10 px-2 py-1">Tier</th>
                  <th className="border-b border-white/10 px-2 py-1">Mechanic</th>
                  <th className="border-b border-white/10 px-2 py-1">Granted</th>
                  <th className="border-b border-white/10 px-2 py-1">Activated</th>
                  <th className="border-b border-white/10 px-2 py-1">Plies</th>
                  <th className="border-b border-white/10 px-2 py-1">Error</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.map((r) => (
                  <tr
                    key={r.id}
                    className={rowFailed(r) ? "bg-red-950/40 text-red-200" : "text-parchment-300"}
                  >
                    <td className="border-b border-white/5 px-2 py-0.5">
                      {r.name} <span className="text-parchment-500">{r.id}</span>
                    </td>
                    <td className="border-b border-white/5 px-2 py-0.5">{r.tier}</td>
                    <td className="border-b border-white/5 px-2 py-0.5">{r.mechanic}</td>
                    <td className="border-b border-white/5 px-2 py-0.5">{r.granted}</td>
                    <td className="border-b border-white/5 px-2 py-0.5">{r.activated}</td>
                    <td className="border-b border-white/5 px-2 py-0.5">{r.plies}</td>
                    <td className="border-b border-white/5 px-2 py-0.5">{r.error ?? ""}</td>
                  </tr>
                ))}
                {shownRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-2 text-parchment-500">
                      {onlyFailures ? "No failures." : "No rows yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
