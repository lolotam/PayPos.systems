import type { ClaimedEvent, DeliveryOutcome, OutboxDispatcherDatabase } from '@pospay/db';
import { assertReplayBounds, ReplayCursorError } from '@pospay/db';
import type { OutboxConsumer } from '../../../outbox/consumer.ts';

const PAGE_SIZE = 100;
const PAGE_LIMIT = 100;
const UNDELIVERED_LIMIT = 200;
const FOUR_TYPE_REPLAYABLE_EVENT_TYPES = new Set([
  'ServiceSessionRecorded',
  'ServiceSessionLinesAdded',
  'ServiceLineChanged',
  'SalaryChanged',
]);
// الأنواع المحسوبة كلها: الأربعة الأولى زائد بقشيش الجلسة وبيع الباقة (50-3d).
const SIX_TYPE_REPLAYABLE_EVENT_TYPES = new Set([
  ...FOUR_TYPE_REPLAYABLE_EVENT_TYPES,
  'SessionTipsChanged',
  'PackageSaleChanged',
]);
const NO_HANDLED_TYPES: ReadonlySet<string> = new Set<string>();
const CONTINUABLE_FAILURE_CODES = new Set([
  'COMMISSION_EMPLOYEE_BUSINESS_MISSING',
  'COMMISSION_LINE_EVENT_INVALID',
  'COMMISSION_TIP_SALARY_INPUT_INVALID',
  'COMMISSION_BUSINESS_MISSING',
  'COMMISSION_PERIOD_CLOSED',
  'COMMISSION_EVENT_TYPE_NOT_HANDLED',
]);
// نوع لا يسجّله المستهلك بعد (بيع الباقة قبل 50-4): رمز ثابت يفرق بين "بانتظار المعالج" و"فجوة حقيقية".
const EVENT_TYPE_NOT_HANDLED = 'COMMISSION_EVENT_TYPE_NOT_HANDLED';

/** حدث خارج شركة النطاق أو نوعه لا تقبله استعادة العمولات؛ الرفض يمنع تسليم حدث لمستهلك غير مقصود. */
export class CommissionReplayEventInvalidError extends Error {
  readonly code = 'COMMISSION_REPLAY_EVENT_INVALID';

  constructor() {
    super('COMMISSION_REPLAY_EVENT_INVALID');
    this.name = 'CommissionReplayEventInvalidError';
  }
}

/** استئناف بلا حد أعلى قد يضم أحداثًا جديدة إلى نطاق استعادة قديم، لذلك له رمز رفض ثابت. */
export class CommissionReplayCursorError extends Error {
  readonly code = 'COMMISSION_REPLAY_THROUGH_REQUIRED';

  constructor() {
    super('COMMISSION_REPLAY_THROUGH_REQUIRED');
    this.name = 'CommissionReplayCursorError';
  }
}

/** إعدادات تشغيل غير صالحة تُرفض برمز ثابت حتى لا تظهر للمشغّل كفشل استعادة عام. */
export class CommissionReplayConfigurationError extends Error {
  readonly code = 'COMMISSION_REPLAY_CONFIGURATION';

  constructor() {
    super('COMMISSION_REPLAY_CONFIGURATION');
    this.name = 'CommissionReplayConfigurationError';
  }
}

/**
 * يحوّل أخطاء الاستعادة المعروفة إلى رموزها الثابتة حتى لا يخرج نص خام للمشغّل.
 *
 * @param error الخطأ الملتقط من التشغيل أو قراءة الأحداث
 * @returns رمز الخطأ المعروف، أو COMMISSION_REPLAY_FAILED لأي خطأ آخر
 */
export function commissionReplayErrorCode(error: unknown): string {
  if (
    error instanceof ReplayCursorError ||
    error instanceof CommissionReplayCursorError ||
    error instanceof CommissionReplayEventInvalidError ||
    error instanceof CommissionReplayConfigurationError
  ) {
    return error.code;
  }
  return 'COMMISSION_REPLAY_FAILED';
}

/**
 * يقيّد نطاق الاستعادة بالنوعين المدعومين حتى لا تبدأ قراءة بنطاق غير معروف.
 *
 * @param value قيمة --types الخام، أو undefined لاختيار الأنواع الأربعة
 * @returns four للأنواع الأربعة أو six للأنواع الستة
 */
export function parseCommissionReplayTypes(value: string | undefined): 'four' | 'six' {
  const types = value ?? 'four';
  if (types === 'four' || types === 'six') return types;
  throw new CommissionReplayConfigurationError();
}

/**
 * يثبت صحة الحدود ويمنع الاستئناف دون حد أعلى حتى يبقى نطاق الاستعادة ثابتًا.
 *
 * @param afterId الحد الأدنى المستأنف، أو null في أول تشغيل
 * @param throughId الحد الأعلى الثابت، إلزامي عند وجود afterId
 * @returns لا قيمة؛ يكمل فقط عند صحة المؤشرين
 */
