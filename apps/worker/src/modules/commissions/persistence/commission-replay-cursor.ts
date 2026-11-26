import { assertReplayBounds, ReplayCursorError } from '@pospay/db';

/**
 * حارس حدود الاستعادة: التحقق من المؤشرين قبل أي قراءة، والتعرّف على خطأ المؤشر الثابت.
 * الوحدة دي تملك استيراد `@pospay/db` وقت التشغيل لأن `jobs/` ما بيقدرش يورثه
 * (CLAUDE.architecture.md §3.1)، والمركّب هو اللي بيربطه.
 */
export const commissionReplayCursorGuard = {
  assertBounds: assertReplayBounds,
  isCursorError: (error: unknown): error is Error & { readonly code: string } =>
    error instanceof ReplayCursorError,
};
