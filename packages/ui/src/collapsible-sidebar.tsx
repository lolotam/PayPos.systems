'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { SidebarGroups } from './collapsible-sidebar-groups.js';
import { CollapseToggle } from './collapsible-sidebar-toggle.js';
import { useDirection } from './direction-provider.js';
import type { NavigationGroup } from './navigation-presentation.js';
import { cn } from './shared/cn.js';
import { useNavigationMedia } from './use-navigation-media.js';

export type CollapsibleSidebarProps = {
  title: string;
  collapseLabel: string;
  expandLabel: string;
  groups: readonly NavigationGroup[];
  currentGroupId?: string | undefined;
  currentPageId?: string | undefined;
  visiblePageIds?: readonly string[] | undefined;
  /** محتوى رأس الشريط — يُرسم في نفس صف مبدّل الطي، ويختفي في الشريط المطويّ. */
  header?: ReactNode;
  footer?: ReactNode;
};

type SidebarFocusOrigin = {
  element: Element;
  inSidebar: boolean;
};

function useSidebarBreakpointFocus(
  isTablet: boolean,
  asideRef: RefObject<HTMLElement | null>,
  toggleRef: RefObject<HTMLButtonElement | null>,
) {
  const previousTablet = useRef(isTablet);
  const focusOrigin = useRef<SidebarFocusOrigin | undefined>(undefined);

  useEffect(() => {
    const rememberFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      focusOrigin.current = {
        element: target,
        inSidebar: asideRef.current?.contains(target) ?? false,
      };
    };
    // ضغطة على جزء غير قابل للتركيز بتودّي التركيز للـ body من غير focusin جديد. بعد pointerup
    // وبعد click بنسأل سؤال واحد: التركيز لسه جوه الشريط؟ مكان الضغط أو الإفلات مش مهم.
    // click ضروري لأن متصفحات اللمس بتطبّق تغيير التركيز بعد pointerup، وقت أحداث الماوس المتوافقة.
    const forgetOnOutsidePress = () => {
      if (!asideRef.current?.contains(document.activeElement)) focusOrigin.current = undefined;
    };
    document.addEventListener('focusin', rememberFocus);
    document.addEventListener('pointerup', forgetOnOutsidePress, true);
    document.addEventListener('click', forgetOnOutsidePress, true);
    return () => {
      document.removeEventListener('focusin', rememberFocus);
      document.removeEventListener('pointerup', forgetOnOutsidePress, true);
      document.removeEventListener('click', forgetOnOutsidePress, true);
    };
  }, [asideRef]);

  useEffect(() => {
    const wasTablet = previousTablet.current;
    if (wasTablet === isTablet) return;
    previousTablet.current = isTablet;

    const active = document.activeElement;
    const origin =
      active !== null && asideRef.current?.contains(active)
        ? { element: active, inSidebar: true }
        : focusOrigin.current;
    if (!origin?.inSidebar) return;

    if (isTablet) {
      if (origin.element.isConnected && origin.element !== toggleRef.current) return;
      asideRef.current?.querySelector<HTMLAnchorElement>('nav a[href]')?.focus();
      return;
    }
    if (origin.element === toggleRef.current || !origin.element.isConnected) {
      toggleRef.current?.focus();
    }
  }, [asideRef, isTablet, toggleRef]);
}

export function CollapsibleSidebar({
  title,
  collapseLabel,
  expandLabel,
  groups,
  currentGroupId,
  currentPageId,
  visiblePageIds,
  header,
  footer,
}: CollapsibleSidebarProps) {
  const dir = useDirection();
  const [expanded, setExpanded] = useState(true);
  const isPhone = useNavigationMedia('(width < 600px)');
  const isTablet = useNavigationMedia('(600px <= width < 1024px)');
  const asideRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useSidebarBreakpointFocus(isTablet, asideRef, toggleRef);

  if (isPhone) return null;

  const rail = isTablet || !expanded;
  return (
    <aside
      ref={asideRef}
      dir={dir}
      data-collapsed={rail ? '' : undefined}
      className={cn(
        'fixed inset-y-0 start-0 z-30 hidden flex-col overflow-y-auto bg-sidebar text-sidebar-foreground transition-[width] duration-200 motion-reduce:transition-none min-[600px]:flex',
        rail ? 'w-20' : 'w-66',
      )}
    >
      <CollapseToggle
        dir={dir}
        expanded={expanded}
        collapseLabel={collapseLabel}
        expandLabel={expandLabel}
        toggleRef={toggleRef}
        onToggle={() => setExpanded((value) => !value)}
        header={rail ? undefined : header}
      />
      <SidebarGroups
        groups={groups}
        title={title}
        rail={rail}
        currentGroupId={currentGroupId}
        currentPageId={currentPageId}
        visiblePageIds={visiblePageIds}
      />
      {footer && !rail ? <div className="shrink-0 p-2">{footer}</div> : null}
    </aside>
  );
}
