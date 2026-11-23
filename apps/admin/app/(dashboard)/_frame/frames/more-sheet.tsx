'use client';

import { BottomSheet, cn, shellNavLinkClass } from '@pospay/ui';
import type { RefObject } from 'react';

import type { ResolvedTopLevel } from '../menu/resolve-top-levels';

interface MoreSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly ResolvedTopLevel[];
  title: string;
  closeLabel: string;
  currentPageId: string | undefined;
  currentGroupId: string | undefined;
  currentLabel: string;
  openerRef: RefObject<HTMLElement | null>;
  closeFocusTarget: () => HTMLElement | null | undefined;
}

/**
 * ورقة «المزيد» على هاتف النمط A: بقية الأقسام، وقوائمها الفرعية روابط مباشرة (app-map.md)،
 * فالطريق «المزيد ثم القائمة الفرعية ثم الصفحة» ثلاث ضغطات. الورقة مودالية تحبس التركيز
 * وتُغلق بالهروب ويعود التركيز إلى زر «المزيد»، وإغلاقها عند الانتقال يتولاه الإطار بتغيّر المسار.
 * القسم الحالي يحمل كلمة «الحالي»، ورابط القائمة الفرعية يحمل علامة «قريبًا» إذا كانت الصفحة التي يفتحها
 * (أولى صفحاتها) غير مبنية، فلا يضيع التمييز لأن اسم القائمة وحده لا يقول ذلك.
 */
export function MoreSheet({
  open,
  onOpenChange,
  groups,
  title,
  closeLabel,
  currentPageId,
  currentGroupId,
  currentLabel,
  openerRef,
  closeFocusTarget,
}: MoreSheetProps) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      closeLabel={closeLabel}
      openerRef={openerRef}
      closeFocusTarget={closeFocusTarget}
    >
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`more-${group.id}`} className="mb-3">
          <h2 id={`more-${group.id}`} className="text-sm font-semibold">
            {group.label}
            {group.id === currentGroupId ? (
              <span className="ms-2 text-xs font-normal text-muted-foreground">{currentLabel}</span>
            ) : null}
          </h2>
          <ul>
            {group.lists.map((list) => {
              const current = list.pages.some((page) => page.id === currentPageId);
              const status = list.pages[0]?.status;
              return (
                <li key={list.id}>
                  <a
                    href={list.href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(shellNavLinkClass, current && 'font-semibold')}
                  >
                    {list.label}
                    {status ? (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {status}
                      </span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </BottomSheet>
  );
}
