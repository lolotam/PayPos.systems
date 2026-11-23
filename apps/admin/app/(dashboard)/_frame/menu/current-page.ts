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

const OVERVIEW_PATH = /^\/overview\/([^/]+)\/?$/;

/**
 * مكان المسار الحالي في نمط واحد: الصفحة الأم التي تحمل علامة «الحالي»، ومجموعتها العليا.
 * الصفحة الفرعية (إنشاء أو تفاصيل) تعلّم أمّها، ومسار غير معروف لا يعلّم شيئًا.
 * عنوان النظرة العامة الذي يولّده النموذج نفسه (/overview/<مجموعة>) يعلّم مجموعته دون صفحة
 * إذا كانت من المجموعات المرئية في هذا النمط (B وC فقط)، فتبقى وحدة B وقائمتها المحلية ظاهرتين.
 */
export function currentPlace(
  style: NavigationStyle,
  pathname: string,
  overviewGroupIds: readonly string[] = [],
): CurrentPlace {
  const overviewId = OVERVIEW_PATH.exec(pathname)?.[1];
  if (overviewId !== undefined && overviewGroupIds.includes(overviewId)) {
    return { pageId: undefined, topLevelId: overviewId, listId: undefined };
  }
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
