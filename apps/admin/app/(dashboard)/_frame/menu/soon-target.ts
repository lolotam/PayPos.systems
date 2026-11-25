import { HOME_HREF } from '../frame-routes';
import {
  NAVIGATION_PAGES,
  pageSoonDestination,
  promotedSoonDestination,
} from '../navigation-model';
import { findNavigationEntryByPathname, soonPageHref } from '@/workspace/model/navigation-rules';
import type { NavigationPageEntry } from '@/workspace/nav-types';
import type { MenuContext } from './menu-context';

export type SoonTarget =
  | { kind: 'not-found' }
  | { kind: 'forward'; href: string }
  | { kind: 'under-development'; name: string; homeHref: string };

/**
 * ما يفعله عنوان /soon/<صفحة>: المعرّف المجهول وكل مدخل لا يراه المستخدم الآن (نوع نشاط أو دور) صفحة غير موجودة؛
 * والمدخل الذي صار مبنيًا يحوَّل إلى وجهته الملموسة إن كان مرئيًا، وإلا يغلق إلى غير موجود متى افتقر لوجهة صريحة ملموسة (#1167)؛
 * وغير المبني المرئي يفتح صفحة قيد التطوير باسمه.
 * الرؤية هنا هي نفس قائمة القوائم وباحث الصفحات، فلا يفتح الرابط المباشر ما تخفيه القوائم (FR-023).
 *
 * @param pageId المعرّف كما في العنوان
 * @param ctx سياق القوائم: الترجمة والصفحات المرئية الآن
 * @param pages قائمة الصفحات المراد البحث ضمنها (الافتراضي كل صفحات التطبيق)
 * @returns الوجهة التي يقرّرها العنوان
 */
export function resolveSoonTarget(
  pageId: string,
  ctx: MenuContext,
  pages: readonly NavigationPageEntry[] = NAVIGATION_PAGES,
): SoonTarget {
  const entry = findNavigationEntryByPathname(soonPageHref(pageId), pages);
  if (entry === undefined || !ctx.visibleIds.includes(entry.id)) return { kind: 'not-found' };
  if (entry.state === 'live') {
    const href =
      pages === NAVIGATION_PAGES
        ? pageSoonDestination(entry)
        : promotedSoonDestination(entry, new Map(pages.map((item) => [item.id, item])));
    return href === undefined ? { kind: 'not-found' } : { kind: 'forward', href };
  }
  return { kind: 'under-development', name: ctx.translate(entry.labelKey), homeHref: HOME_HREF };
}
