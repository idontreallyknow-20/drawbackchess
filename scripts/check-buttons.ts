// Static check: every button comes from the sanctioned set.
//
// The house rule (docs/design-system.md §7) is that buttons pick from
// .btn-leaf / .btn-ghost / .btn-glass / .btn-cursed / .btn-cta / .btn-slab, and
// that "bespoke one-off button styles are retired". The codebase is not there:
// dozens of files hand-roll a button out of inline Tailwind instead.
//
// What a bespoke button does and does not miss is worth being precise about,
// because the count below is otherwise easy to over-read. Tailwind's palette is
// var-backed (`gold` is `rgb(var(--accent-gold-rgb) / <alpha-value>)`), so a
// hand-rolled `border-gold/40 text-parchment` DOES follow the theme's accent
// already. What it misses is the theme's MATERIAL — the top light, the floor,
// the rivet glints, the face treatment in the --btn-* contract — which is
// authored once against .btn-* and cannot reach an element that never wears it.
//
// So this is a real debt, but it is a "these buttons are made of the wrong
// stuff" debt, not a "these buttons are the wrong colour" one. Some findings
// are also legitimately not buttons: an identity chip with a hairline and a
// name in it is an affordance, and converting it to a slab would be a
// regression. Judgement per call-site; the list is a map, not a work order.
//
// Two things are reported:
//
//   1. BESPOKE — a <button>/<Link> whose class list has button geometry
//      (padding + a border or background) but carries no btn-* class. These
//      need converting to <Button>/<LinkButton> by hand.
//
//   2. RAW — a call-site that uses a btn-* class directly rather than the
//      <Button> primitive. These are mechanical to codemod.
//
// Run: npx -y tsx scripts/check-buttons.ts           (report only, always exits 0)
//      npx -y tsx scripts/check-buttons.ts --list     (print every finding)
//      npx -y tsx scripts/check-buttons.ts --strict   (fail on anything off-baseline)
//
// --strict is what CI runs once the migration lands. BASELINE is the set of
// files still awaiting conversion; it may only ever shrink, and the script
// fails on a stale entry so a converted file cannot silently stay listed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const LIST = process.argv.includes("--list");
const STRICT = process.argv.includes("--strict");

/** The sanctioned material classes. Anything else matching `btn-` is a typo. */
const SANCTIONED = [
  "btn-leaf",
  "btn-ghost",
  "btn-glass",
  "btn-glass--primary",
  "btn-cursed",
  "btn-cta",
  "btn-slab",
  "btn-gold",
  "btn-busy",
];

// Files allowed to name a btn-* class directly: the primitive itself defines
// the mapping, and the mod console's ModButton is a sanctioned thin wrapper.
const PRIMITIVE_FILES = ["src/components/ui/Button.tsx", "src/components/mod/ui.tsx"];

// Surfaces that are not part of the product's button vocabulary: dev-only
// harnesses and the pre-hydration error pages, which must not import app code.
const NOT_PRODUCT = [
  "src/app/dev/", // internal galleries and the effects lab
  "src/app/global-error.tsx", // renders without the app shell by design
];

// Files still carrying bespoke buttons. This list may only SHRINK. --strict
// fails on any file not listed here, and on any listed file that has since
// been cleaned, so a converted file cannot silently stay listed.
//
// The mechanical debt is already paid: a codemod took the raw btn-* call-sites
// from 212 to 8. What is left is the judgement work — every entry below is a
// button hand-rolled from inline Tailwind, and some of them are not buttons at
// all (an identity chip with a hairline is an affordance, and turning it into a
// slab would be a regression). They come off this list as their surface is
// touched, not in one sweep.
const BASELINE: string[] = [
  "src/components/mod/ModShell.tsx",
  "src/app/achievements/page.tsx",
  "src/app/analysis/page.tsx",
  "src/app/clubs/[slug]/page.tsx",
  "src/app/clubs/page.tsx",
  "src/app/codex/_components/CodexBrowser.tsx",
  "src/app/codex/_components/CodexRow.tsx",
  "src/app/codex/suggest/page.tsx",
  "src/app/community/page.tsx",
  "src/app/error.tsx",
  "src/app/game/[id]/page.tsx",
  "src/app/game/page.tsx",
  "src/app/history/[id]/page.tsx",
  "src/app/history/page.tsx",
  "src/app/inbox/page.tsx",
  "src/app/lobby/page.tsx",
  "src/app/login/page.tsx",
  "src/app/mod/house/page.tsx",
  "src/app/play/page.tsx",
  "src/app/profile/edit/page.tsx",
  "src/app/profile/page.tsx",
  "src/app/tournaments/[id]/page.tsx",
  "src/app/tournaments/page.tsx",
  "src/app/tutorial/walkthrough/page.tsx",
  "src/app/tv/page.tsx",
  "src/app/u/[username]/page.tsx",
  "src/components/AchievementToast.tsx",
  "src/components/AdminGodPanel.tsx",
  "src/components/Board.tsx",
  // The dock split (BuffDock.tsx -> components/dock/) carried the monolith's
  // remaining bespoke affordances with it: row/chip toggles, the segmented
  // hand filter, and the targeting banner's Done/Cancel pair. A move, not new
  // debt — the old BuffDock.tsx entry retired and the net count shrank.
  "src/components/dock/BuffDock.tsx",
  "src/components/dock/DockAgainstYou.tsx",
  "src/components/dock/DockRow.tsx",
  "src/components/dock/targeting.tsx",
  "src/components/DraftOverlay.tsx",
  "src/components/FriendGame.tsx",
  "src/components/GameOver.tsx",
  "src/components/MobileBuffDrawer.tsx",
  "src/components/MobileNavMenu.tsx",
  "src/components/MoveList.tsx",
  "src/components/MoveStrip.tsx",
  "src/components/OnlineMatch.tsx",
  "src/components/OppPlaysLog.tsx",
  "src/components/OpponentDraftPanel.tsx",
  "src/components/OpponentDraftViewer.tsx",
  "src/components/PlayerSearch.tsx",
  "src/components/PlayerStatsPanel.tsx",
  "src/components/QueueButton.tsx",
  "src/components/RatingChart.tsx",
  "src/components/SettingsBootstrap.tsx",
  "src/components/SettingsPanel.tsx",
  "src/components/SiteHeader.tsx",
  "src/components/SpectatorPill.tsx",
  "src/components/codex/CardDetail.tsx",
  "src/components/guide/KeyTerms.tsx",
  "src/components/mod/PlayersSection.tsx",
  "src/components/mod/ui.tsx",
  "src/components/profile/FriendsModule.tsx",
  "src/components/ratings/CategoryTabs.tsx",
  "src/components/ratings/RatingHistoryPanel.tsx",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** The class attribute of the JSX open tag starting at `from`, flattened.
 *  Walks to the tag's own `>` tracking brace depth, so a className built by a
 *  ternary across five lines is read whole rather than per line. */
function openTag(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length && i < from + 4000; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(from, i);
  }
  return src.slice(from, from + 4000);
}

