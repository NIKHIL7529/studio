"use client";

/**
 * Root page — renders the application shell and home/workspace entry screen.
 */

import { AppShell } from "@/components/AppShell";
import { WorkspaceHome } from "@/components/WorkspaceHome";

export default function HomePage() {
  return (
    <AppShell>
      <WorkspaceHome />
    </AppShell>
  );
}
