"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { FriendsPanel } from "@/components/FriendsPanel";
import dynamic from "next/dynamic";
// The whole match runtime (board, effects, card library) only renders once a
// challenge is accepted; loading it lazily keeps it out of the lobby's first
// paint, where this provider also mounts.
const OnlineMatch = dynamic(() => import("@/components/OnlineMatch").then((m) => m.OnlineMatch), {
  ssr: false,
});
import {
  clearSavedFriendSession,
  loadSavedFriendSession,
  MPSession,
  MPStart,
} from "@/lib/multiplayer";
import { resolvePreferredMode, savePreferredMode } from "@/lib/modeState";
import { Button } from "@/components/ui/Button";

// The whole "Play a Friend" experience, folded into the lobby's Friends tab so
// a player never leaves /lobby to set up a private game. `FriendGameProvider`
// wraps the lobby: while a friend game is being created / joined / played it
// takes over the screen (the waiting card, the connecting card, or the live
// board), and otherwise it renders the lobby normally and exposes the create /
// join actions to the Friends tab (`FriendGameSetup`) and to any lobby row that
// wants to open a friend code (`useFriendGame`).

type View = "setup" | "lobby" | "joining" | "game";

const TIME_STEPS_SEC = [
  30,
  45,
  60,
  90,
  120,
  150,
  180,
  ...range(5 * 60, 10 * 60, 60),
  15 * 60, // the 15+10 preset's base falls between the coarser ranges
  ...range(12 * 60, 30 * 60, 2 * 60),
  ...range(35 * 60, 2 * 60 * 60, 5 * 60),
].sort((a, b) => a - b);

type FriendGameContextValue = {
  // Setup-form state.
  baseSec: number;
  setBaseSec: (v: number) => void;
  incrementSec: number;
  setIncrementSec: (v: number) => void;
  gameMode: "nerf" | "buff";
  pickGameMode: (m: "nerf" | "buff") => void;
  rated: boolean;
  setRated: (v: boolean) => void;
  challenging: string | null;
  error: string | null;
  // Actions.
  handleCreate: () => void;
  joinWithCode: (code: string) => void;
};

const FriendGameContext = createContext<FriendGameContextValue | null>(null);

export function useFriendGame(): FriendGameContextValue {
  const ctx = useContext(FriendGameContext);
  if (!ctx) throw new Error("useFriendGame must be used within a FriendGameProvider");
  return ctx;
}

