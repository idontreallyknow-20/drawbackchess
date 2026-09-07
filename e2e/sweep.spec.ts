import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Route sweep.
//
// One test per public route. Each test loads that route across the full
// width x theme matrix and runs the checks that the design system (see
// docs/design-system.md) and the accessibility contract in section 10 make
// non-negotiable. It fixes nothing and asserts nothing at the end: the output
// is a DEFECT LIST, written to e2e/__screens__/sweep-report.json and printed
// as a summary, plus a full-page screenshot per cell so later rounds can diff.
//
// Why a sweep and not per-route specs: the failures this catches (a table that
// overflows at 360, a caption at 10px, a heading demoted to <h2> so a page has
// zero <h1>) are systemic. They come from shared components, so they repeat on
// dozens of routes and are invisible when you only ever look at one route at
// one width in one theme.
//
// Deliberately non-failing: a `expect()` per finding would stop the sweep at
// the first bad route and hide the other sixty. Findings accumulate; the last
// test in the file prints them and is the one that fails if you want a gate.
// Today it only reports, because this round is a survey.
// ---------------------------------------------------------------------------

// The matrix. Widths are the real breakpoints the app cares about: 360 is the
// small-Android floor, 390 the iPhone floor, 768 the tablet/`md` edge, 1024 the
// `lg` edge where the game rail appears, 1440 the design reference, 1920 the
// widest common desktop (where a max-width bug shows up as a stretched page).
const ALL_WIDTHS = [360, 390, 768, 1024, 1440, 1920];

// Three palettes, exactly as docs/themes.md describes them. "system" is not
// swept: applyUiPrefs resolves it to dark or light before it ever reaches the
// DOM, so it can only produce a duplicate of a cell we already have.
const ALL_THEMES = ["dark", "midnight", "light"] as const;
type Theme = (typeof ALL_THEMES)[number];

// The app persists the site theme in localStorage under this key and
// SettingsBootstrap replays it through applyUiPrefs on mount (see
// src/lib/settings.ts). Seeding the same key is the only honest way to switch
// themes: stamping html[data-theme] by hand would skip the html[data-light]
// flag and the accent custom properties that applyUiPrefs also sets, so the
// light theme would render half-applied and every finding under it would be
// fiction.
const SETTINGS_KEY = "dc:settings-v1";

const WIDTHS = envList("SWEEP_WIDTHS", ALL_WIDTHS.map(String)).map(Number);
const THEMES = envList("SWEEP_THEMES", [...ALL_THEMES]) as Theme[];

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// The routes.
//
// Enumerated from src/app/**/page.tsx. /mod/** is admin-gated and /dev/** is
// behind NEXT_PUBLIC_FX_GALLERY (it happens to open in dev, but it is not a
// public surface and its galleries are deliberately not held to the route
// contract), so neither is swept.
//
// Dynamic routes carry a REAL param wherever one exists. The codex ids come
// straight out of the card libraries, so they resolve to prerendered pages.
// The account-shaped ones (/u, /clubs, /tournaments, /inbox) need a row in the
// dev database; `npm run dev` starts with an empty one, so the sweep seeds a
// user, a club and a tournament through the public API before it starts and
// uses those. Anything still unseedable is listed in SKIPPED below with the
// reason, so the gap is on the record rather than silently missing.
// ---------------------------------------------------------------------------

type Route = {
  /** URL path to sweep, or the fallback when `resolve` finds nothing. */ url: string;
  /** Screenshot folder name and report key. */ slug: string;
  /** Why this URL and not another, when that is not obvious. */ note?: string;
  /**
   * Late-bound param. Tests are collected before the seed test runs, so a
   * route whose id is minted at seed time (a UUID) cannot be spelled at
   * collection time. Returning null means "no real param exists", and the
   * route is reported as not swept instead of being swept against a fake id.
   */
  resolve?: (request: APIRequestContext) => Promise<string | null>;
};

/** Seeded fixtures, minted by the seed test below. */
const SEED = {
  username: "sweepuser",
  clubSlug: "sweep-club",
  tournamentName: "Sweep Arena",
};

// Card ids taken from the libraries themselves (ALL_BUFFS / ALL_NERFS), one per
// family so each of the four codex detail templates gets exercised.
const CODEX_IDS = {
  buff: "pawn_push",
  hex: "heavy_boots",
  boon: "extra_glance",
  nerf: "lucky",
};

function routes(): Route[] {
  const r: Route[] = [
    { url: "/", slug: "root" },
    { url: "/about", slug: "about" },
    { url: "/achievements", slug: "achievements" },
    { url: "/analysis", slug: "analysis" },
    { url: "/clubs", slug: "clubs" },
    { url: "/codex", slug: "codex" },
    { url: "/codex/build", slug: "codex-build" },
    { url: "/codex/suggest", slug: "codex-suggest" },
    { url: "/community", slug: "community" },
    { url: "/contact", slug: "contact" },
    { url: "/faq", slug: "faq" },
    { url: "/friend", slug: "friend" },
    { url: "/game", slug: "game", note: "local bot game, no worker backend" },
    { url: "/guide", slug: "guide" },
    { url: "/guide/buff-mode", slug: "guide-buff-mode" },
    { url: "/guide/capture-the-king", slug: "guide-capture-the-king" },
    { url: "/guide/chess-roguelike", slug: "guide-chess-roguelike" },
    { url: "/guide/chess-variants", slug: "guide-chess-variants" },
    { url: "/guide/chess-with-power-ups", slug: "guide-chess-with-power-ups" },
    { url: "/guide/glossary", slug: "guide-glossary" },
    { url: "/guide/how-to-play", slug: "guide-how-to-play" },
    { url: "/guide/nerf-mode", slug: "guide-nerf-mode" },
    { url: "/guidelines", slug: "guidelines" },
    { url: "/history", slug: "history" },
    { url: "/inbox", slug: "inbox" },
    { url: "/leaderboard", slug: "leaderboard" },
    { url: "/lobby", slug: "lobby" },
    { url: "/login", slug: "login" },
    // The moderator shell. Added round 8: its content is behind auth, but the
    // SHELL renders for a guest and it is where the last of the sub-12px text
    // lives (six 11px rail labels repeated across four routes were 24 of 24
    // rendered violations per theme). A surface the sweep does not visit is a
    // surface with no ratchet under it, which is how those survived four
    // rounds of type-floor work.
    { url: "/mod", slug: "mod" },
    { url: "/mod/cards", slug: "mod-cards" },
    { url: "/mod/house", slug: "mod-house" },
    { url: "/mod/stats", slug: "mod-stats" },
    { url: "/play", slug: "play" },
    { url: "/privacy-policy", slug: "privacy-policy" },
    { url: "/profile", slug: "profile" },
    { url: "/profile/edit", slug: "profile-edit" },
    // Added round 7. Both shipped in this session and neither was swept, so
    // the newest surfaces on the site were the only ones with no regression
    // net under them. /settings/appearance is here as well as /settings
    // because the section route is a different page (its own title, canonical
    // and 404), not a scroll position on the index.
    { url: "/puzzles", slug: "puzzles" },
    { url: "/settings", slug: "settings" },
    { url: "/settings/appearance", slug: "settings-appearance" },
    { url: "/stats", slug: "stats" },
    { url: "/terms-of-service", slug: "terms-of-service" },
    { url: "/tournaments", slug: "tournaments" },
    { url: "/tutorial", slug: "tutorial" },
    { url: "/tutorial/first-game", slug: "tutorial-first-game" },
    { url: "/tutorial/walkthrough", slug: "tutorial-walkthrough" },
    { url: "/tv", slug: "tv" },
    { url: "/updates", slug: "updates" },
    // Dynamic routes with real params.
    { url: `/codex/buff/${CODEX_IDS.buff}`, slug: "codex-buff-id", note: "prerendered card id" },
    { url: `/codex/hex/${CODEX_IDS.hex}`, slug: "codex-hex-id", note: "prerendered card id" },
    { url: `/codex/boon/${CODEX_IDS.boon}`, slug: "codex-boon-id", note: "prerendered card id" },
    { url: `/codex/nerf/${CODEX_IDS.nerf}`, slug: "codex-nerf-id", note: "prerendered card id" },
    { url: `/u/${SEED.username}`, slug: "u-username", note: "seeded account" },
    { url: `/inbox/${SEED.username}`, slug: "inbox-username", note: "seeded account, viewed signed out" },
    { url: `/clubs/${SEED.clubSlug}`, slug: "clubs-slug", note: "seeded club" },
    {
      url: "/tournaments/[id]",
      slug: "tournaments-id",
      note: "seeded tournament, id looked up at run time",
      resolve: async (request) => {
        const res = await request.get("/api/tournaments", { failOnStatusCode: false });
        if (!res.ok()) return null;
        const body = (await res.json()) as { tournaments?: Array<{ id: string; name: string }> };
        const list = body.tournaments || [];
        const mine = list.find((t) => t.name === SEED.tournamentName) || list[0];
        return mine ? `/tournaments/${mine.id}` : null;
      },
    },
  ];
  return r;
}

