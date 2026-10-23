'use client';

import type { ReplaceStaffColumnsInput } from '@pospay/contracts';
import { useRef } from 'react';

type Attempt = { key: string; fingerprint: string };

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * مفتاح المحاولة الواحدة: نفس المسودة بتبعت بنفس المفتاح، والمسودة المتغيّرة بتبعت بمفتاح جديد.
 * السبب: لو الحفظ اتحفظ على السيرفر والرد ضاع، إعادة المحاولة بنفس المفتاح بتخلي السيرفر يعيد نفس النتيجة.
 */
export function useSaveAttemptKey(): {
  keyFor: (body: ReplaceStaffColumnsInput) => string;
  forget: () => void;
  forgetOnKnownError: (error: unknown) => void;
} {
  const attempt = useRef<Attempt | null>(null);
  const keyFor = (body: ReplaceStaffColumnsInput) => {
    const print = JSON.stringify(body);
    const held = attempt.current;
    if (held !== null && held.fingerprint === print) return held.key;
    const key = crypto.randomUUID();
    attempt.current = { key, fingerprint: print };
    return key;
  };
  const forget = () => {
    attempt.current = null;
  };
  const forgetOnKnownError = (error: unknown) => {
    // 409 IDEMPOTENCY_KEY_IN_PROGRESS معناه إن الطلب الأول لسه شغال، فالنتيجة مجهولة والمفتاح يفضل زي ما هو.
    if (codeOf(error) === 'IDEMPOTENCY_KEY_IN_PROGRESS') return;
    // رد 4xx تاني معناه إن النتيجة اتحددت، فالمحاولة الجاية محتاجة مفتاح جديد؛ 5xx أو فشل الشبكة النتيجة فيها مجهولة.
    const status = statusOf(error);
    if (status !== undefined && status >= 400 && status < 500) forget();
  };
  return { keyFor, forget, forgetOnKnownError };
}
