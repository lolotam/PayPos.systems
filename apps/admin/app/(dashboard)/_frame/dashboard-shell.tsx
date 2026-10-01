'use client';

import type { ReactNode } from 'react';

import { WorkspaceProvider } from '@/workspace/model/workspace-provider';

import { DashboardFrame } from './dashboard-frame';

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <DashboardFrame>{children}</DashboardFrame>
    </WorkspaceProvider>
  );
}