/** Dynamic routes with no seedable param, and why. Reported, not swept. */
const SKIPPED: Array<{ url: string; why: string }> = [
  {
    url: "/game/[id]",
    why: "needs a live or archived multiplayer match. The dev box has no game server and no archived games (/api/games/recent returns an empty list), so any id would only exercise the not-found path, not the page.",
  },
  {
    url: "/history/[id]",
    why: "replays a game from THIS DEVICE's localStorage history (loadGameHistory). A fresh browser context has none, so any id renders the missing state rather than the replay.",
  },
];

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

type Severity = "high" | "medium" | "low" | "info";

type Finding = {
  route: string;
  width: number | null;
  theme: Theme | null;
  kind: string;
  severity: Severity;
  detail: string;
  selector?: string;
};

const FINDINGS: Finding[] = [];
const TIMINGS: Array<{ route: string; ms: number }> = [];

function record(f: Finding): void {
  FINDINGS.push(f);
}

// Findings are flushed to disk per route, not held until the end, and the
// report test reads the whole folder back. This box shares four cores with
// other jobs, so a full sweep can take an hour and can be killed part-way; with
// per-route files a killed run keeps everything it already measured and the
// next run only has to do the routes that are missing. It also lets the sweep
// be driven in chunks (`-g "sweep /a"`) without losing the earlier chunks.
const PARTS_DIR = path.join(process.cwd(), "e2e", "__screens__", "findings");

function flushRoute(slug: string, url: string, ms: number, findings: Finding[]): void {
  fs.mkdirSync(PARTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PARTS_DIR, `${slug}.json`),
    JSON.stringify({ slug, url, ms, findings }, null, 1),
  );
}

function loadParts(): { findings: Finding[]; timings: Array<{ route: string; ms: number }> } {
  const findings: Finding[] = [];
  const timings: Array<{ route: string; ms: number }> = [];
  if (!fs.existsSync(PARTS_DIR)) return { findings, timings };
  for (const f of fs.readdirSync(PARTS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const part = JSON.parse(fs.readFileSync(path.join(PARTS_DIR, f), "utf8")) as {
        url: string;
        ms: number;
        findings: Finding[];
      };
      findings.push(...part.findings);
      if (part.ms) timings.push({ route: part.url, ms: part.ms });
    } catch {
      // A part written by a run that was killed mid-write: skip it, the route
      // simply looks unswept and gets redone.
    }
  }
  return { findings, timings };
}

// Console noise this sandbox creates and the app cannot be blamed for. The
// Google Identity script is fetched from accounts.google.com, which the proxy
// blocks; the sign-in button on /login is the only consumer.
// Plus the multiplayer socket: gameServerUrl() in src/lib/multiplayer.ts points
// at ws://<host>:8080/socket/v1 when the site is served from the Next dev port,
// and no game server runs on this box. Every "connection refused" from that
// origin is the sandbox, not the page. This is a real blind spot and is called
// out in the report: the connected states of /lobby, /play, /tv and /game are
// NOT covered by this sweep.
const ALLOWED_NOISE = [
  "accounts.google.com",
  "gsi/client",
  "challenges.cloudflare.com",
  "arena.nerfchess.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  ":8080",
  "/socket/v1",
  "ERR_BLOCKED_BY_CLIENT",
  "ERR_NAME_NOT_RESOLVED",
  "ERR_CONNECTION_REFUSED",
  "ERR_TUNNEL_CONNECTION_FAILED",
  "ERR_PROXY_CONNECTION_FAILED",
];

function isAllowedNoise(text: string): boolean {
  return ALLOWED_NOISE.some((n) => text.includes(n));
}

// Next.js dev-only chatter that says nothing about the page under test.
// "Failed to load resource" is dropped because the console form carries no URL:
// the same event is caught by the response listener, which names the request.
const DEV_NOISE = [
  "Download the React DevTools",
  "[Fast Refresh]",
  "webpack-hmr",
  "_next/static/chunks/app-pages-internals",
  "hot-reloader",
  "Failed to load resource",
];

function isDevNoise(text: string): boolean {
  return DEV_NOISE.some((n) => text.includes(n));
}

// ---------------------------------------------------------------------------
// The in-page probe.
//
// One evaluate returns every DOM-derived finding for a cell. Batching matters:
// at 47 routes x 18 cells a chatty probe would spend more time on CDP
// roundtrips than on the page.
// ---------------------------------------------------------------------------

type Culprit = { selector: string; right: number; left: number; width: number; text: string; hasText: boolean };
type SmallText = { selector: string; px: number; text: string; tag: string; interactive: boolean; body: boolean };
type SmallTarget = { selector: string; w: number; h: number; tag: string; label: string; inlineInProse: boolean };
type IconButton = { selector: string; html: string };

type DomReport = {
  innerWidth: number;
  scrollWidth: number;
  h1Count: number;
  h1Texts: string[];
  culprits: Culprit[];
  smallText: SmallText[];
  smallTargets: SmallTarget[];
  iconButtons: IconButton[];
};

const INTERACTIVE_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
  '[role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], ' +
  '[role="menuitem"], [tabindex]:not([tabindex="-1"])';

/**
 * Widths at which the 44px rule is checked. Phones AND the tablet band: a
 * 1024px tablet is a coarse pointer with no keyboard, and it was outside the
 * old <=390 window entirely.
 */
const TOUCH_WIDTHS = new Set([360, 390, 768, 1024]);

/**
 * Measure the 44px rule the way a finger would experience it.
 *
 * This exists because the sweep was measuring the wrong thing. Playwright's
 * default context is a desktop mouse, so `pointer: fine` matches, so every
 * `[@media(pointer:fine)]:min-h-*` step-down applies, so a control CORRECTLY
 * fixed to 44px-on-touch was still counted as a defect. Measured on one tree:
 * 258 findings at 360 with a fine pointer against 81 with a coarse one. The
 * design rule is "44px on a coarse pointer", so the fine number is not a
 * weaker version of the right answer, it is an answer to a different question,
 * and `sweep-baseline.json` encoded it.
 *
 * The pointer type is fixed when the CONTEXT is created (`hasTouch`), which is
 * why this needs its own page rather than a flag flipped mid-cell. CDP's
 * `Emulation.setEmulatedMedia` looks like it should do it and does not: with
 * `{name:"pointer", value:"coarse"}` sent, `matchMedia("(pointer: coarse)")`
 * still reports false, so a sweep built on it would have gone on reporting
 * fine-pointer numbers under a coarse-pointer label. Verified both ways before
 * this was written.
 *
 * Theme is not a parameter: a hit area does not change colour. So this runs
 * once per route across the touch widths, not once per cell.
 */
