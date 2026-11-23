'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

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
  closeFloating: () => void;
}

/**
 * حالة لوحة نمط C. على الحاسوب يخفيها المستخدم أو يظهرها وتبقى كذلك بين الصفحات.
 * وهي طافية تُفتح للرابط الحالي فقط (مفتاح الانتقال: المسار مع الاستعلام)، والمساحة المعاينة للمسار فقط: كل تغيّر
 * مرحلي، بما فيه الرجوع، يُغلق الطافية، ويعيد تغيّر المسار المعاينة إلى المساحة الحالية؛ أما مرشّح صفحة
 * (استعلام) فلا يمسّ معاينة اللوحة الدائمة على الحاسوب. الضغطة بمفتاح تعديل لا تغيّر المسار فتبقى مفتوحة.
 * كل فتح يسجّل الزر الذي فتح به (الشريط أو الأداة العلوية) ليعود إليه التركيز عند الإغلاق.
 * ظهور اللوحة على الحاسوب وفتحها الطافي حالتان منفصلتان: فعل أحدهما لا يمسّ الآخر، والطافية تُمحى عند
 * مغادرة عرض التابلت فلا تعود مفتوحة عند الرجوع إليه.
 */
export function usePanelState(
  navigationKey: string,
  pathname: string,
  currentWorkspaceId: string | undefined,
  openerRef: RefObject<HTMLButtonElement | null>,
): PanelState {
  const floating = useMediaQuery(FLOATING_QUERY);
  const [hidden, setHidden] = useState(false);
  const [floatingOpen, setFloatingOpen] = useRouteScopedState(navigationKey, false);
  const [inspectedId, setInspectedId] = useRouteScopedState<string | undefined>(
    pathname,
    undefined,
  );
  const wasFloating = useRef(floating);
  useEffect(() => {
    if (wasFloating.current && !floating) setFloatingOpen(false);
    wasFloating.current = floating;
  }, [floating, setFloatingOpen]);
  const open = floating ? floatingOpen : !hidden;
  const show = (opener: HTMLButtonElement) => {
    openerRef.current = opener;
    if (floating) setFloatingOpen(true);
    else setHidden(false);
  };
  const hide = () => {
    if (floating) setFloatingOpen(false);
    else setHidden(true);
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
  return {
    open,
    inspectedId,
    inspect,
    inspectOnly: setInspectedId,
    show,
    hide,
    closeFloating: () => setFloatingOpen(false),
  };
}
