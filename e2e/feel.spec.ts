import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Board feel, measured rather than described.
//
// "How does it feel to play?" is the question this repo has the least evidence
// about, because every other harness checks that something is CORRECT. A board
// can be entirely correct and still feel bad: the piece lands a beat after the
// click, the legal dots wait for mouseup, the bot answers instantly at one
// level and hangs at the next, the clock only redraws once a second so the
// last ten seconds lie to you.
//
// So this plays a real game against the local bot and reports numbers for the
// handful of things a player actually notices. It asserts only the ones with a
// defensible threshold and PRINTS the rest, because "the bot took 380ms" is
// evidence for a later judgement, not a pass or a fail.
//
// Uses the fully client-side bot game, so no Durable Object backend is needed
// (they do not run under `next dev`).
//
//   npx playwright test e2e/feel.spec.ts --reporter=list
// ---------------------------------------------------------------------------

const gameUrl = (o: { mode?: string; difficulty?: string; t?: number; inc?: number } = {}) =>
  `/game?mode=${o.mode ?? "buff"}&difficulty=${o.difficulty ?? "easy"}&color=w` +
  `&t=${o.t ?? 0}&inc=${o.inc ?? 0}&rated=0`;

/** Premoves off and no persisted game, so each run starts from the same place. */
async function hermetic(page: Page, settings: Record<string, unknown> = {}) {
  await page.addInitScript((s) => {
    try {
      window.localStorage.setItem("dc:settings-v1", JSON.stringify(s));
      window.localStorage.removeItem("dc:active-ai-game");
    } catch {
      // localStorage unavailable: defaults still work, just less hermetic.
    }
  }, { premovesEnabled: false, ...settings });
}

// Squares carry `data-sq={numeric index}`, not a name, so the readable handle
// is the aria-label the board already speaks. Occupancy comes from the cell's
// own sr-only description ("white pawn" / "empty"), which is the board's own
// answer rather than a guess about which element holds the glyph.
const square = (page: Page, name: string) =>
  page.locator(`[role="gridcell"][aria-label="square ${name}"]`).first();

const LEGAL_DOTS = ".dot-target, .dot-capture";

/**
 * A buff game opens with a modal "Opening pick: choose a card" over the board,
 * so the first thing a player does is not a move. Take the first card and
 * commit, which is what a player does, and return how long the board was
 * unreachable for.
 */
async function clearOpeningPick(page: Page): Promise<number> {
  const started = Date.now();
  const dialog = page.locator('[role="dialog"]').first();
  if (!(await dialog.isVisible().catch(() => false))) return 0;
  // The cards deal in, and are not interactive until they have. The draft's
  // own contract (docs/draft-sequence.md) is that the decision timer appears
  // exactly when both cards are dealt and clickable, so that is the signal to
  // wait on. Clicking before it lands silently does nothing, and then the
  // commit button never leaves its disabled "Pick a card" state.
  await page
    .getByRole("timer", { name: /Draft decision timer/i })
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {});
  // The commit button RENAMES itself on selection, "Pick a card" to "Confirm
  // <card name>", so matching it by its pre-click label finds a stale, still
  // disabled node and waits forever. Match both spellings.
  const cards = dialog.locator("button").filter({ hasNotText: /^(Hide|Pick a card|Reroll|Skip)/ });
  await cards.first().click();
  const commit = dialog.getByRole("button", { name: /^(Pick a card|Confirm )/i });
  await commit.click();
  await dialog.waitFor({ state: "hidden", timeout: 15_000 });
  return Date.now() - started;
}

async function boardReady(page: Page) {
  // Hydration, not paint. Another agent lost an hour tonight to a probe that
  // waited 2.5s after waitForSelector and measured an unhydrated page, so this
  // waits for the thing hydration produces: a real ARIA grid with 64 cells and
  // exactly one tab stop.
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[role="gridcell"][aria-label^="square "]').length === 64 &&
      document.querySelectorAll('[role="gridcell"][tabindex="0"]').length === 1,
    { timeout: 45_000 },
  );
}

/** What the board says is standing on this square: "white pawn", "empty". */
async function occupant(page: Page, name: string): Promise<string> {
  return page.evaluate((sq) => {
    const cell = document.querySelector(`[role="gridcell"][aria-label="square ${sq}"]`);
    const id = cell?.getAttribute("aria-describedby");
    const desc = id ? document.getElementById(id) : null;
    return (desc?.textContent ?? "").trim();
  }, name);
}

