import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Some dev sandboxes preinstall Chromium under PLAYWRIGHT_BROWSERS_PATH
 * (e.g. /opt/pw-browsers/chromium-1194) at a revision that may not match the
 * one this @playwright/test version would download. When the env var points
 * at such a directory, launch that binary explicitly. On CI the env var is
 * unset and `npx playwright install chromium` provides the default browser,
 * so no override is applied there.
 */
function preinstalledChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return undefined;
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d));
  } catch {
    return undefined;
  }
  // Prefer the newest preinstalled revision if several are present.
  dirs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const dir of dirs) {
    const exe = path.join(root, dir, "chrome-linux", "chrome");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const chromiumExe = preinstalledChromium();

export default defineConfig({
  testDir: "./e2e",
  // The bot game test drives a full game flow (in-page AI search), which can be
  // slow on a cold first run; give it real room so a slow-but-correct run isn't
  // failed by the per-test cap before the CI retry can help.
  timeout: 150_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  // The tests share one dev server and the game test is CPU-heavy (AI search
  // runs in the page); serialize for stable timings.
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 },
    // Reduced motion alone no longer makes the flow deterministic, and the
    // comment that used to sit here claiming it did was stale.
    //
    // `applyUiPrefs` honours the OS prefers-reduced-motion flag ONLY when the
    // player has opted in via `followSystemMotion`, which defaults to FALSE:
    // card plays are gameplay information, so they stay on by default (see
    // src/lib/settings.ts). So this context option, on its own, left every
    // test running the full draft choreography while the config promised the
    // opposite.
    //
    // It is kept because it is still the honest description of the emulated
    // device, and paired with a storage seed below that actually reaches the
    // app's own switch.
    contextOptions: { reducedMotion: "reduce" },
    // Seed the app's own motion setting, which is what `data-anim` is read
    // from. `storageState` runs before any page script, so the very first
    // render is already in the off state; setting it from a fixture would
    // race the first paint.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:3000",
          localStorage: [
            {
              name: "dc:settings-v1",
              value: JSON.stringify({ animationSpeed: "off", followSystemMotion: true }),
            },
          ],
        },
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        ...(chromiumExe ? { launchOptions: { executablePath: chromiumExe } } : {}),
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
