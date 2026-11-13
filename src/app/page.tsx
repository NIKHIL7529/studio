/**
 * Root page — renders the application shell and home/workspace entry screen.
 *
 * This is a Server Component. The AppShell and WorkspaceHome components
 * include "use client" only where browser APIs are needed.
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
