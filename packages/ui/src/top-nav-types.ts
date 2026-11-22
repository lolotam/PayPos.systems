import type { RefObject } from 'react';
import type { NavigationChromeLabels, NavigationModule } from './navigation-presentation.js';

export type TopNavProps = {
  modules: readonly NavigationModule[];
  labels: NavigationChromeLabels;
  currentModuleId?: string | undefined;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onNavigate?: (() => void) | undefined;
};

export type TopNavRefs = {
  drawerTriggerRef: RefObject<HTMLButtonElement | null>;
  moduleTriggerRef: RefObject<HTMLButtonElement | null>;
};
