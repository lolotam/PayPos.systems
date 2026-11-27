import { createPlatformEmailDatabase } from '@pospay/db';
import type { Logger } from '@pospay/observability';

import { createResendIntake } from './modules/notifications/index.ts';
import { closeOptional, optionalWithin } from './shared/optional-capability.ts';

type ResendIntake = ReturnType<typeof createResendIntake>;

/** استقبال ردّ المزود وقاعدته المحصورة — اللي بيقفلهم جذر التركيب وقت التوقف. */
export interface EmailFeedbackIntake {
  readonly resend: ResendIntake;
  readonly database: ReturnType<typeof createPlatformEmailDatabase>;
}

/**
 * يشغّل استقبال ردّ المزود على بريد Resend. بيركب على نفس قاعدة الإشعارات المحصورة بس بيحتاج سرّ
 * الـ webhook الخاص بيه: من غيره المسار بيرد NOT_READY ومفيش حاجة بتتخزّن. أي فشل بيقفل
 * الاستقبال من غير ما يوقّف الـ API.
 *
 * @param options قاعدة الإشعارات وإعدادات العملية
 * @param options.intakeUrl عنوان قاعدة الإشعارات المحصورة، أو غايب لما القناة مش مضبوطة
 * @param options.production هل العملية إنتاج
 * @param options.trustedProxy قائمة الـ proxy الموثوقة
 * @param options.redisUrl عنوان Redis
 * @param options.env بيئة العملية
 * @param options.logger المسجّل المشترك
 * @returns الاستقبال والقاعدة، أو undefined لما معطّل أو فشل
 */
export async function startEmailFeedbackIntake(options: {
  intakeUrl: string | undefined;
  production: boolean;
  trustedProxy: readonly string[];
  redisUrl: string;
  env: NodeJS.ProcessEnv;
  logger: Logger;
}): Promise<EmailFeedbackIntake | undefined> {
  const { intakeUrl, logger } = options;
  const report = (state: 'READY' | 'UNAVAILABLE' | 'DISABLED', reason?: string) =>
    logger[state === 'READY' ? 'info' : state === 'DISABLED' ? 'info' : 'warn'](
      { capability: { name: 'EMAIL_FEEDBACK_INTAKE', state, ...(reason ? { reason } : {}) } },
      'email feedback intake capability',
    );
  if (intakeUrl === undefined) {
    report('DISABLED', 'NOT_CONFIGURED');
    return undefined;
  }
  let database: ReturnType<typeof createPlatformEmailDatabase> | undefined;
  let resend: ResendIntake | undefined;
  try {
    // بلا proxy موثوق في الإنتاج كل الطلبات بتوصل من عنوان الـ proxy نفسه، فحد المزوّد لكل IP
    // بيبقى دلو واحدة، والـ 503 هو السلوك المتعمد (spec 075 FR-001).
    if (options.production && options.trustedProxy.length === 0)
      throw new Error('EMAIL_FEEDBACK_CAPABILITY_UNAVAILABLE');
    database = createPlatformEmailDatabase({ url: intakeUrl });
    const intake = createResendIntake(database, options.redisUrl, options.env, logger);
    resend = intake;
    await optionalWithin(() => intake.ready());
    report('READY');
    return { resend: intake, database };
  } catch (error) {
    report(
      'UNAVAILABLE',
      error instanceof Error && error.message === 'RESEND_EVENT_DIGEST_KEY_INVALID'
        ? 'EVENT_DIGEST_KEY_MISSING_OR_INVALID'
        : 'SETUP_FAILED',
    );
    await closeOptional([() => resend?.close(true), () => database?.close(true)]);
    return undefined;
  }
}
