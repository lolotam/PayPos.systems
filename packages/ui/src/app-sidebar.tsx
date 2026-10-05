'use client';
import { useSyncExternalStore, type ReactNode } from 'react';
import { AppSidebarContent } from './app-sidebar-content.js';
import { AppSidebarDrawer } from './app-sidebar-drawer.js';

export type AppSidebarProps = {
  title: string;
  openLabel: string;
  closeLabel: string;
  header: ReactNode;
  navigation: ReactNode;
  footer: ReactNode;
};

function subscribe(callback: () => void) {
  const media = window.matchMedia('(min-width: 768px)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}
const desktopSnapshot = () => window.matchMedia('(min-width: 768px)').matches;
const serverSnapshot = () => false;

export function AppSidebar(props: AppSidebarProps) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
  const content = (
    <AppSidebarContent
      title={props.title}
      header={props.header}
      navigation={props.navigation}
      footer={props.footer}
    />
  );
  if (desktop)
    return (
      <aside className="fixed inset-y-0 start-0 z-30 flex w-72 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground">
        {content}
      </aside>
    );
  return (
    <AppSidebarDrawer title={props.title} openLabel={props.openLabel} closeLabel={props.closeLabel}>
      {content}
    </AppSidebarDrawer>
  );
}
