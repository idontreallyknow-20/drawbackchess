"use client";

import type { ReactNode } from "react";
import type { CodexFilters } from "@/lib/nerfFilter";
import { SORT_OPTIONS } from "@/lib/nerfFilter";
import { CATEGORY_DEFS } from "@/lib/nerfCategories";
import { BUFF_COLLECTIONS, NERF_COLLECTIONS } from "@/lib/cardCollections";
import { TIER_LABEL, TIER_ROMAN } from "@/lib/tiers";
import {
  BEHAVIOUR_LABEL,
  BEHAVIOURS,
  type Behaviour,
  type Library,
} from "./codexData";

// Draft-buff categories, presented like the nerf categories. Nerf-relief boons
// are deliberately absent (they only exist in Nerf mode's draft pool).
// Exported so the browser's active-filter chips can label a category id.
export const BUFF_CATEGORY_DEFS = [
  { id: "movement", label: "Movement" },
  { id: "pieces", label: "Pieces" },
  { id: "tempo", label: "Tempo" },
  { id: "protection", label: "Protection" },
  { id: "attack", label: "Attack" },
  { id: "info", label: "Info" },
  { id: "draft", label: "Draft manipulation" },
];

// One labeled select ("chip") in the filter row. 12px control text keeps it
// above the sub-12px floor; the label is a section eyebrow at 11px.
function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] text-parchment-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-full rounded-none border border-[color:var(--edge)] bg-[color:var(--bg-base)] px-3 py-1.5 text-[12px] font-body text-parchment focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
      >
        {children}
      </select>
    </label>
  );
}

/**
 * The filter chip row: difficulty tier, category (where the family has varied
 * categories), passive vs activated behaviour (buff families only), collection,
 * and sort. Discovered from the real data model, so it only offers filters the
 * cards actually carry. Shared verbatim between the desktop inline row and the
 * mobile bottom sheet.
 */
export function FilterControls({
  tab,
  filters,
  behaviour,
  availableTiers,
  onPatch,
  onBehaviour,
  layout,
}: {
  tab: Library;
  filters: CodexFilters;
  behaviour: Behaviour;
  availableTiers: number[];
  onPatch: (p: Partial<CodexFilters>) => void;
  onBehaviour: (b: Behaviour) => void;
  layout: "inline" | "sheet";
}) {
  const isRules = tab === "rules";
  // A category dropdown only makes sense where the cards carry varied
  // categories: nerfs and plain buffs. Hexes are all one category and boons are
  // a cross-cutting pool, so they browse by tier and search alone.
  const showCategory = tab === "rules" || tab === "buffs";
  // Behaviour (passive / instant / activated) is a Buff.kind, so it is hidden
  // for nerfs, which are always passive.
  const showBehaviour = !isRules;
  const collections = isRules ? NERF_COLLECTIONS : BUFF_COLLECTIONS;

  const wrap =
    layout === "sheet"
      ? "grid grid-cols-2 gap-x-4 gap-y-4"
      : "flex flex-wrap items-end gap-x-4 gap-y-3";

  return (
    <div className={wrap}>
      <FilterSelect
        label={isRules ? "Difficulty" : "Tier"}
        value={filters.tier === null ? "" : String(filters.tier)}
        onChange={(v) => onPatch({ tier: v === "" ? null : Number(v) })}
      >
        <option value="">{isRules ? "All difficulties" : "All tiers"}</option>
        {availableTiers.map((t) => (
          <option key={t} value={t}>
            {TIER_ROMAN[t]}. {TIER_LABEL[t]}
          </option>
        ))}
      </FilterSelect>

      {showCategory && (
        <FilterSelect
          label="Category"
          value={filters.categories[0] ?? ""}
          onChange={(v) => onPatch({ categories: v === "" ? [] : [v] })}
        >
          <option value="">All categories</option>
          {(isRules ? CATEGORY_DEFS : BUFF_CATEGORY_DEFS).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </FilterSelect>
      )}

      {showBehaviour && (
        <FilterSelect
          label="Behaviour"
          value={behaviour}
          onChange={(v) => onBehaviour(v as Behaviour)}
        >
          {BEHAVIOURS.map((b) => (
            <option key={b} value={b}>
              {BEHAVIOUR_LABEL[b]}
            </option>
          ))}
        </FilterSelect>
      )}

      <FilterSelect
        label="Collection"
        value={filters.collection ?? ""}
        onChange={(v) => onPatch({ collection: v === "" ? null : v })}
      >
        <option value="">All collections</option>
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Sort"
        value={filters.sort}
        onChange={(v) => onPatch({ sort: v as CodexFilters["sort"] })}
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </FilterSelect>
    </div>
  );
}
