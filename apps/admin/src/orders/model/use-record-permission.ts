'use client';
import { useState } from 'react';
import { useSessionServices, type SessionServiceScope } from '../api/use-session-services';

type Decision = { allowed: boolean; refusal: unknown };

function forbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 403;
}

// سياق التسجيل بقى مفتوح لصلاحية تغيير المنفّذين (PP-19.1)، فإذن التسجيل بيتعرف من قايمة الخدمات اللي لسه للتسجيل بس،
// بنفس مفتاح كاش حقل الخدمة فمفيش طلب زيادة. القرار بيتثبت من آخر رد خلص: تغيير اللغة بيعمل مفتاح جديد لسه بيحمّل،
// ولو القرار اتحسب منه الفورم كان هيتشال ويرجع والمسودة اللي ما اتحفظتش تضيع. الصفحة متركّبة بمفتاح الـ scope، فالقرار لكل scope.
export function useRecordPermission(scope: SessionServiceScope, enabled: boolean) {
  const services = useSessionServices(scope, '', enabled);
  const [decision, setDecision] = useState<Decision | null>(null);
  let next = decision;
  if (services.isSuccess) next = { allowed: true, refusal: null };
  else if (services.isError) {
    next = forbidden(services.error)
      ? { allowed: false, refusal: services.error }
      : { allowed: true, refusal: null };
  }
  if (
    next !== decision &&
    (next?.allowed !== decision?.allowed || next?.refusal !== decision?.refusal)
  )
    setDecision(next);
  return {
    refused: next?.allowed === false,
    refusal: next?.allowed === false ? next.refusal : null,
    // الفورم بيستنى أول رد بس، عشان صاحب التغيير بس ما يشوفوش للحظة؛ بعد كده القرار المتثبت هو اللي بيحكم.
    waiting: next === null && services.isPending && services.fetchStatus === 'fetching',
  };
}