const lineOf = (src: string, index: number) => src.slice(0, index).split("\n").length;

/** Button geometry: a padding utility plus an edge or a fill. Deliberately
 *  conservative — an unstyled <button> wrapping an icon is not a bespoke
 *  button, it is a hit target, and flagging those would drown the signal. */
function looksLikeAButton(tag: string): boolean {
  const padded = /\bp[xy]?-[0-9[]/.test(tag);
  const surfaced = /\bborder\b|\bbg-|\bshadow-/.test(tag);
  return padded && surfaced;
}

type Finding = { rel: string; line: number; kind: "BESPOKE" | "RAW"; detail: string };

const findings: Finding[] = [];
const files = walk(join(ROOT, "src")).filter((f) => f.endsWith(".tsx"));

for (const file of files) {
  const rel = relative(ROOT, file).split("\\").join("/");
  if (NOT_PRODUCT.some((p) => rel.startsWith(p))) continue;
  const src = readFileSync(file, "utf8");
  const isPrimitive = PRIMITIVE_FILES.includes(rel);

  for (const m of src.matchAll(/<(button|Link)[\s>]/g)) {
    const tag = openTag(src, m.index!);
    if (!/className|class=/.test(tag)) continue;

    const named = SANCTIONED.filter((c) => new RegExp(`\\b${c}\\b`).test(tag));
    if (named.length > 0) {
      if (isPrimitive) continue;
      findings.push({
        rel,
        line: lineOf(src, m.index!),
        kind: "RAW",
        detail: `<${m[1]}> uses .${named[0]} directly`,
      });
      continue;
    }
    // A <Link> is usually navigation, not a control. Only count one that has
    // been dressed as a button.
    if (!looksLikeAButton(tag)) continue;
    findings.push({
      rel,
      line: lineOf(src, m.index!),
      kind: "BESPOKE",
      detail: `<${m[1]}> styled inline, no btn-* class`,
    });
  }
}

const bespoke = findings.filter((f) => f.kind === "BESPOKE");
const raw = findings.filter((f) => f.kind === "RAW");
const byFile = (fs: Finding[]) => [...new Set(fs.map((f) => f.rel))].sort();

console.log(
  `[check-buttons] ${bespoke.length} bespoke button(s) in ${byFile(bespoke).length} file(s); ` +
    `${raw.length} raw btn-* call-site(s) in ${byFile(raw).length} file(s)`,
);

if (LIST) {
  for (const f of findings.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line)) {
    console.log(`  ${f.kind.padEnd(7)} ${f.rel}:${f.line}  ${f.detail}`);
  }
} else if (bespoke.length > 0) {
  console.log("\n  Bespoke buttons by file (worst first):");
  const counts = new Map<string, number>();
  for (const f of bespoke) counts.set(f.rel, (counts.get(f.rel) ?? 0) + 1);
  for (const [rel, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`    ${String(n).padStart(3)}  ${rel}`);
  }
  console.log("    (--list for every finding)");
}

if (!STRICT) {
  console.log(
    "\nReport only. Run with --strict to fail on regressions once the " +
      "<Button> migration has landed.",
  );
  process.exit(0);
}

const offenders = byFile(bespoke);
const newOffenders = offenders.filter((f) => !BASELINE.includes(f));
const stale = BASELINE.filter((f) => !offenders.includes(f));

if (newOffenders.length === 0 && stale.length === 0 && raw.length === 0) {
  console.log("[check-buttons] OK: every button comes from the sanctioned set");
  process.exit(0);
}

if (newOffenders.length > 0) {
  console.log(`\n${newOffenders.length} file(s) with NEW bespoke buttons:`);
  for (const f of newOffenders) console.log("  " + f);
  console.log(
    "\nUse <Button tone=… /> from src/components/ui/Button.tsx (or <LinkButton> " +
      "for navigation styled as a control). A themed flagship material is " +
      "authored against .btn-*, so a hand-rolled button will not pick it up.",
  );
}
if (raw.length > 0) {
  console.log(`\n${raw.length} call-site(s) still naming a btn-* class directly:`);
  for (const f of LIST ? raw : raw.slice(0, 20)) console.log(`  ${f.rel}:${f.line}  ${f.detail}`);
}
if (stale.length > 0) {
  console.log(`\n${stale.length} stale BASELINE entry(s) — these files are clean now:`);
  for (const f of stale) console.log("  " + f);
  console.log("\nRemove them from BASELINE in this script so the list keeps shrinking.");
}
process.exit(1);
