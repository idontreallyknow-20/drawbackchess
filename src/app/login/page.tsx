"use client";

import Link from "next/link";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { login, register } from "@/lib/authClient";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/Button";

// Public sitekey; when unset the widget is skipped and signup works as before.
const TURNSTILE_SITEKEY = process.env.NEXT_PUBLIC_TURNSTILE_SITEKEY;

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

export default function LoginPageWrapper() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}

function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  // Guests arriving to upgrade land on the register tab; their guest account
  // is converted in place, keeping their rating and history.
  const upgrading = params.get("upgrade") === "1";
  const [tab, setTab] = useState<"login" | "register">(upgrading ? "register" : "login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Google sign-in failures arrive back here as a query param.
  const [error, setError] = useState<string | null>(params.get("oauthError"));

  // Turnstile: only rendered on the register tab when a sitekey is configured.
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReady, setTurnstileReady] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // The api.js script may already be present after a client navigation.
  useEffect(() => {
    if (window.turnstile) queueMicrotask(() => setTurnstileReady(true));
  }, []);

  // Render (and clean up) the widget whenever the register tab is active.
  useEffect(() => {
    if (tab !== "register" || !TURNSTILE_SITEKEY || !turnstileReady) return;
    const el = turnstileRef.current;
    const turnstile = window.turnstile;
    if (!el || !turnstile) return;
    const id = turnstile.render(el, {
      sitekey: TURNSTILE_SITEKEY,
      action: "turnstile-spin-v1",
      callback: (token: string) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(""),
      "error-callback": () => setTurnstileToken(""),
    });
    widgetIdRef.current = id;
    return () => {
      try {
        turnstile.remove(id);
      } catch {
        /* widget already gone */
      }
      widgetIdRef.current = null;
      setTurnstileToken("");
    };
  }, [tab, turnstileReady]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (tab === "register" && TURNSTILE_SITEKEY && !turnstileToken) {
      setError("Please complete the captcha.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (tab === "login") await login(username, password);
      else await register(username, password, email.trim(), turnstileToken);
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
      // Tokens are single-use; reset so the user can retry.
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetIdRef.current);
        } catch {
          /* nothing to reset */
        }
        setTurnstileToken("");
      }
    }
  };

  return (
    <main className="min-h-screen">
      {TURNSTILE_SITEKEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          onLoad={() => setTurnstileReady(true)}
        />
      )}
      {/* The standard site nav (design system §9: identical on every page),
          not a logo-only stub. */}
      <SiteHeader />
      <section className="max-w-md mx-auto px-6 py-8">
        <h1 className="page-title">
          {tab === "login" ? "Welcome back" : "Create your account"}
        </h1>
        {upgrading && (
          <p className="mt-2 text-parchment-200 text-sm">
            Your guest rating, games, and member date carry over.
          </p>
        )}

        <div className="mt-6 grid grid-cols-2 gap-1 plate p-1">
          {(["login", "register"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              // These are tabs, not a bespoke control, and they measured 32px
              // tall: the smallest targets on the one page every new player
              // has to get through. A min-height rather than more padding, so
              // the pair keeps its current density on a mouse.
              aria-pressed={tab === t}
              className={
                "flex min-h-[44px] items-center justify-center py-2 text-sm font-display font-semibold tracking-wide transition " +
                (tab === t ? "bg-[color:var(--bg-raised)] text-gold-leaf" : "text-parchment-300 hover:bg-[color:var(--bg-raised)]")
              }
            >
              {t === "login" ? "Sign in" : "Register"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-4 plate p-6 space-y-4">
          {error && (
            <div className="p-3 border border-oxblood-glow/60 bg-oxblood/15 text-parchment text-sm">
              {error}
            </div>
          )}
          <div>
            <label className="text-[12px] font-medium text-parchment-300 block mb-1.5" htmlFor="username">
              {tab === "login" ? "Username or email" : "Username"}
            </label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              maxLength={tab === "login" ? 254 : 20}
              className="w-full bg-[color:var(--bg-base)] border border-[color:var(--edge)] px-4 py-3 focus:border-[color:var(--edge-strong)] text-parchment placeholder:text-parchment-500"
              placeholder="knight_rider"
            />
            {tab === "register" && (
              <p className="mt-1 text-[12px] text-parchment-400">
                3-20 characters: letters, digits, underscores.
              </p>
            )}
          </div>
          {tab === "register" && (
            <div>
              <label className="text-[12px] font-medium text-parchment-300 block mb-1.5" htmlFor="email">
                Email <span className="normal-case text-parchment-500">(optional)</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                maxLength={254}
                className="w-full bg-[color:var(--bg-base)] border border-[color:var(--edge)] px-4 py-3 focus:border-[color:var(--edge-strong)] text-parchment placeholder:text-parchment-500"
                placeholder="you@example.com"
              />
              <p className="mt-1 text-[12px] text-parchment-400">
                Sign in with your email.
              </p>
            </div>
          )}
          <div>
            <label className="text-[12px] font-medium text-parchment-300 block mb-1.5" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={tab === "login" ? "current-password" : "new-password"}
              className="w-full bg-[color:var(--bg-base)] border border-[color:var(--edge)] px-4 py-3 focus:border-[color:var(--edge-strong)] text-parchment"
              placeholder={tab === "register" ? "at least 8 characters" : ""}
            />
          </div>
          {tab === "register" && TURNSTILE_SITEKEY && (
            <div ref={turnstileRef} className="flex justify-center" />
          )}
          <Button tone="leaf"
            type="submit"
            disabled={
              busy ||
              !username.trim() ||
              !password ||
              (tab === "register" && !!TURNSTILE_SITEKEY && !turnstileToken)
            }
            className="w-full py-3 text-lg disabled:opacity-50">
            {busy ? "One moment…" : tab === "login" ? "Sign in" : "Create account"}
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[color:var(--bg-raised)]" />
            <span className="text-[12px] text-parchment-400">or</span>
            <div className="h-px flex-1 bg-[color:var(--bg-raised)]" />
          </div>
          <a
            href={`/api/auth/google?next=${encodeURIComponent(next)}`}
            className="w-full flex items-center justify-center gap-3 py-3 border border-[color:var(--edge)] bg-[color:var(--bg-base)] hover:bg-[color:var(--bg-raised)] transition text-parchment font-display text-[15px]"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.7 1.22 9.19 3.6l6.86-6.86C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.2C12.44 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.2C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Continue with Google
          </a>
        </form>
      </section>
    </main>
  );
}
