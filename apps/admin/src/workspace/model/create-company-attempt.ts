'use client';

import { createCompanyInput, type CreateCompanyInput } from '@pospay/contracts';
import { useEffect, useState } from 'react';

// اسم ثابت واحد: المحاولة غير المحسومة بتعيش هنا خارج المكوّن، عشان إعادة تركيب الصفحة أو تبويب
// تاني ما يقدروش يبعت مفتاح جديد ويعملوا شركة تانية والطلب الأول لسه شغال على السيرفر.
export const ATTEMPT_STORAGE_NAME = 'pospay.admin.create-company-attempt';

// السيرفر بيحتفظ بسجل مفتاح الـ Idempotency 24 ساعة، فأي محاولة أقدم من 23 تعتبر ميتة وتتنضف.
const ATTEMPT_MAX_AGE_MS = 23 * 60 * 60 * 1000;

/** محاولة إنشاء لسه نتيجتها مجهولة، محفوظة باسم المستخدم عشان تبويب تاني ما ياخدهوش بالغلط. */
export type StoredAttempt = {
  userId: string;
  key: string;
  body: CreateCompanyInput;
  startedAt: string;
};

function expired(stored: StoredAttempt): boolean {
  const started = Date.parse(stored.startedAt);
  return Number.isNaN(started) || Date.now() - started > ATTEMPT_MAX_AGE_MS;
}

function parseAttempt(raw: string): StoredAttempt | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.userId !== 'string' ||
      typeof candidate.key !== 'string' ||
      typeof candidate.startedAt !== 'string' ||
      typeof candidate.body !== 'object' ||
      candidate.body === null ||
      !createCompanyInput.safeParse(candidate.body).success
    ) {
      return null;
    }
    return {
      userId: candidate.userId,
      key: candidate.key,
      body: candidate.body as CreateCompanyInput,
      startedAt: candidate.startedAt,
    };
  } catch {
    return null;
  }
}

/** بيقرا المحاولة غير المحسومة لنفس المستخدم؛ بتاعت مستخدم تاني أو قديمة أو تالفة بتتشال ويرجّع null. */
export function readAttempt(userId: string | undefined): StoredAttempt | null {
  if (typeof window === 'undefined' || userId === undefined) return null;
  const raw = window.localStorage.getItem(ATTEMPT_STORAGE_NAME);
  if (raw === null) return null;
  const stored = parseAttempt(raw);
  if (stored === null || stored.userId !== userId || expired(stored)) {
    window.localStorage.removeItem(ATTEMPT_STORAGE_NAME);
    return null;
  }
  return stored;
}

export function writeAttempt(attempt: StoredAttempt): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ATTEMPT_STORAGE_NAME, JSON.stringify(attempt));
}

export function removeAttempt(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ATTEMPT_STORAGE_NAME);
}

/** الجواب مش قاطع: الرقم ضايع (فشل شبكة) أو 5xx أو 408/409/429 — الشركة ممكن تكون اتعملت فعلًا. */
export function isUndecided(error: unknown): boolean {
  const status = (error as { status?: unknown }).status;
  if (typeof status !== 'number') return true;
  return status >= 500 || status === 408 || status === 409 || status === 429;
}

/** بيقرا المحاولة المخزّنة، يتبع كتابة تبويب تاني عبر حدث storage، ويعيد القراءة كل ما الطلب يستقر. */
export function useStoredAttempt(
  userId: string | undefined,
  isPending: boolean,
  isSuccess: boolean,
  isError: boolean,
): StoredAttempt | null {
  const [stored, setStored] = useState<StoredAttempt | null>(() => readAttempt(userId));
  useEffect(() => {
    setStored(readAttempt(userId));
  }, [isError, isPending, isSuccess, userId]);
  useEffect(() => {
    if (userId === undefined) return undefined;
    const onStorage = (event: StorageEvent) => {
      if (event.key === ATTEMPT_STORAGE_NAME || event.key === null) setStored(readAttempt(userId));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId]);
  return stored;
}
