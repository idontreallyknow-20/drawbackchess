// A17: does /game/[id] ever leave "Connecting…" when the spectate fallback
// throws?
//
//   node scripts/repro-a17-connecting.mjs [--id ZZZZ9] [--wait 30000]
//
// `spectate()` is called unawaited, and its catch block does more async work
// (isArenaGameLive, a second MPSession, showReplay). Anything that throws in
// there rejects a promise nobody holds, so the page's mode never leaves
// {kind:"loading"} and the viewer sits on a skeleton with no error and no exit.
//
// This drives a real browser at the running dev server and reports which
// terminal state (if any) the page reaches. `?a17=throw` activates the repro
// shim in the page's catch block; without it the run measures the ordinary
// failure path instead.
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
const gameId = arg("--id", "ZZZZ9");
const waitMs = Number(arg("--wait", "30000"));
const query = args.includes("--no-shim") ? "" : "?a17=throw";

const exe = preinstalledChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

const url = `http://localhost:3000/game/${gameId}${query}`;
console.log(`opening ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded" });

// The terminal states each render text no skeleton does. "Connecting…" (and
// "Waiting for your opponent…") are the two non-terminal ones.
const TERMINAL = [
  "Something interrupted the game", // {kind:"error"}
  "Game not found", // {kind:"missing"}
  "Back to the lobby",
];

const started = Date.now();
let settledAt = null;
let lastState = "";
while (Date.now() - started < waitMs) {
  const state = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      connecting: t.includes("Connecting…") || t.includes("Waiting for your opponent…"),
      slow: t.includes("taking longer than usual"),
      text: t.replace(/\s+/g, " ").slice(0, 260),
    };
  });
  lastState = state.text;
  if (!state.connecting) {
    settledAt = Date.now() - started;
    break;
  }
  await page.waitForTimeout(500);
}

const shot = `/tmp/a17-${query ? "shim" : "plain"}-${settledAt == null ? "hung" : "settled"}.png`;
await page.screenshot({ path: shot, fullPage: false });

console.log(`\nresult: ${settledAt == null ? `STILL CONNECTING after ${waitMs}ms` : `left the skeleton after ${settledAt}ms`}`);
console.log(`page text: ${lastState}`);
console.log(`terminal words present: ${TERMINAL.filter((w) => lastState.includes(w)).join(", ") || "(none)"}`);
console.log(`console/page errors: ${errors.length ? errors.join(" | ") : "(none)"}`);
console.log(`screenshot: ${shot}`);

await browser.close();
process.exit(settledAt == null ? 1 : 0);
