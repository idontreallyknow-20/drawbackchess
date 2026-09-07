// Static check: every passive effect composition has a sound family cue, and
// every cue family is actually handled by the sound dispatcher.
//
// Every card's persistent effect (nerf reveal, buff/boon/hex acquisition) is
// voiced once on spawn via PassiveSpawn -> playPassiveCue, keyed by the
// composition's `soundCue` ("passive/<family>"). This check guarantees the two
// halves stay in sync: no composition may carry a cue the dispatcher silently
// drops, and none may be left without a cue.
//
// Run: node scripts/check-sound-coverage.cjs

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const COMPOSITIONS = path.join(ROOT, "src/components/effects/passive/compositions.ts");
const SOUNDS = path.join(ROOT, "src/lib/sounds.ts");

function fail(msg) {
  console.error("[check-sound-coverage] FAIL: " + msg);
  process.exit(1);
}

const compSrc = fs.readFileSync(COMPOSITIONS, "utf8");
const soundsSrc = fs.readFileSync(SOUNDS, "utf8");

// Each composition entry is one object literal with a `cardId:` field. Count
// them, then count the soundCue fields: they must match one-to-one so no entry
// is left unvoiced.
const cardIdCount = (compSrc.match(/\bcardId:\s*"/g) || []).length;
const cueMatches = compSrc.match(/\bsoundCue:\s*"([^"]+)"/g) || [];
const cueValues = cueMatches.map((m) => m.replace(/.*"([^"]+)".*/, "$1"));

if (cardIdCount === 0) fail("no composition entries found (parse error?)");
if (cueValues.length !== cardIdCount) {
  fail(
    `${cardIdCount - cueValues.length} of ${cardIdCount} compositions have no soundCue ` +
      `(entries=${cardIdCount}, cues=${cueValues.length})`,
  );
}

// Distinct families used by the compositions.
const usedFamilies = new Map();
for (const cue of cueValues) {
  const fam = cue.startsWith("passive/") ? cue.slice("passive/".length) : cue;
  usedFamilies.set(fam, (usedFamilies.get(fam) || 0) + 1);
}

// Families the dispatcher actually handles: the keys of the CUE_FN map in
// sounds.ts. Parse the map body so this tracks the real code.
const mapMatch = soundsSrc.match(/const CUE_FN[^{]*{([\s\S]*?)}/);
if (!mapMatch) fail("could not find the CUE_FN dispatch map in sounds.ts");
const handled = new Set(
  (mapMatch[1].match(/\b(\w+):\s*playCue\w+/g) || []).map((m) => m.split(":")[0].trim()),
);

// Every handled family must have a real exported voice function.
for (const fam of handled) {
  const fn = "playCue" + fam.charAt(0).toUpperCase() + fam.slice(1);
  if (!new RegExp(`export function ${fn}\\b`).test(soundsSrc)) {
    fail(`CUE_FN maps "${fam}" but sounds.ts has no exported ${fn}()`);
  }
}

// Every family used by a composition must be handled by the dispatcher.
const unhandled = [...usedFamilies.keys()].filter((f) => !handled.has(f));
if (unhandled.length) {
  fail(
    `these composition sound families have no dispatcher voice: ${unhandled.join(", ")}. ` +
      `Add a playCue* function and a CUE_FN entry in sounds.ts.`,
  );
}

// Every exported cue must be gated. A sound that plays through the master
// switch (or through mute, or at full level while the volume slider sits at
// 10%) is the single easiest bug to introduce here: you add a voice, you test
// it, it works, and nobody notices it ignores Settings until a player in a
// quiet room gets a check alarm at full blast. knock(), tone() and
// playSample() all apply isMuted() and getVolume() themselves, so the check is
// that the function body reaches one of the pref gates before making a sound:
// `soundPrefs.enabled` (game voices), `fx()` (card/effect voices, which folds
// in the effects pref and mute), or a bare `isMuted()` for the handful that
// build their own audio graph.
const GATE = /soundPrefs\.enabled|\bfx\(\)|isMuted\(\)/;
// Not cues: helpers and configuration that happen to be exported.
const NOT_A_CUE = new Set(["playSample", "playPassiveCue"]);
const ungated = [];
let cueCount = 0;
const fnRe = /export function (play\w+)\s*\(/g;
let m;
while ((m = fnRe.exec(soundsSrc))) {
  const name = m[1];
  if (NOT_A_CUE.has(name)) continue;
  cueCount++;
  // Body = from the opening brace to the next top-level "\n}" line.
  const from = soundsSrc.indexOf("{", m.index + m[0].length);
  const end = soundsSrc.indexOf("\n}", from);
  const body = soundsSrc.slice(from, end < 0 ? soundsSrc.length : end);
  // A cue that only delegates to other exported cues inherits their gates.
  const delegatesOnly = !/\b(knock|tone)\(/.test(body) && /\bplay[A-Z]\w*\(/.test(body);
  if (!GATE.test(body) && !delegatesOnly) ungated.push(name);
}
if (ungated.length) {
  fail(
    `these exported sounds never check the sound prefs and would play with sound off: ` +
      `${ungated.join(", ")}. Start the body with a soundPrefs.enabled / fx() guard.`,
  );
}

// playPassiveCue is the one dispatcher, and it must still gate before playing.
if (!/function playPassiveCue[\s\S]{0,200}?fx\(\)/.test(soundsSrc)) {
  fail("playPassiveCue no longer gates on fx(); passive cues would ignore the sound settings");
}

// The volume setting is applied in exactly three places (knock, tone,
// playSample). A cue that multiplies by getVolume() itself squares the slider,
// which is how the tonal half of the set used to drift out of balance with the
// percussive half.
const doubledVolume = soundsSrc.match(/master:[^,}]*getVolume\(\)/g) || [];
if (doubledVolume.length) {
  fail(
    `${doubledVolume.length} cue(s) scale a master gain by getVolume() by hand; ` +
      `knock()/tone() already do it, so this squares the volume setting.`,
  );
}

// Confirm the spawn actually calls the dispatcher (the wiring, not just the map).
if (!/playPassiveCue\(/.test(fs.readFileSync(path.join(ROOT, "src/components/effects/passive/PassiveSpawn.tsx"), "utf8"))) {
  fail("PassiveSpawn.tsx does not call playPassiveCue; passive cues would never fire");
}

const summary = [...usedFamilies.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([f, n]) => `${f}:${n}`)
  .join("  ");
console.log(
  `[check-sound-coverage] OK: all ${cardIdCount} passive effect compositions carry a sound cue; ` +
    `${handled.size} families, all wired to a dispatcher voice.`,
);
console.log("  coverage by family: " + summary);
console.log(
  `  gate audit: ${cueCount} exported cues, all behind the sound prefs; ` +
    `no cue double-applies the volume setting.`,
);
