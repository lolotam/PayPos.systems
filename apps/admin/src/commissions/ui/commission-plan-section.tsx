'use client';

import type {
  CommissionPlanEmployeeListItem,
  CommissionPlanVersion,
  CommissionPlanVersionList,
} from '@pospay/contracts';
import { useEffect, useMemo, useState } from 'react';
import { isPlanNotFound, type PlanScope } from '../api/plan-access';
import { useCommissionPlanVersions } from '../api/use-commission-plan-versions';
import { useSaveCommissionPlan, type PlanAttemptMemory } from '../api/use-save-commission-plan';
import type { PlanDraft } from '../model/plan-draft';
import { draftFromVersion, emptyPlanDraft } from '../model/plan-draft';
import { useLocale } from '@/shared/locale/locale-context';
import { planRefusalMessage } from './plan-server-messages';
import { PlanBuilderForm } from './plan-builder-form';
import { PlanHistoryTable } from './plan-history-table';

/** مسودة بلوك الموظفة: أحدث نسخة مخزّنة، أو مسودة فاضية بيوم النشاط لو التاريخ لسه فاضي. */
function sectionDraft(page: CommissionPlanVersionList, timeZone: string): PlanDraft {
  const newest = page.items[0];
  return newest !== undefined ? draftFromVersion(newest) : emptyPlanDraft(timeZone, new Date());
}

/**
 * بلوك موظفة واحدة: المحرّر بيركب بس بعد نجاح أول صفحة تاريخ، وقيم النموذج بتعيش جوّه الفورم
 * نفسها فما بتتأثرش بإعادة جلب ولا تحميل صفحات أكتر؛ الحفظ الناجح بس هو اللي بيصفّر التاريخ
 * ويرجّع يركّب المحرّر على النسخة المخزّنة بعد ما الصفحة الأولى ترجع منها.
 */
export function CommissionPlanSection({
  scope,
  employee,
  employeeLabel,
  timeZone,
  memory,
}: {
  scope: PlanScope;
  employee: CommissionPlanEmployeeListItem;
  employeeLabel: string;
  timeZone: string;
  memory: PlanAttemptMemory;
}) {
  const locale = useLocale();
  const versions = useCommissionPlanVersions(scope, employee.id);
  const save = useSaveCommissionPlan(scope, employee.id, memory);
  const failure = versions.isError ? versions.error : null;
  const notFound = failure !== null && isPlanNotFound(failure);
  const firstPage = versions.data?.pages[0];
  const initial = useMemo(
    () => (firstPage === undefined ? null : sectionDraft(firstPage, timeZone)),
    [firstPage, timeZone],
  );
  // مفتاح النموذج من آخر نسخة محفوظة ناجحة بس: الحفظ اللي بيستنى أو بيرفض ما بيغيّرش المفتاح
  // فالمحرّر ما بيتركّبش من جديد وتعديلات المدير بتفضل مكانها لحد ما نجاح حقيقي يعيد الأساس.
  const [saved, setSaved] = useState<CommissionPlanVersion | null>(null);
  useEffect(() => {
    if (notFound) memory.current.delete(employee.id);
  }, [employee.id, memory, notFound]);

  if (notFound) return <p role="alert">{planRefusalMessage(failure, locale)}</p>;
  const items = versions.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <p className="font-semibold">{employeeLabel}</p>
      {failure !== null ? <p role="alert">{planRefusalMessage(failure, locale)}</p> : null}
      {initial !== null ? (
        <PlanBuilderForm
          key={saved === null ? 'initial' : saved.id}
          initial={saved === null ? initial : draftFromVersion(saved)}
          pending={save.isPending}
          serverError={save.error}
          onSubmit={(body) => save.mutate(body, { onSuccess: (version) => setSaved(version) })}
        />
      ) : null}
      {versions.data !== undefined ? (
        <PlanHistoryTable
          items={items}
          timeZone={timeZone}
          hasNextPage={versions.hasNextPage}
          loadingMore={versions.isFetchingNextPage}
          loadMoreError={versions.isFetchNextPageError}
          // نفس سبب اللقطة: الإلغاء وقت قفل النطاق بيرفض الوعد، والخطأ مسجّل في حالة الاستعلام.
          onLoadMore={() => versions.fetchNextPage().catch(() => undefined)}
        />
      ) : null}
    </div>
  );
}
