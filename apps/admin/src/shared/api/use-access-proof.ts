'use client';
import { useEffect, useRef, useState } from 'react';

export type AccessProof = 'pending' | 'granted' | 'refused' | 'failed';

function refusalStatus(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  return (error as { status?: unknown }).status;
}

/**
 * بيطلب إثبات قراءة حالي من الخادم لكل نطاق قبل عرض أي بيانات حساسة من الكاش:
 * على أول تركيب وعلى تغيير النطاق الإثبات يرجع pending لحد ما جولة جلب للنطاق النشط تخلص —
 * نجاح بيرجّع granted، ورفض (401/403) refused بيلغي أي بيانات متخزنة، وفشل عابر failed
 * عشان المستهلك يعرض رسالة إعادته الخاصة. جولات الجلب اللاحقة بتحدّث الإثبات باستمرار
 * (رفض حديث بيلغي الإثبات فورًا)، ونتيجة نطاق قديم ما بتأثرش لأن الحكم دايمًا على النطاق النشط.
 * مفيش قيم افتراضية عامة هنا: كل مستهلك حساس بيطلب إثباته بنفسه، والمنتقي والتمديد على سلوكهم.
 */
export function useAccessProof(
  isFetching: boolean,
  isError: boolean,
  error: unknown,
  scopeKey: string,
  enabled = true,
): AccessProof {
  const [proof, setProof] = useState<AccessProof>('pending');
  const provenScope = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (provenScope.current === scopeKey) return;
    provenScope.current = scopeKey;
    setProof('pending');
  }, [enabled, scopeKey]);
  useEffect(() => {
    if (!enabled || provenScope.current !== scopeKey || isFetching) return;
    if (isError) {
      const status = refusalStatus(error);
      setProof(status === 401 || status === 403 ? 'refused' : 'failed');
      return;
    }
    setProof('granted');
  }, [enabled, isError, error, isFetching, scopeKey]);
  // رفض من أي تحديث أحدث بيلغي الإثبات فورًا حتى لو الكاش فيه بيانات.
  if (isError) {
    const status = refusalStatus(error);
    return status === 401 || status === 403 ? 'refused' : 'failed';
  }
  return proof;
}
