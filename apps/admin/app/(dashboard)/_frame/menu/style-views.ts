import type {
  NavigationGroup,
  NavigationModule,
  NavigationWorkspace,
  ShellNavItem,
} from '@pospay/ui';

import { overviewHref } from '../frame-routes';
import { currentPlace } from './current-page';
import type { MenuContext } from './menu-context';
import { resolveTopLevels, type ResolvedList, type ResolvedTopLevel } from './resolve-top-levels';

export interface StyleAView {
  groups: NavigationGroup[];
  currentGroupId: string | undefined;
  currentPageId: string | undefined;
  tabs: ShellNavItem[];
  pills: ShellNavItem[];
  bottom: ShellNavItem[];
  more: ResolvedTopLevel[];
}

export interface StyleBView {
  modules: NavigationModule[];
  currentModuleId: string | undefined;
  activePageId: string | undefined;
}

export interface StyleCView {
  workspaces: NavigationWorkspace[];
  currentWorkspaceId: string | undefined;
  activePageId: string | undefined;
  bottom: ShellNavItem[];
}

const sectionsOf = (lists: readonly ResolvedList[]) =>
  lists.map(({ id, label, pages }) => ({ id, label, pages }));

function topLevelItem(item: ResolvedTopLevel, current: boolean, ctx: MenuContext): ShellNavItem {
  return {
    id: item.id,
    label: item.label,
    href: item.href,
    icon: ctx.icon?.(item.iconName),
    current,
  };
}

function pillsOf(
  list: ResolvedList | undefined,
  currentPageId: string | undefined,
): ShellNavItem[] {
  if (list === undefined || list.pages.length < 2) return [];
  return list.pages.map((page) => ({ ...page, current: page.id === currentPageId }));
}

/** النمط A: شريط جانبي بمجموعات، وتبويبات المجموعة الحالية، وحبوب القائمة الفرعية الحالية. */
export function buildStyleAView(ctx: MenuContext): StyleAView {
  const top = resolveTopLevels('A', ctx);
  const place = currentPlace('A', ctx.pathname);
  const group = top.find((item) => item.id === place.topLevelId);
  const list = group?.lists.find((item) => item.id === place.listId);
  return {
    groups: top.map((item) => ({
      id: item.id,
      label: item.label,
      href: item.href,
      icon: ctx.icon?.(item.iconName),
      pages: item.lists.flatMap((entry) => entry.pages),
    })),
    currentGroupId: place.topLevelId,
    currentPageId: place.pageId,
    tabs: (group?.lists ?? []).map((item) => ({
      id: item.id,
      label: item.label,
      href: item.href,
      current: item.id === list?.id,
    })),
    pills: pillsOf(list, place.pageId),
    bottom: top
      .filter((item) => item.bottomBar)
      .map((item) => topLevelItem(item, item.id === place.topLevelId, ctx)),
    more: top.filter((item) => !item.bottomBar),
  };
}

/** النمط B: وحدات الشريط العلوي، لكل وحدة أعمدتها وصفحة نظرة عامة. */
export function buildStyleBView(ctx: MenuContext): StyleBView {
  const top = resolveTopLevels('B', ctx);
  const place = currentPlace(
    'B',
    ctx.pathname,
    top.map((item) => item.id),
  );
  return {
    modules: top.map((item) => ({
      id: item.id,
      label: item.label,
      href: overviewHref(item.id),
      sections: sectionsOf(item.lists),
    })),
    currentModuleId: place.topLevelId,
    activePageId: place.pageId,
  };
}

/**
 * النمط C: مساحات العمل على الشريط، وأقسام كل مساحة، وتبويبات الهاتف السفلية.
 * تبويب الهاتف يفتح صفحة نظرة عامة للمساحة (design.md §4)، لا أول صفحة فيها.
 */
export function buildStyleCView(ctx: MenuContext): StyleCView {
  const top = resolveTopLevels('C', ctx);
  const place = currentPlace(
    'C',
    ctx.pathname,
    top.map((item) => item.id),
  );
  return {
    workspaces: top.map((item) => ({
      id: item.id,
      label: item.label,
      icon: ctx.icon?.(item.iconName),
      sections: sectionsOf(item.lists),
    })),
    currentWorkspaceId: place.topLevelId,
    activePageId: place.pageId,
    bottom: top.map((item) => ({
      ...topLevelItem(item, item.id === place.topLevelId, ctx),
      href: overviewHref(item.id),
    })),
  };
}
