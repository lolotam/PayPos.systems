// أدوات التوافق مع الإشعارات: موديل الإشعارات الحقيقي بقيمه الافتراضية، وقناة بتمسك كل
// إرسال، وسجل اختباري فيه قالب التقييم زي ما بيكون بعد تركيب المرسل.
import {
  createTemplateRegistry,
  type Channel,
  type ChannelRequest,
  type ChannelResult,
  type TemplateDefinition,
} from '@pospay/notifications';
import { RATING_REQUEST_TEMPLATE_KEY, RATING_REQUEST_TEMPLATE_REVISION } from '@pospay/contracts';

import {
  createInAppNotificationModule,
  createNotificationModule,
} from '../../modules/notifications/index.ts';
import type { RatingClaimsWorld } from './rating-claims-world.types.ts';

/** إعداد موديل الإشعارات في الاختبار: وضع تجريبي ومفتاح بصمة ثابت للاختبار. */
const TEST_CONFIGURATION = {
  mode: 'fake' as const,
  hashKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  hashKeyId: 'rating-claims-test-v1',
};

/** قناة بتمسك كل طلب إرسال بدل ما تبعثه، عشان الاختبار يشوف إن مفيش إرسال حصل. */
export interface RecordingChannel extends Channel {
  readonly calls: readonly ChannelRequest[];
}

/** قناة تسجيل: بتفبل الإرسال وتكتبه، من غير ما يطلع أي طلب لبره. */
export function recordingChannel(): RecordingChannel {
  const calls: ChannelRequest[] = [];
  const send = async (request: ChannelRequest): Promise<ChannelResult> => {
    calls.push(request);
    return { kind: 'accepted', providerMessageId: 'recorded' };
  };
  return { calls, send };
}

/**
 * موديل الإشعارات الكامل بقيمه الافتراضية.
 *
 * السجل الافتراضي فيه قالب staffOtp بس، فطلب التقييم مالهوش قالب؛ ده هو الوضع الحقيقي
 * قبل ما يتركّب مرسل التقييم، والاختبار بيبني عليه. لما الاختبار يمرّر سجل، ده معناه
 * إن المرسل اتركّب.
 */
export function fullNotificationModule(
  world: RatingClaimsWorld,
  channel: Channel,
  registry?: ReturnType<typeof createTemplateRegistry>,
) {
  return createNotificationModule({
    database: world.base.db,
    ids: world.base.ids,
    clock: world.base.clock,
    configuration: TEST_CONFIGURATION,
    production: false,
    channel,
    ...(registry === undefined ? {} : { registry }),
  });
}

/**
 * موديل داخل التطبيق بس: مفيش قناة إرسال خالص، والإذن نفسه بيرفض التشغيل.
 *
 * ده الموديل اللي العامل بيشتغل بيه لحد ما الإشعارات تطلع، والطلب بيقع فيه زي ما
 * بيقع في الإنتاج: رفض بإذن مش موديل.
 */
export function inAppNotificationModule(world: RatingClaimsWorld) {
  return createInAppNotificationModule({
    database: world.base.db,
    ids: world.base.ids,
    clock: world.base.clock,
  });
}

/** قالب التقييم للاختبار: نفس معاملات مطالبة 2a بالظبط. */
const RATING_TEMPLATE: TemplateDefinition = {
  key: RATING_REQUEST_TEMPLATE_KEY,
  revision: RATING_REQUEST_TEMPLATE_REVISION,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    {
      name: 'customer_first_name',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
    },
    {
      name: 'business_name',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
    },
    {
      name: 'performers',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
    },
    {
      name: 'rating_request_id',
      type: 'text',
      required: true,
      sensitivity: 'safe',
      component: 'body',
      // المعرّف UUID طوله ٣٢ خانة، فقاعدة الأرقام ترفضه؛ نوع النص بيقبله زي ما هو.
      textKind: 'id',
    },
  ],
  copy: { ar: 'قيّم خدمتك', en: 'Rate our service' },
};

/**
 * سجل فيه قالب التقييم: ده شكل السجل بعد تركيب المرسل.
 *
 * الاختبار بيستخدمه بعد ما الطلب يكون اتستهلك، عشان يتأكد إن التركيب الجديد مبيعيدش
 * إرسال طلب خلص.
 */
export function ratingRegistryWithSender() {
  return createTemplateRegistry([RATING_TEMPLATE], {
    [RATING_REQUEST_TEMPLATE_KEY]: { ar: 'pospay_rating_ar', en: 'pospay_rating_en' },
  });
}
