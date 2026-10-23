import type { PushChannel, PushRequest, PushResult } from '../push/channel.ts';

/** نتيجة الإرسال اللي المزيف بيرجّعها: قبول أو رفض أو نتيجة مش معروفة. */
export type FakePushOutcome =
  | 'accepted'
  | 'gone404'
  | 'gone410'
  | '400'
  | '401'
  | '403'
  | '413'
  | '429'
  | '5xx'
  | 'timeout'
  | 'crash';

/** خطافات المزيف: قبل التسليم وبعده. */
export interface FakePushChannelHooks {
  readonly beforeSubmission?: () => void | Promise<void>;
  readonly afterSubmission?: () => void | Promise<void>;
}

/**
 * قناة دفع مزيفة: بتسجّل الطلب اللي كان هيتبعت وبترجّع نتيجة مبرمجة.
 * القاعدة: كل طلب يوصلها بيتسجل، والعداد بيتزاد بالظبط مع الطلب اللي اتنفذ؛ وانتهاء المهلة مابيكملش ولا بيعيد تقديم.
 */
export class FakePushChannel implements PushChannel {
  calls = 0;
  outcome: FakePushOutcome = 'accepted';
  readonly requests: PushRequest[] = [];

  constructor(
    readonly now: () => Date,
    readonly hooks: FakePushChannelHooks = {},
  ) {}

  async send(request: PushRequest): Promise<PushResult> {
    this.requests.push(request);
    await this.hooks.beforeSubmission?.();
    if (request.deadline !== null && this.now().getTime() >= request.deadline.getTime())
      return { kind: 'expired' };
    this.calls += 1;
    if (this.outcome === 'crash') throw new Error('FAKE_EXECUTION_CRASH');
    await this.hooks.afterSubmission?.();
    return outcomeResult(this.outcome);
  }
}

function outcomeResult(outcome: FakePushOutcome): PushResult {
  if (outcome === 'accepted') return { kind: 'accepted', httpStatus: 201 };
  if (outcome === 'gone404') return { kind: 'gone', httpStatus: 404 };
  if (outcome === 'gone410') return { kind: 'gone', httpStatus: 410 };
  if (outcome === '429')
    return { kind: 'rejected', code: 'PROVIDER_429', httpStatus: 429, vapidRejected: false };
  if (outcome === '401' || outcome === '403')
    return {
      kind: 'rejected',
      code: 'PROVIDER_4XX',
      httpStatus: outcome === '401' ? 401 : 403,
      vapidRejected: true,
    };
  if (outcome === '400' || outcome === '413')
    return {
      kind: 'rejected',
      code: 'PROVIDER_4XX',
      httpStatus: outcome === '400' ? 400 : 413,
      vapidRejected: false,
    };
  if (outcome === '5xx')
    return { kind: 'unknown', code: 'PROVIDER_5XX', outcomeKnown: false, httpStatus: 503 };
  return { kind: 'unknown', code: 'NETWORK_UNKNOWN', outcomeKnown: false, httpStatus: null };
}