async function touchTargetPass(
  browser: Browser,
  url: string,
  emit: (width: number, t: SmallTarget) => void,
) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 900 },
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1_200);
    // Widest first, same reasoning as the main sweep: a resize re-runs the
    // media queries but not a component that measured itself on mount, so the
    // risk of a stale layout is kept on the narrow end where the mobile rules
    // are the ones that own the page.
    for (const width of [...TOUCH_WIDTHS].sort((a, b) => b - a)) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      const report = await probe(page, INTERACTIVE_SELECTOR);
      for (const t of report.smallTargets) {
        if (t.inlineInProse) continue;
        emit(width, t);
      }
    }
  } finally {
    await context.close();
  }
}

async function probe(page: Page, interactiveSelector: string): Promise<DomReport> {
  return page.evaluate((SEL: string): DomReport => {
    // A short, human-readable path. Long enough to find the element in the
    // source, short enough to paste into a bug report.
    function cssPath(el: Element): string {
      const parts: string[] = [];
      let node: Element | null = el;
      for (let depth = 0; node && depth < 4; depth++) {
        let part = node.tagName.toLowerCase();
        if (node.id) {
          part += `#${node.id}`;
          parts.unshift(part);
          break;
        }
        const cls = (node.getAttribute("class") || "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join(".");
        if (cls) part += `.${cls}`;
        const dt = node.getAttribute("data-testid") || node.getAttribute("data-board-grid");
        if (dt !== null) part += `[data-testid="${dt}"]`;
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(" > ");
    }

    // The Next.js dev overlay (nextjs-portal and friends) is injected by the
    // dev server and never ships. Every one of its nodes would otherwise show
    // up as an unlabelled control with no focus ring.
    function devChrome(el: Element): boolean {
      return !!el.closest("nextjs-portal, next-route-announcer, [data-nextjs-toast], #__next-build-watcher");
    }

    function visible(el: Element): boolean {
      if (devChrome(el)) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    // Screen-reader-only text is real content but is intentionally 1px and
    // clipped, so it must never count as an overflow culprit or a tiny-text
    // violation.
    function srOnly(el: Element): boolean {
      if (el.closest(".sr-only")) return true;
      const r = el.getBoundingClientRect();
      return r.width <= 2 && r.height <= 2;
    }

    const vw = window.innerWidth;

    // --- 1. Horizontal overflow ------------------------------------------
    // The obvious test, `documentElement.scrollWidth <= innerWidth + 1`, can
    // NEVER fail on this site: globals.css opens with
    // `html, body { overflow-x: clip }`. That rule does stop phones scrolling
    // sideways, but it does not stop content being too wide. It relocates the
    // symptom: instead of a page you can scroll, you get content pushed past
    // the right edge and silently thrown away, with no scrollbar and no way to
    // reach it. So the scrollWidth number is still reported (it is the stated
    // contract, and it would matter if that rule were ever removed), and the
    // real work is the walk below, which finds boxes that stick out whether or
    // not the root lets you scroll to them.
    //
    // Anything inside an ancestor that genuinely SCROLLS (overflow-x auto or
    // scroll) is fine and skipped: docs/design-system.md explicitly allows wide
    // tables and code blocks to scroll inside their own container. `hidden` and
    // `clip` are NOT skipped, because those clip rather than scroll, and
    // clipped content is exactly the defect being hunted.
    const seen: Element[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      if (!visible(el) || srOnly(el)) return;
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 && r.left >= -1) return;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return;
      }
      seen.push(el);
    });
    // Keep only the deepest offenders: an ancestor is wide because its child
    // is, and naming the ancestor sends the reader up the wrong tree.
    const culprits: Culprit[] = seen
      .filter((el) => !seen.some((other) => other !== el && el.contains(other)))
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
      .slice(0, 6)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const text = (el.textContent || "").trim().replace(/\s+/g, " ");
        return {
          selector: cssPath(el),
          right: Math.round(r.right),
          left: Math.round(r.left),
          width: Math.round(r.width),
          text: text.slice(0, 70),
          hasText: text.length > 0,
        };
      });

    // --- 2. Exactly one <h1> ---------------------------------------------
    // Zero means the page has no name in the accessibility tree and no search
    // result title; two means the outline lies about what the page is about.
    const h1s = Array.from(document.querySelectorAll("h1"));

    // --- 3. Type floor ----------------------------------------------------
    // docs/design-system.md section 3: 13px hard floor for body and
    // interactive text, 12px allowed only for captions and labels. Anything
    // under 12 is a straight violation. We report every element below 13 with
    // its computed size so the caller can judge the 12-to-13 band.
    const smallText: SmallText[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const counted = new Set<Element>();
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const text = (node.nodeValue || "").trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || counted.has(el)) continue;
      counted.add(el);
      if (el.closest('[aria-hidden="true"]')) continue;
      if (!visible(el) || srOnly(el)) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(px) || px >= 13) continue;
      // The 12px allowance is for captions and labels only. Text inside a
      // control, and running body copy, both sit on the 13px floor, so the
      // caller needs to know which kind of text this is.
      const interactive = !!el.closest(
        'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="link"], [role="menuitem"]',
      );
      const bodyCopy = ["p", "li", "td", "dd", "blockquote"].includes(el.tagName.toLowerCase());
      smallText.push({
        selector: cssPath(el),
        px: Math.round(px * 100) / 100,
        text: text.replace(/\s+/g, " ").slice(0, 50),
        tag: el.tagName.toLowerCase(),
        interactive,
        body: bodyCopy,
      });
    }

    // --- 4. Touch targets -------------------------------------------------
    // Section 10: 44px hit areas on mobile. Inline links inside running prose
    // are the sanctioned exception (you cannot make a word in a sentence
    // 44px tall), so they are flagged separately rather than counted.
    const smallTargets: SmallTarget[] = [];
    document.querySelectorAll(SEL).forEach((el) => {
      if (!visible(el) || srOnly(el)) return;
      if ((el as HTMLButtonElement).disabled) return;
      if (getComputedStyle(el).pointerEvents === "none") return;
      // A chessboard square is not a touch target in this sense. Its size is
      // set by the board, which is sized to the viewport: at 360 the board is
      // 336px wide, so a 44px square is arithmetically impossible and demanding
      // one would be demanding a board that does not fit the screen. The board
      // is one target the size of the board.
      //
      // This bites unevenly and that is worth knowing: `Board.tsx` renders its
      // squares as divs with a gridcell role and only ONE roving tab stop, so
      // the selector caught one of its 64; `PuzzleBoard.tsx` renders real
      // buttons, so it caught all 64. Same design, two very different numbers,
      // for a reason that has nothing to do with either board's hit areas.
      if (el.closest('[role="grid"]')) return;
      // A drag gutter is not a tap target. `role="separator"` with a pointer
      // handler is a resize affordance for a mouse (the rail handle is
      // `touch-none` and `lg:block`, i.e. it does not exist on a phone), and a
      // 44px gutter would be a 44px stripe of dead space between two panels.
      if (el.getAttribute("role") === "separator") return;
      const box = el.getBoundingClientRect();
      // A control can carry its hit area on an absolutely-positioned pseudo
      // element that reaches outside its own box, which is the standard way to
      // give a small switch a thumb-sized target without making the switch
      // itself bigger. `.settings-toggle::before { inset: -10px -2px }` is
      // exactly this, and measuring the element alone reported all 27 of them
      // on /settings as defects.
      //
      // Only counted when the element is POSITIONED, because otherwise the
      // pseudo's containing block is some ancestor and its insets say nothing
      // about where it sits relative to this box. Only negative insets expand:
      // a pseudo pulled inwards is decoration, not a target.
      const r = (() => {
        const own = getComputedStyle(el);
        if (own.position === "static") return box;
        let { top, left, right, bottom } = box;
        // An absolutely-positioned CHILD that reaches outside the box does the
        // same job and is the more common spelling of it: `RailResizeHandle`
        // is a 3.5px div containing `<span class="absolute inset-y-0 -left-1.5
        // -right-1.5">`, whose whole purpose is to be the hit area. A child's
        // events bubble to this element, so its box is part of this target.
        // Only children of the control itself, never an ancestor's overlay.
        for (const kid of Array.from(el.children)) {
          const ks = getComputedStyle(kid);
          if (ks.position !== "absolute" || ks.pointerEvents === "none") continue;
          if (ks.display === "none" || ks.visibility === "hidden") continue;
          const kr = kid.getBoundingClientRect();
          if (!kr.width || !kr.height) continue;
          top = Math.min(top, kr.top);
          left = Math.min(left, kr.left);
          right = Math.max(right, kr.right);
          bottom = Math.max(bottom, kr.bottom);
        }
        for (const pseudo of ["::before", "::after"]) {
          const ps = getComputedStyle(el, pseudo);
          if (!ps || ps.content === "none" || ps.position !== "absolute") continue;
          if (ps.display === "none" || ps.pointerEvents === "none") continue;
          const n = (v: string) => {
            const x = parseFloat(v);
            return Number.isFinite(x) ? x : 0;
          };
          top = Math.min(top, box.top + n(ps.top));
          left = Math.min(left, box.left + n(ps.left));
          right = Math.max(right, box.right - n(ps.right));
          bottom = Math.max(bottom, box.bottom - n(ps.bottom));
        }
        return { top, left, right, bottom, width: right - left, height: bottom - top } as DOMRect;
      })();
      // Half a pixel of slack: a control laid out at 43.7px is a rounding
      // artefact of the layout, not a design that missed the target.
      if (r.width >= 43.5 && r.height >= 43.5) return;
      const cs = getComputedStyle(el);
      // An inline control sitting inside running prose is exempt: the design
      // system's own glossary terms are exactly this, and giving one a 44px
      // box would push the line it lives in apart. Deliberately NOT limited to
      // <a>: GlossaryText renders a focusable <span>, and an earlier version
      // of this check tested `tagName === "A"` and so reported 241 of them as
      // defects across the guide and codex pages. They were the single largest
      // cluster in the whole sweep and none of them was real.
      // "Inside running prose" is a property of the TEXT AROUND the control,
      // not of its ancestor's tag name, and testing the tag name has now been
      // too narrow twice. First it was `tagName === "A"`, which reported 241
      // GlossaryText spans as defects. Then it was this closest() list, which
      // missed "New here? [Take the tour]: a guided first game" on /play,
      // because that sentence lives in a <span> inside a role="note" rather
      // than in a <p>. So test the thing itself: does the control sit among
      // real text in its own parent? Whitespace between two nav links does not
      // count, which is why the text nodes are trimmed.
      const inlineParent = el.parentElement;
      const amongText = inlineParent
        ? Array.prototype.some.call(
            inlineParent.childNodes,
            (n: ChildNode) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0,
          )
        : false;
      const inlineInProse =
        cs.display.startsWith("inline") &&
        (amongText || !!el.closest("p, li, blockquote, dd, figcaption"));

      // A control that FILLS a row which is itself a 44px target is not a
      // small target: the row is the target, and every pixel of it triggers
      // the control. The codex list is built this way on purpose (a 44px row
      // whose link stretches to the row's content box), and reporting the
      // link's own 42px box counted a correct pattern as 120 defects.
      //
      // "Fills it" is measured, not assumed: the parent must reach 44px, and
      // the gap between them must be only the parent's own border and padding.
      // A link floating inside a tall row with real dead space around it is
      // still a defect and still reported.
      const parent = el.parentElement;
      let filledByRow = false;
      if (parent) {
        const pr = parent.getBoundingClientRect();
        const ps = getComputedStyle(parent);
        const chrome =
          parseFloat(ps.borderTopWidth) +
          parseFloat(ps.borderBottomWidth) +
          parseFloat(ps.paddingTop) +
          parseFloat(ps.paddingBottom);
        const dead = pr.height - chrome - r.height;
        filledByRow = pr.height >= 43.5 && dead <= 0.5 && r.width >= 43.5;
      }
      if (filledByRow) return;
      smallTargets.push({
        selector: cssPath(el),
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        tag: el.tagName.toLowerCase(),
        label:
          (el.getAttribute("aria-label") || (el.textContent || "").trim())
            .replace(/\s+/g, " ")
            .slice(0, 40),
        inlineInProse,
      });
    });

    // --- 5. Icon-only buttons need a name ---------------------------------
    // Section 10 again. A button whose whole content is an <svg> is invisible
    // to a screen reader without aria-label, aria-labelledby, title, or
    // .sr-only text.
    const iconButtons: IconButton[] = [];
    document.querySelectorAll('button, [role="button"], a[href]').forEach((el) => {
      if (!visible(el) || srOnly(el) || devChrome(el)) return;
      const hasGlyph = !!el.querySelector("svg, img");
      if (!hasGlyph) return;
      const own = (el.textContent || "").trim();
      const labelled =
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (el.getAttribute("aria-labelledby")
          ? (document.getElementById(el.getAttribute("aria-labelledby") as string)?.textContent || "")
          : "") ||
        (el.querySelector("img")?.getAttribute("alt") || "");
      if (own.length > 0 || (labelled || "").trim().length > 0) return;
      iconButtons.push({
        selector: cssPath(el),
        html: el.outerHTML.replace(/\s+/g, " ").slice(0, 130),
      });
    });

    return {
      innerWidth: vw,
      scrollWidth: document.documentElement.scrollWidth,
      h1Count: h1s.length,
      h1Texts: h1s.map((h) => (h.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60)),
      culprits,
      smallText,
      smallTargets,
      iconButtons,
    };
  }, interactiveSelector);
}

