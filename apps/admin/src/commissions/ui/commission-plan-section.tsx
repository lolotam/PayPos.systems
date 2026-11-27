'use client';

import type {
  CommissionPlanEmployeeListItem,
  CommissionPlanVersion,
  CommissionPlanVersionList,
} from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isPlanNotFound, usePlanAccess, type PlanScope } from '../api/plan-access';
import { useCommissionPlanSeed } from '../api/use-commission-plan-seed';
import { useCommissionPlanVersions } from '../api/use-commission-plan-versions';
import { useSaveCommissionPlan, type PlanAttemptMemory } from '../api/use-save-commission-plan';
import type { PlanDraft } from '../model/plan-draft';
import { draftFromVersion, emptyPlanDraft } from '../model/plan-draft';
import { useLocale } from '@/shared/locale/locale-context';
import { planRefusalMessage } from './plan-server-messages';
import { PlanBuilderForm } from './plan-builder-form';
import { PlanHistoryTable } from './plan-history-table';

/** مسودة بلوك الموظفة: أحدث نسخة عادية، أو مسودة فاضية بيوم النشاط لما القراءة تأكد إن مفيش نسخة عادية. */
function sectionDraft(newest: CommissionPlanVersion | null, timeZone: string): PlanDraft {
  return newest !== null ? draftFromVersion(newest) : emptyPlanDraft(timeZone, new Date());
}

/**
 * المسودة بتتثبّت مرة واحدة بعد نجاح البذرة وأول صفحة تاريخ مع بعض: أحدث نسخة عادية في
 * الصفحة (لو اتقدّمت على البذرة) هي الأساس، وإلا بذرة `kind=ordinary` هي الأساس.
 * مفيش إعادة جلب: البذرة الأقدم ما بتستنىش، لأنها بتتقفل بقراءة الصفحة نفسها.
 */
function useInitialDraft(
  seed: Pick<UseQueryResult<CommissionPlanVersion | null>, 'data'>,
  firstPage: CommissionPlanVersionList | undefined,
  timeZone: string,
): PlanDraft | null {
  const [initial, setInitial] = useState<PlanDraft | null>(null);
  const { data } = seed;
  if (initial === null && data !== undefined && firstPage !== undefined) {
    // أول صفحة تاريخ ممكن تبقى كلها إصلاحات، فالنسخة العادية من جواها هي المرجع الأحدث.
    const ordinary = firstPage.items.find((item) => item.repair_period === null);
    if (ordinary !== undefined && (data === null || ordinary.version > data.version)) {
      setInitial(draftFromVersion(ordinary));
    } else {
      setInitial(sectionDraft(data, timeZone));
    }
  }
  return initial;
}

/**
 * بلوك موظفة واحدة: المحرّر بيركب بعد نجاح قراءة أحدث نسخة عادية (من البذرة أو من أول صفحة
 * تاريخ لما تكون أحدث منها)، وفشل القراءة بيظهر رسالة من غير محرّر، وقيم النموذج بتعيش جوّه
 * الفورم نفسها فما بتتأثرش بإعادة جلب ولا تحميل صفحات أكتر؛ الحفظ الناجح بس هو اللي بيرجّع يركّب المحرّر.
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
  const seed = useCommissionPlanSeed(scope, employee.id);
  const failure = versions.isError ? versions.error : seed.isError ? seed.error : null;
  const notFound = failure !== null && isPlanNotFound(failure);
  const access = usePlanAccess(scope);
  const initial = useInitialDraft(seed, versions.data?.pages[0], timeZone);
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
      {initial !== null && !access.denied ? (
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
