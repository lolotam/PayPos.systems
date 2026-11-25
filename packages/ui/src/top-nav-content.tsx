'use client';

import { useRef } from 'react';
import type { NavigationModule } from './navigation-presentation.js';
import { TopNavChrome } from './top-nav-chrome.js';
import { useTopNavSession, type NavigationLayout } from './top-nav-session.js';
import type { TopNavProps } from './top-nav-types.js';

type TopNavContentProps = Omit<TopNavProps, 'modules'> & {
  layout: NavigationLayout;
  visibilityKey: string;
  visibleModules: readonly NavigationModule[];
};

export function TopNavContent({
  layout,
  visibilityKey,
  visibleModules,
  ...chromeProps
}: TopNavContentProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const moduleTriggerRef = useRef<HTMLButtonElement>(null);
  const state = useTopNavSession({
    visibilityKey,
    layout,
    hasVisibleModules: visibleModules.length > 0,
    rootRef,
    drawerTriggerRef,
    moduleTriggerRef,
  });
  return (
    <TopNavChrome
      {...chromeProps}
      rootRef={rootRef}
      drawerTriggerRef={drawerTriggerRef}
      moduleTriggerRef={moduleTriggerRef}
      visibleModules={visibleModules}
      state={state}
    />
  );
}
