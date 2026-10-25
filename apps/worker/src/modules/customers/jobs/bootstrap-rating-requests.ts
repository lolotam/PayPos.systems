import type { Tx } from '@pospay/db';

import type {
  ScheduleRatingRequest,
  ScheduleRatingRequestPorts,
} from '../use-cases/schedule-rating-request/schedule-rating-request.ts';

// طبقة الـ jobs بتوصل لطبقة الـ use-cases بس، فأنواع منفذ الزيارات والساعة بتيجي من حزمة منافذ
// حالة الجدولة نفسها — هي نفس الأنواع اللي جذر العامل بيحقنها.
type DaySessionsPort = ScheduleRatingRequestPorts['daySessions'];
type Clock = ConstructorParameters<typeof ScheduleRatingRequest>[2];
type SessionPage = Awaited<ReturnType<DaySessionsPort['sessionsSince']>>;

/** النطاق المجمد: أقل لحظة زيارة، وأعلى معرف زيارة، وآخر لحظة تسجيل مقبولة. */
export type BootstrapRange = Parameters<DaySessionsPort['sessionsSince']>[2];

/** معاملة المستأجر: كل صفحة قراءة وكل زيارة بتاخد معاملة مستقلة، ومفيش معاملة عبر الصفحات. */
export interface BootstrapDatabase {
  withTenant<T>(companyId: string, work: (tx: Tx) => Promise<T>): Promise<T>;
}

/** اللي الـ bootstrap محتاجه من العالم الخارجي: قارئ الزيارات، وحالة الجدولة، والساعة، وسطر الطباعة. */
export interface BootstrapDeps {
  db: BootstrapDatabase;
  daySessions: DaySessionsPort;
  schedule: Pick<ScheduleRatingRequest, 'execute'>;
  clock: Clock;
  log(line: string): void;
}

/** مدخلات التشغيل: الشركة والقطع، ومدى الاستئناف اختياري عشان إعادة التشغيل بنفس النطاق. */
export interface BootstrapParams {
  companyId: string;
  cutoff: Date;
  checkpoint?: string | null;
  maxSessionId?: string;
  recordedAtOrBefore?: Date;
  pageSize?: number;
}

/** نتيجة التشغيل: النطاق المجمد والأرقام والتغطية وهل التغطية اكتملت. */
export interface BootstrapResult {
  range: BootstrapRange;
  processed: number;
  alreadyDone: number;
  expected: number;
  complete: boolean;
  lastSessionId: string | null;
}