test.describe("board feel", () => {
  test.describe.configure({ mode: "serial" });

  test("a move lands promptly, and the legal dots do not wait for mouseup", async ({ page }) => {
    await hermetic(page);
    await page.goto(gameUrl());
    await boardReady(page);
    const blocked = await clearOpeningPick(page);
    console.log(`  the board was behind the opening-pick modal for ${blocked}ms before a move was possible`);

    const from = square(page, "e2");
    const to = square(page, "e4");
    await expect(from).toBeVisible();

    // 1. Legal-move affordance latency. Lichess shows the destinations on
    //    POINTER DOWN, before you have committed to anything, which is most of
    //    why picking a piece up there feels immediate. Measure ours.
    const box = await from.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const downAt = Date.now();
    await page.mouse.down();
    let dotsAt: number | null = null;
    try {
      await page.waitForFunction(
        (sel) => document.querySelectorAll(sel).length > 0,
        LEGAL_DOTS,
        { timeout: 2000 },
      );
      dotsAt = Date.now();
    } catch {
      dotsAt = null;
    }
    const onDown = dotsAt != null ? dotsAt - downAt : null;
    await page.mouse.up();

    let onUp: number | null = null;
    if (onDown == null) {
      const upAt = Date.now();
      try {
        await page.waitForFunction(
          (sel) => document.querySelectorAll(sel).length > 0,
          LEGAL_DOTS,
          { timeout: 2000 },
        );
        onUp = Date.now() - upAt;
      } catch {
        onUp = null;
      }
    }

    console.log(
      `  legal dots: ${
        onDown != null
          ? `${onDown}ms after pointerdown (good, this is the Lichess behaviour)`
          : onUp != null
            ? `NOT on pointerdown; ${onUp}ms after pointerup (a beat late by comparison)`
            : "never appeared for either event, so there is no destination affordance at all"
      }`,
    );

    // 2. Move latency, broken into its two halves. A single "when did the
    //    destination say white pawn" number cannot tell an 800ms glide from
    //    800ms of doing nothing, and those are opposite problems: one is a
    //    tuning choice, the other is a stall. So watch BOTH squares from before
    //    the click and record when each first changes.
    const before = await occupant(page, "e4");
    const tbox = await to.boundingBox();
    expect(tbox).not.toBeNull();

    await page.evaluate(() => {
      const read = (sq: string) => {
        const cell = document.querySelector(`[role="gridcell"][aria-label="square ${sq}"]`);
        const id = cell?.getAttribute("aria-describedby");
        return (document.getElementById(id ?? "")?.textContent ?? "").trim();
      };
      const w = window as unknown as { __feel: { t0: number; from: number | null; to: number | null } };
      w.__feel = { t0: performance.now(), from: null, to: null };
      const e2 = read("e2");
      const e4 = read("e4");
      const tick = () => {
        const f = w.__feel;
        if (f.from == null && read("e2") !== e2) f.from = performance.now() - f.t0;
        if (f.to == null && read("e4") !== e4) f.to = performance.now() - f.t0;
        if (f.from == null || f.to == null) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.mouse.move(tbox!.x + tbox!.width / 2, tbox!.y + tbox!.height / 2);
    await page.evaluate(() => {
      (window as unknown as { __feel: { t0: number } }).__feel.t0 = performance.now();
    });
    await page.mouse.down();
    await page.mouse.up();

    await page.waitForFunction(
      () => {
        const f = (window as unknown as { __feel: { from: number | null; to: number | null } }).__feel;
        return f.from != null && f.to != null;
      },
      undefined,
      { timeout: 8000 },
    );
    const feel = await page.evaluate(
      () => (window as unknown as { __feel: { from: number | null; to: number | null } }).__feel,
    );
    const after = await occupant(page, "e4");

    console.log(
      `  my move: origin emptied +${Math.round(feel.from!)}ms, destination filled +${Math.round(feel.to!)}ms ` +
        `(e4 read ${JSON.stringify(before)} before, ${JSON.stringify(after)} after)`,
    );
    console.log(
      "  read the first number: that is when the board committed the move. The second is\n" +
        "  when the piece finished arriving, so the gap between them is the glide, which is\n" +
        "  a tuning choice rather than a stall. NOTE this is `next dev`, unoptimised and on\n" +
        "  a shared box, so treat these as an upper bound and re-measure against a build\n" +
        "  before calling any of it a defect.",
    );

    // The defensible threshold, and only this one. A board that has not
    // committed the move within two seconds is not slow, it is broken, and no
    // amount of dev-mode overhead excuses it.
    expect(Math.round(feel.from!), "click to the board committing the move").toBeLessThan(2000);
  });

  test("the bot answers, and in a human amount of time", async ({ page }) => {
    test.setTimeout(180_000);
    // One level, not three. The first attempt looped over easy/medium/hard and
    // spent 2.5 minutes timing out, because after White's move the game can
    // open ANOTHER draft, so a probe watching black's home rank waits forever
    // on a board nobody is allowed to touch. The board's own live region says
    // what happened, so watch that instead of guessing at squares.
    await hermetic(page);
    await page.goto(gameUrl({ difficulty: "easy" }));
    await boardReady(page);
    await clearOpeningPick(page);

    const from = square(page, "e2");
    const fb = await from.boundingBox();
    const to = square(page, "e4");
    const tb = await to.boundingBox();
    expect(fb).not.toBeNull();
    expect(tb).not.toBeNull();

    await page.mouse.click(fb!.x + fb!.width / 2, fb!.y + fb!.height / 2);
    const playedAt = Date.now();
    await page.mouse.click(tb!.x + tb!.width / 2, tb!.y + tb!.height / 2);

    // "black <piece> <from> <to>" in the live region is the bot having moved.
    let replied: number | null = null;
    try {
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('[aria-live]')].some((el) =>
            /\bblack\b/i.test(el.textContent ?? ""),
          ),
        undefined,
        { timeout: 60_000 },
      );
      replied = Date.now() - playedAt;
    } catch {
      replied = null;
    }

    const said = await page.evaluate(() =>
      [...document.querySelectorAll("[aria-live]")]
        .map((el) => (el.textContent ?? "").trim())
        .filter(Boolean)
        .join(" | "),
    );
    console.log(`  easy bot replied in ${replied == null ? "NEVER (60s)" : `${replied}ms`}`);
    console.log(`  the board announced: ${JSON.stringify(said.slice(0, 160))}`);
    console.log(
      "  that number includes any draft the move triggered, which is the honest thing to\n" +
        "  measure: it is how long the player waits, not how long the search ran.",
    );

    expect(replied, "the bot must reply at all").not.toBeNull();
  });

  test("the clock shows tenths only when they matter", async ({ page }) => {
    // The claim under test is the one Lichess gets right and most hobby boards
    // do not: below the emergency threshold the clock has to show tenths, and
    // above it it must not, because a clock that always shows tenths is noise
    // and one that never does is lying about the last ten seconds.
    //
    // `t` is SECONDS per side, which the route documents and my first probe
    // did not read: `t=1` gave a one-second game and a clock already reading
    // 0:00.1, so the "clock" it sampled was a `[class*=clock]` match on the
    // separator span. Address the clock by the shape of what it says instead.
    //
    // The digits also change size deliberately (`text-[26px]` on a phone,
    // `sm:text-xl` on a desktop rail), which looks like a broken arbitrary
    // value if you read the computed size without reading the classes.
    const clockText = async () =>
      page.evaluate(() => {
        for (const el of document.querySelectorAll("*")) {
          const t = (el.textContent ?? "").trim();
          if (el.children.length === 0 && /^\d{1,2}:\d{2}(\.\d)?$/.test(t)) return t;
        }
        return "";
      });

    // 1. A comfortable clock: no tenths.
    await hermetic(page);
    await page.goto(gameUrl({ t: 300, inc: 0, difficulty: "easy" }));
    await boardReady(page);
    await clearOpeningPick(page);
    const comfortable = await clockText();
    console.log(`  a 5-minute clock reads ${JSON.stringify(comfortable)}`);

    // 2. A clock already inside the emergency band: tenths.
    await hermetic(page);
    await page.goto(gameUrl({ t: 8, inc: 0, difficulty: "easy" }));
    await boardReady(page);
    await clearOpeningPick(page);
    const urgent = await clockText();
    console.log(`  an 8-second clock reads ${JSON.stringify(urgent)}`);

    expect(comfortable, "a clock is rendered at all in a timed game").not.toBe("");
    expect(urgent, "a clock is rendered at all in a timed game").not.toBe("");
    expect(comfortable, "a comfortable clock does not show tenths").not.toMatch(/\.\d$/);
    expect(urgent, "a clock inside the emergency band shows tenths").toMatch(/\.\d$/);
  });
});
