/**
 * AppShell — the top-level application chrome.
 *
 * Provides a fixed topbar, a content area and a narrow status bar at the
 * bottom. The shell itself does not contain routing logic; that lives in the
 * Next.js layout.
 */

import * as React from "react";
import { Divider } from "@/components/ui";
import { AppLogo } from "@/components/AppLogo";

// ─── TopBar ───────────────────────────────────────────────────────────────────

function TopBar() {
  return (
    <header
      className={[
        "flex items-center justify-between",
        "h-11 px-4",
        "bg-cs-bg-surface border-b border-cs-border-subtle",
        "shrink-0 z-10",
      ].join(" ")}
      role="banner"
    >
      {/* Left: logo + app name */}
      <div className="flex items-center gap-3">
        <AppLogo size={22} />
        <span className="text-sm font-semibold text-cs-text-primary tracking-tight">
          Content Studio
        </span>
        <span className="text-xs text-cs-text-tertiary hidden sm:inline">
          — local video editor
        </span>
      </div>

      {/* Right: placeholder for future global controls */}
      <nav aria-label="Application navigation" className="flex items-center gap-1">
        {/*
          Phase 1: No real navigation controls exist yet.
          The nav element is present for accessibility/landmark purposes.
          Controls will be added as features are implemented in later phases.
        */}
      </nav>
    </header>
  );
}

// ─── StatusBar ────────────────────────────────────────────────────────────────

function StatusBar() {
  return (
    <footer
      className={[
        "flex items-center justify-between",
        "h-6 px-4",
        "bg-cs-bg-base border-t border-cs-border-subtle",
        "shrink-0",
      ].join(" ")}
      role="contentinfo"
    >
      <span className="text-[11px] text-cs-text-tertiary">Phase 2 — Workspace & Local Persistence</span>
      <span className="text-[11px] text-cs-text-tertiary">Content Studio 0.1.0</span>
    </footer>
  );
}

// ─── Narrow-viewport notice ───────────────────────────────────────────────────

function NarrowViewportNotice() {
  return (
    <aside
      className={[
        "flex flex-col items-center justify-center gap-3 p-6 text-center",
        "sm:hidden",
        "bg-cs-bg-elevated border-b border-cs-border-default",
      ].join(" ")}
      aria-label="Browser window size notice"
    >
      <p className="text-xs text-cs-text-secondary max-w-xs">
        Content Studio is designed for desktop use. For the best experience open it in a full-sized
        browser window.
      </p>
    </aside>
  );
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex flex-col h-screen min-h-0 bg-cs-bg-base overflow-hidden">
      <TopBar />
      <NarrowViewportNotice />
      <Divider />
      <main
        id="main-content"
        className="flex-1 overflow-auto min-h-0"
        role="main"
      >
        {children}
      </main>
      <StatusBar />
    </div>
  );
}

