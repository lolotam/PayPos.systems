import { HOME_HREF } from '../frame-routes';
import { findNavigationPageByPathname, pageEntryHref } from '../navigation-model';
import { soonPageHref } from '@/workspace/model/navigation-rules';
import type { MenuContext } from './menu-context';

export type SoonTarget =
  | { kind: 'not-found' }
  | { kind: 'forward'; href: string }
  | { kind: 'under-development'; name: string; homeHref: string };

/**
 * ما يفعله عنوان /soon/<صفحة>: المعرّف المجهول وكل مدخل لا يراه المستخدم الآن (نوع نشاط أو دور) صفحة غير موجودة؛
 * والمدخل الذي صار مبنيًا يحوَّل إلى عنوانه الحقيقي إن كان مرئيًا؛ وغير المبني المرئي يفتح صفحة قيد التطوير باسمه.
 * الرؤية هنا هي نفس قائمة القوائم وباحث الصفحات، فلا يفتح الرابط المباشر ما تخفيه القوائم (FR-023).
 *
 * @param pageId المعرّف كما في العنوان
 * @param ctx سياق القوائم: الترجمة والصفحات المرئية الآن
 * @returns الوجهة التي يقرّرها العنوان
 */
export function resolveSoonTarget(pageId: string, ctx: MenuContext): SoonTarget {
  const entry = findNavigationPageByPathname(soonPageHref(pageId));
  if (entry === undefined || !ctx.visibleIds.includes(entry.id)) return { kind: 'not-found' };
  if (entry.state === 'live') return { kind: 'forward', href: pageEntryHref(entry) };
  return { kind: 'under-development', name: ctx.translate(entry.labelKey), homeHref: HOME_HREF };
}
