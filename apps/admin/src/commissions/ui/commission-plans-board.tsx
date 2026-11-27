'use client';

import type { CommissionPlanEmployeeListItem } from '@pospay/contracts';
import { usePlanAccess, type PlanScope } from '../api/plan-access';
import { isCursorUnavailable } from '../api/plan-access';
import { useCommissionPlanEmployees } from '../api/use-commission-plan-employees';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import {
  CommissionPlanEmployeePicker,
  commissionPlanEmployeeLabel,
} from '../ui/commission-plan-employee-picker';
import type { PlanAttemptMemory } from '../api/use-save-commission-plan';
import { CommissionBlockedCorrectionsSection } from '../ui/commission-blocked-corrections-section';
import { planRefusalMessage } from '../ui/plan-server-messages';
import { useState, type ReactNode } from 'react';

/** الاختيار اللي بتسلّمه اللقطة للشاشة اللي تحته: الموظفة والتسمية وتوقيت النشاط. */
export type PlanBoardSelection = { employee: CommissionPlanEmployeeListItem; employeeLabel: string; timeZone: string };
interface CommissionPlansBoardProps {
  scope: PlanScope;
  renderSection(selection: PlanBoardSelection): ReactNode;
  /** لو اتبعتت بتظهر تحت اللقطة قائمة التصحيحات الموقوفة وإصلاحها (شاشة الخطط)، وغيابها بيخفي القسم (شاشة التجاوزات). */
  memory?: PlanAttemptMemory;
}

/**
 * لقطة الموظفين والتاريخ لموظفة مختارة: بيبنيوا على أول صفحة موظفين ناجحة، والاختيار عايش هنا
 * فبيضيع لوحده مع قفل الوصول ومفيش استعادة للاختيار القديم بعد «جرّب تاني».
 */
export function CommissionPlansBoard({ scope, renderSection, memory }: CommissionPlansBoardProps) {
  const locale = useLocale();
  const [selectedId, setSelectedId] = useState('');
  const employees = useCommissionPlanEmployees(scope);
  const access = usePlanAccess(scope);
  const items = employees.data?.pages.flatMap((page) => page.items) ?? [];
  const timeZone = employees.data?.pages[0]?.time_zone ?? 'UTC';
  const selected = items.find((item) => item.id === selectedId) ?? null;
  // البيانات المحفوظة هي الشرط مش isSuccess: إعادة جلب خلفية فاشلة بتفضل اللقطة ظاهرة وتحتها رسالة الخطأ.
  const showPicker = !access.denied && employees.data !== undefined;
  return (
    <>
      {employees.isError ? (
        <p role="alert">
          {isCursorUnavailable(employees.error)
            ? t(locale, 'errors.COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE')
            : planRefusalMessage(employees.error, locale)}
        </p>
      ) : null}
      {employees.isFetchNextPageError ? (
        <p role="alert">{t(locale, 'commissionPlanBuilder.couldNotLoadMore')}</p>
      ) : null}
      {showPicker ? (
        <CommissionPlanEmployeePicker
          items={items}
          hasNextPage={employees.hasNextPage}
          loadingMore={employees.isFetchingNextPage}
          // جلب الصفحة التالية ممكن يرفض CancelledError لما 403 يقفل النطاق ويلغي الطلب،
          // والفشل نفسه مسجّل في حالة الاستعلام فالرسالة وزرار المحاولة بيبانوا عادي.
          onLoadMore={() => employees.fetchNextPage().catch(() => undefined)}
          value={selectedId}
          onChange={setSelectedId}
        />
      ) : null}
      {selected !== null
        ? renderSection({ employee: selected, employeeLabel: commissionPlanEmployeeLabel(selected, locale), timeZone })
        : null}
      {showPicker && memory !== undefined ? (
        <CommissionBlockedCorrectionsSection
          scope={scope}
          employees={items}
          timeZone={timeZone}
          memory={memory}
        />
      ) : null}
    </>
  );
}
