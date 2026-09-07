// Guards the sentence-case rule (design-system.md sections 3 and 11).
//
//   npx tsx scripts/check-case.ts            # report
//   npx tsx scripts/check-case.ts --list     # every finding, not just new ones
//   npx tsx scripts/check-case.ts --strict   # fail on a NEW offender or a stale baseline entry
//
// WHY THIS EXISTS
//
// The design system is unusually specific here, in two places:
//
//   Section 11: "Sentence case everywhere, including buttons ('Find a match',
//   not 'FIND A MATCH'). Allcaps survive only in the LIVE badge."
//
//   Section 3: "The 9-10px letterspaced-smallcaps pattern is retired sitewide,
//   along with the .smallcaps / .eyebrow / .kicker utilities that carried it.
//   A section label is a plain bold heading at the body size, not an uppercase
//   tracked-out device." And: hierarchy is "weight + size + color, in that
//   order. Never letter-spacing alone."
//
// Both rules were written down and neither was enforced, so the device
// survived in the single most visible place on the site: the main nav, on
// every page, plus every section head in the quick-settings popover. It was
// not found by any guard. It was found by rendering a page and looking at it.
//
// The `.allcaps` utility is the reason a checker is worth more than a one-off
// cleanup. It had zero call sites and sat in globals.css anyway, which is
// exactly how a retired pattern returns: the next person reaches for the class
// that already exists and assumes it is sanctioned.
//
// WHAT COUNTS AS AN OFFENDER
//
// A Tailwind `uppercase` class or a CSS `text-transform: uppercase`, anywhere
// under src/ outside the exempt paths below. Tracking on its own is NOT
// flagged: `tracking-*` is legitimate on a mono clock or a logotype, and
// flagging it would bury the signal. The uppercase transform is the thing the
// document actually bans.
//
// THE BASELINE
//
// Same shape as scripts/check-buttons.ts, and for the same reason: the
// remaining sites are judgement calls that deserve a designer's eye rather
// than a blanket rewrite, and a guard that fails on all of them from day one
// gets disabled instead of obeyed. --strict fails on anything NEW, and also on
// a stale entry, so the list can only shrink.
//
// A baseline entry is a debt, not an exemption. The genuinely sanctioned case
// (the LIVE badge) is listed under EXEMPT with its reason.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

/** Truly sanctioned, per section 11. Not debt. */
const EXEMPT: { file: string; why: string }[] = [
  {
    file: "src/components/PresenceBadge.tsx",
    why: "the LIVE badge, the one allcaps the design system names",
  },
];

/**
 * The card-effects layer is decoration, not UI chrome: 200 files of bespoke
 * per-card animation where a shouted word is the art. Section 11 governs
 * interface copy. Excluded wholesale rather than baselined one by one.
 */
const EXCLUDED_DIRS = ["effects"];

/**
 * Known offenders at the time this guard was written. Every one is a real
 * violation and every one should eventually be zero. They are grouped so the
 * next person can take a coherent slice rather than a random file.
 */
const BASELINE: string[] = [
  // The clip studio: a dense video-editing surface with its own visual
  // language, worth doing as one deliberate pass rather than piecemeal.
  "src/components/clip/ClipModal.tsx",
  "src/components/clip/clipStudio.css",
  // The moderator console. Internal, and its density conventions differ.
  "src/components/mod/ModShell.tsx",
  "src/components/mod/ui.tsx",
  "src/components/mod/stats/RulesTable.tsx",
  "src/components/mod/stats/StatCard.tsx",
  // Game-moment typography, where allcaps is arguably the point. Needs a
  // decision on whether a board splash is "interface copy" at all.
  "src/app/globals.css",
  "src/components/DraftOverlay.tsx",
  "src/components/draft/WaitingCornerNotice.tsx",
  "src/components/EffectPopover.tsx",
  // Ordinary chrome. These are the ones to fix first.
  "src/app/page.tsx",
  "src/app/leaderboard/page.tsx",
  "src/app/tv/page.tsx",
  "src/app/u/[username]/page.tsx",
  "src/app/updates/page.tsx",
  "src/app/global-error.tsx",
  "src/components/FriendGame.tsx",
  "src/components/QueueButton.tsx",
  "src/components/match/CommandRail.tsx",
  "src/components/profile/ActivityFeed.tsx",
  "src/components/profile/RatingRail.tsx",
  // Open Graph card rendering: an image, not a page.
  "src/lib/ogCard.tsx",
];

interface Finding {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.includes(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const UPPERCASE_CLASS = /(?:^|[\s"'`])uppercase(?:[\s"'`]|$)/;
const UPPERCASE_CSS = /text-transform\s*:\s*uppercase/;

const findings: Finding[] = [];
for (const abs of walk(SRC)) {
  const rel = path.relative(ROOT, abs);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  lines.forEach((line, i) => {
    // A mention inside a comment is documentation, not a use. This matters:
    // several of the fixes deliberately leave a comment explaining what was
    // removed, and flagging those would punish writing the explanation down.
    const stripped = line.replace(/\/\/.*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (!UPPERCASE_CLASS.test(stripped) && !UPPERCASE_CSS.test(stripped)) return;
    findings.push({ file: rel, line: i + 1, text: line.trim().slice(0, 110) });
  });
}

const exemptFiles = new Set(EXEMPT.map((e) => e.file));
const live = findings.filter((f) => !exemptFiles.has(f.file));
const byFile = new Map<string, Finding[]>();
for (const f of live) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file)!.push(f);
}

const baseline = new Set(BASELINE);
const novel = [...byFile.keys()].filter((f) => !baseline.has(f)).sort();
const stale = [...baseline].filter((f) => !byFile.has(f)).sort();

const listAll = process.argv.includes("--list");
const strict = process.argv.includes("--strict");

if (listAll) {
  for (const [file, items] of [...byFile.entries()].sort()) {
    const tag = baseline.has(file) ? "baseline" : "NEW";
    console.log(`\n${file}  (${items.length}, ${tag})`);
    for (const f of items) console.log(`  ${String(f.line).padStart(5)}  ${f.text}`);
  }
} else {
  const total = live.length;
  console.log(
    `[check-case] ${total} uppercase site(s) across ${byFile.size} file(s); ` +
      `${BASELINE.length} file(s) baselined, ${EXEMPT.length} exempt.`,
  );
  console.log("    (--list for every finding)");
}

let bad = false;
if (novel.length) {
  bad = true;
  console.log(`\n${novel.length} file(s) NOT in the baseline use uppercase:`);
  for (const f of novel) {
    console.log(`  ${f}`);
    for (const item of byFile.get(f)!) console.log(`      ${item.line}  ${item.text}`);
  }
  console.log(
    "\nSentence case everywhere (design-system.md section 11). If this is genuinely\n" +
      "the LIVE badge or an equivalent, add it to EXEMPT with the reason; do not add\n" +
      "new chrome to BASELINE.",
  );
}
if (stale.length) {
  bad = true;
  console.log(`\n${stale.length} stale baseline entr(y/ies), now clean. Remove them:`);
  for (const f of stale) console.log(`  ${f}`);
}

if (strict && bad) process.exit(1);
if (!bad) console.log("[check-case] OK: no new uppercase chrome, no stale baseline entries");
