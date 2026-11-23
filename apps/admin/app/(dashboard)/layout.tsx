import type { ReactNode } from 'react';

import { SessionGate } from '@/session/pages/session-gate';

import { DashboardShell } from './_frame/dashboard-shell';
import { readRequestNavStyle } from './_frame/nav-style/request-nav-style';

// Cross-area composition lives in app/ (CLAUDE.architecture.md §11.2): session guards the route,
// the frame joins the session actions with the workspace selector. The navigation style is read here,
// on the server, so the first paint already draws the style the user chose (no other style flashes).
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const initialStyle = await readRequestNavStyle();
  return (
    <SessionGate>
      <DashboardShell initialStyle={initialStyle}>{children}</DashboardShell>
    </SessionGate>
  );
}
