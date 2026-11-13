import { expect, it } from 'vitest';

import {
  runSessionTipsBootstrap,
  type BootstrapTipSession,
  type CurrentTipSessionsReader,
} from '../index.ts';

type BootstrapDeps = Parameters<typeof runSessionTipsBootstrap>[0];
type BootstrapScope = Parameters<typeof runSessionTipsBootstrap>[1];
type FakeTx = Parameters<Parameters<BootstrapDeps['withTenant']>[1]>[0];
type FakeMark = { readonly consumerId: string; readonly eventId: string };
type FakeCursor = { readonly businessDate: string; readonly sessionId: string };
type FakeSavepoint = { readonly marks: FakeMark[] };
type FakeStep = { readonly items: readonly BootstrapTipSession[]; readonly nextCursor: FakeCursor | null };

const CONSUMER = 'commissions.project-inputs';
const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const BUSINESS = '01920000-0000-7000-8000-0000000000a1';
const OTHER_BUSINESS = '01920000-0000-7000-8000-0000000000b1';
const BRANCH = '01920000-0000-7000-8000-0000000000a2';
const EMPLOYEE = '01920000-0000-7000-8000-00000000ee01';
const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const cursor = (sessionId: string): FakeCursor => ({ businessDate: '2026-12-01', sessionId });

function createFakeHarness(options: {
  readonly steps: Readonly<Record<string, readonly FakeStep[]>>;
  readonly failures?: Readonly<Record<string, string>>;
  readonly readerError?: unknown;
}) {
  const executed: string[] = [];
  const committed: FakeMark[] = [];
  const reads: { businessId: string; after: FakeCursor | null }[] = [];
  const rollbacks = { count: 0 };
  const queues = new Map<string, FakeStep[]>();
  for (const [id, steps] of Object.entries(options.steps)) queues.set(id, [...steps]);

  const reader: CurrentTipSessionsReader = {
    readPage: async (_tx, _companyId, businessId, _range, page) => {
      reads.push({ businessId, after: page.after });
      if (options.readerError !== undefined) throw options.readerError;
      const step = queues.get(businessId)?.shift();
      if (step === undefined) throw new Error(`NO_PAGE_FOR_${businessId}`);
      return { items: [...step.items], nextCursor: step.nextCursor };
    },
  };

  const withTenant: BootstrapDeps['withTenant'] = async <T>(
    _companyId: string,
    fn: (tx: FakeTx) => Promise<T>,
  ) => {
    const tx = {
      transaction: async (inner: (sp: FakeSavepoint) => Promise<unknown>) => {
        const savepoint: FakeSavepoint = { marks: [] };
        try {
          await inner(savepoint);
        } catch (error) {
          rollbacks.count += 1;
          savepoint.marks.length = 0;
          throw error;
        }
        committed.push(...savepoint.marks);
        return savepoint;
      },
    };
    return fn(tx as unknown as FakeTx);
  };

  const tipsFor: BootstrapDeps['tipsFor'] = () => ({
    execute: async (input) => {
      executed.push(input.sessionId);
      const code = options.failures?.[input.sessionId];
      if (code !== undefined) throw Object.assign(new Error(code), { code });
    },
  });

  const markConsumed: BootstrapDeps['markConsumed'] = async (tx, consumerId, event) => {
    (tx as unknown as FakeSavepoint).marks.push({ consumerId, eventId: event });
    return true;
  };

  return {
    deps: { withTenant, reader, tipsFor, consumerId: CONSUMER, markConsumed },
    executed,
    committed,
    reads,
    rollbacks,
  };
}

const tipSession = (
  sessionId: string,
  revision: number,
  events: readonly number[],
  tips: readonly { employeeId: string; method: 'CASH' | 'CARD'; amount: string }[] = [],
): BootstrapTipSession => ({
  sessionId,
  businessDate: '2026-12-01',
  branchId: BRANCH,
  revision,
  tips: tips.map((tip) => ({ ...tip })),
  eventIds: events.map((n) => eventId(n)),
});