interface FrozenRange {
  readonly range: BootstrapRange;
  readonly hasSessions: boolean;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

function pageSizeOf(pageSize: number | undefined): number {
  if (pageSize === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE)
    throw new RangeError('BOOTSTRAP_PAGE_SIZE_INVALID');
  return pageSize;
}

// النطاق يتجمد مرة واحدة قبل أول صفحة: أعلى معرف زيارة ولحظة بدء المهمة، عشان أي كتابة حية بعد كده
// تفضل للمستهلك الحي وما تختلطش بالصفحات اللي بتقرأ.
async function freezeRange(deps: BootstrapDeps, params: BootstrapParams): Promise<FrozenRange> {
  const recordedAtOrBefore = params.recordedAtOrBefore ?? deps.clock.now();
  const maxSessionId =
    params.maxSessionId ??
    (await deps.db.withTenant(params.companyId, (tx) =>
      deps.daySessions.watermark(tx, params.companyId),
    ));
  const cutoff = params.cutoff.toISOString();
  if (maxSessionId === null) {
    // الشركة مفيهاش زيارات أصلاً، فمافيش حد أعلى للمعرّف؛ التشغيل يخلص مكتمل بصفر.
    deps.log(
      `range cutoff=${cutoff} maxSessionId=none recordedAtOrBefore=${recordedAtOrBefore.toISOString()}`,
    );
    return {
      range: { cutoff: params.cutoff, maxSessionId: '', recordedAtOrBefore },
      hasSessions: false,
    };
  }
  deps.log(
    `range cutoff=${cutoff} maxSessionId=${maxSessionId} recordedAtOrBefore=${recordedAtOrBefore.toISOString()}`,
  );
  return { range: { cutoff: params.cutoff, maxSessionId, recordedAtOrBefore }, hasSessions: true };
}

async function processPage(
  deps: BootstrapDeps,
  params: BootstrapParams,
  page: SessionPage,
): Promise<void> {
  for (const session of page) {
    // نفس مسار التسليم الحي: كل زيارة في معاملتها الخاصة، وأي خطأ بيوقف المهمة عند آخر checkpoint.
    await deps.db.withTenant(params.companyId, (tx) =>
      deps.schedule.execute(tx, {
        companyId: params.companyId,
        businessId: session.businessId,
        customerId: session.customerId,
        branchId: session.branchId,
        occurredAt: session.occurredAt,
      }),
    );
  }
}

// العدّان بيتجمدوا قبل المعالجة، وعضوية النطاق لا تعتمد على حالة السطور القابلة للتغيير.
async function coverageOf(
  deps: BootstrapDeps,
  params: BootstrapParams,
  range: BootstrapRange,
): Promise<{ expected: number; alreadyDone: number }> {
  const checkpoint = params.checkpoint ?? null;
  return deps.db.withTenant(params.companyId, async (tx) => {
    const expected = await deps.daySessions.countSince(tx, params.companyId, range);
    const alreadyDone =
      checkpoint === null
        ? 0
        : await deps.daySessions.countSince(tx, params.companyId, {
            ...range,
            maxSessionId: checkpoint,
          });
    return { expected, alreadyDone };
  });
}

function emptyResult(range: BootstrapRange, lastSessionId: string | null): BootstrapResult {
  return {
    range,
    processed: 0,
    alreadyDone: 0,
    expected: 0,
    complete: true,
    lastSessionId,
  };
}

/**
 * يشغّل bootstrap طلبات التقييم لشركة واحدة: تجميد النطاق مرة واحدة، ثم قراءة صفحات keyset
 * وتمرير كل زيارة على نفس مسار الجدولة الحي، ثم مقارنة التغطية بالعدد المتوقع.
 * الزيارة المسجلة بعد بداية المهمة بره النطاق المجمد، فالمستهلك الحي بياخدها.
 * التغطية بتتجمد قبل المعالجة، وكل زيارة في النطاق بتتعد حتى لو اتلغت سطورها أثناء الشغل.
 *
 * @param deps قارئ الزيارات وحالة الجدولة والساعة وسطر الطباعة
 * @param params الشركة والقطع ومدى الاستئناف اختياري
 * @returns النطاق المجمد والأرقام وهل التغطية اكتملت
 */
export async function runRatingBootstrap(
  deps: BootstrapDeps,
  params: BootstrapParams,
): Promise<BootstrapResult> {
  const pageSize = pageSizeOf(params.pageSize);
  const frozen = await freezeRange(deps, params);
  if (!frozen.hasSessions) {
    deps.log('processed=0 alreadyDone=0 expected=0 complete=true');
    return emptyResult(frozen.range, params.checkpoint ?? null);
  }
  const range = frozen.range;
  const { expected: frozenExpected, alreadyDone } = await coverageOf(deps, params, range);
  deps.log(`frozen expected=${frozenExpected} alreadyDone=${alreadyDone}`);
  let cursor = params.checkpoint ?? null;
  let processed = 0;
  for (;;) {
    const page = await deps.db.withTenant(params.companyId, (tx) =>
      deps.daySessions.sessionsSince(tx, params.companyId, range, cursor, pageSize),
    );
    await processPage(deps, params, page);
    processed += page.length;
    const last = page.at(-1);
    if (last !== undefined) cursor = last.sessionId;
    deps.log(`checkpoint=${cursor ?? 'none'} processed=${processed}`);
    if (page.length < pageSize) break;
  }
  const covered = alreadyDone + processed;
  // معاملة بدأت قبل T0 ممكن تظهر بعد مرور مؤشر الصفحة؛ العد النهائي يكشفها من غير تغيير العد المجمد.
  const verifiedExpected = await deps.db.withTenant(params.companyId, (tx) =>
    deps.daySessions.countSince(tx, params.companyId, range),
  );
  const complete = covered === frozenExpected && verifiedExpected === frozenExpected;
  deps.log(
    `processed=${processed} alreadyDone=${alreadyDone} expected=${frozenExpected} verifiedExpected=${verifiedExpected} complete=${complete}`,
  );
  return {
    range,
    processed,
    alreadyDone,
    expected: frozenExpected,
    complete,
    lastSessionId: cursor,
  };
}
