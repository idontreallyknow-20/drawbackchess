"use client";

import { SiteHeader } from "@/components/SiteHeader";
import { isRetired } from "@/engine/retired";
import { EmptyState } from "@/components/EmptyState";
import { isBoon } from "@/engine/buff";
import type { Buff } from "@/engine/buff";
import type { Nerf } from "@/engine/nerf";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, SearchX, SlidersHorizontal, X } from "lucide-react";
import {
  EMPTY_FILTERS,
  filterAndSortNerfs,
  filtersFromQueryString,
  filtersToQueryString,
  hasActiveFilters,
  matchesSearch,
  type CodexFilters,
} from "@/lib/nerfFilter";
import { cardText, hydrateCardText } from "@/lib/cardText";
import { buffCollection, BUFF_COLLECTIONS, NERF_COLLECTIONS } from "@/lib/cardCollections";
import { getCategoryLabel } from "@/lib/nerfCategories";
import { TIER_LABEL, TIER_ROMAN } from "@/lib/tiers";
import { BUFF_CATEGORY_DEFS, FilterControls } from "./FilterControls";
import { FilterSheet } from "./FilterSheet";
import { CodexRow } from "./CodexRow";
import { ExpandedCard } from "./ExpandedCard";
import {
  BEHAVIOUR_LABEL,
  DEFAULT_TAB,
  LIBRARY_NOUN_PLURAL,
  LIBRARY_TABS,
  TAB_LABEL,
  entryPath,
  tiersPresent,
  type Behaviour,
  type CodexEntry,
  type Library,
} from "./codexData";
import { Button } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";

// How many rows to add each time the reader approaches the end of the list.
// The list defaults to this many so the DOM near page load stays small (well
// under a hundred rows) however many hundred cards the family holds.
const BATCH = 60;

const isHexCard = (b: Buff) => b.category === "hex";
const isBoonCard = (b: Buff) => isBoon(b) && !isHexCard(b);

type EngineData = {
  nerfs: Nerf[];
  buffs: Buff[];
  hexes: Buff[];
  boons: Buff[];
};

type Load = "loading" | "ready" | "error";

// Sort a buff family the same way the nerf filter sorts nerfs, so both
// libraries read identically (easy = gentlest tier first, brutal = hardest).
function sortBuffs(list: Buff[], sort: CodexFilters["sort"]): Buff[] {
  const byName = (x: Buff, y: Buff) => x.name.localeCompare(y.name);
  const out = [...list];
  if (sort === "az") out.sort(byName);
  else if (sort === "za") out.sort((x, y) => byName(y, x));
  else if (sort === "easy") out.sort((x, y) => x.tier - y.tier || byName(x, y));
  else out.sort((x, y) => y.tier - x.tier || byName(x, y));
  return out;
}

function filterBuffs(source: Buff[], filters: CodexFilters, behaviour: Behaviour): Buff[] {
  // Same instant search as the nerf library: every token must be a substring
  // of name/description/category OR a fuzzy subsequence of the name, so a
  // near-miss spelling still finds the card.
  const q = filters.search.trim();
  const list = source.filter(
    (b) =>
      (filters.tier === null || b.tier === filters.tier) &&
      (filters.categories.length === 0 || filters.categories.includes(b.category)) &&
      (filters.collection === null || buffCollection(b) === filters.collection) &&
      (behaviour === "all" || b.kind === behaviour) &&
      (q === "" ||
        matchesSearch(
          `${b.name} ${b.description} ${b.category}`.toLowerCase(),
          b.name.toLowerCase(),
          q,
        )),
  );
  return sortBuffs(list, filters.sort);
}

