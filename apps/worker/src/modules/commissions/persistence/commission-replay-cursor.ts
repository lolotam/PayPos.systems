import { assertReplayBounds } from '@pospay/db';

/**
 * حارس حدود الاستعادة: التحقق من المؤشرين قبل أي قراءة. الوحدة دي تملك استيراد
 * `@pospay/db` وقت التشغيل لأن `jobs/` ما بيقدرش يورثه (CLAUDE.architecture.md §3.1)،
 * والمركّب هو اللي بيربطه.
 */
export const commissionReplayCursorGuard = {
  assertBounds: assertReplayBounds,
};
