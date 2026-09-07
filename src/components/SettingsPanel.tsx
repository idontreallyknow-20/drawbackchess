"use client";

// The settings MODAL: the drill-down panel opened from the header.
//
// Everything that makes a settings surface — the controls, the pickers, the
// row/group layout, the read/write model — lives in components/settings/rows.tsx
// and is shared verbatim with the /settings route. This file is the dialog
// chrome around it: the portal, the scroll lock, the section list, and the
// live-game reminder. Nothing here knows what a setting IS.

import { useState } from "react";
import { createPortal } from "react-dom";
import { useModalChrome } from "@/lib/useModalChrome";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { SECTIONS } from "@/components/settings/config";
import { SettingsRows, useSettingsModel } from "@/components/settings/rows";
import Link from "next/link";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Set when a live game is in progress; when omitted, the panel infers it
   *  from the route (game pages live under /game and /play). */
  liveGame?: boolean;
}

export function SettingsPanel({ open, onClose, liveGame }: Props) {
  // The model re-reads storage on every SETTINGS_CHANGED_EVENT, so a change
  // made on the /settings route (or by the account pull) is already reflected
  // here without the panel being told about it.
  const { settings, update } = useSettingsModel();
  // Drill-down navigation: the panel opens on a sparse home of category
  // cards; picking one slides into that section's focused sub-page, with a
  // Back control at its head. One level, never deeper.
  const [view, setView] = useState<"home" | string>("home");
  const pathname = usePathname();
  const inLiveGame =
    liveGame ?? (pathname != null && (pathname.startsWith("/game") || pathname.startsWith("/play")));

  // Always start back on the home grid so the panel opens in the same place.
  // The values themselves need no re-sync on open any more: the model is
  // subscribed. Handled on the open transition during render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setView("home");
  }

  // Scroll lock + Escape: `aria-modal` below promised both and neither
  // existed, so a touch drag scrolled the page behind the panel and Tab walked
  // straight out of it. Called BEFORE the early return so hook order is stable.
  const chrome = useModalChrome(open, onClose);
  const { attachDialog } = chrome;

  if (!open) return null;

  const activeSection = view === "home" ? null : SECTIONS.find((s) => s.id === view) ?? null;

  // Portalled to the body. This panel is rendered INSIDE <nav>, which
  // globals.css pins at z-index 30, so the whole modal was trapped in that
  // stacking context and the body-level AchievementToast (z-40) painted over
  // it — an unlock while Settings was open put the toast and its buttons on
  // top of the settings pane, intercepting clicks meant for it.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/70 p-4"
      onPointerDown={chrome.onBackdropPointerDown}
    >
      <div
        ref={attachDialog}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="plate plate-raised relative flex max-h-[88dvh] w-full max-w-[46rem] flex-col overflow-hidden"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Header. */}
        <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--edge)] py-2.5 pl-5 pr-2.5">
          <h2 className="font-display text-[15px] font-bold text-parchment-50">Settings</h2>
          <div className="flex items-center gap-1">
            {/* The same settings, at a URL. Deep-links straight to whichever
                section is open, so "send me your board setup" is a link. */}
            <Link
              href={activeSection ? `/settings/${activeSection.id}` : "/settings"}
              onClick={onClose}
              className="flex min-h-[44px] items-center gap-1.5 px-2.5 text-[13px] text-parchment-400 transition hover:text-parchment"
            >
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              Full page
            </Link>
            <button
              onClick={onClose}
              className="nav-icon-btn relative z-20 grid min-h-[44px] min-w-[44px] place-items-center text-parchment-400 hover:text-parchment"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Gentle reminder for players who open Settings mid-game. */}
        {inLiveGame && (
          <p className="shrink-0 border-b border-[color:var(--edge)] px-5 py-1.5 text-[12px] text-gold-leaf">
            Heads up: the game clock keeps running while Settings is open.
          </p>
        )}

        {/* Body: a left column of section links and a right column of plain
            rows on desktop; one column on a phone, where the section list is
            the first view and a Back control returns to it. */}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Section links. Always on screen from sm up; on a phone this is
              the whole view until a section is chosen. */}
          <nav
            aria-label="Settings sections"
            className={
              "shrink-0 overflow-y-auto border-[color:var(--edge)] p-2 sm:block sm:w-[13rem] sm:border-r " +
              (activeSection ? "hidden" : "block h-[min(32rem,60dvh)] sm:h-[min(32rem,60dvh)]")
            }
          >
            <ul className="flex flex-col gap-0.5">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <button
                    onClick={() => setView(section.id)}
                    aria-current={activeSection?.id === section.id || undefined}
                    className="settings-tab flex min-h-[44px] w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13px]"
                  >
                    <section.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                    <span className="min-w-0 flex-1 truncate">{section.title}</span>
                    <ChevronRight
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 text-parchment-500 sm:hidden"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Content. Plain rows: label left, control right. */}
          <div
            className={
              "min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-2 sm:block sm:h-[min(32rem,60dvh)] sm:px-5 " +
              (activeSection ? "block h-[min(32rem,60dvh)]" : "hidden")
            }
          >
            {activeSection ? (
              <>
                {/* Sub-page head. The Back control is the phone's way out of a
                    section; from sm up the section list is already on screen. */}
                <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b border-[color:var(--edge)] bg-inherit px-4 py-1.5 sm:-mx-5 sm:px-5">
                  <button
                    onClick={() => setView("home")}
                    className="flex min-h-[36px] items-center gap-1 pr-2 text-[13px] text-parchment-400 transition hover:text-parchment sm:hidden"
                  >
                    <ChevronLeft aria-hidden className="h-4 w-4" />
                    Back
                  </button>
                  <span className="flex items-center gap-2 font-display text-[14px] font-semibold text-parchment-100">
                    <activeSection.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                    {activeSection.title}
                  </span>
                </div>
                <SettingsRows rows={activeSection.rows} settings={settings} update={update} />
              </>
            ) : (
              <p className="hidden pt-6 text-[13px] text-parchment-400 sm:block">
                Pick a section on the left.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
