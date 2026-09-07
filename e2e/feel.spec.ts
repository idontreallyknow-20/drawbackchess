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
  // The game-over panel is ALSO `role="dialog"` with nothing on it to say so,
  // which is a finding in its own right: a draft and an ending are the same
  // element to a screen reader and to anything automating the page. Bail out
  // rather than waiting forever for cards that are not there.
  if (await page.locator("#game-over-title").isVisible().catch(() => false)) return 0;
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
  if ((await cards.count()) === 0) return Date.now() - started;
  const commit = dialog.getByRole("button", { name: /^(Pick a card|Confirm )/i });
  // Click the card, then WAIT for the commit button to enable, and retry the
  // card click if it does not. A click that lands before the deal finishes is
  // silently dropped, and on a loaded box the decision timer is not a reliable
  // enough signal on its own: this timed out at three minutes with four other
  // jobs on the machine. Retrying is cheaper than a longer fixed wait.
  for (let attempt = 0; attempt < 4; attempt++) {
    await cards.first().click({ timeout: 10_000 }).catch(() => {});
    try {
      await commit.waitFor({ state: "visible", timeout: 5_000 });
      if (await commit.isEnabled()) break;
    } catch {
      // fall through and try again
    }
    await page.waitForTimeout(500);
  }
  if (!(await commit.isEnabled().catch(() => false))) return Date.now() - started;
  await commit.click({ timeout: 10_000 }).catch(() => {});
  await dialog.waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
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

  test("a whole game, start to result, and what the arc costs", async ({ page }) => {
    test.setTimeout(600_000);
    // Every other test here looks at one beat. This one plays a game to a
    // RESULT and reports the arc, because the numbers that decide whether a
    // session is fun are cumulative and none of them is visible from a single
    // move: how many times the draft takes the board away, how long it holds
    // it, and how much of a game is spent unable to touch anything.
    //
    // Plays legal moves at random from the board's own move set rather than
    // trying to play well. The point is the harness around the chess, not the
    // chess.
    await hermetic(page);
    await page.goto(gameUrl({ difficulty: "easy" }));
    await boardReady(page);

    const started = Date.now();
    let drafts = 0;
    let draftMs = 0;
    let plies = 0;
    let result: string | null = null;

    /** Every legal destination the board is currently showing for one of my
     *  pieces, found by clicking a piece and reading the dots it lights. */
    const tryMove = async (): Promise<boolean> => {
      const cells = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="gridcell"][aria-label^="square "]')).map((el) => {
          const id = el.getAttribute("aria-describedby");
          return {
            name: (el.getAttribute("aria-label") ?? "").replace("square ", ""),
            desc: (document.getElementById(id ?? "")?.textContent ?? "").trim(),
          };
        }),
      );
      const mine = cells.filter((c) => c.desc.startsWith("white "));
      // Shuffle so a stuck piece does not stall the whole game.
      for (let i = mine.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mine[i], mine[j]] = [mine[j], mine[i]];
      }
      // Every piece, not a sample. Twelve of sixteen shuffled was enough to
      // stall a game at six moves when a handicap narrowed the move set, and a
      // harness that gives up early reports a session share computed over a
      // 17-second session, which is a different and much noisier number.
      for (const from of mine) {
        const fb = await square(page, from.name).boundingBox();
        if (!fb) continue;
        await page.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2);
        const dests = await page.evaluate((sel) => {
          const out: string[] = [];
          for (const dot of document.querySelectorAll(sel)) {
            const cell = dot.closest('[role="gridcell"][aria-label^="square "]');
            const n = cell?.getAttribute("aria-label")?.replace("square ", "");
            if (n) out.push(n);
          }
          return out;
        }, LEGAL_DOTS);
        if (!dests.length) continue;
        const to = dests[Math.floor(Math.random() * dests.length)];
        const tb = await square(page, to).boundingBox();
        if (!tb) continue;
        await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
        return true;
      }
      return false;
    };

    for (let turn = 0; turn < 80; turn++) {
      // The ending is checked BEFORE the draft, because the game-over panel is
      // also a `role="dialog"` and the first version of this loop mistook it
      // for a draft and waited ten minutes for cards that would never deal.
      // The result comes from the game-over dialog's own title, NOT from
      // scanning the page for words. The first version of this looked for
      // "Draw" anywhere in `document.body.innerText` and matched the OFFER A
      // DRAW BUTTON on move one, so it reported a drawn game after zero moves.
      result = await page.evaluate(
        () => document.getElementById("game-over-title")?.textContent?.trim() ?? null,
      );
      if (result) break;

      // A draft can open at any point and takes the board away while it does.
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.isVisible().catch(() => false)) {
        const cost = await clearOpeningPick(page);
        if (cost > 0) {
          drafts++;
          draftMs += cost;
        }
      }

      if (!(await tryMove())) {
        // One retry after a beat: a draft closing, a card animation finishing
        // or the bot still moving can all leave a frame where nothing is
        // selectable, and giving up there ends the session early.
        await page.waitForTimeout(900);
        if (!(await tryMove())) break;
      }
      plies++;
      // Give the bot its turn. 3s is generous against a measured 807ms.
      await page.waitForTimeout(700);
    }

    const total = Date.now() - started;
    console.log(
      `  played ${plies} of my moves in ${(total / 1000).toFixed(0)}s, result: ` +
        (result ?? "none reached; the loop ran out of moves it could find"),
    );
    if (!result) {
      console.log(
        "  no result is not necessarily a defect: the mover picks a random legal\n" +
          "  destination from twelve shuffled pieces, and a handicap that narrows the\n" +
          "  move set enough will exhaust that sample before the game ends. It does mean\n" +
          "  the arc below covers an opening and a middlegame, not a whole game.",
      );
    }
    console.log(
      `  the draft took the board away ${drafts} time(s) for ${(draftMs / 1000).toFixed(1)}s total, ` +
        `which is ${((draftMs / total) * 100).toFixed(0)}% of the session`,
    );
    if (drafts) console.log(`  average ${(draftMs / drafts / 1000).toFixed(1)}s per draft`);

    // One assertion, and it is not a stopwatch. A game has to be PLAYABLE:
    // moves have to land, turn after turn, with drafts opening and closing in
    // between. The draft share is RECORDED, not asserted, because the right
    // number is a design judgement and a test should not pretend to make it.
    // Measured on this build: three drafts costing 13.0s across a 43s session,
    // which is 30% of the early game spent unable to touch the board.
    expect(plies, "the game must be playable end to end").toBeGreaterThan(8);
  });
});
