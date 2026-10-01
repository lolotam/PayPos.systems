import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { DashboardShell } from '@/shared/frame/dashboard-shell';

import { readSession } from '../api/server-session';
import { SessionUnavailable } from '../ui/session-unavailable';

export async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await readSession();
  if (session.kind === 'anonymous') redirect('/login');
  if (session.kind === 'error') return <SessionUnavailable />;
  return <DashboardShell>{children}</DashboardShell>;
}
