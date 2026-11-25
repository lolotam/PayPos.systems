import type { createTemplateRegistry } from '@pospay/notifications';
import { type Channel, type TemplateComponent } from '@pospay/notifications';
import {
  RATING_REQUEST_TEMPLATE_KEY,
  RATING_TOKEN_KEY_VERSION_MAX,
  RATING_TOKEN_KEY_VERSION_PARAMETER,
} from '@pospay/contracts';

import { refusedResult, submissionResult, type Attempt } from '../domain/attempt-status.ts';
import type { ChannelPort, RatingTokenSender, SendConfiguration } from '../ports/channel.port.ts';

/** مدخلات تركيب رابط التقييم وقت الإرسال: المشتق في الذاكرة والأصل المتحقق منه؛ أي واحد null يعني قفل مغلق. */
export interface RatingLinkOptions {
  readonly token: RatingTokenSender | null;
  readonly origin: string | null;
}

/** معاملات القالب بعد فصل إصدار المفتاح، ومعها الإصدار وهوية الطلب لاشتقاق الرابط. */
interface RatingSplit {
  readonly parameters: Attempt['safeParameters'];
  readonly keyVersion: number;
  readonly ratingRequestId: string;
}

/** إصدار المفتاح عدد صحيح بين 1 وأكبر إصدار يقبله المشتق. */
function validKeyVersion(value: string | number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= RATING_TOKEN_KEY_VERSION_MAX
  );
}

/**
 * يفصل معامل إصدار المفتاح عن معاملات القالب قبل التحقق منها، لأن القالب المعتمد لا يعرفه.
 *
 * @param attempt لقطة محاولة طلب التقييم
 * @returns المعاملات بلا الإصدار مع الإصدار وهوية الطلب، أو null لو الإصدار أو الهوية ناقصة أو غير صالحة
 */
function splitRatingParameters(attempt: Attempt): RatingSplit | null {
  const version = attempt.safeParameters.find((p) => p.name === RATING_TOKEN_KEY_VERSION_PARAMETER);
  const id = attempt.safeParameters.find((p) => p.name === 'rating_request_id');
  if (version === undefined || version.type !== 'number' || !validKeyVersion(version.value))
    return null;
  if (id === undefined || typeof id.value !== 'string') return null;
  return {
    parameters: attempt.safeParameters.filter((p) => p.name !== RATING_TOKEN_KEY_VERSION_PARAMETER),
    keyVersion: version.value,
    ratingRequestId: id.value,
  };
}

/** يشتق رابط التقييم في الذاكرة: الأصل ثم # ثم التوكن؛ يرجع null لو أي مكون غير متاح فيُغلق الإرسال. */
function ratingLink(attempt: Attempt, split: RatingSplit, link: RatingLinkOptions): string | null {
  if (link.token === null || link.origin === null) return null;
  const token = link.token.token(
    { companyId: attempt.companyId, ratingRequestId: split.ratingRequestId },
    split.keyVersion,
  );
  return token === null ? null : `${link.origin}/#${token}`;
}

/** نتيجة تحضير المحاولة: القالب المحضّر (أو null لو معاملات التقييم ناقصة)، والرابط المشتق، وهوية الطلب اللي يُستبدل مكانها. */
interface PreparedAttempt {
  readonly prepared: ReturnType<ReturnType<typeof createTemplateRegistry>['prepare']> | null;
  readonly url: string | null;
  readonly id: string | null;
}

/** يحضّر القالب؛ لطلب التقييم يفصل إصدار المفتاح أولاً ويشتق الرابط في الذاكرة، ولغيره يمرّر المعاملات كما هي. */
function prepareAttempt(
  registry: ReturnType<typeof createTemplateRegistry>,
  link: RatingLinkOptions,
  attempt: Attempt,
  locale: 'ar' | 'en',
): PreparedAttempt {
  const { templateKey, templateRevision } = attempt;
  if (templateKey !== RATING_REQUEST_TEMPLATE_KEY)
    return {
      prepared: registry.prepare(templateKey, templateRevision, locale, attempt.safeParameters),
      url: null,
      id: null,
    };
  const split = splitRatingParameters(attempt);
  if (split === null) return { prepared: null, url: null, id: null };
  return {
    prepared: registry.prepare(templateKey, templateRevision, locale, split.parameters),
    url: ratingLink(attempt, split, link),
    id: split.ratingRequestId,
  };
}

/** يبني مكوّنات جديدة يحل فيها الرابط مكان معرّف الطلب، من غير تعديل لقطة المحاولة. */
function withLink(
  components: readonly TemplateComponent[],
  id: string | null,
  url: string | null,
): readonly TemplateComponent[] {
  if (url === null) return components;
  return components.map((component) => ({
    ...component,
    parameters: component.parameters.map((p) => (p.text === id ? { ...p, text: url } : p)),
  }));
}

/**
 * يركّب محول القناة؛ لقالب التقييم فقط يفصل إصدار المفتاح ويحل الرابط في الذاكرة وقت الإرسال،
 * ولا يعدّل لقطة المحاولة ولا يخزن الرابط أو يسجّله.
 *
 * @param channel قناة الإرسال
 * @param registry سجل القوالب المعتمدة
 * @param link مشتق الرابط والأصل لقالب التقييم، وبدونهما يُرفض قالب التقييم بـ CONFIG_INVALID
 * @returns منفذ القناة مع فحص الإعداد
 */
export function createChannelAdapter(
  channel: Channel,
  registry: ReturnType<typeof createTemplateRegistry>,
  link: RatingLinkOptions = { token: null, origin: null },
): ChannelPort & SendConfiguration {
  const isRating = (attempt: Attempt) => attempt.templateKey === RATING_REQUEST_TEMPLATE_KEY;
  return {
    failure: (attempt) => {
      if (attempt.locale === null) return 'LOCALE_MISSING';
      const { prepared, url } = prepareAttempt(registry, link, attempt, attempt.locale);
      if (prepared === null) return 'CONFIG_INVALID';
      if (!prepared.valid) return prepared.code;
      if (prepared.name !== attempt.providerTemplateName) return 'CONFIG_INVALID';
      return isRating(attempt) && url === null ? 'CONFIG_INVALID' : null;
    },
    send: async (attempt) => {
      if (attempt.locale === null || attempt.phone === null)
        return refusedResult('DESTINATION_INVALID');
      const { prepared, url, id } = prepareAttempt(registry, link, attempt, attempt.locale);
      if (prepared === null || !prepared.valid || prepared.name !== attempt.providerTemplateName)
        return refusedResult('CONFIG_INVALID');
      if (isRating(attempt) && url === null) return refusedResult('CONFIG_INVALID');
      const result = await channel.send({
        phone: attempt.phone,
        locale: attempt.locale,
        deadline: attempt.deadline,
        providerTemplateName: prepared.name,
        components: withLink(prepared.components, id, url),
      });
      if (result.kind === 'refused') return refusedResult('CONFIG_INVALID');
      return submissionResult(result);
    },
  };
}
