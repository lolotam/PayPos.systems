import type { ReactNode } from 'react';

import { SessionGate } from '@/session/pages/session-gate';

import { DashboardShell } from './_frame/dashboard-shell';

// Cross-area composition lives in app/ (CLAUDE.architecture.md §11.2): session guards the route,
// the frame joins the session actions with the workspace selector.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      <DashboardShell>{children}</DashboardShell>
    </SessionGate>
  );
}
