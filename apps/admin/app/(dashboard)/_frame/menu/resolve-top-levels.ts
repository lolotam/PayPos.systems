import type { MessageKey } from '@pospay/i18n';
import type { NavigationPage } from '@pospay/ui';

import type {
  NavigationIconName,
  NavigationPageEntry,
  NavigationStyle,
} from '@/workspace/nav-types';

import { NAVIGATION_GROUPINGS, NAVIGATION_PAGES, pageEntryHref } from '../navigation-model';
import type { MenuContext } from './menu-context';

export interface ResolvedList {
  id: string;
  label: string;
  href: string;
  pages: NavigationPage[];
}

export interface ResolvedTopLevel {
  id: string;
  label: string;
  description: string | undefined;
  iconName: NavigationIconName;
  bottomBar: boolean;
  href: string;
  lists: ResolvedList[];
}

interface RawList {
  id: string;
  labelKey: MessageKey;
  pageIds: readonly string[];
}

interface RawTopLevel {
  id: string;
  labelKey: MessageKey;
  descriptionKey?: MessageKey;
  icon: NavigationIconName;
  bottomBar?: boolean;
  lists: readonly RawList[];
}

const ENTRIES_BY_ID: ReadonlyMap<string, NavigationPageEntry> = new Map(
  NAVIGATION_PAGES.map((entry) => [entry.id, entry]),
);

function rawTopLevels(style: NavigationStyle): readonly RawTopLevel[] {
  if (style === 'A')
    return NAVIGATION_GROUPINGS.A.map((group) => ({ ...group, lists: group.tabs }));
  if (style === 'B')
    return NAVIGATION_GROUPINGS.B.map((item) => ({ ...item, lists: item.columns }));
  return NAVIGATION_GROUPINGS.C.map((item) => ({ ...item, lists: item.panelSections }));
}

/** صفحة القائمة: المدخل غير المبني يحمل علامة «قريبًا» ويفتح صفحة قيد التطوير. */
export function toNavigationPage(entry: NavigationPageEntry, ctx: MenuContext): NavigationPage {
  const page: NavigationPage = {
    id: entry.id,
    label: ctx.translate(entry.labelKey),
    href: pageEntryHref(entry),
  };
  return entry.state === 'soon' ? { ...page, status: ctx.translate('adminNav.soonBadge') } : page;
}

function visibleList(raw: RawList, ctx: MenuContext): ResolvedList | undefined {
  const pages = raw.pageIds
    .filter((id) => ctx.visibleIds.includes(id))
    .flatMap((id) => {
      const entry = ENTRIES_BY_ID.get(id);
      return entry === undefined ? [] : [toNavigationPage(entry, ctx)];
    });
  const first = pages[0];
  if (first === undefined) return undefined;
  return { id: raw.id, label: ctx.translate(raw.labelKey), href: first.href, pages };
}

/**
 * المستوى الأعلى لنمط واحد بعد حذف كل قائمة فرعية ومجموعة بلا صفحة مرئية (FR-010).
 * الأنماط الثلاثة تمر من هنا، فلا يستطيع نمط أن يعرض صفحة لا يعرضها غيره.
 */
export function resolveTopLevels(style: NavigationStyle, ctx: MenuContext): ResolvedTopLevel[] {
  return rawTopLevels(style).flatMap((raw) => {
    const lists = raw.lists.flatMap((list) => visibleList(list, ctx) ?? []);
    const first = lists[0]?.pages[0];
    if (first === undefined) return [];
    return [
      {
        id: raw.id,
        label: ctx.translate(raw.labelKey),
        description:
          raw.descriptionKey === undefined ? undefined : ctx.translate(raw.descriptionKey),
        iconName: raw.icon,
        bottomBar: raw.bottomBar === true,
        href: first.href,
        lists,
      },
    ];
  });
}
