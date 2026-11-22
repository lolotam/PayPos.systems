import type { NavigationStyle } from '@/workspace/nav-types';

import {
  findNavigationPageByPathname,
  findTopLevelGroupForPage,
  resolveMenuEntryForPathname,
} from '../navigation-model';

export interface CurrentPlace {
  pageId: string | undefined;
  topLevelId: string | undefined;
  listId: string | undefined;
}

/**
 * مكان المسار الحالي في نمط واحد: الصفحة الأم التي تحمل علامة «الحالي»، ومجموعتها العليا.
 * الصفحة الفرعية (إنشاء أو تفاصيل) تعلّم أمّها، ومسار غير معروف لا يعلّم شيئًا.
 */
export function currentPlace(style: NavigationStyle, pathname: string): CurrentPlace {
  const entry = resolveMenuEntryForPathname(pathname);
  if (entry === undefined || findNavigationPageByPathname(pathname) === undefined) {
    return { pageId: undefined, topLevelId: undefined, listId: undefined };
  }
  return {
    pageId: entry.id,
    topLevelId: findTopLevelGroupForPage(style, entry.id),
    listId: entry.submenu,
  };
}
