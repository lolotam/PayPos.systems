import type { AuthDatabase } from '@pospay/db';

/** حد الخمول: أقصى فترة بلا لمس قبل ما النافذة تصرف. */
export const PRIVATE_VIEW_IDLE_MS = 60_000;
/** سقف عمر النافذة من فتحها؛ الخمول عمره ما بيعديش السقف. */
export const PRIVATE_VIEW_CAP_MS = 300_000;
/**
 * عمر دليل PIN: قاعدة مستقلة عن حد الخمول.
 * القيمتين النهارده سواء، بس كل واحد بيلزمه سطر في الـ ADR: الدليل بتقادمه، والنافذة بلمسها.
 */
export const PRIVATE_VIEW_PROOF_MAX_AGE_MS = 60_000;

/** مصدر عشوائي مستقل عن الزمن والجلسة حتى لا يصبح window_id قابلاً للتنبؤ. */
export interface PrivateViewEntropy {
  /** يعيد عدد البايتات المطلوب لمادة عشوائية جديدة. */
  bytes(n: number): Uint8Array;
}

/** اعتمادات المخزن المحدود؛ كل زمن ومعرف وعشوائية تأتي من منافذ مركبة في config. */
export interface PrivateViewStoreOptions {
  readonly database: AuthDatabase;
  readonly ids: {
    /** ينشئ مفتاح صف verification فقط، لا window_id. */
    newId(): string;
  };
  readonly entropy: PrivateViewEntropy;
  /** يعيد عينة الساعة؛ الفتح بياخدها من جوه قفل صف الجلسة، والفحص بياخدها مرة واحدة للطلب. */
  now(): Date;
}
