// A18: what does the eval bar cost the main thread on /analysis?
//
//   node scripts/measure-analysis-frames.mjs [--engine off] [--label after]
//
// Same instrument as the round-8 measurement this is compared against:
// a PerformanceObserver on 'longtask' plus a requestAnimationFrame sampler,
// installed before any page script runs, while a real 12-move line is arrowed
// through one ply at a time. Long tasks and frames are the thing that matters
// here — the search's own wall time is NOT the cost being measured, because a
// search on a worker thread costs the page nothing however long it takes.
//
// total blocking = the standard Total Blocking Time: the part of each long task
// beyond 50ms, summed.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

function preinstalledChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return undefined;
  const dirs = fs
    .readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const dir of dirs) {
    const exe = path.join(root, dir, "chrome-linux", "chrome");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const args = process.argv.slice(2);
const arg = (k, dflt) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const label = arg("--label", "run");
const engineOff = arg("--engine", "on") === "off";
// The step delay has to be long enough for a ladder to finish, or the
// measurement is of an interrupted ladder rather than a completed one.
const stepMs = Number(arg("--step", "900"));

// A real 12-move line (24 plies): the Italian, played into a genuine middlegame.
const LINE =
  "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4 e5d4 c3d4 c5b4 c1d2 b4d2 b1d2 d7d5 e4d5 f6d5 d1b3 c6e7 e1g1 e8g8 f1e1 c7c6";
const PLIES = LINE.split(" ").length;

const exe = preinstalledChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Installed before page scripts so the very first long task of the route is
// caught, not just the ones after hydration.
await page.addInitScript(() => {
  window.__perf = { tasks: [], frames: [], recording: false };
  new PerformanceObserver((list) => {
    if (!window.__perf.recording) return;
    for (const e of list.getEntries()) window.__perf.tasks.push(e.duration);
  }).observe({ entryTypes: ["longtask"] });
  let last = performance.now();
  const tick = (t) => {
    if (window.__perf.recording) window.__perf.frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const url = `http://localhost:3000/analysis?moves=${encodeURIComponent(LINE)}`;
await page.goto(url, { waitUntil: "load" });
await page.waitForSelector("[data-eval-mode]", { timeout: 30000 });

if (engineOff) {
  await page.getByTitle("Toggle engine").click();
  await page.waitForTimeout(400);
}

// Rewind to the start of the line, settle, then start recording.
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.__perf.tasks = [];
  window.__perf.frames = [];
  window.__perf.recording = true;
});

// Walk the line one ply at a time, exactly as a reviewer does.
for (let i = 0; i < PLIES; i++) {
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(stepMs);
}
await page.evaluate(() => {
  window.__perf.recording = false;
});

const perf = await page.evaluate(() => {
  const el = document.querySelector("[data-eval-mode]");
  return {
    tasks: window.__perf.tasks,
    frames: window.__perf.frames,
    depth: el?.getAttribute("data-eval-depth") ?? null,
    cost: el?.getAttribute("data-eval-cost") ?? null,
    thread: el?.getAttribute("data-eval-thread") ?? null,
  };
});

const tbt = perf.tasks.reduce((a, d) => a + Math.max(0, d - 50), 0);
const longest = perf.tasks.length ? Math.max(...perf.tasks) : 0;
const slowFrames = perf.frames.filter((f) => f > 100).length;

console.log(
  JSON.stringify(
    {
      label,
      engine: engineOff ? "off" : "on",
      plies: PLIES,
      longTasks: perf.tasks.length,
      longestMs: Math.round(longest),
      totalBlockingMs: Math.round(tbt),
      framesOver100ms: slowFrames,
      frames: perf.frames.length,
      finalDepth: perf.depth,
      finalRungCostMs: perf.cost,
      thread: perf.thread,
    },
    null,
    2,
  ),
);

await browser.close();
