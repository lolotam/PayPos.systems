import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

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

/** مرسل بيجهّز نفسه قبل الفحص؛ تحميل المكتبة بياخد وقت والموعد بيتحسب بعده. */
interface PreparableSender extends WebPushSender {
  prepare?(): Promise<void>;
}

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
  /** طلب Node نفسه؛ بيحقن في الاختبار من غير شبكة. */
  readonly request?: typeof httpsRequest;
}

// المكتبة بتتحمّل عند أول إرسال حقيقي بس: الـ API بيستورد الحزمة دي، فاستيرادها ما يحمّلش web-push.
type WebPushLibrary = {
  generateRequestDetails(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: WebPushRequestOptions,
  ): {
    method: string;
    headers: Record<string, string | number | undefined>;
    body: Buffer | null;
    endpoint: string;
  };
};

let library: Promise<WebPushLibrary> | null = null;

function loadLibrary(): Promise<WebPushLibrary> {
  library ??= (async () => {
    const imported = (await import('web-push')) as unknown as { default: WebPushLibrary };
    return imported.default;
  })();
  return library;
}

/**
 * المرسل الافتراضي: تشفير وتوقيع من المكتبة، ثم طلب واحد بـ Node بمهلة مطلقة.
 * القاعدة: مهلة المكتبة هي مهلة خمول السوكِت بس، فالمهلة المطلقة بتتعمل هنا بـ AbortController؛
 * الرد بيتقرا رمز حالته بس وال BODY بيتهمل من غير ما يتبع تحويل.
 */
function defaultSender(request: typeof httpsRequest): PreparableSender {
  const send: WebPushSender = async (target, payload, options) => {
    const webpush = await loadLibrary();
    const details = webpush.generateRequestDetails(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      payload,
      options,
    );
    return sendOnce(request, details, options.timeout);
  };
  return Object.assign(send, {
    prepare: async () => {
      await loadLibrary();
    },
  });
}

// طلب واحد بمهلة مطلقة: الاتصال والطلب والرد كلهم جوّه نفس الوقت.
// الرد بيتدمّر من غير قراءة جسمه، وأي خطأ بيتحوّل لسبب محدود من غير نصّه.
function sendOnce(
  request: typeof httpsRequest,
  details: {
    method: string;
    headers: Record<string, string | number | undefined>;
    body: Buffer | null;
    endpoint: string;
  },
  timeoutMs: number,
): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort();
      reject(new Error('PUSH_REQUEST_TIMEOUT'));
    }, timeoutMs);
    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    try {
      const req = request(
        details.endpoint,
        {
          method: details.method,
          headers: details.headers,
          signal: abort.signal,
        },
        (response: IncomingMessage) => {
          const statusCode = response.statusCode ?? 0;
          response.destroy();
          clearTimeout(timer);
          resolve({ statusCode });
        },
      );
      req.on('error', (error: Error) => fail(error));
      if (details.body !== null) req.write(details.body);
      req.end();
    } catch (error) {
      fail(error as Error);
    }
  });
}

/**
 * قناة الدفع الحقيقية: بتعمل طلب واحد لخدمة الدفع وبترجّع النتيجة من غير إعادة محاولة.
 * القاعدة: جسم المزود ورأسه وعنوان نقطة الدفع ما بيوصلوش للنتيجة أبداً، وأي خطأ بيتحوّل لسبب محدود.
 */
export class WebPushChannel implements PushChannel {
  readonly #sender: PreparableSender;
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
    this.#sender = options.sender ?? defaultSender(options.request ?? httpsRequest);
  }

  async send(request: PushRequest): Promise<PushResult> {
    // تحميل المكتبة بيحصل قبل الفحص: بعد الفحص مفيش أي await قبل الطلب نفسه.
    if (this.#sender.prepare !== undefined) await this.#sender.prepare();
    const current = this.#now().getTime();
    const remainingMs = request.deadline === null ? null : request.deadline.getTime() - current;
    if (remainingMs !== null && remainingMs <= 0) return { kind: 'expired' };
    const timeout = remainingMs === null ? this.#timeoutMs : Math.min(this.#timeoutMs, remainingMs);
    const ttlSeconds =
      remainingMs === null
        ? request.ttlSeconds
        : Math.min(request.ttlSeconds, Math.floor(remainingMs / 1000));
    if (ttlSeconds < 1) return { kind: 'expired' };
    try {
      const response = await this.#sender(request.target, request.payload, {
        TTL: ttlSeconds,
        urgency: request.urgency,
        topic: request.topic,
        timeout,
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
