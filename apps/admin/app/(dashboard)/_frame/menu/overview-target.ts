import type { NavigationStyle } from '@/workspace/nav-types';

import { HOME_HREF } from '../frame-routes';
import { NAVIGATION_STYLES } from '../navigation-model';
import { buildGroupOverview, type GroupOverview } from './group-overview';
import type { MenuContext } from './menu-context';
import { resolveTopLevels } from './resolve-top-levels';

export type OverviewTarget =
  | { kind: 'overview'; overview: GroupOverview }
  | { kind: 'replace'; href: string };

/**
 * ما يفعله عنوان /overview/<مجموعة> في النمط الحالي: يعرض نظرة المجموعة إن كانت في هذا النمط وفيها صفحة
 * يراها المستخدم؛ وإلا يستبدل العنوان بأول صفحة مرئية من المجموعة نفسها في نمط آخر (المجموعة تخص نمطًا آخر،
 * أو بُدّل النمط وهو على نظرة لا يعرفها النمط الجديد)؛ والمجموعة المجهولة أو التي لا صفحة مرئية فيها
 * ترجع إلى الرئيسية.
 *
 * @param style النمط الحالي للمستخدم
 * @param groupId معرّف المجموعة كما في العنوان
 * @param ctx سياق القوائم: الترجمة والصفحات المرئية الآن
 * @returns النظرة العامة لعرضها، أو العنوان الذي يُستبدل به عنوان الصفحة
 */
export function resolveOverviewTarget(
  style: NavigationStyle,
  groupId: string,
  ctx: MenuContext,
): OverviewTarget {
  const overview = buildGroupOverview(style, groupId, ctx);
  if (overview !== undefined) return { kind: 'overview', overview };
  for (const other of NAVIGATION_STYLES.filter((option) => option !== style)) {
    const href = resolveTopLevels(other, ctx).find((item) => item.id === groupId)?.href;
    if (href !== undefined) return { kind: 'replace', href };
  }
  return { kind: 'replace', href: HOME_HREF };
}
