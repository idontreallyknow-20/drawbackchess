"use client";

// Last-resort boundary: replaces the root layout when even it throws, so it
// must render its own html/body and carry inline styles (globals.css is not
// loaded here). Mirrors the site's plate-on-ink look.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const buttonBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    // Comfortable 44px touch target on phones (no Tailwind here: globals.css
    // is not loaded when the root layout itself has crashed).
    minHeight: "44px",
    padding: "8px 14px",
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.02em",
    cursor: "pointer",
    textDecoration: "none",
  };
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Breathing room so the card never touches the screen edge on phones.
          padding: "24px 16px",
          boxSizing: "border-box",
          background: "#161512",
          color: "#b8b8b8",
          fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div
          style={{
            background: "#262421",
            border: "1px solid rgba(255,255,255,0.07)",
            boxShadow: "0 12px 40px -24px rgba(0,0,0,0.7)",
            padding: "24px",
            maxWidth: "24rem",
            width: "100%",
            textAlign: "center",
          }}
        >
          <div
            style={{
              // 12px is the design system's caption floor, and #8c8c8c clears
              // 4.60:1 on this panel where #7f7d77 measured 3.76:1. The colours
              // are literals on purpose: this boundary paints when the app
              // stylesheet may not have loaded, so it cannot use tokens.
              fontSize: "12px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8c8c8c",
            }}
          >
            Well, that broke
          </div>
          <h1 style={{ margin: "6px 0 0", fontSize: "22px", fontWeight: 600, color: "#e9e7e3" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "10px 0 0", fontSize: "13px", lineHeight: 1.5, color: "#a3a09b" }}>
            The site hit an unexpected error. Your game state is saved locally.
          </p>
          <div
            style={{
              marginTop: "20px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
            }}
          >
            <button
              type="button"
              onClick={() => {
                // A hard navigation fully resets the crashed app tree, which is
                // exactly what recovering from a global error wants.
                window.location.href = "/";
              }}
              style={{
                ...buttonBase,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#b8b8b8",
              }}
            >
              Back to the game
            </button>
            <button
              onClick={reset}
              style={{
                ...buttonBase,
                // Gold accent literals (mirror --accent-gold #d4a017): globals.css
                // is not loaded in this boundary, so CSS vars can't resolve here.
                background: "rgba(212,160,23,0.1)",
                border: "1px solid rgba(212,160,23,0.4)",
                color: "#d4a017",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
