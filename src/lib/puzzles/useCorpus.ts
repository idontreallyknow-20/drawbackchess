"use client";

// Loading the puzzle corpus, with all five system states behind it.
//
// The file is a static asset (`public/puzzle-data/puzzles.json`), so there is
// no API and no game server involved: the route works with nothing running but
// a CDN. It is still a network fetch, and design-system section 8 asks every
// async surface for loading, empty, error, disconnected and recovered. All five
// are real here rather than decorative:
//
//   loading       the file is a few tens of KB and a cold cache is a real wait
//   empty         a corpus can genuinely be empty before the generator has run
//   error         a 404 or a schema the page does not understand
//   disconnected  offline is the normal case for the surface this route exists
//                 for: someone opening the site when nobody else is online
//   recovered     announced once, and only when the outage was long enough to
//                 have been noticed
//
// Once the corpus is in memory the puzzle itself is entirely local — the engine
// is running in the page — so losing the network mid-solve must not interrupt
// anything. That is why `status` stays "ready" when the connection drops after
// a successful load, and `offline` is reported separately.

import { useCallback, useEffect, useRef, useState } from "react";

import { PUZZLE_DATA_URL, PUZZLE_FILE_VERSION, type Puzzle, type PuzzleFile } from "./types";

export type CorpusStatus = "loading" | "ready" | "empty" | "error" | "disconnected";

/** How long an outage has to last before recovering from it is worth saying.
 *  Under this, the reconnect is silent (design-system section 8.5). */
const RECOVERY_ANNOUNCE_MS = 2000;

export interface Corpus {
  status: CorpusStatus;
  puzzles: Puzzle[];
  error: string | null;
  /** True while the browser reports no connection, whatever the status is. */
  offline: boolean;
  /** Set for a few seconds after a slow outage ends. */
  recovered: boolean;
  retry: () => void;
}

export function usePuzzleCorpus(): Corpus {
  const [status, setStatus] = useState<CorpusStatus>("loading");
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const offlineSince = useRef<number | null>(null);
  const loaded = useRef(false);

  const retry = useCallback(() => {
    if (!loaded.current) setStatus("loading");
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(PUZZLE_DATA_URL, { cache: "no-cache" });
        if (!res.ok) throw new Error(`The puzzle file returned ${res.status}.`);
        const file = (await res.json()) as PuzzleFile;
        if (cancelled) return;
        if (file.version !== PUZZLE_FILE_VERSION) {
          throw new Error("This build does not understand the puzzle file it was given.");
        }
        const list = Array.isArray(file.puzzles) ? file.puzzles : [];
        loaded.current = true;
        setPuzzles(list);
        setStatus(list.length ? "ready" : "empty");
      } catch (err) {
        if (cancelled) return;
        // Offline is a different state from broken, and it gets a different
        // answer: one waits for the connection, the other offers a retry.
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setStatus("disconnected");
        } else {
          setError(err instanceof Error ? err.message : "The puzzle file could not be read.");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const goOffline = () => {
      offlineSince.current = Date.now();
      setOffline(true);
      if (!loaded.current) setStatus("disconnected");
    };
    const goOnline = () => {
      const down = offlineSince.current ? Date.now() - offlineSince.current : 0;
      offlineSince.current = null;
      setOffline(false);
      if (down > RECOVERY_ANNOUNCE_MS) setRecovered(true);
      if (!loaded.current) setAttempt((n) => n + 1);
    };
    if (typeof navigator !== "undefined" && navigator.onLine === false) goOffline();
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // The recovered notice dismisses itself. It is never a modal and never waits
  // for a click, because nothing about it needs acknowledging.
  useEffect(() => {
    if (!recovered) return;
    const id = window.setTimeout(() => setRecovered(false), 4000);
    return () => window.clearTimeout(id);
  }, [recovered]);

  return { status, puzzles, error, offline, recovered, retry };
}