// ---------------------------------------------------------------------------
// Focus audit.
//
// Section 10 wants a visible focus ring on everything interactive. Programmatic
// .focus() does not reliably match :focus-visible in Chromium, so this drives
// the real keyboard: Tab, then for the newly focused element read its computed
// style, move focus to <body>, read the same style again, and put focus back.
// Two reads of the same element one frame apart, so a difference means the
// focus state is actually painted and no difference means it is not.
// ---------------------------------------------------------------------------

type FocusStep = { selector: string; label: string; tag: string; changed: boolean; focused: string; blurred: string } | null;

async function focusAudit(page: Page, maxStops: number): Promise<Array<NonNullable<FocusStep>>> {
  // Park focus on <body> so Tab starts at the first tabbable element rather
  // than wherever the page put it.
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    (document.body as HTMLElement).focus();
  });

  const stops: Array<NonNullable<FocusStep>> = [];
  const seen = new Set<string>();
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press("Tab");
    const step: FocusStep = await page.evaluate((): FocusStep => {
      function cssPath(el: Element): string {
        const parts: string[] = [];
        let node: Element | null = el;
        for (let depth = 0; node && depth < 4; depth++) {
          let part = node.tagName.toLowerCase();
          if (node.id) {
            parts.unshift(`${part}#${node.id}`);
            break;
          }
          const cls = (node.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
          if (cls) part += `.${cls}`;
          parts.unshift(part);
          node = node.parentElement;
        }
        return parts.join(" > ");
      }
      // The properties a focus ring can plausibly live in. Backgrounds and
      // borders count: a filled or outlined-by-border treatment is still
      // visible, even if the design system asks for an outline.
      function sig(el: Element): string {
        const cs = getComputedStyle(el);
        return [
          cs.outlineStyle,
          cs.outlineWidth,
          cs.outlineColor,
          cs.outlineOffset,
          cs.boxShadow,
          cs.borderColor,
          cs.borderWidth,
          cs.backgroundColor,
          cs.color,
          cs.textDecorationLine,
          cs.filter,
        ].join(" | ");
      }
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      // The Next.js dev overlay injects its own focusable root; it is not part
      // of the product and must not be judged by the product's rules.
      if (el.closest("nextjs-portal, next-route-announcer, [data-nextjs-toast]")) {
        return { selector: "nextjs-portal", label: "", tag: "dev-overlay", changed: true, focused: "", blurred: "" };
      }
      const focused = sig(el);
      // Some designs paint the ring on a child (an inner span or the svg), so
      // fold the first two element children into the signature too.
      const kids = Array.from(el.children).slice(0, 2).map(sig).join(" || ");
      (document.body as HTMLElement).focus();
      const blurred = sig(el);
      const blurredKids = Array.from(el.children).slice(0, 2).map(sig).join(" || ");
      (el as HTMLElement).focus();
      return {
        selector: cssPath(el),
        label: (el.getAttribute("aria-label") || (el.textContent || "").trim()).replace(/\s+/g, " ").slice(0, 40),
        tag: el.tagName.toLowerCase(),
        changed: focused !== blurred || kids !== blurredKids,
        focused,
        blurred,
      };
    });
    if (!step) break;
    // Tab wrapped back into the browser chrome or looped: stop.
    const key = `${step.selector}::${step.label}`;
    if (seen.has(key)) break;
    seen.add(key);
    stops.push(step);
  }
  // Leave the page as it was found: no stray tabindex, nothing still focused.
  // The width loop keeps probing this same navigation, and an element left in
  // its focus state would show up as a colour change in later cells.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.removeAttribute("tabindex");
  });
  return stops;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const SCREENS_DIR = path.join(process.cwd(), "e2e", "__screens__");

