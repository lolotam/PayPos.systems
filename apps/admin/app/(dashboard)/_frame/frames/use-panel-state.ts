'use client';

import { useState, type RefObject } from 'react';

import { useMediaQuery } from './use-media-query';
import { useRouteScopedState } from './use-route-scoped-state';

// نفس استعلام ContextPanel: بين 600 و1023px تطفو اللوحة فوق الصفحة بدل أن تأخذ مكانًا.
const FLOATING_QUERY = '(min-width: 600px) and (width < 1024px)';

export interface PanelState {
  open: boolean;
  inspectedId: string | undefined;
  inspect: (workspaceId: string, opener: HTMLButtonElement) => void;
  inspectOnly: (workspaceId: string) => void;
  show: (opener: HTMLButtonElement) => void;
  hide: () => void;
}

/**
 * حالة لوحة نمط C. على الحاسوب يخفيها المستخدم أو يظهرها وتبقى كذلك بين الصفحات.
 * وهي طافية تُفتح للصفحة الحالية فقط، والمساحة المعاينة كذلك: كل تغيّر مرحلي في المسار، بما فيه
 * الرجوع، يُغلق الطافية ويعيد المعاينة إلى المساحة الحالية. الضغطة بمفتاح تعديل لا تغيّر المسار فتبقى مفتوحة.
 * كل فتح يسجّل الزر الذي فتح به (الشريط أو الأداة العلوية) ليعود إليه التركيز عند الإغلاق.
 */
export function usePanelState(
  pathname: string,
  currentWorkspaceId: string | undefined,
  openerRef: RefObject<HTMLButtonElement | null>,
): PanelState {
  const floating = useMediaQuery(FLOATING_QUERY);
  const [hidden, setHidden] = useState(false);
  const [floatingOpen, setFloatingOpen] = useRouteScopedState(pathname, false);
  const [inspectedId, setInspectedId] = useRouteScopedState<string | undefined>(
    pathname,
    undefined,
  );
  const open = floating ? floatingOpen : !hidden;
  const show = (opener: HTMLButtonElement) => {
    openerRef.current = opener;
    setHidden(false);
    setFloatingOpen(true);
  };
  const hide = () => {
    setHidden(true);
    setFloatingOpen(false);
  };
  const inspect = (workspaceId: string, opener: HTMLButtonElement) => {
    if (open && (inspectedId ?? currentWorkspaceId) === workspaceId) {
      openerRef.current = opener;
      hide();
      return;
    }
    setInspectedId(workspaceId);
    show(opener);
  };
  return { open, inspectedId, inspect, inspectOnly: setInspectedId, show, hide };
}
