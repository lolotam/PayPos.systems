import type { RefObject } from 'react';
import type { NavigationChromeLabels, NavigationModule } from './navigation-presentation.js';

export type TopNavProps = {
  modules: readonly NavigationModule[];
  labels: NavigationChromeLabels;
  currentModuleId?: string | undefined;
  activePageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  onNavigate?: (() => void) | undefined;
  /** 'none' يترك رسم القائمة المحلية للمستضيف ليضعها بجانب الصفحة؛ الافتراضي يرسمها تحت الشريط. */
  localNav?: 'stacked' | 'none' | undefined;
  /** يغيّره المستضيف عند كل انتقال ليُغلق المنيو الواسع والدرج دون إعادة بناء الشريط؛ الغياب لا يغيّر شيئًا. */
  resetKey?: string | undefined;
};

export type TopNavRefs = {
  drawerTriggerRef: RefObject<HTMLButtonElement | null>;
  moduleTriggerRef: RefObject<HTMLButtonElement | null>;
};
