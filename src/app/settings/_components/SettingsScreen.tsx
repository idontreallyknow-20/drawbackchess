"use client";

// The /settings screen.
//
// Settings used to exist only inside a modal opened from the header, which
// meant they had no address: you could not bookmark them, link a friend to the
// board-theme picker, or land on them from search. This is the same surface at
// a URL.
//
// It is NOT a second implementation. Every row, control and picker comes from
// components/settings/rows.tsx, and the rows themselves from
// components/settings/config.ts — the identical modules the panel renders. A row
// added to that config appears here and in the panel at once, and a change made
// on either surface reaches the other through SETTINGS_CHANGED_EVENT, which
// useSettingsModel subscribes to. There is nothing to keep in step by hand.
//
// DEEP LINKING is a real path segment: /settings/appearance, not a fragment.
// A path reaches the server, so the section gets its own <title> and canonical,
// an unknown one gets a real 404 through notFound(), and browser history moves
// between sections. The fragment form still works on this index page — every
// section is rendered here with id={section.id}, so /settings#appearance scrolls
// to it — but it is the weaker half of the pair: a fragment is invisible to the
// server, so it can never be more than a scroll position.
//
// The five system states (design-system.md §8), all real dependencies of this
// surface rather than states invented to fill a checklist:
//   1. Loading      — the stored values live in localStorage, which the server
//                     render cannot see, so the rows mount after hydration.
//   2. Empty        — the filter matched no setting.
//   3. Error        — this browser refuses to persist (private mode, blocked
//                     site data), so nothing changed here would survive.
//   4. Disconnected — the account sync endpoint is unreachable; changes still
//                     apply and still save locally, they just do not follow you.
//   5. Recovered    — the sync came back, announced once and then dismissed.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { fetchMe } from "@/lib/authClient";
import { EmptyState } from "@/components/EmptyState";
import { Button, LinkButton } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";
import type { Settings } from "@/lib/settings";
import { SECTIONS, type RowConfig, type SectionConfig } from "@/components/settings/config";
import { SettingsRows, useSettingsModel } from "@/components/settings/rows";
import { SettingsSkeleton } from "./SettingsSkeleton";

/** Where the account copy stands. `local` is not a failure: it is what a
 *  signed-out player should be told, and it is the common case. */
type SyncState = "checking" | "synced" | "local" | "offline" | "recovered";

/** Does this browser actually let us keep anything? Private windows and
 *  "block site data" both throw on write, and every setting on this page is
 *  stored locally first, so a page that cannot write is a page that lies. */
