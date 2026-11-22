'use client';

import { useState, type RefObject } from 'react';

import { useMediaQuery } from './use-media-query';

// نفس استعلام ContextPanel: بين 600 و1023px تطفو اللوحة فوق الصفحة بدل أن تأخذ مكانًا.
const FLOATING_QUERY = '(min-width: 600px) and (width < 1024px)';

export interface PanelState {
  open: boolean;
  inspectedId: string | undefined;
  inspect: (workspaceId: string, opener: HTMLButtonElement) => void;
  inspectOnly: (workspaceId: string) => void;
  show: () => void;
  hide: () => void;
}

/**
 * حالة لوحة نمط C. على الحاسوب يخفيها المستخدم أو يظهرها وتبقى كذلك بين الصفحات.
 * وهي طافية تُفتح لمسار واحد فقط، فأي انتقال في نفس التبويب يغيّر المسار فتُغلق من تلقاء نفسها،
 * أما الضغطة بمفتاح تعديل فلا تغيّر المسار فتبقى مفتوحة. المساحة المعاينة تُنسى عند تغيّر المسار أيضًا.
 */
export function usePanelState(
  pathname: string,
  currentWorkspaceId: string | undefined,
  openerRef: RefObject<HTMLButtonElement | null>,
): PanelState {
  const floating = useMediaQuery(FLOATING_QUERY);
  const [hidden, setHidden] = useState(false);
  const [floatingPath, setFloatingPath] = useState<string | null>(null);
  const [inspected, setInspected] = useState<{ path: string; id: string } | null>(null);
  const open = floating ? floatingPath === pathname : !hidden;
  const inspectedId = inspected?.path === pathname ? inspected.id : undefined;
  const show = () => {
    setHidden(false);
    setFloatingPath(pathname);
  };
  const hide = () => {
    setHidden(true);
    setFloatingPath(null);
  };
  const inspectOnly = (workspaceId: string) => setInspected({ path: pathname, id: workspaceId });
  const inspect = (workspaceId: string, opener: HTMLButtonElement) => {
    openerRef.current = opener;
    if (open && (inspectedId ?? currentWorkspaceId) === workspaceId) {
      hide();
      return;
    }
    inspectOnly(workspaceId);
    show();
  };
  return { open, inspectedId, inspect, inspectOnly, show, hide };
}
