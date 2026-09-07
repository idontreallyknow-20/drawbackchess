// ---------------------------------------------------------------------------
// C49 measurement harness: how long from the game page's first render until
// the draft overlay is in the DOM, on the local bot game's opening draft.
//
//   node scripts/measure-draft-open.mjs --runs 5 --label before
//
// It drives the same URL the e2e draft tests use, with `?perf=1` so the page's
// own render/commit marks (`window.__gamePerf`, see src/app/game/page.tsx) are
// recorded, and adds a document-start MutationObserver that stamps the first
// moment `[data-dialog="draft"]` (the overlay root) and the "Resolving effects"
// chip exist. Per run it reports:
//
//   render:start -> overlay        the headline "hydration to overlay in DOM"
//   offer known  -> overlay        the structural segment C49 is about: the
//                                  first render that knows about the offer,
//                                  through to the overlay being committed
//   commits in between             how many React commits that segment cost
//
// Medians over the runs are printed at the end. The dev server must already be
// running on :3000; nothing here starts or stops it.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const RUNS = Number(argOf("runs", "5"));
const LABEL = argOf("label", "run");
const ANIM = argOf("anim", "default"); // default | fast | off | reduced
const BASE = argOf("base", "http://localhost:3000");
const GAME_URL = `${BASE}/game?mode=buff&difficulty=easy&color=w&t=0&inc=0&rated=0&perf=1`;

function preinstalledChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return undefined;
  const dirs = fs
    .readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-linux", "chrome");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r1 = (n) => Math.round(n * 10) / 10;

const settings = { premovesEnabled: false };
if (ANIM === "fast") settings.animationSpeed = "fast";
if (ANIM === "off") settings.animationSpeed = "off";

const exe = preinstalledChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: ANIM === "reduced" ? "reduce" : "no-preference",
});

await context.addInitScript((seed) => {
  try {
    window.localStorage.setItem("dc:settings-v1", JSON.stringify(seed.settings));
    // A saved game would restore instead of dealing a fresh opening draft.
    window.localStorage.removeItem("dc:active-ai-game");
  } catch {
    // storage unavailable: the run still measures, just less hermetically
  }
  const marks = [];
  window.__draftMarks = marks;
  const seen = new Set();
  const stamp = (n) => {
    if (seen.has(n)) return;
    seen.add(n);
    marks.push({ n, t: performance.now() });
  };
  const check = () => {
    if (document.querySelector('[data-dialog="draft"]')) stamp("overlay:dom");
    if (document.querySelector(".draft-deal-grid")) stamp("deal-grid:dom");
    for (const el of document.querySelectorAll('[role="status"]')) {
      if ((el.textContent || "").includes("Resolving effects")) stamp("chip:dom");
    }
  };
  const start = () => {
    check();
    new MutationObserver(check).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };
  if (document.documentElement) start();
  else document.addEventListener("readystatechange", start, { once: true });
}, { settings });

const rows = [];
// One warmup navigation: the first load of a dev build compiles and fetches
// chunks that later runs get from cache, and it is not what we are measuring.
for (let i = 0; i < RUNS + 1; i++) {
  const page = await context.newPage();
  const warnings = [];
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[draft-sequence]")) warnings.push(t);
  });
  await page.goto(GAME_URL, { waitUntil: "commit" });
  await page.waitForSelector('[data-dialog="draft"]', { timeout: 60_000 });
  // Let the deal finish so a cards-ready stall (the 12s cap) would surface.
  await page
    .waitForSelector('[role="timer"][aria-label="Draft decision timer"]', { timeout: 30_000 })
    .catch(() => null);
  const data = await page.evaluate(() => ({
    marks: window.__draftMarks || [],
    perf: window.__gamePerf || [],
    seq: window.__draftSeq || [],
  }));
  await page.close();
  if (i === 0) {
    console.log(`[warmup] overlay marks: ${data.marks.map((m) => m.n).join(", ")}`);
    continue;
  }

  const perf = data.perf;
  if (args.includes("--dump")) {
    const all = [...perf, ...data.marks, ...data.seq].sort((a, b) => a.t - b.t);
    const t0 = all[0]?.t ?? 0;
    for (const m of all) console.log(`   ${r1(m.t - t0).toString().padStart(8)}  ${m.n}`);
  }
  const first = (pred) => perf.find(pred)?.t ?? null;
  const renderStart = first((m) => m.n === "render:start");
  const bootstrapEnd = first((m) => m.n === "bootstrap:end");
  const offerKnown = first((m) => m.n.startsWith("render:draft key=") && !m.n.includes("key=-"));
  const overlayRender = first((m) => m.n.startsWith("render:draft key=") && m.n.includes("vis=1"));
  const mark = (n) => data.marks.find((m) => m.n === n)?.t ?? null;
  const overlay = mark("overlay:dom");
  const commitsBetween =
    offerKnown != null && overlay != null
      ? perf.filter((m) => m.n === "commit" && m.t >= offerKnown && m.t <= overlay).length
      : null;
  rows.push({
    hydrationToOverlay: overlay != null && renderStart != null ? overlay - renderStart : null,
    offerToOverlay: overlay != null && offerKnown != null ? overlay - offerKnown : null,
    offerToOverlayRender:
      overlayRender != null && offerKnown != null ? overlayRender - offerKnown : null,
    bootstrapEndToOverlay: overlay != null && bootstrapEnd != null ? overlay - bootstrapEnd : null,
    chip: mark("chip:dom") != null,
    commitsBetween,
    warnings: warnings.length,
    seq: data.seq.map((m) => m.n).join(" "),
  });
  const r = rows[rows.length - 1];
  console.log(
    `[${LABEL} ${ANIM} run ${i}] hydration->overlay ${r1(r.hydrationToOverlay)}ms  offer->overlay ${r1(
      r.offerToOverlay,
    )}ms  offer->overlayRender ${r1(r.offerToOverlayRender)}ms  commits ${r.commitsBetween}  chip ${
      r.chip ? "PAINTED" : "none"
    }  draft-seq warnings ${r.warnings}${r.seq ? `  [${r.seq}]` : ""}`,
  );
}

await context.close();
await browser.close();

const col = (k) => rows.map((r) => r[k]).filter((v) => v != null);
console.log(`\n=== ${LABEL} (${ANIM}), ${rows.length} runs, medians ===`);
console.log(`hydration (render:start) -> overlay in DOM : ${r1(median(col("hydrationToOverlay")))}ms`);
console.log(`offer-known render       -> overlay in DOM : ${r1(median(col("offerToOverlay")))}ms`);
console.log(`offer-known render       -> overlay render : ${r1(median(col("offerToOverlayRender")))}ms`);
console.log(`bootstrap:end            -> overlay in DOM : ${r1(median(col("bootstrapEndToOverlay")))}ms`);
console.log(`commits from offer to overlay              : ${median(col("commitsBetween"))}`);
console.log(`"Resolving effects" chip painted           : ${rows.filter((r) => r.chip).length}/${rows.length} runs`);
console.log(`[draft-sequence] console warnings          : ${rows.reduce((a, r) => a + r.warnings, 0)}`);