export function FriendGameProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<View>("setup");
  // Live mirror for the session event handler below: wireSession registers its
  // callback once at session creation, so reading `view` directly there froze
  // it at that moment ("setup"/"joining") and the not-in-game guard never
  // actually stood down after `start`. The ref always reads the current view.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  const [code, setCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  // Default custom-challenge clock: 3+2 (a brisk blitz control most players
  // reach for).
  const [baseSec, setBaseSec] = useState(180);
  const [incrementSec, setIncrementSec] = useState(2);
  // Friend games always run the Draft ruleset; the host picks the section:
  // Buff (no nerfs) or Nerf (secret handicaps revealed at game end). Buff is
  // the default. Picks stay hidden; everything reveals at game end. Stakes
  // (casual or rated) are chosen separately below.
  const [gameMode, setGameMode] = useState<"nerf" | "buff">("buff");
  // A deliberate mode pick here is remembered site-wide, like every other mode
  // selector.
  const pickGameMode = (m: "nerf" | "buff") => {
    setGameMode(m);
    savePreferredMode(m);
  };
  // Rated custom challenge: the game moves both players' ratings when they are
  // signed-in accounts (otherwise it plays out casual). Defaults to casual so a
  // relaxed game with a friend never touches a rating by surprise.
  const [rated, setRated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState<MPStart | null>(null);
  // Direct challenge: ?challenge=NAME pre-addresses the game to that player;
  // creating it then notifies them instead of relying on a shared code.
  const [challenging, setChallenging] = useState<string | null>(null);

  const sessionRef = useRef<MPSession | null>(null);
  // Mirrors sessionRef for the in-game render gate below: the many pre-game
  // transitions read the ref synchronously, but rendering must not, so the live
  // session is also tracked as state (set when the `start` frame lands).
  const [session, setSession] = useState<MPSession | null>(null);
  const expectedChallengeHostRef = useRef<string | null>(null);

  // Tell the target the game exists; failures degrade to a plain friend code.
  const registerChallenge = async (
    to: string,
    gameCode: string,
    timeSec: number,
    incSec: number,
    isRated: boolean,
  ) => {
    try {
      await fetch("/api/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, code: gameCode, timeSec, incrementSec: incSec, rated: isRated }),
      });
    } catch {}
  };

  const cancelChallenge = (gameCode: string) => {
    if (!gameCode) return;
    try {
      void fetch(`/api/challenges/${encodeURIComponent(gameCode)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancelled" }),
      });
    } catch {}
  };

  const claimIncomingChallenge = async (gameCode: string): Promise<{ ok: boolean; from?: string }> => {
    try {
      const res = await fetch(`/api/challenges/${encodeURIComponent(gameCode)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accepted" }),
      });
      // Not every friend code is a direct challenge. Public codes, signed-out
      // users, and hosts simply fall through to the normal websocket join.
      if (res.status === 401 || res.status === 403 || res.status === 404) return { ok: true };
      const data = (await res.json().catch(() => null)) as { error?: string; from?: string } | null;
      if (res.ok) return { ok: true, from: data?.from };
      setError(data?.error ?? "That challenge is no longer available.");
      return { ok: false };
    } catch {
      return { ok: true };
    }
  };

  useEffect(() => {
    return () => {
      sessionRef.current?.destroy();
      sessionRef.current = null;
    };
  }, []);

  // Set up the session event handler for the pre-game phase; once `start`
  // arrives, OnlineMatch takes over the event stream.
  const wireSession = (sess: MPSession) => {
    sess.on((e) => {
      if (e.type === "open") {
        setCode(e.code);
        setView("lobby");
      } else if (e.type === "start") {
        const expectedHost = expectedChallengeHostRef.current;
        if (expectedHost && e.setup.players?.w?.name !== expectedHost) {
          setError("That challenge no longer points to the player who sent it.");
          sess.destroy();
          if (sessionRef.current === sess) sessionRef.current = null;
          setSession(null);
          expectedChallengeHostRef.current = null;
          clearSavedFriendSession();
          setView("setup");
          return;
        }
        setStart(e.setup);
        setCode(e.setup.id);
        setError(null);
        setSession(sess);
        setView("game");
      } else if (e.type === "error" && viewRef.current !== "game") {
        setError(e.message);
      }
    });
  };

  const joinWithCode = async (raw: string) => {
    const trimmed = raw.trim().toUpperCase();
    setError(null);
    clearSavedFriendSession();
    expectedChallengeHostRef.current = null;
    if (!trimmed) {
      setError("Enter a code.");
      return;
    }
    // Validate the shape before opening a socket: an obvious typo (wrong
    // length or illegal characters) gets an inline explanation instead of a
    // dead-end "Connecting…" screen that can only time out. Real codes are
    // 5 or 8 chars from a fixed uppercase alphabet, so this only rejects
    // input that could never be a code; the server stays the final authority.
    if (!/^[A-Z0-9]{4,8}$/.test(trimmed)) {
      setError("That doesn't look like a game code. Codes are 4-8 letters and digits, e.g. ABCDE.");
      return;
    }
    const sess = new MPSession();
    sessionRef.current = sess;
    wireSession(sess);
    setJoinCode(trimmed);
    setView("joining");
    try {
      const claimed = await claimIncomingChallenge(trimmed);
      expectedChallengeHostRef.current = claimed.from ?? null;
      if (!claimed.ok) {
        if (sessionRef.current === sess) {
          sess.destroy();
          sessionRef.current = null;
          expectedChallengeHostRef.current = null;
          setView("setup");
        }
        return;
      }
      await sess.join(trimmed);
      // The game starts on receipt of the server `start` frame.
    } catch (e) {
      // Join refused (host left, seat taken, bad code): drop the session and
      // all challenge expectations so the setup form starts clean.
      if (sessionRef.current !== sess) return;
      sess.destroy();
      sessionRef.current = null;
      expectedChallengeHostRef.current = null;
      setError((e instanceof Error ? e.message : String(e)) || "Failed to connect. Check the code.");
      setView("setup");
    }
  };

  useEffect(() => {
    if (sessionRef.current) return;
    const search = new URLSearchParams(window.location.search);
    // Arriving with a shared code (e.g. from a shared join link or an Accept
    // button in the lobby) joins that game immediately.
    const codeParam = search.get("code")?.trim().toUpperCase();
    if (codeParam) {
      queueMicrotask(() => setJoinCode(codeParam));
      // A refresh mid-game lands here with the challenge code still in the
      // URL. By then the challenge record is consumed and the joiner seat is
      // taken, so a fresh join can never succeed; the saved seat token is the
      // only way back into the game. Resume it, and only fall back to a fresh
      // join when there is no saved seat for this code or the server refuses
      // the seat (game gone or archived).
      const savedForCode = loadSavedFriendSession();
      if (savedForCode && savedForCode.id === codeParam) {
        queueMicrotask(() => {
          setCode(savedForCode.id);
          setView("joining");
        });
        const sess = new MPSession();
        sessionRef.current = sess;
        wireSession(sess);
        sess.resume(savedForCode).catch(() => {
          if (sessionRef.current !== sess) return;
          sess.destroy();
          sessionRef.current = null;
          clearSavedFriendSession();
          void joinWithCode(codeParam);
        });
      } else {
        void joinWithCode(codeParam);
      }
      return;
    }
    // Mode carries over from the rest of the site: an explicit ?mode=nerf|buff
    // wins, else the last mode this browser picked, else the Buff default the
    // state already holds.
    {
      const m = resolvePreferredMode();
      if (m !== "buff") queueMicrotask(() => setGameMode(m));
    }
    const challengeParam = search.get("challenge")?.trim();
    if (challengeParam) {
      queueMicrotask(() => setChallenging(challengeParam));
      return;
    }
    const saved = loadSavedFriendSession();
    if (!saved) return;
    queueMicrotask(() => {
      setCode(saved.id);
      setView("joining");
    });
    let cancelled = false;
    const resumeSaved = async () => {
      // A finished game must never re-capture this page: if the saved game
      // is already archived, drop the stale session and show the setup form.
      try {
        const res = await fetch(`/api/games/${encodeURIComponent(saved.id)}`);
        if (cancelled) return;
        if (res.ok) {
          clearSavedFriendSession();
          setView("setup");
          return;
        }
      } catch {}
      if (cancelled || sessionRef.current) return;
      const sess = new MPSession();
      sessionRef.current = sess;
      wireSession(sess);
      sess.resume(saved).catch(() => {
        if (sessionRef.current !== sess) return;
        clearSavedFriendSession();
        sessionRef.current = null;
        setView("setup");
      });
    };
    void resumeSaved();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    setError(null);
    clearSavedFriendSession();
    const sess = new MPSession();
    sessionRef.current = sess;
    wireSession(sess);
    try {
      const c = await sess.host(baseSec, incrementSec, {
        draft: true,
        mode: gameMode,
        // Rated custom challenge (the server rates it only when both seats are
        // signed-in accounts, else it plays out casual).
        ...(rated ? { rated: true } : {}),
        // Direct challenge: the server reserves the opponent seat for them,
        // so a lobby stranger can never take it first.
        ...(challenging ? { invite: challenging } : {}),
      });
      if (sessionRef.current !== sess) return;
      setCode(c);
      setView("lobby");
      if (challenging) registerChallenge(challenging, c, baseSec, incrementSec, rated);
    } catch (e) {
      if (sessionRef.current !== sess) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExit = () => {
    if (challenging && view === "lobby") cancelChallenge(code);
    clearSavedFriendSession();
    sessionRef.current?.destroy();
    sessionRef.current = null;
    setSession(null);
    expectedChallengeHostRef.current = null;
    setStart(null);
    setView("setup");
    setCode("");
    setJoinCode("");
    setError(null);
  };

  if (view === "game" && start && session) {
    return (
      <OnlineMatch
        session={session}
        start={start}
        subtitle={`code ${start.id}`}
        onExit={handleExit}
      />
    );
  }

  if (view === "lobby") {
    return (
      <main className="min-h-screen pb-16">
        <SiteHeader active="/lobby" />
        <section className="max-w-xl mx-auto px-6 py-12 text-center">
          <div className="text-[12px] text-parchment-400">
            {challenging ? `Challenge sent to ${challenging}` : "Share this code"}
          </div>
          <div className="mt-3 font-mono text-5xl tracking-[0.2em] text-gold-leaf">{code}</div>
          <p className="mt-6 text-parchment-200">
            {challenging
              ? `${challenging} has been notified.`
              : "Send this code to your friend."}
          </p>
          <div className="mt-8 flex items-center justify-center gap-2 text-[12px] text-parchment-400">
            <span className="w-1.5 h-1.5 rounded-full bg-verdigris animate-flicker" />
            Waiting for opponent…
          </div>
          {error && (
            <div className="mt-6 plate p-3 px-4 border-oxblood-glow/60 bg-oxblood/15 text-parchment">
              {error}
            </div>
          )}
          <Button tone="ghost"
            onClick={handleExit}
            className="mt-8 px-5 py-2 font-body">
            Cancel
          </Button>
        </section>
      </main>
    );
  }

  if (view === "joining") {
    return (
      <main className="min-h-screen pb-16">
        <SiteHeader active="/lobby" />
        <section className="max-w-xl mx-auto px-6 py-12 text-center">
          <div className="text-[12px] text-parchment-400">Connecting…</div>
          <div className="mt-3 font-mono text-4xl tracking-[0.2em] text-gold-leaf">{joinCode || code}</div>
          {error && (
            <div className="mt-6 plate p-3 px-4 border-oxblood-glow/60 bg-oxblood/15 text-parchment">
              {error}
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <FriendGameContext.Provider
      value={{
        baseSec,
        setBaseSec,
        incrementSec,
        setIncrementSec,
        gameMode,
        pickGameMode,
        rated,
        setRated,
        challenging,
        error,
        handleCreate,
        joinWithCode,
      }}
    >
      {children}
    </FriendGameContext.Provider>
  );
}

// The friend-game setup, rendered inline inside the lobby's Friends tab. Time
// control, a color-coded mode pick, casual/rated stakes, the create+share
// button, and a join-with-code box — everything the standalone page used to
// carry, without leaving /lobby. `showFriends={false}` suppresses the inline
// FriendsPanel for call sites (the lobby's Friends tab) that lay the panel
// out themselves next to this form; other call sites are unchanged.
export function FriendGameSetup({ showFriends = true }: { showFriends?: boolean }) {
  const {
    baseSec,
    setBaseSec,
    incrementSec,
    setIncrementSec,
    gameMode,
    pickGameMode,
    rated,
    setRated,
    challenging,
    error,
    handleCreate,
    joinWithCode,
  } = useFriendGame();
  const [joinCode, setJoinCode] = useState("");
  const presetActive = (b: number, i: number) => baseSec === b && incrementSec === i;
  const onPreset = presetActive(baseSec, incrementSec) && TIME_PRESETS.some((t) => presetActive(t.base, t.inc));
  // The custom-time disclosure owns its open state (mirrored from the DOM via
  // onToggle) so a user toggle sticks; it pops open when the sliders leave the
  // presets, since that is the only way to see the value they now hold.
  const [customOpen, setCustomOpen] = useState(!onPreset);
  const [prevOnPreset, setPrevOnPreset] = useState(onPreset);
  if (prevOnPreset !== onPreset) {
    setPrevOnPreset(onPreset);
    if (!onPreset) setCustomOpen(true);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start">
    <div className="space-y-5">
      {challenging && (
        <p className="text-parchment-200">
          <span className="text-gold-leaf">{challenging}</span> gets a notification and the
          game starts when they accept.
        </p>
      )}

      {error && (
        <div className="plate p-3 px-4 border-oxblood-glow/60 bg-oxblood/15 text-parchment">
          {error}
        </div>
      )}

      {/* Time control: the same nine tiles as quick pairing, edge to edge,
          with the sliders folded under "Custom" for anything else. */}
      <div>
        <div className="mb-2 text-[12px] text-parchment-400">Time control</div>
        <div className="grid grid-cols-3 gap-2">
          {TIME_PRESETS.map((t) => {
            const on = presetActive(t.base, t.inc);
            return (
              <Button
                key={t.label}
                tone="default"
                aria-pressed={on}
                onClick={() => {
                  setBaseSec(t.base);
                  setIncrementSec(t.inc);
                }}
                className={
                  "!min-h-[52px] flex-col !gap-0.5 !px-1 !py-2" +
                  (on ? " !border-2 !border-solid !border-[color:var(--accent)] text-[color:var(--accent)]" : "")
                }
              >
                <span className="font-mono text-base leading-none tabular-nums">{t.label}</span>
                <span className={"text-[12px] " + (on ? "opacity-90" : "text-parchment-400")}>{t.speed}</span>
              </Button>
            );
          })}
        </div>
        <details className="mt-3" open={customOpen} onToggle={(e) => setCustomOpen(e.currentTarget.open)}>
          {/* A disclosure summary is a control: its text is interactive text. */}
          <summary className="inline-flex min-h-[44px] cursor-pointer select-none items-center text-[13px] text-parchment-400 hover:text-parchment-200 [@media(pointer:fine)]:min-h-0">
            Custom time
          </summary>
          <div className="mt-3 space-y-4">
            <TimeSlider
              label="Time per Side"
              value={baseSec}
              values={[0, ...TIME_STEPS_SEC]}
              display={baseSec === 0 ? "Unlimited" : formatTimeControl(baseSec)}
              formatEdgeLabel={formatTimeControl}
              onChange={setBaseSec}
            />
            <TimeSlider
              label="Increment (Seconds)"
              value={incrementSec}
              values={range(0, 30, 1)}
              display={String(incrementSec)}
              disabled={baseSec === 0}
              onChange={setIncrementSec}
            />
          </div>
        </details>
      </div>

      <div>
        <div className="text-[12px] text-parchment-400 mb-2">Mode</div>
        <div className="grid grid-cols-2 gap-2">
          <ModeChoice mode="buff" selected={gameMode === "buff"} onClick={() => pickGameMode("buff")} />
          <ModeChoice mode="nerf" selected={gameMode === "nerf"} onClick={() => pickGameMode("nerf")} />
        </div>
      </div>

      <div>
        <div className="text-[12px] text-parchment-400 mb-2">Stakes</div>
        <div className="grid grid-cols-2 gap-2">
          <StakeButton selected={!rated} onClick={() => setRated(false)}>
            Casual
          </StakeButton>
          <StakeButton selected={rated} onClick={() => setRated(true)}>
            Rated
          </StakeButton>
        </div>
        {rated && (
          <p className="mt-2 text-[12px] leading-snug text-parchment-400">
            Rated when both players are signed in.
          </p>
        )}
      </div>

      <Button tone="leaf"
        onClick={handleCreate}
        className="w-full py-3.5 font-body text-lg">
        {challenging
          ? `Send ${rated ? "rated " : ""}challenge to ${challenging}`
          : rated
          ? "Create rated game"
          : "Create game"}
      </Button>

    </div>
    {/* Right column: join a code, then your friends. */}
    <div className="space-y-5">
      {!challenging && (
        <>
          <div>
            <div className="text-[12px] text-parchment-400 mb-2">Join with a code</div>
            <div className="flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && joinCode.trim()) joinWithCode(joinCode);
                }}
                placeholder="ABCDE"
                maxLength={8}
                aria-label="Friend game code"
                className="min-w-0 flex-1 bg-ink-900/60 border border-white/15 rounded-sm px-4 py-3 text-lg font-mono tracking-widest uppercase focus:outline-none focus:border-gold/60 text-parchment placeholder:text-parchment-500"
              />
              <Button tone="ghost"
                onClick={() => joinWithCode(joinCode)}
                disabled={!joinCode.trim()}
                className="px-5 font-body disabled:opacity-50">
                Join
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Your friends: add by username and challenge in one tap. Hidden on the
          challenge-specific flow (arriving via ?challenge=name), where the
          panel is already about one opponent, and when the host layout renders
          the panel itself (showFriends={false}). */}
      {!challenging && showFriends && <FriendsPanel />}
    </div>
    </div>
  );
}

// The quick-pairing pools, so a friend game starts from the same nine tiles.
const TIME_PRESETS: { label: string; base: number; inc: number; speed: string }[] = [
  { label: "1+0", base: 60, inc: 0, speed: "Bullet" },
  { label: "2+1", base: 120, inc: 1, speed: "Bullet" },
  { label: "3+0", base: 180, inc: 0, speed: "Blitz" },
  { label: "3+2", base: 180, inc: 2, speed: "Blitz" },
  { label: "5+0", base: 300, inc: 0, speed: "Blitz" },
  { label: "5+3", base: 300, inc: 3, speed: "Blitz" },
  { label: "10+0", base: 600, inc: 0, speed: "Rapid" },
  { label: "10+5", base: 600, inc: 5, speed: "Rapid" },
  { label: "15+10", base: 900, inc: 10, speed: "Rapid" },
];

// The two modes, told apart by color: each button always wears its mode
// identity (rose for Nerf, sky for Buff), deepening with a ring and a check
// when selected — matching the Quick Play mode cards, no swatch dot.
function ModeChoice({
  mode,
  selected,
  onClick,
}: {
  mode: "nerf" | "buff";
  selected: boolean;
  onClick: () => void;
}) {
  const identity =
    mode === "nerf"
      ? selected
        ? "border-mode-nerf bg-mode-nerf/20 text-mode-nerfGlow ring-2 ring-inset ring-mode-nerf"
        : "border-mode-nerf/30 bg-mode-nerf/5 text-mode-nerfGlow/80 hover:border-mode-nerf/60 hover:bg-mode-nerf/10"
      : selected
        ? "border-mode-buff bg-mode-buff/20 text-mode-buffGlow ring-2 ring-inset ring-mode-buff"
        : "border-mode-buff/30 bg-mode-buff/5 text-mode-buffGlow/80 hover:border-mode-buff/60 hover:bg-mode-buff/10";
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={mode === "nerf" ? "Nerf" : "Buff"}
      onClick={onClick}
      className={
        // 148.5x41: py-3 is 0.75rem, and at a 14px root that is 10.5px a side, so
        // the box lands three short of the minimum however wide it is.
        "flex min-h-[44px] items-center justify-center gap-2 px-3 py-3 border transition font-display text-sm font-bold [@media(pointer:fine)]:min-h-0 " +
        identity
      }
    >
      {selected && (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      {mode === "nerf" ? "Nerf" : "Buff"}
    </button>
  );
}

// Rated / Casual segment. Rated wears the gold identity (it stakes something);
// casual stays neutral.
function StakeButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "min-h-[44px] px-3 py-2 border transition-colors duration-150 text-[14px] font-medium " +
        (selected
          ? "border-2 border-[color:var(--accent)] bg-[color:var(--bg-raised)] text-[color:var(--accent)]"
          : "border-[color:var(--edge)] bg-[color:var(--bg-raised)] text-parchment-200 hover:border-[color:var(--edge-strong)] hover:text-parchment-50")
      }
    >
      {children}
    </button>
  );
}

function range(start: number, end: number, step: number) {
  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    values.push(value);
  }
  return values;
}

function formatTimeControl(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  return `${minutes}:${remainingSec.toString().padStart(2, "0")}`;
}

function TimeSlider({
  label,
  value,
  values,
  display,
  disabled = false,
  formatEdgeLabel = String,
  onChange,
}: {
  label: string;
  value: number;
  values: number[];
  display: string;
  disabled?: boolean;
  formatEdgeLabel?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const index = Math.max(0, values.indexOf(value));

  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] text-parchment-400">{label}</div>
        <div className="font-mono text-sm text-gold-leaf tabular-nums">{display}</div>
      </div>
      <input
        type="range"
        min={0}
        max={values.length - 1}
        step={1}
        value={index}
        disabled={disabled}
        onChange={(e) => onChange(values[Number(e.target.value)])}
        // 16px tall, and the one control on this page that has to be dragged
        // rather than tapped. The track paints centred in whatever height the
        // element has, so min-height grows the hit area without moving the
        // slider. Same shape and same fix as the picker on /play, which is a
        // separate copy of this component.
        className="min-h-[44px] w-full accent-gold-leaf disabled:cursor-not-allowed [@media(pointer:fine)]:min-h-0"
      />
      <div className="mt-1 flex justify-between font-mono text-[12px] text-parchment-400">
        <span>{formatEdgeLabel(values[0])}</span>
        <span>{formatEdgeLabel(values[values.length - 1])}</span>
      </div>
    </div>
  );
}
