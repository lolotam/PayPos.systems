import type { HubCardItem } from '@pospay/ui';

import type { NavigationStyle } from '@/workspace/nav-types';

import type { MenuContext } from './menu-context';
import { resolveTopLevels } from './resolve-top-levels';

export interface OverviewSection {
  id: string;
  label: string;
  items: HubCardItem[];
}

export interface GroupOverview {
  id: string;
  label: string;
  description: string | undefined;
  sections: OverviewSection[];
}

/**
 * صفحات مجموعة واحدة في النمط الحالي كبطاقات محور (B وC).
 * المجموعة المجهولة أو التي لا صفحة مرئية فيها لا ترجع شيئًا، والمسار يحوّلها إلى الرئيسية.
 * وصف البطاقة هو اسم قائمتها الفرعية، لأن المدخل نفسه لا يحمل وصفًا.
 */
export function buildGroupOverview(
  style: NavigationStyle,
  groupId: string,
  ctx: MenuContext,
): GroupOverview | undefined {
  const group = resolveTopLevels(style, ctx).find((item) => item.id === groupId);
  if (group === undefined) return undefined;
  return {
    id: group.id,
    label: group.label,
    description: group.description,
    sections: group.lists.map((list) => ({
      id: list.id,
      label: list.label,
      items: list.pages.map((page) => ({ ...page, description: list.label })),
    })),
  };
}