export function assertCommissionReplayCursor(afterId: string | null, throughId: string | null): void {
  assertReplayBounds(afterId, throughId);
  if (afterId !== null && throughId === null) throw new CommissionReplayCursorError();
}

/** نطاق الاستعادة: شركة واحدة وحد أدنى مستأنف وحد أعلى ثابت طوال التشغيل. */
export interface CommissionReplayCursor {
  readonly companyId: string;
  readonly afterId: string | null;
  readonly throughId: string | null;
}

export type CommissionReplayStatus = 'COMPLETE' | 'UNDELIVERED' | 'PAGE_LIMIT' | 'ABORTED';

/**
 * نطاق الأحداث التي تعيدها الاستعادة: الأنواع الأربعة (50-3a) أو الأنواع المحسوبة الستة (50-3d).
 * الستة تقرأ من واجهة الأحداث المحتفظ بها، والأربعة من واجهة مدخلات العمولة.
 */
export type CommissionReplayScope = 'FOUR_TYPE' | 'SIX_TYPE';

/**
 * نتيجة خالية من الحمولات؛ الهويات والأنواع والرموز وحدها تصلح لتقرير المشغّل.
 * afterId هو مؤشر الاستئناف الآمن الذي لا يتجاوز أول حدث غير مسلّم.
 * handledThroughId هو آخر حدث اكتملت معالجته، وبه تستكمل القراءة بعد PAGE_LIMIT أو ABORTED.
 */
export interface CommissionReplayResult {
  readonly status: CommissionReplayStatus;
  readonly afterId: string | null;
  readonly handledThroughId: string | null;
  readonly throughId: string | null;
  readonly counts: Record<string, number>;
  readonly undelivered: { eventId: string; type: string; code: string }[];
  readonly truncated: boolean;
}

/** سبب الفشل الحقيقي لكل حدث، لأن نتيجة deliver وحدها لا تحمل رمز الخطأ المستقر. */
export type CommissionFailureCodes = Map<string, string>;

/** واجهة صفحات الاستعادة: الأنواع الأربعة والأنواع المحسوبة الستة، كل واحدة بفلتر أنواعها. */
type CommissionReplayReader = Pick<
  OutboxDispatcherDatabase,
  'commissionInputReplayPage' | 'commissionRetainedEventPage'
>;

/** تبعيات الاستعادة: قارئ الصفحات وموصّل الأحداث وخريطة الفشل والنطاق وأنواع المستهلك. */
export interface CommissionReplayDeps {
  readonly reader: CommissionReplayReader;
  readonly deliver: (event: ClaimedEvent) => Promise<DeliveryOutcome>;
  readonly failures: CommissionFailureCodes;
  readonly scope?: CommissionReplayScope;
  readonly handledTypes?: ReadonlySet<string>;
}

/** حالة التشغيل المشتركة بين دوال الاستعادة: النطاق والواجهة والأعداد والجداول. */
interface ReplayRun {
  readonly reader: CommissionReplayReader;
  readonly scope: CommissionReplayScope;
  readonly companyId: string;
  readonly replayableTypes: ReadonlySet<string>;
  readonly handledTypes: ReadonlySet<string>;
  readonly deliver: (event: ClaimedEvent) => Promise<DeliveryOutcome>;
  readonly failures: CommissionFailureCodes;
  readonly counts: Record<string, number>;
  readonly undelivered: CommissionReplayResult['undelivered'];
  afterId: string | null;
  handledThroughId: string | null;
  throughId: string | null;
  truncated: boolean;
}

/**
 * يلتقط رمز الخطأ قبل أن يحوّله deliver إلى نتيجة عامة، ثم يعيد رميه بلا تغيير حتى تبقى معاملة الحدث ملغاة.
 *
 * @param consumer مستهلك مدخلات العمولات الأصلي
 * @param sink خريطة هوية الحدث إلى رمز الخطأ الثابت
 * @returns مستهلك بالهوية والأنواع نفسها ومعالج مغلّف لتسجيل الفشل
 */
export function recordCommissionFailureCodes(
  consumer: OutboxConsumer,
  sink: CommissionFailureCodes,
): OutboxConsumer {
  return {
    ...consumer,
    handle: async (tx, event) => {
      try {
        await consumer.handle(tx, event);
      } catch (error) {
        sink.set(event.id, failureCode(error));
        throw error;
      }
    },
  };
}

/**
 * يعيد مدخلات العمولات عبر المستهلك وحده دون تعديل نشر outbox، ويتجاوز فقط أخطاء العمل المحددة.
 * فشل قراءة صفحة يوقف التشغيل بـ ABORTED مع الاحتفاظ بالمؤشرات، بينما يبقى خطأ النطاق فشلًا صريحًا.
 * في نطاق الأنواع الستة لا يُسلَّم إلا نوع يسجّله المستهلك، والنوع غير المسجّل يُدرج كغير مسلّم برمز ثابت.
 *
 * @param deps قارئ صفحات الـ dispatcher وموصّل الأحداث وخريطة أسباب الفشل والنطاق وأنواع المستهلك
 * @param cursor الشركة وحدود النطاق المطلوب استعادته
 * @returns مؤشرا الاستئناف الآمن وآخر معالجة وحالة التشغيل وأعداد التسليم والأخطاء المقصودة فقط
 */
