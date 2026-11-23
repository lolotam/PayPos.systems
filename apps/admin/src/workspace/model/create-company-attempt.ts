'use client';

import { createCompanyInput, type CreateCompanyInput } from '@pospay/contracts';

// اسم ثابت واحد: المحاولة غير المحسومة بتعيش هنا خارج المكوّن، عشان إعادة تركيب الصفحة أو تبويب
// تاني ما يقدروش يبعت مفتاح جديد ويعملوا شركة تانية والطلب الأول لسه شغال على السيرفر.
export const ATTEMPT_STORAGE_NAME = 'pospay.admin.create-company-attempt';

// السيرفر بيحتفظ بسجل مفتاح الـ Idempotency 24 ساعة، فأي محاولة أقدم من 23 تعتبر ميتة وتتنضف.
const ATTEMPT_MAX_AGE_MS = 23 * 60 * 60 * 1000;

/** محاولة إنشاء محفوظة: بلا `createdAt` لسه نتيجتها مجهولة، وبالعلامة معناها الشركة اتعملت
 * والقراءة ما شوفتهاش لسه — الاتنين بيمشوا بسقف الـ 23 ساعة نفسه. */
export type StoredAttempt = {
  userId: string;
  key: string;
  body: CreateCompanyInput;
  startedAt: string;
  createdAt?: string;
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
      (candidate.createdAt !== undefined && typeof candidate.createdAt !== 'string') ||
      !createCompanyInput.safeParse(candidate.body).success
    ) {
      return null;
    }
    return {
      userId: candidate.userId,
      key: candidate.key,
      body: candidate.body as CreateCompanyInput,
      startedAt: candidate.startedAt,
      ...(candidate.createdAt === undefined ? {} : { createdAt: candidate.createdAt as string }),
    };
  } catch {
    return null;
  }
}

// الوصول للتخزين ممكن يرمي (إعدادات خصوصية أو تخزين مليان): القراءة بترجع null والكتابة
// والشيل بترمض بصمت — الشاشة ساعتها بتنزل لنموذج عادي محمي بحرس قراءة مساحات العمل (077).
function attemptStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** بيقرا المحاولة غير المحسومة لنفس المستخدم؛ بتاعت مستخدم تاني أو قديمة أو تالفة بتتشال ويرجّع null. */
export function readAttempt(userId: string | undefined): StoredAttempt | null {
  if (typeof window === 'undefined' || userId === undefined) return null;
  const storage = attemptStorage();
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(ATTEMPT_STORAGE_NAME);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const stored = parseAttempt(raw);
  if (stored === null || stored.userId !== userId || expired(stored)) {
    removeAttempt();
    return null;
  }
  return stored;
}

export function writeAttempt(attempt: StoredAttempt): void {
  if (typeof window === 'undefined') return;
  const storage = attemptStorage();
  if (storage === null) return;
  try {
    storage.setItem(ATTEMPT_STORAGE_NAME, JSON.stringify(attempt));
  } catch {
    // التخزين مرفوض: بترمض، وحرس قراءة مساحات العمل في الـ mutationFn بيحمي من شركة تانية برضه.
  }
}

export function removeAttempt(): void {
  if (typeof window === 'undefined') return;
  const storage = attemptStorage();
  if (storage === null) return;
  try {
    storage.removeItem(ATTEMPT_STORAGE_NAME);
  } catch {
    // بترمض: ما فيش محاولة تتشال من التخزين، والحالة المحلية بتظل هي المرجع.
  }
}

/** بينشّئ علامة الإنشاء على محاولة نفس المستخدم بعد جواب 201؛ بتاعت مستخدم تاني ما بتتلمنش. */
export function markCreated(userId: string): StoredAttempt | null {
  if (typeof window === 'undefined') return null;
  const stored = readAttempt(userId);
  if (stored === null) return null;
  const created: StoredAttempt = { ...stored, createdAt: new Date().toISOString() };
  writeAttempt(created);
  return created;
}

/** الجواب مش قاطع: الرقم ضايع (فشل شبكة) أو 5xx أو 408/409/429 — الشركة ممكن تكون اتعملت فعلًا. */
export function isUndecided(error: unknown): boolean {
  const status = (error as { status?: unknown }).status;
  if (typeof status !== 'number') return true;
  return status >= 500 || status === 408 || status === 409 || status === 429;
}
