import type { PushChannel, PushRequest, PushResult, PushTarget } from '../push/channel.ts';
import { readPushWorkerConfiguration } from '../push/worker-configuration.ts';

/** خيارات الطلب اللي بتتبعت لخدمة الدفع: مدة البقاء والأولوية والموضوع والمهلة ومفاتيح VAPID. */
export interface WebPushRequestOptions {
  readonly TTL: number;
  readonly urgency: 'high';
  readonly topic: string;
  readonly timeout: number;
  readonly vapidDetails: {
    readonly subject: string;
    readonly publicKey: string;
    readonly privateKey: string;
  };
}

/** المرسل: بياخد الوجهة والحمولة وخيارات الطلب وبيرد برمز حالة بس. */
export type WebPushSender = (
  target: PushTarget,
  payload: string,
  options: WebPushRequestOptions,
) => Promise<{ statusCode: number }>;

/** إعدادات قناة الدفع: مفاتيح VAPID والساعة ومهلة الطلب والمرسل. */
export interface WebPushChannelOptions {
  readonly vapid: {
    readonly subject: string;
    readonly publicKey: string;
    readonly privateKey: string;
  };
  readonly now: () => Date;
  readonly timeoutMs?: number;
  readonly sender?: WebPushSender;
}

// المكتبة بتتحمّل عند أول إرسال حقيقي بس: الـ API بيستورد الحزمة دي، فاستيرادها ما يحمّلش web-push.
type WebPushLibrary = {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: WebPushRequestOptions,
  ): Promise<{ statusCode: number }>;
};

// المرسل الافتراضي: طلب واحد لمكتبة web-push، والرد بيتقلّم لرقم الحالة بس.
const librarySender: WebPushSender = async (target, payload, options) => {
  const { default: webpush } = (await import('web-push')) as unknown as {
    default: WebPushLibrary;
  };
  const response = await webpush.sendNotification(
    { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
    payload,
    options,
  );
  return { statusCode: response.statusCode };
};

/**
 * قناة الدفع الحقيقية: بتعمل طلب واحد لخدمة الدفع وبترجّع النتيجة من غير إعادة محاولة.
 * القاعدة: جسم المزود ورأسه وعنوان نقطة الدفع ما بيوصلوش للنتيجة أبداً، وأي خطأ بيتحوّل لسبب محدود.
 */
export class WebPushChannel implements PushChannel {
  readonly #sender: WebPushSender;
  readonly #now: () => Date;
  readonly #timeoutMs: number;
  readonly #vapid: WebPushRequestOptions['vapidDetails'];

  constructor(options: WebPushChannelOptions) {
    const readiness = readPushWorkerConfiguration({
      VAPID_PUBLIC_KEY: options.vapid.publicKey,
      VAPID_PRIVATE_KEY: options.vapid.privateKey,
      VAPID_SUBJECT: options.vapid.subject,
    });
    if (!readiness.ready) throw new Error('PUSH_PROVIDER_CONFIG_INVALID');
    this.#vapid = {
      subject: readiness.configuration.subject,
      publicKey: readiness.configuration.publicKey,
      privateKey: readiness.configuration.privateKey,
    };
    this.#now = options.now;
    this.#timeoutMs = Math.min(10_000, Math.max(1, options.timeoutMs ?? 10_000));
    this.#sender = options.sender ?? librarySender;
  }

  async send(request: PushRequest): Promise<PushResult> {
    const current = this.#now().getTime();
    // فحص الموعد مجاور لبدء الطلب: ما فيش await ولا إعادة تقديم قبله.
    if (request.deadline !== null && current >= request.deadline.getTime())
      return { kind: 'expired' };
    const remaining =
      request.deadline === null ? this.#timeoutMs : request.deadline.getTime() - current;
    try {
      const response = await this.#sender(request.target, request.payload, {
        TTL: request.ttlSeconds,
        urgency: request.urgency,
        topic: request.topic,
        timeout: Math.min(this.#timeoutMs, remaining),
        vapidDetails: this.#vapid,
      });
      return typeof response.statusCode === 'number'
        ? mapStatus(response.statusCode)
        : networkUnknown();
    } catch (error) {
      const status = statusOf(error);
      return status === null ? networkUnknown() : mapStatus(status);
    }
  }
}

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function mapStatus(status: number): PushResult {
  // كود الحالة بره المدى المسموح مش بيتخزّن: قيد قاعدة البيانات بين 100 و599.
  if (status < 100 || status > 599)
    return { kind: 'unknown', code: 'NETWORK_UNKNOWN', outcomeKnown: false, httpStatus: null };
  if (status >= 200 && status < 300) return { kind: 'accepted', httpStatus: status };
  if (status === 404 || status === 410) return { kind: 'gone', httpStatus: status };
  if (status >= 400 && status < 500)
    return {
      kind: 'rejected',
      code: status === 429 ? 'PROVIDER_429' : 'PROVIDER_4XX',
      httpStatus: status,
      vapidRejected: status === 401 || status === 403,
    };
  if (status >= 500 && status < 600)
    return { kind: 'unknown', code: 'PROVIDER_5XX', outcomeKnown: false, httpStatus: status };
  return { kind: 'unknown', code: 'NETWORK_UNKNOWN', outcomeKnown: false, httpStatus: status };
}

// أي خطأ من غير رمز حالة: مهلة أو شبكة أو رفض من المكتبة قبل الشبكة — النتيجة مش معروفة.
function networkUnknown(): PushResult {
  return { kind: 'unknown', code: 'NETWORK_UNKNOWN', outcomeKnown: false, httpStatus: null };
}