export function CodexBrowser() {
  const [tab, setTab] = useState<Library>(DEFAULT_TAB);
  const [filters, setFilters] = useState<CodexFilters>(EMPTY_FILTERS);
  const [behaviour, setBehaviour] = useState<Behaviour>("all");
  const [engine, setEngine] = useState<EngineData | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [textHydrated, setTextHydrated] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [visible, setVisible] = useState(BATCH);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const hydrated = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);

  // Pull the ~26k-line card engine in its own async chunk, then derive the four
  // browsable families. Retired cards (src/engine/retired.ts) are dropped here,
  // before any count or filter sees them: the codex lists what is in play, and
  // a retired card's page stays reachable only by its direct link. Re-runs when
  // the reader retries after an error.
  useEffect(() => {
    let cancelled = false;
    Promise.all([import("@/engine/nerfs/library"), import("@/engine/buffs/library")])
      .then(([nerfs, buffs]) => {
        if (cancelled) return;
        const all = buffs.ALL_BUFFS.filter((b) => !isRetired(b.id));
        setEngine({
          nerfs: nerfs.ALL_NERFS.filter((n) => !isRetired(n.id)),
          buffs: all.filter((b) => !isHexCard(b) && !isBoonCard(b)),
          hexes: all.filter(isHexCard),
          boons: all.filter(isBoonCard),
        });
        setLoad("ready");
      })
      .catch(() => {
        if (!cancelled) setLoad("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Moderator text overrides, fetched once. The libraries render as-is until
  // (or unless) any land, so the codex never waits on the network.
  useEffect(() => {
    let alive = true;
    hydrateCardText().then((any) => {
      if (alive && any) setTextHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Restore tab / filters / behaviour from the URL on mount, then mirror them
  // back (replace, so history is not spammed) as they change.
  useEffect(() => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    const tabParam = params.get("tab") as Library | null;
    // Post-hydration URL restoration: initial render matches the static markup
    // (defaults), then this one-shot effect adopts the shared/refreshed URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tabParam && LIBRARY_TABS.includes(tabParam)) setTab(tabParam);
    const behaviourParam = params.get("behaviour");
    if (behaviourParam === "passive" || behaviourParam === "instant" || behaviourParam === "activated") {
      setBehaviour(behaviourParam);
    }
    setFilters(filtersFromQueryString(search));
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    const params = new URLSearchParams(filtersToQueryString(filters));
    if (tab !== DEFAULT_TAB) params.set("tab", tab);
    if (behaviour !== "all") params.set("behaviour", behaviour);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filters, tab, behaviour]);

  const nerfSource = useMemo<Nerf[]>(
    () => (!engine ? [] : textHydrated ? engine.nerfs.map((d) => cardText("nerf", d)) : engine.nerfs),
    [engine, textHydrated],
  );
  const buffFamilies = useMemo(() => {
    if (!engine) return { buffs: [], hexes: [], boons: [] } as Record<string, Buff[]>;
    if (!textHydrated) return { buffs: engine.buffs, hexes: engine.hexes, boons: engine.boons };
    return {
      buffs: engine.buffs.map((b) => cardText("buff", b)),
      hexes: engine.hexes.map((b) => cardText("buff", b)),
      boons: engine.boons.map((b) => cardText("buff", b)),
    };
  }, [engine, textHydrated]);

  const currentSource: (Nerf | Buff)[] =
    tab === "rules" ? nerfSource : buffFamilies[tab];
  const availableTiers = useMemo(() => tiersPresent(currentSource), [currentSource]);

  const entries = useMemo<CodexEntry[]>(() => {
    if (!engine) return [];
    if (tab === "rules") {
      return filterAndSortNerfs(nerfSource, filters).map((card) => ({ kind: "nerf", card }) as const);
    }
    return filterBuffs(buffFamilies[tab], filters, behaviour).map(
      (card) => ({ kind: "buff", card }) as const,
    );
  }, [engine, tab, filters, behaviour, nerfSource, buffFamilies]);

  // Reset the window and any open row whenever the visible set changes. Done
  // during render (the React-sanctioned "adjust state on prop change" pattern)
  // rather than in an effect, so there is no extra commit or cascading render.
  const listKey = `${tab}|${filtersToQueryString(filters)}|${behaviour}`;
  const [prevListKey, setPrevListKey] = useState(listKey);
  if (prevListKey !== listKey) {
    setPrevListKey(listKey);
    setVisible(BATCH);
    setExpandedId(null);
  }

  // Render as the reader approaches the end: a generous rootMargin batches the
  // next rows in before the sentinel is actually on screen.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (obs) => {
        if (obs.some((o) => o.isIntersecting)) {
          setVisible((v) => (v < entries.length ? v + BATCH : v));
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [entries.length]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const patch = useCallback((p: Partial<CodexFilters>) => setFilters((f) => ({ ...f, ...p })), []);
  const clearAll = useCallback(() => {
    setFilters({ ...EMPTY_FILTERS });
    setBehaviour("all");
  }, []);
  const switchTab = useCallback((next: Library) => {
    setTab(next);
    // Category ids and behaviour differ between families; a stale one would
    // silently filter everything out.
    setFilters((f) => ({ ...f, categories: [], collection: null, tier: null }));
    setBehaviour("all");
  }, []);

  const copyLink = useCallback((path: string, id: string) => {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedId(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId(null), 1600);
  }, []);

  const nounPlural = LIBRARY_NOUN_PLURAL[tab];
  // In-play cards only: retired ones never reach currentSource.
  const totalCount = currentSource.length;
  const shownCount = entries.length;
  const active = hasActiveFilters(filters) || behaviour !== "all";
  const visibleEntries = entries.slice(0, visible);

  // One removable chip per active filter, so the reader always sees exactly
  // what is narrowing the list and can drop any single filter in one click.
  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.search.trim()) {
    activeChips.push({
      key: "search",
      label: `"${filters.search.trim()}"`,
      clear: () => patch({ search: "" }),
    });
  }
  if (filters.tier !== null) {
    activeChips.push({
      key: "tier",
      label: `${tab === "rules" ? "Difficulty" : "Tier"} ${TIER_ROMAN[filters.tier]} (${TIER_LABEL[filters.tier]})`,
      clear: () => patch({ tier: null }),
    });
  }
  for (const cat of filters.categories) {
    activeChips.push({
      key: `cat:${cat}`,
      label:
        tab === "rules"
          ? getCategoryLabel(cat)
          : BUFF_CATEGORY_DEFS.find((c) => c.id === cat)?.label ?? cat,
      clear: () => patch({ categories: filters.categories.filter((c) => c !== cat) }),
    });
  }
  if (behaviour !== "all") {
    activeChips.push({
      key: "behaviour",
      label: BEHAVIOUR_LABEL[behaviour],
      clear: () => setBehaviour("all"),
    });
  }
  if (filters.collection !== null) {
    const pools = tab === "rules" ? NERF_COLLECTIONS : BUFF_COLLECTIONS;
    activeChips.push({
      key: "collection",
      label: pools.find((c) => c.id === filters.collection)?.label ?? filters.collection,
      clear: () => patch({ collection: null }),
    });
  }

  const filterControls = (layout: "inline" | "sheet") => (
    <FilterControls
      tab={tab}
      filters={filters}
      behaviour={behaviour}
      availableTiers={availableTiers}
      onPatch={patch}
      onBehaviour={setBehaviour}
      layout={layout}
    />
  );

  return (
    <main className="min-h-screen pb-20">
      <SiteHeader active="/codex" />

      <section className="mx-auto max-w-7xl px-6 pt-4">
        <h1 className="page-title">Codex</h1>
        <p className="mt-2 text-[15px] text-parchment-300">
          {load === "ready"
            ? `Browse every card and rule. ${totalCount} ${nounPlural} in this tab: search by name or effect, then open a row for the full card.`
            : "Browse every card and rule: search by name or effect, then open a row for the full card."}
        </p>

        {/* Sticky compact header: tabs, search, and the filter chip row (or, on
            phones, the bottom-sheet trigger). No (banned): a
            near-opaque ink surface keeps the content beneath from bleeding
            through. */}
        <div className="sticky top-0 z-30 -mx-6 mt-4 border-b border-[color:var(--edge)] bg-[color:var(--bg-base)] px-6 pb-3 pt-3">
          <div role="tablist" aria-label="Card families" className="flex flex-wrap gap-1 border-b border-[color:var(--edge)]">
            {LIBRARY_TABS.map((t) => {
              const selected = tab === t;
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => switchTab(t)}
                  // Same 44px floor and same `(pointer: fine)` step-down as
                  // every other navigation chip: px-3 py-2 left these tabs 35px
                  // tall. min-h, not more padding, so the underline indicator
                  // stays pinned to the row's bottom edge.
                  className={`relative inline-flex min-h-[44px] items-center px-3 py-2 font-display text-[14px] transition [@media(pointer:fine)]:min-h-0 ${
                    selected ? "text-parchment-50" : "text-parchment-300 hover:text-parchment-100"
                  }`}
                >
                  {TAB_LABEL[t]}
                  {selected && (
                    <span className="absolute inset-x-2 -bottom-px h-0.5 bg-[color:var(--accent)]" />
                  )}
                </button>
              );
            })}
          </div>

          <SearchInput
            className="mt-3"
            value={filters.search}
            onChange={(next) => patch({ search: next })}
            label={`Search ${nounPlural}`}
            placeholder={`Search ${nounPlural} by name or effect`}
          />

          {/* Desktop: inline filter chip row, with the match count beside it
              only while a filter or search is narrowing the list. Mobile: one
              trigger button that opens the bottom sheet. */}
          <div className="mt-3 hidden items-end gap-4 sm:flex">
            {filterControls("inline")}
            {load === "ready" && active && (
              <span className="pb-1.5 text-[12px] text-parchment-400" role="status" aria-live="polite">
                {shownCount} {nounPlural}
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 sm:hidden">
            <p className="text-[12px] text-parchment-400" role="status" aria-live="polite">
              {load === "ready"
                ? active
                  ? `${shownCount} ${nounPlural}`
                  : ""
                : load === "error"
                  ? "Could not load the library"
                  : `Loading the ${nounPlural}`}
            </p>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              // The phone-only filter trigger: it was 32px tall, and it is the
              // only way to reach the filters at this width.
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-none border border-[color:var(--edge)] px-3 py-1.5 text-[13px] text-parchment-200 hover:bg-[color:var(--bg-raised)] sm:hidden"
            >
              <SlidersHorizontal size={14} aria-hidden />
              Filters
              {active && (
                <span className="grid h-[17px] min-w-[17px] place-items-center rounded-none bg-[color:var(--accent)] px-1 text-[12px] font-bold leading-none text-ink-950">
                  {activeChips.length}
                </span>
              )}
            </button>
          </div>

          {/* Active-filter chips: one per live filter, each with its own
              one-click clear, plus a Clear-all at the end of the row. */}
          {activeChips.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.clear}
                  aria-label={`Remove filter: ${chip.label}`}
                  // Chip-shaped, but the whole pill IS the control (its name is
                  // "Remove filter: …"), so its text is interactive text at
                  // 13px rather than a 12px label. The static chips on this
                  // page — the tier roman numeral and the filter count badge —
                  // stay at 12px because they are labels beside a control, not
                  // the control itself.
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-none border border-[color:var(--accent)]/40 bg-[rgb(var(--accent-rgb)/0.1)] px-2 py-1 text-[13px] text-parchment-100 transition-colors hover:border-[color:var(--accent)] hover:bg-[rgb(var(--accent-rgb)/0.18)] [@media(pointer:fine)]:min-h-[28px]"
                >
                  {chip.label}
                  <X size={12} aria-hidden className="text-parchment-300" />
                </button>
              ))}
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex min-h-[44px] items-center px-1.5 py-1 text-[13px] text-parchment-400 underline-offset-2 hover:text-parchment-100 hover:underline [@media(pointer:fine)]:min-h-[28px]"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Results: the five async surface states. Loading and error are the
            engine import; empty is the no-match state (which offers to clear
            filters); the ready state is the windowed grid. */}
        <div className="mt-4">
          {load === "loading" ? (
            <SkeletonRows />
          ) : load === "error" ? (
            <EmptyState
              icon={AlertTriangle}
              title="The library did not load"
              body="The card library failed to load. Check your connection and try again."
              action={{
                label: "Retry",
                onClick: () => {
                  setLoad("loading");
                  setReloadKey((k) => k + 1);
                },
              }}
              secondary={{ href: "/", label: "Back to home" }}
            />
          ) : shownCount === 0 ? (
            <EmptyState
              icon={SearchX}
              title={`No ${nounPlural} match your filters`}
              body="Try a different word, or widen the tier and category filters to see more cards."
              action={{ label: "Clear filters", onClick: clearAll }}
            />
          ) : (
            <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {visibleEntries.map((entry) => {
                const id = entry.card.id;
                const isOpen = expandedId === id;
                return (
                  <li key={`${entry.kind}:${id}`} className={isOpen ? "lg:col-span-2" : ""}>
                    <CodexRow
                      entry={entry}
                      expanded={isOpen}
                      copied={copiedId === id}
                      onToggle={() => setExpandedId((cur) => (cur === id ? null : id))}
                      onCopy={() => copyLink(entryPath(entry), id)}
                    />
                    {isOpen && (
                      <div className="mt-2">
                        <ExpandedCard
                          entry={entry}
                          copied={copiedId === id}
                          onCopy={() => copyLink(entryPath(entry), id)}
                          onCollapse={() => setExpandedId(null)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
              <li aria-hidden ref={sentinelRef} className="h-px lg:col-span-2" />
            </ul>
          )}
        </div>
      </section>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filters"
        footer={
          <>
            <Button tone="ghost"
             
              onClick={clearAll}
              className="flex-1 px-4 py-2.5 text-[14px]">
              Clear filters
            </Button>
            <Button tone="leaf"
             
              onClick={() => setSheetOpen(false)}
              className="flex-1 px-4 py-2.5 text-[14px]">
              {load === "ready" ? `Show ${shownCount} ${nounPlural}` : "Done"}
            </Button>
          </>
        }
      >
        {filterControls("sheet")}
      </FilterSheet>
    </main>
  );
}

function SkeletonRows() {
  return (
    <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2" aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => (
        <li
          key={i}
          className="flex min-h-[44px] items-center gap-2.5 rounded-none border border-[color:var(--edge)] px-2.5 py-2"
        >
          <span className="skeleton h-7 w-7 shrink-0 rounded-none" />
          <span className="skeleton h-4 w-1/3 rounded-none" />
          <span className="skeleton ml-auto h-4 w-1/4 rounded-none" />
        </li>
      ))}
    </ul>
  );
}

