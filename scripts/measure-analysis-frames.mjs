// A18: what does the eval bar cost the main thread on /analysis?
//
//   node scripts/measure-analysis-frames.mjs --label after [--step 120] [--passes 4]
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
//
// READ THE STEP RATE BEFORE READING THE NUMBERS. At --step 900 (about one key
// press a second) neither the old idle ladder nor the worker drops a single
// frame, so the run says nothing. At --step 120 (an arrow key held down) the
// eval's cost is real but so is the analysis page's own per-ply render, which
// in `next dev` is 50-120ms and swamps it. The clean read of what one eval
// costs is a single ply on a quiet page — see the round-9 notes.
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
// Number of times to press the Engine toggle before recording. 1 turns the
// engine off (the page-only baseline); 2 turns it off and back on, which is the
// control for that baseline — same clicks, same focus, engine still running —
// so a difference between --clicks 1 and --clicks 2 is the engine and nothing
// else about the procedure.
const clicks = Number(arg("--clicks", "0"));
// The step delay has to be long enough for a ladder to finish, or the
// measurement is of an interrupted ladder rather than a completed one.
const stepMs = Number(arg("--step", "900"));
const passes = Number(arg("--passes", "1"));

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

for (let i = 0; i < clicks; i++) {
  await page.getByTitle("Toggle engine").click();
  await page.waitForTimeout(400);
}
// The toggle keeps focus after a click, and the page's arrow-key handler is on
// window; blur it so every run drives the line from the same focus state.
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());

// Rewind to the start of the line, settle, then start recording.
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.__perf.tasks = [];
  window.__perf.frames = [];
  window.__perf.recording = true;
});

// Walk the line one ply at a time, exactly as a reviewer does. `--passes`
// repeats the walk so a fast step rate still gives a long enough window.
//
// `readings` counts the steps where the bar actually had a score for the
// position on screen by the time the next key went down. A ladder that keeps
// the main thread free by never getting to run is not a fix, so the cost of the
// eval and the presence of the eval have to be read off the same run.
let readings = 0;
let steps = 0;
for (let pass = 0; pass < passes; pass++) {
  if (pass > 0) {
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(stepMs);
  }
  for (let i = 0; i < PLIES; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(stepMs);
    steps++;
    if (await page.evaluate(() => !!document.querySelector("[data-eval-depth]"))) readings++;
  }
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
// A second, independent reading of the same thing. The longtask entries turned
// out to vary wildly run to run on this box (the same build measured 0 and 104
// long tasks), so the frame gaps the rAF sampler recorded are reported
// alongside them: a frame that arrives 110ms after the last one is a frame the
// viewer lost, whether or not the browser filed a longtask entry for it.
const gapBlocking = perf.frames.reduce((a, f) => a + Math.max(0, f - 50), 0);
const maxGap = perf.frames.length ? Math.max(...perf.frames) : 0;

console.log(
  JSON.stringify(
    {
      label,
      engine: clicks % 2 === 1 ? "off" : "on",
      toggleClicks: clicks,
      plies: PLIES,
      passes,
      stepMs,
      steps,
      stepsWithAReading: readings,
      longTasks: perf.tasks.length,
      longestMs: Math.round(longest),
      totalBlockingMs: Math.round(tbt),
      framesOver100ms: slowFrames,
      frames: perf.frames.length,
      maxFrameGapMs: Math.round(maxGap),
      frameGapBlockingMs: Math.round(gapBlocking),
      finalDepth: perf.depth,
      finalRungCostMs: perf.cost,
      thread: perf.thread,
    },
    null,
    2,
  ),
);

await browser.close();
