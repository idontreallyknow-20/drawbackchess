import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // `min-h-screen` / `h-screen` resolve to the DYNAMIC viewport, not the
      // large one Tailwind 3.4 ships. On iOS Safari `100vh` is the large
      // viewport, so with the URL bar showing every `min-h-screen` page was
      // ~90-115px taller than the screen: short pages rubber-banded with
      // nothing to scroll to, and the `min-h-screen flex items-center` screens
      // (error, friend invite, connecting) sat half a URL-bar off centre. The
      // game surfaces already used dvh explicitly; this brings the other ~43
      // call sites in line without touching them one by one.
      minHeight: { screen: "100dvh" },
      height: { screen: "100dvh" },
      // The interface root is 14px (globals.css `html`), not the 16px Tailwind
      // assumes, so the shipped rem ramp resolved BELOW the design system's
      // floors: `text-xs` (0.75rem) rendered at 10.5px across ~244 call sites
      // and `text-sm` (0.875rem) at 12.25px. Pinning the two small steps to
      // absolute pixels puts them exactly on section 3's two floors, 12px for
      // captions and labels and 13px for body and interactive text, without
      // touching a single call site. Everything from `base` up is unchanged
      // (1rem = 14px = the intended base).
      fontSize: {
        xs: ["12px", "16px"],
        sm: ["13px", "18px"],
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        // ink = the Lichess dark surface ladder. The names are historical; the
        // values are Lichess's: 900 is the page, 800 the box/panel, 700 the
        // raised/hover step, 500 the border.
        ink: {
          950: "#0f0e0c",
          900: "#161512", // page background
          800: "#262421", // panels / boxes
          700: "#302e2c", // raised / hover
          600: "#3a3836",
          500: "#404040", // borders
          400: "#8c8c8c", // secondary text on a dark ground
        },
        // parchment = the Lichess text ramp (foreground). Neutral greys: #bababa
        // is Lichess's body text, #ccc its headings, #8c8c8c its secondary and
        // #707070 its muted.
        parchment: {
          DEFAULT: "#c6c6c6",
          50: "#e8e8e8",
          100: "#dedede",
          200: "#c6c6c6",
          300: "#ababab",
          400: "#979797",
          // 500 is the muted floor. It was #7a7a7a, which measured 3.61:1 on
          // the panel and 2.68:1 on a raised row: below WCAG AA in every
          // palette. #8c8c8c is Lichess's own secondary grey (the same value as
          // ink-400) and measures 4.60:1 on the panel, 5.43:1 on the page.
          // Light resolves this class through --text-muted instead.
          500: "#8c8c8c",
        },
        // gold = the accent (links / primary). Historical name, Lichess blue:
        // the rgb triples are set on :root and pushed by applyUiPrefs.
        // brag = Lichess's brass highlight (DONATE, dates, ranks, medals).
        // Decorative emphasis only; links and primary actions stay blue.
        brag: {
          DEFAULT: "rgb(var(--brag-rgb) / <alpha-value>)",
          hi: "var(--brag-hi)",
        },
        gold: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          leaf: "rgb(var(--accent-hi-rgb) / <alpha-value>)",
          dim: "rgb(var(--accent-dim-rgb) / <alpha-value>)",
        },
        // oxblood = alert / danger → the Nerf-red accent token (red always
        // means Nerf / curses / danger).
        oxblood: {
          DEFAULT: "rgb(var(--accent-nerf-rgb) / <alpha-value>)",
          glow: "rgb(var(--accent-nerf-hi-rgb) / <alpha-value>)",
          deep: "rgb(var(--accent-nerf-deep-rgb) / <alpha-value>)",
        },
        // verdigris = positive / success → the positive-green accent token
        // (green means online / wins / positive rating change only).
        verdigris: {
          DEFAULT: "rgb(var(--accent-positive-rgb) / <alpha-value>)",
          glow: "rgb(var(--accent-positive-hi-rgb) / <alpha-value>)",
        },
        // bruise = a neutral secondary grey. Still referenced by the board's
        // risk-dot ladder and a dozen chips, so the name stays; the violet does
        // not. Mirrors --bruise in globals.css.
        bruise: {
          DEFAULT: "#8c8c8c",
          glow: "#a0a0a0",
        },
        // coral / mint / sun: three semantic chip colours still used across the
        // codex, the dock and the leaderboard. Retoned onto the Lichess palette
        // (Nerf red, Lichess green, a muted brass) rather than removed, because
        // dropping the names would silently blank those classes. Mirrors the
        // matching tokens in globals.css.
        coral: {
          DEFAULT: "#d85a48",
          glow: "#e5745f",
        },
        mint: {
          DEFAULT: "#629924",
          glow: "#7bb52f",
        },
        sun: {
          DEFAULT: "#c9a227",
          glow: "#dcb84a",
        },
        // mode identities: Nerf mode is red, Buff mode is blue — the same two
        // semantic accent tokens used for curses/danger (red) and powers/boons
        // (blue), so a mode always reads the same color everywhere.
        mode: {
          nerf: "rgb(var(--accent-nerf-rgb) / <alpha-value>)",
          nerfGlow: "rgb(var(--accent-nerf-hi-rgb) / <alpha-value>)",
          buff: "rgb(var(--accent-buff-rgb) / <alpha-value>)",
          buffGlow: "rgb(var(--accent-buff-hi-rgb) / <alpha-value>)",
        },
      },
      boxShadow: {
        leaf: "0 0 24px -10px rgb(var(--accent-gold-rgb) / 0.4)",
        oxblood: "0 0 32px -14px rgb(var(--accent-nerf-rgb) / 0.4)",
        // Mode glows, softer than the alert shadows above.
        nerf: "0 0 24px -12px rgb(var(--accent-nerf-rgb) / 0.35)",
        buff: "0 0 24px -12px rgb(var(--accent-buff-rgb) / 0.35)",
        plate:
          "0 12px 40px -24px rgba(0,0,0,0.7), 0 1px 0 0 rgba(255,255,255,0.03) inset",
      },
      keyframes: {
        flicker: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.85" },
        },
        sigil: {
          "0%, 100%": { transform: "rotate(0deg)" },
          "50%": { transform: "rotate(180deg)" },
        },
        rise: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        seal: {
          "0%": { transform: "scale(0.6) rotate(-6deg)", opacity: "0" },
          "70%": { transform: "scale(1.06) rotate(2deg)", opacity: "1" },
          "100%": { transform: "scale(1) rotate(0deg)", opacity: "1" },
        },
        bob: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        flicker: "flicker 4.5s ease-in-out infinite",
        sigil: "sigil 60s linear infinite",
        rise: "rise 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        seal: "seal 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both",
        bob: "bob 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