const page = (items: readonly BootstrapTipSession[], nextCursor: FakeCursor | null = null): FakeStep => ({
  items,
  nextCursor,
});

const scopeOf = (businessIds: readonly string[]): BootstrapScope => ({
  companyId: COMPANY,
  businessIds,
  from: '2026-12-01',
  to: '2026-12-31',
});

it('applies every session of two pages in order and marks every event once', async () => {
  // يثبت أن صفحتين لنشاط واحد تُنفَّذان بالترتيب وأن كل حدث يُعلَّم مرة واحدة بهوية المستهلك
  const harness = createFakeHarness({
    steps: {
      [BUSINESS]: [
        page([tipSession('s1', 1, [1]), tipSession('s2', 2, [2, 3])], cursor('s1')),
        page([tipSession('s3', 1, [4])]),
      ],
    },
  });
  const result = await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]));
  expect(result.status).toBe('COMPLETE');
  expect(result.counts).toEqual({ sessions: 3, events: 4 });
  expect(harness.executed).toEqual(['s1', 's2', 's3']);
  expect(harness.committed.map((mark) => mark.eventId)).toEqual([
    eventId(1),
    eventId(2),
    eventId(3),
    eventId(4),
  ]);
  expect(new Set(harness.committed.map((mark) => mark.consumerId))).toEqual(new Set([CONSUMER]));
  expect(harness.rollbacks.count).toBe(0);
});
it('records a closed period as undelivered and keeps the rest of the page applied', async () => {
  // يثبت أن سبباً معروفاً يُسجَّل كجلسة غير مسلَّمة بلا مبالغ ولا موظفات وبقيّة الصفحة تُطبَّق
  const harness = createFakeHarness({
    steps: {
      [BUSINESS]: [
        page([tipSession('ok1', 1, [10]), tipSession('bad', 1, [11]), tipSession('ok2', 1, [12])]),
      ],
    },
    failures: { bad: 'COMMISSION_PERIOD_CLOSED' },
  });
  const result = await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]));
  expect(result.status).toBe('UNDELIVERED');
  expect(result.undelivered).toEqual([
    { sessionId: 'bad', businessId: BUSINESS, code: 'COMMISSION_PERIOD_CLOSED' },
  ]);
  expect(result.counts).toEqual({ sessions: 2, events: 2 });
  expect(harness.committed.map((mark) => mark.eventId)).toEqual([eventId(10), eventId(12)]);
  expect(harness.rollbacks.count).toBe(1);
});
it('treats the other known reasons as continuable and applies nothing for them', async () => {
  // يثبت أن سببَي العمل الناقص والمبلغ غير الصالح لا يوقفان الصفحة ولا يُطبَّقان
  const harness = createFakeHarness({
    steps: {
      [BUSINESS]: [page([tipSession('s1', 1, [20]), tipSession('s2', 1, [21])])],
    },
    failures: {
      s1: 'COMMISSION_BUSINESS_MISSING',
      s2: 'COMMISSION_TIP_SALARY_INPUT_INVALID',
    },
  });
  const result = await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]));
  expect(result.status).toBe('UNDELIVERED');
  expect(result.undelivered.map((entry) => entry.code)).toEqual([
    'COMMISSION_BUSINESS_MISSING',
    'COMMISSION_TIP_SALARY_INPUT_INVALID',
  ]);
  expect(result.counts).toEqual({ sessions: 0, events: 0 });
  expect(harness.committed).toEqual([]);
});
it('aborts on an unknown reason and keeps the cursor of the last committed page', async () => {
  // يثبت أن خطأً غير معروف يوقف التشغيل عند آخر صفحة ثبتت فيكمل منها، وصفحة التوقف ما تُحسبش
  const harness = createFakeHarness({
    steps: {
      [BUSINESS]: [
        page([tipSession('s1', 1, [30])], cursor('s1')),
        page([tipSession('s2', 1, [31])]),
      ],
    },
    failures: { s2: 'COMMISSION_SOMETHING_UNKNOWN' },
  });
  const result = await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]));
  expect(result.status).toBe('ABORTED');
  expect(result.abortedAt).toEqual({ businessId: BUSINESS, after: cursor('s1') });
  expect(result.counts).toEqual({ sessions: 1, events: 1 });
  expect(harness.committed.map((mark) => mark.eventId)).toEqual([eventId(30)]);
});
it('propagates a RangeError from the reader unchanged', async () => {
  // يثبت أن خطأ المدى يطلع كما هو بدل ما يتحول إلى توقف صامت
  const harness = createFakeHarness({
    steps: { [BUSINESS]: [page([])] },
    readerError: new RangeError('SESSION_TIPS_BOOTSTRAP_RANGE_INVALID'),
  });
  await expect(runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]))).rejects.toThrow(
    'SESSION_TIPS_BOOTSTRAP_RANGE_INVALID',
  );
});
it('runs the businesses in order with an independent cursor per business', async () => {
  // يثبت أن كل نشاط له مؤشره الخاص وأن النشاط الفارغ ينتهي بلا أعداد
  const harness = createFakeHarness({
    steps: {
      [BUSINESS]: [
        page([tipSession('s1', 1, [40])], cursor('s1')),
        page([tipSession('s2', 1, [41])]),
      ],
      [OTHER_BUSINESS]: [page([])],
    },
  });
  const result = await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS, OTHER_BUSINESS]));
  expect(result.status).toBe('COMPLETE');
  expect(result.counts).toEqual({ sessions: 2, events: 2 });
  expect(harness.reads).toEqual([
    { businessId: BUSINESS, after: null },
    { businessId: BUSINESS, after: cursor('s1') },
    { businessId: OTHER_BUSINESS, after: null },
  ]);
  // الصفحة الفارغة في نشاط آخر تنتهي بلا أعداد ولا علامات
  const empty = createFakeHarness({ steps: { [OTHER_BUSINESS]: [page([])] } });
  const emptyResult = await runSessionTipsBootstrap(empty.deps, scopeOf([OTHER_BUSINESS]));
  expect(emptyResult.status).toBe('COMPLETE');
  expect(emptyResult.counts).toEqual({ sessions: 0, events: 0 });
  expect(empty.committed).toEqual([]);
});
it('caps the undelivered list at 200 and reports truncation', async () => {
  // يثبت سقف التقرير: 200 جلسة غير مسلَّمة والباقي محذوف مع علامة truncation
  const items = Array.from({ length: 201 }, (_entry, index) =>
    tipSession(`s${index}`, 1, [index + 1]),
  );
  const failures: Record<string, string> = {};
  for (const item of items) failures[item.sessionId] = 'COMMISSION_PERIOD_CLOSED';
  const harness = createFakeHarness({
    steps: { [BUSINESS]: [page(items)] },
    failures,
  });
  const result = await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]));
  expect(result.undelivered).toHaveLength(200);
  expect(result.truncated).toBe(true);
  expect(result.counts).toEqual({ sessions: 0, events: 0 });
});
it('keeps the tip amounts and employee ids out of the result', async () => {
  // يثبت أن التقرير يحمل هوية الجلسة والرمز فقط بلا مبالغ ولا موظفات
  const harness = createFakeHarness({
    steps: {
      [BUSINESS]: [
        page([tipSession('s1', 1, [50], [{ employeeId: EMPLOYEE, method: 'CASH', amount: '77.777' }])]),
      ],
    },
    failures: { s1: 'COMMISSION_PERIOD_CLOSED' },
  });
  const result = await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]));
  const json = JSON.stringify(result);
  expect(json).not.toContain('77.777');
  expect(json).not.toContain(EMPLOYEE);
  expect(result.undelivered).toEqual([
    { sessionId: 's1', businessId: BUSINESS, code: 'COMMISSION_PERIOD_CLOSED' },
  ]);
});