function storageWritable(): boolean {
  try {
    const probe = "dc:settings-probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** The two gates below never change after the first client render, so their
 *  store has nothing to notify: subscribe is a no-op that unsubscribes to
 *  nothing. `getSnapshot` must be referentially stable, hence module scope. */
const subscribeNever = () => () => {};
const isClient = () => true;
const isServer = () => false;
const alwaysWritable = () => true;

function matches(row: RowConfig, section: SectionConfig, needle: string): boolean {
  if (!needle) return true;
  const hay = `${row.label} ${row.hint ?? ""} ${row.group ?? ""} ${section.title}`.toLowerCase();
  return hay.includes(needle);
}

export function SettingsScreen({ focus }: { focus?: string }) {
  // Hydration gate AND the loading state in one flag. The stored values are
  // read synchronously by useSettingsModel so no surface ever paints a frame of
  // defaults — which is exactly why the rows must not render during hydration,
  // when the server's markup (defaults) and the client's (the real values)
  // would disagree. The heading and chrome render on both passes; only the rows
  // wait a frame.
  //
  // useSyncExternalStore, not an effect: it is built to return one value on the
  // server and hydration pass and another once the client is live, which is
  // precisely the gate, and it does it without a setState in an effect body.
  const ready = useSyncExternalStore(subscribeNever, isClient, isServer);
  const writable = useSyncExternalStore(subscribeNever, storageWritable, alwaysWritable);
  const [query, setQuery] = useState("");
  const [sync, setSync] = useState<SyncState>("checking");
  // One subscription for the whole page, not one per section. Reading the
  // stored values here is safe on the hydration pass because nothing renders
  // them until `ready`.
  const { settings, update } = useSettingsModel();
  // Where the recovered notice hands back to once it has been seen.
  const settleTo = useRef<SyncState>("synced");

  // Honour /settings#appearance ourselves.
  //
  // The browser resolves a fragment while parsing the document, and at that
  // moment the sections do not exist: they are behind the `ready` gate above,
  // one frame later. Measured before this: #appearance resolved to an element
  // 2680px down the page with window.scrollY still 0. So the scroll is redone
  // once the rows are actually on screen. `scroll-mt-4` on each section keeps
  // the heading off the top edge.
  useEffect(() => {
    if (!ready) return;
    const id = window.location.hash.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    // Only ever a section of this page, never an arbitrary id: the hash is
    // attacker-supplied and this must not become a way to scroll the reader to
    // something else.
    if (target && SECTIONS.some((s) => s.id === id)) {
      target.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }, [ready]);

  // The account sync probe.
  //
  // fetchMe() is the site's own "who am I", and its three-way answer is exactly
  // the three-way answer this surface needs: a user means the settings blob
  // follows the account, `null` means signed out (a fact about the page, not an
  // outage), and `undefined` means the request never landed, which is the only
  // thing that counts as a disconnection. Reusing it rather than probing
  // /api/users/settings directly also keeps the network quiet: /api/auth/me is
  // already fetched by SiteHeader on this page, so this adds no new endpoint,
  // and the offline branch below short-circuits before any request at all.
  // Working out where the sync stands is kept PURE, and applying it is a second
  // step, so the effect below starts with an await rather than a setState. That
  // is the shape react-hooks/set-state-in-effect is asking for, and it reads
  // better anyway: one place decides, one place applies.
  const resolveSync = useCallback(async (): Promise<"offline" | "local" | "synced"> => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
    const me = await fetchMe();
    if (me === undefined) return "offline";
    return me === null ? "local" : "synced";
  }, []);

  const applySync = useCallback((settled: "offline" | "local" | "synced") => {
    if (settled === "offline") {
      setSync("offline");
      return;
    }
    // Where this settles once any recovery notice has had its moment. A signed
    // out reader lands on "local", which is not a failure state, but they are
    // still owed the recovery notice: they watched the page say it had lost
    // touch, so it has to say when it stopped being true.
    settleTo.current = settled;
    // Only announce a recovery if there was something to recover from;
    // §8.5 says a silent return is the right default otherwise.
    setSync((prev) => (prev === "offline" ? "recovered" : settled));
  }, []);

  /** Retry, and the browser coming back online, both re-probe. */
  const probeSync = useCallback(async () => {
    applySync(await resolveSync());
  }, [resolveSync, applySync]);

  // The first probe is written inline rather than as a call to probeSync, in
  // the same shape as every other fetching route here (see leaderboard/page.tsx):
  // an async IIFE with a cancelled flag, so nothing lands after unmount and the
  // only state writes are after an await or inside a listener.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settled = await resolveSync();
      if (!cancelled) applySync(settled);
    })();
    const onOffline = () => setSync("offline");
    const onOnline = () => void probeSync();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [resolveSync, applySync, probeSync]);

  // The recovered notice retires itself rather than sitting there forever.
  useEffect(() => {
    if (sync !== "recovered") return;
    const id = window.setTimeout(() => setSync(settleTo.current), 4000);
    return () => window.clearTimeout(id);
  }, [sync]);

  const needle = query.trim().toLowerCase();
  const shown = (focus ? SECTIONS.filter((s) => s.id === focus) : SECTIONS)
    .map((section) => ({ section, rows: section.rows.filter((r) => matches(r, section, needle)) }))
    .filter((s) => s.rows.length > 0);
  const focused = focus ? SECTIONS.find((s) => s.id === focus) ?? null : null;

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader />
      <div className="mx-auto max-w-5xl px-5 py-6 sm:px-6 sm:py-8">
        <div className="text-[12px] text-parchment-400">
          {focused ? (
            // 13px, not the 12px of the label beside it: §3's caption floor is
            // 12px but its INTERACTIVE floor is 13px, and this is a link. It
            // measured 12px inherited from the wrapper before this.
            <Link
              href="/settings"
              className="inline-flex min-h-[44px] items-center text-[13px] hover:text-parchment [@media(pointer:fine)]:min-h-0"
            >
              All settings
            </Link>
          ) : (
            "Preferences"
          )}
        </div>
        {/* Exactly one h1 on the route, whichever section is open: the section
            name is an h2 below, because the page is Settings either way. */}
        <h1 className="page-title mt-0.5">Settings</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-parchment-300">
          {focused
            ? focused.blurb
            : "Everything the quick panel holds, at an address you can bookmark and share. Changes save as you make them, on this device first."}
        </p>

        <SyncNotice state={sync} onRetry={() => void probeSync()} />

        {!writable && (
          <div
            role="alert"
            className="plate mt-4 border-l-2 border-l-[color:var(--accent-danger)] p-4"
          >
            <h2 className="font-display text-[14px] font-semibold text-parchment-50">
              This browser will not keep your settings
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-parchment-300">
              Local storage is blocked, so anything you change here applies to this tab and is
              gone when you close it. A private window or a &ldquo;block site data&rdquo; setting
              is the usual cause.
            </p>
          </div>
        )}

        {/* The filter. Worth having on a full page in a way it is not in the
            panel: seven sections and forty-odd rows is more than a scan.
            Through the shared SearchInput rather than a sixth hand-rolled box:
            this one already had its 44px floor right, but four others did not,
            and one of each is the point of the primitive. It also brings a
            clear button, which this did not have. */}
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Filter settings"
          label="Filter settings"
          className="mt-4 max-w-sm"
        />

        {!ready ? (
          <SettingsSkeleton />
        ) : shown.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              icon={Search}
              title="No setting matches that"
              body={`Nothing in ${focused ? focused.title.toLowerCase() : "settings"} is called “${query.trim()}”. Try a shorter word, or clear the filter to see everything.`}
              action={{ onClick: () => setQuery(""), label: "Clear filter" }}
              secondary={focused ? { href: "/settings", label: "Search all settings" } : undefined}
            />
          </div>
        ) : (
          <div className="mt-5 grid gap-5 sm:grid-cols-[13rem_minmax(0,1fr)]">
            <SectionRail focus={focus} />
            <div className="min-w-0 space-y-4">
              {shown.map(({ section, rows }) => (
                <SectionPanel
                  key={section.id}
                  section={section}
                  rows={rows}
                  settings={settings}
                  update={update}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/** Every section as a real link, so the rail is navigable (and crawlable, and
 *  middle-clickable) rather than a set of buttons that only move local state. */
function SectionRail({ focus }: { focus?: string }) {
  return (
    <nav aria-label="Settings sections" className="min-w-0">
      <ul className="flex flex-wrap gap-1 sm:sticky sm:top-4 sm:flex-col">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <Link
              href={`/settings/${section.id}`}
              aria-current={focus === section.id ? "page" : undefined}
              className={
                "settings-tab flex min-h-[44px] w-full items-center gap-2.5 px-2.5 py-2 text-[13px] " +
                (focus === section.id ? "text-parchment-50" : "")
              }
            >
              <section.icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate">{section.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SectionPanel({
  section,
  rows,
  settings,
  update,
}: {
  section: SectionConfig;
  rows: RowConfig[];
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  return (
    // The id is what makes /settings#appearance land in the right place.
    <section id={section.id} className="plate scroll-mt-4 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-display text-[14px] font-semibold text-parchment-50">
        <section.icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2} />
        {section.title}
      </h2>
      <SettingsRows rows={rows} settings={settings} update={update} />
    </section>
  );
}

/** States 4 and 5, plus the signed-out fact that is neither. Nothing is drawn
 *  while the probe is in flight or once it has quietly succeeded: a settings
 *  page that shouts "synced" at you has told you nothing. */
function SyncNotice({ state, onRetry }: { state: SyncState; onRetry: () => void }) {
  if (state === "checking" || state === "synced") return null;

  if (state === "offline") {
    return (
      <div
        role="status"
        className="plate mt-4 flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-[13px] leading-relaxed text-parchment-300">
          Not syncing to your account right now. Changes still apply and stay saved on this
          device.
        </p>
        <Button tone="default" size="sm" onClick={onRetry} className="shrink-0">
          Retry
        </Button>
      </div>
    );
  }

  if (state === "recovered") {
    return (
      <p role="status" className="mt-4 text-[13px] text-parchment-300">
        Back in touch with your account. Your settings are syncing again.
      </p>
    );
  }

  // "local": signed out. A statement of fact with the way to change it. The
  // way out is a LinkButton rather than a word underlined mid-sentence: an
  // inline link in prose measured 41x18 at 360, and §10's floor applies to
  // anything that is actually a control.
  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <p className="text-[13px] leading-relaxed text-parchment-400">
        These settings live on this device. Sign in to carry them to your phone and back.
      </p>
      <LinkButton tone="default" size="sm" href="/login" className="shrink-0">
        Sign in
      </LinkButton>
    </div>
  );
}
