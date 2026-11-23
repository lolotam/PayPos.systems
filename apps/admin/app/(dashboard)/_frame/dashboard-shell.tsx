'use client';

import type { ReactNode } from 'react';

import { WorkspaceProvider } from '@/workspace/model/workspace-provider';
import type { NavigationStyle } from '@/workspace/nav-types';

import { DashboardFrame } from './dashboard-frame';
import { NavStyleProvider } from './nav-style/nav-style-context';

export function DashboardShell({
  children,
  initialStyle,
}: {
  children: ReactNode;
  initialStyle: NavigationStyle;
}) {
  return (
    <NavStyleProvider initialStyle={initialStyle}>
      <WorkspaceProvider>
        <DashboardFrame>{children}</DashboardFrame>
      </WorkspaceProvider>
    </NavStyleProvider>
  );
}
