'use client';
import { t } from '@pospay/i18n';
import { NavTabs } from '@pospay/ui';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import {
  EMPLOYEE_DETAIL_TABS,
  EMPLOYEE_DETAIL_TAB_LABELS,
  employeeDetailHref,
  type EmployeeDetailTab,
} from '../model/employee-detail-tabs';

/** عناوين الصف كلها مسارات التطبيق نفسه؛ الضغطة العادية تنتقل داخل الصفحة بدل تحميلها كاملة. */
function softHref(event: MouseEvent<HTMLElement>): string | null {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  if (event.defaultPrevented || event.button !== 0 || modified) return null;
  if (!(event.target instanceof Element)) return null;
  return event.target.closest('a[href]')?.getAttribute('href') ?? null;
}

/** صف تبويبات الموظف كروابط؛ التبويب الحالي يحمل `aria-current="page"`. */
export function EmployeeDetailTabs({
  employeeId,
  current,
}: {
  employeeId: string;
  current: EmployeeDetailTab;
}) {
  const locale = useLocale();
  const router = useRouter();
  const items = EMPLOYEE_DETAIL_TABS.map((tab) => ({
    id: tab,
    label: t(locale, EMPLOYEE_DETAIL_TAB_LABELS[tab]),
    href: employeeDetailHref(employeeId, tab),
    current: tab === current,
  }));
  return (
    <div
      onClick={(event) => {
        const href = softHref(event);
        if (href === null) return;
        event.preventDefault();
        router.push(href);
      }}
    >
      <NavTabs items={items} labels={{ label: t(locale, 'leaveHistory.tabsLabel') }} />
    </div>
  );
}
