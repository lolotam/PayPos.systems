'use client';
import { useState } from 'react';
import { useSessionServices, type SessionServiceScope } from '../api/use-session-services';

type Decision = { scope: string; allowed: boolean; refusal: unknown };

function forbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 403;
}

// سياق التسجيل بقى مفتوح لصلاحية تغيير المنفّذين (PP-19.1)، فإذن التسجيل بيتعرف من قايمة الخدمات اللي لسه للتسجيل بس،
// بنفس مفتاح كاش حقل الخدمة فمفيش طلب زيادة. السماح من رد ناجح بس، والرفض من 403 بس؛ أي خطأ تاني قبل أول قرار
// ما بيفتحش الفورم وبيظهر إعادة محاولة. القرار بيتثبت بعد كده: تغيير اللغة بيعمل مفتاح جديد لسه بيحمّل، ولو القرار
// اتحسب منه الفورم كان هيتشال والمسودة تضيع، وإعادة جلب فاشلة ما بتغيّرش قرار اتاخد. تغيير الـ scope بيرجّعه للصفر.
export function useRecordPermission(scope: SessionServiceScope, enabled: boolean) {
  const services = useSessionServices(scope, '', enabled);
  const key = `${scope.companyId}:${scope.businessId}:${scope.branchId}:${scope.userId}`;
  const [stored, setStored] = useState<Decision | null>(null);
  const kept = stored?.scope === key ? stored : null;
  let next = kept;
  if (services.isSuccess) next = { scope: key, allowed: true, refusal: null };
  else if (services.isError && forbidden(services.error))
    next = { scope: key, allowed: false, refusal: services.error };
  if (
    next !== stored &&
    (next?.scope !== stored?.scope ||
      next?.allowed !== stored?.allowed ||
      next?.refusal !== stored?.refusal)
  )
    setStored(next);
  const failed = next === null && services.isError ? services.error : null;
  return {
    refused: next?.allowed === false,
    refusal: next?.allowed === false ? next.refusal : null,
    failed,
    retry: () => {
      void services.refetch();
    },
    // الفورم بيستنى أول قرار بس، عشان صاحب التغيير بس ما يشوفوش للحظة؛ بعد كده القرار المتثبت هو اللي بيحكم.
    waiting:
      next === null &&
      (failed !== null || (services.isPending && services.fetchStatus === 'fetching')),
  };
}