export async function runCommissionInputReplay(
  deps: CommissionReplayDeps,
  cursor: CommissionReplayCursor,
): Promise<CommissionReplayResult> {
  assertCommissionReplayCursor(cursor.afterId, cursor.throughId);
  const run = createRun(deps, cursor);
  const finished = (): CommissionReplayStatus =>
    run.undelivered.length === 0 ? 'COMPLETE' : 'UNDELIVERED';
  for (let page = 0; page < PAGE_LIMIT; page++) {
    let batch: Awaited<ReturnType<OutboxDispatcherDatabase['commissionInputReplayPage']>>;
    try {
      batch = await (run.scope === 'SIX_TYPE'
        ? run.reader.commissionRetainedEventPage(
            run.companyId,
            run.handledThroughId,
            run.throughId,
            PAGE_SIZE,
          )
        : run.reader.commissionInputReplayPage(
            run.companyId,
            run.handledThroughId,
            run.throughId,
            PAGE_SIZE,
          ));
    } catch (error) {
      if (
        error instanceof ReplayCursorError ||
        (error instanceof TypeError && error.message === 'REPLAY_SCOPE_INVALID')
      )
        throw error;
      return replayResult(run, 'ABORTED');
    }
    if (page === 0) run.throughId = batch.throughId;
    if (batch.events.length === 0) return replayResult(run, finished());
    for (const event of batch.events) {
      if (event.companyId !== run.companyId || !run.replayableTypes.has(event.eventType))
        throw new CommissionReplayEventInvalidError();
      if ((await deliverEvent(run, event)) === 'ABORTED') return replayResult(run, 'ABORTED');
      run.handledThroughId = event.id;
      if (run.undelivered.length === 0) run.afterId = event.id;
    }
    if (batch.events.length < PAGE_SIZE) return replayResult(run, finished());
  }
  return replayResult(run, 'PAGE_LIMIT');
}

/** يبني حالة التشغيل من التبعيات والمؤشرات؛ النطاق يختار الواجهة والأنواع القابلة للاستعادة. */
function createRun(deps: CommissionReplayDeps, cursor: CommissionReplayCursor): ReplayRun {
  const scope = deps.scope ?? 'FOUR_TYPE';
  return {
    reader: deps.reader,
    scope,
    companyId: cursor.companyId.toLowerCase(),
    replayableTypes:
      scope === 'SIX_TYPE' ? SIX_TYPE_REPLAYABLE_EVENT_TYPES : FOUR_TYPE_REPLAYABLE_EVENT_TYPES,
    handledTypes: deps.handledTypes ?? NO_HANDLED_TYPES,
    deliver: deps.deliver,
    failures: deps.failures,
    counts: {},
    undelivered: [],
    afterId: cursor.afterId,
    handledThroughId: cursor.afterId,
    throughId: cursor.throughId,
    truncated: false,
  };
}

/**
 * يسلّم الحدث أو يدرجه غير مسلّم: النوع الذي لا يسجّله المستهلك لا يُسلَّم أصلاً، لأن تسليمه
 * يعدّ توصيلاً لنوع بلا معالج؛ يُدرج برمز ثابت ومؤشر الاستئناف يتوقف قبله.
 */
async function deliverEvent(run: ReplayRun, event: ClaimedEvent): Promise<'OK' | 'ABORTED'> {
  if (run.scope === 'SIX_TYPE' && !run.handledTypes.has(event.eventType)) {
    run.truncated = recordUndelivered(
      run.undelivered,
      event,
      EVENT_TYPE_NOT_HANDLED,
      run.truncated,
    );
    return 'OK';
  }
  const outcome = await run.deliver(event);
  if (outcome.delivered) {
    run.counts[event.eventType] = (run.counts[event.eventType] ?? 0) + 1;
    return 'OK';
  }
  const code = run.failures.get(event.id);
  if (code === undefined || !CONTINUABLE_FAILURE_CODES.has(code)) return 'ABORTED';
  run.truncated = recordUndelivered(run.undelivered, event, code, run.truncated);
  return 'OK';
}

/** يبني سطر النتيجة من حالة التشغيل؛ لا حمولات ولا أسماء. */
function replayResult(run: ReplayRun, status: CommissionReplayStatus): CommissionReplayResult {
  return {
    status,
    afterId: run.afterId,
    handledThroughId: run.handledThroughId,
    throughId: run.throughId,
    counts: run.counts,
    undelivered: run.undelivered,
    truncated: run.truncated,
  };
}

function recordUndelivered(
  undelivered: CommissionReplayResult['undelivered'],
  event: ClaimedEvent,
  code: string,
  truncated: boolean,
): boolean {
  if (undelivered.length >= UNDELIVERED_LIMIT) return true;
  undelivered.push({ eventId: event.id, type: event.eventType, code });
  return truncated;
}

function failureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}