// The ratchet's baseline. Checked in, and the only file in this harness that
// is: everything else under __screens__ is output. Shrink-only, so it records
// what today's tree produces and fails when tomorrow's produces more.
const BASELINE_FILE = path.join(__dirname, "sweep-baseline.json");

/**
 * Mint the rows the account-shaped dynamic routes need. `npm run dev` starts
 * against an empty database, so without this /u/[username], /clubs/[slug] and
 * /tournaments/[id] could only ever be swept in their not-found state, which
 * would tell us nothing about the pages themselves.
 *
 * Everything goes through the public API, so this cannot drift from what a real
 * signup produces. Re-running is safe: a duplicate username just fails and the
 * existing row is used.
 */
test("seed: fixtures for the dynamic routes", async ({ request }) => {
  fs.mkdirSync(SCREENS_DIR, { recursive: true });

  const password = "sweep-pass-1234";
  let cookie = "";
  const register = await request.post("/api/auth/register", {
    data: { username: SEED.username, password },
    failOnStatusCode: false,
  });
  if (register.ok()) {
    cookie = (register.headers()["set-cookie"] || "").split(";")[0];
  } else {
    const login = await request.post("/api/auth/login", {
      data: { username: SEED.username, password },
      failOnStatusCode: false,
    });
    if (login.ok()) cookie = (login.headers()["set-cookie"] || "").split(";")[0];
  }

  const profile = await request.get(`/api/users/${SEED.username}`, { failOnStatusCode: false });
  if (!profile.ok()) {
    record({
      route: `/u/${SEED.username}`,
      width: null,
      theme: null,
      kind: "seed",
      severity: "info",
      detail: `could not seed an account (POST /api/auth/register and /api/auth/login both failed); the profile route will be swept in its not-found state`,
    });
  }

  if (cookie) {
    const headers = { cookie };
    const clubs = await request.get("/api/clubs", { failOnStatusCode: false });
    const existing = clubs.ok() ? ((await clubs.json()) as { clubs?: Array<{ slug: string }> }).clubs || [] : [];
    const seeded = existing.find((c) => c.slug === SEED.clubSlug);
    if (!seeded) {
      await request.post("/api/clubs", {
        headers,
        data: { name: "Sweep Club", description: "Seed club for the route sweep." },
        failOnStatusCode: false,
      });
    }

    const tours = await request.get("/api/tournaments", { failOnStatusCode: false });
    const tourList = tours.ok()
      ? ((await tours.json()) as { tournaments?: Array<{ id: string; name: string }> }).tournaments || []
      : [];
    if (!tourList.some((t) => t.name === SEED.tournamentName)) {
      await request.post("/api/tournaments", {
        headers,
        data: {
          name: SEED.tournamentName,
          description: "Seed tournament for the route sweep.",
          format: "arena",
          mode: "nerf",
          clockTimeSec: 180,
          clockIncrementSec: 2,
          durationMin: 60,
        },
        failOnStatusCode: false,
      });
    }
  }

  for (const s of SKIPPED) {
    record({
      route: s.url,
      width: null,
      theme: null,
      kind: "not-swept",
      severity: "info",
      detail: s.why,
    });
  }
});

// ---------------------------------------------------------------------------
// The sweep itself
// ---------------------------------------------------------------------------

for (const route of routes()) {
  test(`sweep ${route.url}`, async ({ page, request, browser }, testInfo) => {
    // 18 full page loads per route on a four-core box with three niced
    // simulations running, against a dev server that compiles each route on
    // first hit. The default 150s cap is for the game test, not for this.
    testInfo.setTimeout(15 * 60 * 1000);
    const started = Date.now();

    // Resume: a route already on disk is not redone. SWEEP_FORCE=1 re-sweeps
    // everything, which is what you want after a UI change.
    const partFile = path.join(PARTS_DIR, `${route.slug}.json`);
    if (process.env.SWEEP_FORCE !== "1" && fs.existsSync(partFile)) {
      test.skip(true, `already swept, see ${path.relative(process.cwd(), partFile)}`);
      return;
    }
    // Only this route's findings go into its part file, so take a mark and
    // slice from it at the end.
    const mark = FINDINGS.length;

    // Late-bound params (see Route.resolve) settle here, once the seed test has
    // run and the row exists.
    let url = route.url;
    if (route.resolve) {
      const resolved = await route.resolve(request);
      if (!resolved) {
        record({
          route: route.url,
          width: null,
          theme: null,
          kind: "not-swept",
          severity: "info",
          detail: "no row exists for this dynamic route and seeding it failed, so there is no real param to sweep",
        });
        test.skip();
        return;
      }
      url = resolved;
    }

    const shotDir = path.join(SCREENS_DIR, route.slug);
    fs.mkdirSync(shotDir, { recursive: true });

    // Per-navigation collectors, cleared before each goto so a finding is
    // always attributable to one cell.
    let consoleErrors: string[] = [];
    let pageErrors: string[] = [];
    let badResponses: string[] = [];
    let failedRequests: string[] = [];
    let navFailures = 0;

    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (isAllowedNoise(text) || isDevNoise(text)) return;
      consoleErrors.push(text.slice(0, 240));
    });
    page.on("pageerror", (err) => {
      const text = `${err.name}: ${err.message}`;
      if (isAllowedNoise(text)) return;
      pageErrors.push(text.slice(0, 240));
    });
    page.on("response", (res) => {
      const status = res.status();
      if (status < 400) return;
      const url = res.url();
      if (isAllowedNoise(url)) return;
      // Cache-buster query strings differ on every load, which would make the
      // same broken endpoint look like a hundred separate findings.
      const [path_, query] = url.replace("http://localhost:3000", "").split("?");
      badResponses.push(`${status} ${path_}${query ? "?..." : ""}`);
    });
    page.on("requestfailed", (req) => {
      const url = req.url();
      const failure = req.failure()?.errorText || "";
      if (isAllowedNoise(url) || isAllowedNoise(failure)) return;
      // The dev server tears down HMR and RSC streams on navigation; an
      // aborted request is the navigation, not a defect.
      if (failure.includes("ERR_ABORTED") || failure.includes("net::ERR_ABORTED")) return;
      failedRequests.push(`${failure} ${url.replace("http://localhost:3000", "")}`);
    });

    // Establish the origin once so localStorage is writable, then warm the
    // route. The dev server compiles a route the first time it is asked for
    // and that first hit can take the best part of a minute here; warming it
    // outside the matrix keeps a compile from being mistaken for a slow page.
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(500);

    // A route that redirects (e.g. /codex/build, kept alive only so old links
    // land on /codex/suggest) is not a surface of its own: sweeping it would
    // just duplicate its target's findings under a second name, and the
    // in-flight navigation tears down the execution context under every
    // evaluate. Record where it goes and leave it to the target's own test.
    // Read the landing URL twice, a beat apart. A `redirect()` in a server
    // component does not always arrive as an HTTP 307 under `next dev`: the
    // router can deliver the page and then push to the target, so the first
    // read still says /codex/build and the redirect lands mid-evaluate.
    let landed = new URL(page.url()).pathname;
    await page.waitForTimeout(1_200);
    landed = new URL(page.url()).pathname;
    if (landed !== url) {
      record({
        route: url,
        width: null,
        theme: null,
        kind: "redirect",
        severity: "info",
        detail: `redirects to ${landed}; not swept separately, the findings for this surface are under ${landed}`,
      });
      flushRoute(route.slug, url, Date.now() - started, FINDINGS.slice(mark));
      return;
    }

    // Widest first. One navigation per THEME, then the widths are walked by
    // resizing the viewport instead of reloading.
    //
    // Why: a full reload per cell is 18 navigations per route, and on this box
    // (four cores shared with other jobs, a dev server that recompiles) a
    // navigation costs one to two orders of magnitude more than a resize. Three
    // navigations per route instead of eighteen is what makes the full matrix
    // affordable at all. The layout follows, because the responsive work here
    // is CSS media queries plus matchMedia listeners, both of which react to a
    // resize. What a resize does NOT redo is a component that measured itself
    // once on mount, so a defect that only appears when a page is LOADED at
    // 360 could be missed. Widest-to-narrowest ordering keeps that risk on the
    // mobile end, where the narrow layout is the one the media queries own.
    const orderedWidths = [...WIDTHS].sort((a, b) => b - a);

    for (const theme of THEMES) {
      // Write the theme the way the app writes it, then reload so
      // SettingsBootstrap replays it through applyUiPrefs.
      await page.evaluate(
        ([key, value]) => {
          try {
            window.localStorage.setItem(key, JSON.stringify({ siteTheme: value }));
          } catch {
            // Private mode or blocked storage: the cell still renders, just in
            // the default theme, and the theme assertion below will say so.
          }
        },
        [SETTINGS_KEY, theme] as const,
      );

      consoleErrors = [];
      pageErrors = [];
      badResponses = [];
      failedRequests = [];

      // Load at the widest width so the desktop chrome mounts first.
      await page.setViewportSize({ width: orderedWidths[0], height: 900 });
      let navOk = true;
      try {
        await page.goto(url, { waitUntil: "load", timeout: 150_000 });
      } catch (err) {
        navOk = false;
        navFailures++;
        record({
          route: url,
          width: null,
          theme,
          kind: "navigation",
          severity: "high",
          detail: `navigation failed or timed out: ${(err as Error).message.split("\n")[0].slice(0, 160)}`,
        });
      }
      // A dead navigation on every theme is the dev server falling over, not
      // the route being broken. Throw rather than write a part file full of
      // fictional defects: a thrown route is simply re-swept next run, and a
      // quietly "swept" route with nothing measured in it would read as a
      // clean route and quietly shrink the backlog.
      if (navFailures >= Math.min(3, THEMES.length)) {
        // Drop everything this route recorded, including the navigation
        // failures themselves. A dead or OOM-killed dev server is not a defect
        // in the page, and a "0 h1, no focus ring, 12 overflows" report taken
        // from a blank error page is worse than no report: it reads like real
        // work. The route is left unmeasured, which the summary states plainly.
        FINDINGS.length = mark;
        throw new Error(`${url}: ${navFailures} navigations failed. Infrastructure, not a defect: check that the dev server is up. Route left unmeasured.`);
      }
      if (!navOk) continue;

      // Let the client hydrate, apply the theme, and settle its first data
      // fetch. Short and fixed on purpose: a networkidle wait never resolves
      // on the routes that hold a socket open (/tv, /lobby, /game).
      await page.waitForTimeout(700);

      // The theme must actually be on the document, or every colour-adjacent
      // finding under it would be about the wrong palette.
      const applied = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme || "",
        light: document.documentElement.dataset.light || "",
      }));
      if (applied.theme !== theme) {
        record({
          route: url,
          width: null,
          theme,
          kind: "theme",
          severity: "medium",
          detail: `html[data-theme] is "${applied.theme}", expected "${theme}"; applyUiPrefs did not adopt the stored setting`,
        });
      }
      if (theme === "light" && applied.light !== "on") {
        record({
          route: url,
          width: null,
          theme,
          kind: "theme",
          severity: "medium",
          detail: `light theme is active but html[data-light] is not set, so the paper treatments in globals.css never apply`,
        });
      }

      for (const width of orderedWidths) {
        const cell = { route: url, width, theme };
        if (width !== orderedWidths[0]) {
          await page.setViewportSize({ width, height: 900 });
          // One frame for the media queries and matchMedia listeners to land,
          // plus a beat for any re-render they trigger.
          await page.waitForTimeout(350);
        }

        const report = await probe(page, INTERACTIVE_SELECTOR);

        // 1. Horizontal overflow, in both of its forms.
        //
        // The stated contract first: the document must not scroll sideways.
        // On this codebase it structurally cannot (see the probe), so this
        // firing at all would mean the root clip rule was removed.
        if (report.scrollWidth > report.innerWidth + 1) {
          const over = report.scrollWidth - report.innerWidth;
          record({
            ...cell,
            kind: "overflow-scroll",
            severity: "high",
            detail: `document scrolls ${over}px past the viewport (scrollWidth ${report.scrollWidth} vs innerWidth ${report.innerWidth})`,
          });
        }
        // The form this codebase can actually produce: a box that sticks out
        // past the right edge and is thrown away by html,body{overflow-x:clip}.
        // With text in it that is lost content; without, it is a stray decoration.
        for (const c of report.culprits) {
          record({
            ...cell,
            kind: "overflow-clipped",
            severity: c.hasText ? "high" : "medium",
            selector: c.selector,
            detail: `element is ${c.width}px wide and spans x=${c.left}..${c.right} against a ${report.innerWidth}px viewport, so ${c.right - report.innerWidth}px of it is clipped away and unreachable (no sideways scroll: html,body{overflow-x:clip}). ${c.hasText ? `Clipped text: "${c.text}"` : "No text content."}`,
          });
        }

        // 2. Exactly one <h1>.
        if (report.h1Count !== 1) {
          record({
            ...cell,
            kind: "h1",
            severity: report.h1Count === 0 ? "high" : "medium",
            detail:
              report.h1Count === 0
                ? "no <h1> on the page: it has no accessible name and no document outline"
                : `${report.h1Count} <h1> elements: ${report.h1Texts.map((t) => `"${t}"`).join(", ")}`,
          });
        }

        // 4. Type floor. Under 12px is a straight violation whatever the text
        // is. Between 12 and 13 it depends on the kind of text: a caption or a
        // chip may sit at 12, but a control label or a paragraph of body copy
        // is on the 13px floor and this is a defect.
        for (const t of report.smallText) {
          const onBodyFloor = t.interactive || t.body;
          record({
            ...cell,
            kind: t.px < 12 ? "type-floor" : onBodyFloor ? "type-floor-13" : "type-floor-12",
            severity: t.px < 12 ? "high" : onBodyFloor ? "medium" : "low",
            selector: t.selector,
            detail:
              t.px < 12
                ? `<${t.tag}> renders at ${t.px}px, under the 12px absolute floor. Text: "${t.text}"`
                : onBodyFloor
                  ? `${t.interactive ? "interactive" : "body"} text in <${t.tag}> renders at ${t.px}px; the 13px floor applies (12px is captions and labels only). Text: "${t.text}"`
                  : `<${t.tag}> renders at ${t.px}px, inside the 12px caption allowance. Only a defect if this is body or interactive text. Text: "${t.text}"`,
          });
        }

        // 6. Touch targets run once per route, on a real coarse pointer.
        //    See touchTargetPass, below the theme loop.

        // 5a. Icon-only buttons without a name. The DOM differs between the
        // mobile and desktop chrome, so check at one narrow and one wide cell
        // rather than on every one.
        if (theme === "dark" && (width === 360 || width === 1440)) {
          for (const b of report.iconButtons) {
            record({
              ...cell,
              kind: "aria-label",
              severity: "medium",
              selector: b.selector,
              detail: `icon-only control with no accessible name: ${b.html}`,
            });
          }

          // 5b. Focus visibility. Same reasoning: the tab order differs
          // between the two chromes, and walking it is the slowest check here.
          const stops = await focusAudit(page, 45);
          if (stops.length === 0) {
            record({
              ...cell,
              kind: "focus",
              severity: "medium",
              detail: "Tab reached no focusable element on the page",
            });
          }
          for (const s of stops) {
            if (s.changed) continue;
            record({
              ...cell,
              kind: "focus",
              severity: "medium",
              selector: s.selector,
              detail: `<${s.tag}> "${s.label}" paints nothing on keyboard focus (outline, shadow, border, background and colour are all identical focused and blurred)`,
            });
          }
        }

        // Screenshot last, after every probe, so the image matches the DOM the
        // findings were taken from.
        await page
          .screenshot({ path: path.join(shotDir, `${width}-${theme}.png`), fullPage: true, animations: "disabled" })
          .catch((err: Error) => {
            record({
              ...cell,
              kind: "screenshot",
              severity: "low",
              detail: `screenshot failed: ${err.message.split("\n")[0].slice(0, 120)}`,
            });
          });
      }

      // 3 and 7. Console errors, page errors and bad responses belong to the
      // NAVIGATION, not to any one width: there is one load per theme and the
      // resizes below it can only add to the same stream. Recording them here,
      // once, keeps a single broken fetch from being reported six times.
      const themeCell = { route: url, width: null, theme };
      for (const e of new Set(pageErrors)) {
        record({ ...themeCell, kind: "pageerror", severity: "high", detail: e });
      }
      for (const e of new Set(consoleErrors)) {
        record({ ...themeCell, kind: "console", severity: "high", detail: e });
      }
      // A 401 or 403 is usually the signed-out answer and is called out as
      // such rather than dressed up as a bug; a 404 means the page is asking
      // for an endpoint that does not exist, and a 5xx is always a defect.
      for (const r of new Set(badResponses)) {
        const status = r.slice(0, 3);
        const authish = status === "401" || status === "403";
        record({
          ...themeCell,
          kind: authish ? "http-auth" : "http",
          severity: status.startsWith("5") ? "high" : authish ? "low" : "medium",
          detail: authish
            ? `request returned ${r} while signed out; a defect only if the page asks for it unconditionally`
            : `request returned ${r}`,
        });
      }
      for (const r of new Set(failedRequests)) {
        record({ ...themeCell, kind: "request-failed", severity: "medium", detail: r });
      }
    }

    await touchTargetPass(browser, url, (width, t) => {
      record({
        route: url,
        width,
        theme: null,
        kind: "touch-target",
        severity: t.w < 32 || t.h < 32 ? "high" : "medium",
        selector: t.selector,
        detail: `<${t.tag}> hit area is ${t.w}x${t.h} on a COARSE pointer, below the 44x44 minimum. Label: "${t.label}"`,
      });
    });

    const elapsed = Date.now() - started;
    TIMINGS.push({ route: url, ms: elapsed });
    flushRoute(route.slug, url, elapsed, FINDINGS.slice(mark));
  });
}

// ---------------------------------------------------------------------------
// Static state audit.
//
// docs/design-system.md section 8 asks every async surface for five states:
// loading, empty, error, disconnected, recovered. Three of those are only
// visible when the backend misbehaves, which a sweep cannot arrange, so this
// reads the source instead: which route has a loading.tsx (its own or an
// inherited one), which imports EmptyState, which has an error branch, and
// which mounts ConnectionBanner. It is a work list, not a verdict.
// ---------------------------------------------------------------------------

type StateRow = {
  route: string;
  fetches: boolean;
  loadingAt: string | null;
  errorAt: string | null;
  skeleton: boolean;
  emptyState: boolean;
  inlineEmpty: boolean;
  errorUi: boolean;
  connection: boolean;
};

test("audit: which routes implement which system states", async () => {
  const appDir = path.join(process.cwd(), "src", "app");
  const srcDir = path.join(process.cwd(), "src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  }

  const srcFiles = walk(srcDir).filter((f) => /\.tsx?$/.test(f));
  const byAlias = new Map<string, string>();
  for (const f of srcFiles) {
    byAlias.set(f.replace(`${srcDir}/`, "@/").replace(/\.tsx?$/, ""), f);
  }
  // Chrome every page pulls in. Counting its internals would credit each page
  // with states that live in the header, not in the page.
  const CHROME = /\/(SiteHeader|SiteFooter|Footer|Logo|ui\/Button|PlayerLink|PlayerAvatar|SocialsRow|ModeBadge)\.tsx$/;

  function importsOf(file: string): string[] {
    const src = fs.readFileSync(file, "utf8");
    const out: string[] = [];
    for (const m of src.matchAll(/from\s+"(@\/[^"]+)"/g)) {
      const t = byAlias.get(m[1]);
      if (t && !CHROME.test(t)) out.push(t);
    }
    for (const m of src.matchAll(/import\("(@\/[^"]+)"\)/g)) {
      const t = byAlias.get(m[1]);
      if (t && !CHROME.test(t)) out.push(t);
    }
    return out;
  }

  const rows: StateRow[] = [];
  const pages = srcFiles.filter((f) => f.startsWith(appDir) && f.endsWith("/page.tsx")).sort();
  for (const p of pages) {
    const dir = path.dirname(p);
    const rel = path.relative(appDir, dir);
    const route = rel === "" ? "/" : `/${rel}`;
    if (route.startsWith("/mod") || route.startsWith("/dev")) continue;

    let loadingAt: string | null = null;
    let errorAt: string | null = null;
    for (let d = dir; ; d = path.dirname(d)) {
      if (loadingAt === null && fs.existsSync(path.join(d, "loading.tsx"))) {
        loadingAt = `/${path.relative(appDir, d)}`;
      }
      if (errorAt === null && fs.existsSync(path.join(d, "error.tsx"))) {
        errorAt = `/${path.relative(appDir, d)}`;
      }
      if (d === appDir) break;
    }

    const own = new Set<string>([p, ...walk(dir).filter((f) => /\.tsx?$/.test(f))]);
    for (const t of importsOf(p)) {
      own.add(t);
      for (const t2 of importsOf(t)) own.add(t2);
    }
    const blob = [...own]
      .map((f) => {
        try {
          return fs.readFileSync(f, "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");

    rows.push({
      route,
      fetches: /\bfetch\(|fetchMe\(|loadGameHistory/.test(blob),
      loadingAt,
      errorAt,
      skeleton: /skeleton|Skeleton|animate-pulse/.test(blob),
      emptyState: /\bEmptyState\b/.test(blob),
      inlineEmpty: /(No [a-z].{0,40}(yet|found|here)|Nothing (here|yet)|is empty|no results)/i.test(blob),
      errorUi: /(Try again|Retry|Something went wrong|Couldn't load|Could not load|failed to load)/i.test(blob),
      connection: /ConnectionBanner/.test(blob),
    });
  }

  for (const r of rows) {
    if (!r.fetches) continue; // A static reading page owes none of the five.
    if (!r.loadingAt && !r.skeleton) {
      record({
        route: r.route,
        width: null,
        theme: null,
        kind: "state-loading",
        severity: "medium",
        detail: "async surface with no loading.tsx and no skeleton",
      });
    }
    if (!r.emptyState && !r.inlineEmpty) {
      record({
        route: r.route,
        width: null,
        theme: null,
        kind: "state-empty",
        severity: "medium",
        detail: "async surface with no EmptyState and no inline empty copy",
      });
    }
    if (!r.errorUi) {
      record({
        route: r.route,
        width: null,
        theme: null,
        kind: "state-error",
        severity: "medium",
        detail: `no in-page error branch; the only boundary is ${r.errorAt || "none"}`,
      });
    }
    if (!r.connection) {
      record({
        route: r.route,
        width: null,
        theme: null,
        kind: "state-disconnected",
        severity: "low",
        detail: "no ConnectionBanner, so no disconnected or recovered state",
      });
    }
  }

  fs.mkdirSync(SCREENS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SCREENS_DIR, "state-audit.json"), JSON.stringify(rows, null, 1));
});

// ---------------------------------------------------------------------------
// Report. Runs last because Playwright runs tests in file order with one
// worker, and it is the only place the whole picture exists.
// ---------------------------------------------------------------------------

type Defect = {
  route: string;
  kind: string;
  severity: Severity;
  selector?: string;
  detail: string;
  /** Every matrix cell that reproduced it, as "width/theme". */ cells: string[];
};

test("report: write the defect list", async () => {
  fs.mkdirSync(SCREENS_DIR, { recursive: true });

  // Collapse the matrix. A 12px label is 12px in all three themes and at all
  // six widths, so the raw list repeats the same defect eighteen times and
  // buries the ones that only happen at 360. One row per distinct defect, with
  // the cells it reproduced in, is the readable form and still says exactly
  // where it shows up.
  // In-memory findings are this run's; the part files carry every route ever
  // swept, including the ones this run skipped as already done. Merging both
  // and deduping is what makes a chunked or resumed sweep produce one whole
  // report rather than a slice.
  const parts = loadParts();
  const all = [...parts.findings, ...FINDINGS];
  const grouped = new Map<string, Defect>();
  for (const f of all) {
    const key = `${f.route}\0${f.kind}\0${f.selector || ""}\0${f.detail}`;
    const cell =
      f.width === null ? (f.theme ? `load/${f.theme}` : "static") : `${f.width}/${f.theme}`;
    const hit = grouped.get(key);
    if (hit) {
      if (!hit.cells.includes(cell)) hit.cells.push(cell);
      continue;
    }
    grouped.set(key, {
      route: f.route,
      kind: f.kind,
      severity: f.severity,
      selector: f.selector,
      detail: f.detail,
      cells: [cell],
    });
  }
  const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  const defects = [...grouped.values()].sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || a.route.localeCompare(b.route) || a.kind.localeCompare(b.kind),
  );

  const byKind = new Map<string, number>();
  for (const d of defects) byKind.set(d.kind, (byKind.get(d.kind) || 0) + 1);
  const byRoute = new Map<string, Defect[]>();
  for (const d of defects) {
    const list = byRoute.get(d.route) || [];
    list.push(d);
    byRoute.set(d.route, list);
  }

  const measuredSlugs = fs.existsSync(PARTS_DIR)
    ? fs.readdirSync(PARTS_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
    : [];
  const timings = [...parts.timings];
  for (const t of TIMINGS) if (!timings.some((x) => x.route === t.route)) timings.push(t);
  const totalMs = timings.reduce((sum, t) => sum + t.ms, 0);
  const out = {
    generatedAt: new Date().toISOString(),
    widths: WIDTHS,
    themes: THEMES,
    routesSwept: routes().map((r) => r.url),
    routesSkipped: SKIPPED,
    caveat:
      "No game server runs on this box (gameServerUrl points at :8080), so socket errors are filtered and the connected states of /lobby, /play, /tv and /game are not covered.",
    // Coverage, stated plainly. A route with no part file was never measured
    // (the run was cut short, or its navigations failed and it was discarded),
    // and that is not the same as a route that came back clean.
    measured: measuredSlugs,
    notMeasured: routes()
      .filter((r) => !measuredSlugs.includes(r.slug))
      .map((r) => r.url),
    totals: {
      distinctDefects: defects.length,
      rawFindings: all.length,
      high: defects.filter((d) => d.severity === "high").length,
      medium: defects.filter((d) => d.severity === "medium").length,
      low: defects.filter((d) => d.severity === "low").length,
      info: defects.filter((d) => d.severity === "info").length,
      byKind: Object.fromEntries([...byKind.entries()].sort((a, b) => b[1] - a[1])),
    },
    sweepSeconds: Math.round(totalMs / 1000),
    timings: timings.sort((a, b) => b.ms - a.ms),
    defects,
  };
  fs.writeFileSync(path.join(SCREENS_DIR, "sweep-report.json"), JSON.stringify(out, null, 1));

  // A short console summary so a run is readable without opening the JSON.
  const lines: string[] = [];
  lines.push(
    `SWEEP: ${defects.length} distinct defects (${all.length} raw findings), ${out.measured.length}/${out.routesSwept.length} routes measured, ${out.sweepSeconds}s of page time`,
  );
  if (out.notMeasured.length) lines.push(`  NOT MEASURED: ${out.notMeasured.join(", ")}`);
  for (const [kind, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${String(n).padStart(5)}  ${kind}`);
  }
  for (const [route, list] of [...byRoute.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const kinds = new Map<string, number>();
    for (const d of list) kinds.set(d.kind, (kinds.get(d.kind) || 0) + 1);
    lines.push(`  ${route}: ${[...kinds.entries()].map(([k, n]) => `${k}x${n}`).join(", ")}`);
  }
  console.log(lines.join("\n"));

  // -------------------------------------------------------------------------
  // The ratchet.
  //
  // A survey that only ever prints a number is read once and then ignored, and
  // nothing stops the number going back up. This turns it into the same
  // shrink-only shape scripts/check-buttons.ts and check-case.ts already use:
  // a committed baseline of counts per route and kind, a failure when any of
  // them GROWS or a new pair appears, and a nag when one is stale because the
  // defects were fixed.
  //
  // Counts rather than individual defects, deliberately. A defect's identity
  // includes its CSS path and its measured pixel size, both of which churn on
  // any unrelated edit, so an identity-based baseline would be permanently
  // out of date and would train people to regenerate it without reading it. A
  // count per (route, kind) is stable under refactors and still catches the
  // thing worth catching: this route grew a new kind of problem.
  //
  // Only meaningful on a FULL run. A narrowed run (SWEEP_WIDTHS or
  // SWEEP_THEMES set) legitimately sees fewer cells, so it reports and does
  // not gate; otherwise a quick single-width check would look like a hundred
  // fixes and rewrite the baseline with a number no full run can meet.
  const fullRun = WIDTHS.length === ALL_WIDTHS.length && THEMES.length === ALL_THEMES.length;
  const complete = out.notMeasured.length === 0;

  const counts: Record<string, number> = {};
  for (const d of defects) {
    const key = `${d.route} ${d.kind}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  if (!fs.existsSync(BASELINE_FILE) || process.env.SWEEP_WRITE_BASELINE === "1") {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ counts }, null, 1));
    console.log(`\n[sweep] baseline written to ${path.relative(process.cwd(), BASELINE_FILE)} (${Object.keys(counts).length} route/kind pairs)`);
    expect(out.routesSwept.length).toBeGreaterThan(0);
    return;
  }

  const baseline: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")).counts;
  const grown: string[] = [];
  const appeared: string[] = [];
  const shrunk: string[] = [];
  for (const [key, n] of Object.entries(counts)) {
    const was = baseline[key];
    if (was === undefined) appeared.push(`${key}: ${n} new`);
    else if (n > was) grown.push(`${key}: ${was} -> ${n}`);
  }
  for (const [key, was] of Object.entries(baseline)) {
    const now = counts[key] ?? 0;
    if (now < was) shrunk.push(`${key}: ${was} -> ${now}`);
  }

  if (shrunk.length) {
    console.log(`\n[sweep] ${shrunk.length} route/kind pair(s) improved. Re-run with SWEEP_WRITE_BASELINE=1 to lock the gains in:`);
    for (const line of shrunk.slice(0, 20)) console.log(`    ${line}`);
  }

  if (!fullRun || !complete) {
    console.log(
      `\n[sweep] reporting only, not gating: ${!fullRun ? "narrowed run (SWEEP_WIDTHS/SWEEP_THEMES set)" : `${out.notMeasured.length} route(s) not measured`}.`,
    );
    expect(out.routesSwept.length).toBeGreaterThan(0);
    return;
  }

  const regressions = [...appeared, ...grown];
  if (regressions.length) {
    console.log(`\n[sweep] ${regressions.length} REGRESSION(S):`);
    for (const line of regressions) console.log(`    ${line}`);
  }
  expect(regressions, `the sweep found defects this baseline does not allow:\n  ${regressions.join("\n  ")}`).toEqual([]);
});
