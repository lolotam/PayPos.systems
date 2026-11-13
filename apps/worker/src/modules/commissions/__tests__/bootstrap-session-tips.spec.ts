import { expect, it } from 'vitest';

import {
  runSessionTipsBootstrap,
  type BootstrapTipSession,
  type CurrentTipSessionsReader,
} from '../index.ts';
import { normalizeBusinessIds } from '../use-cases/bootstrap-session-tips/bootstrap-session-tips.ts';

type BootstrapDeps = Parameters<typeof runSessionTipsBootstrap>[0];
type BootstrapScope = Parameters<typeof runSessionTipsBootstrap>[1];
type FakeTx = Parameters<Parameters<BootstrapDeps['withTenant']>[1]>[0];
type FakeMark = { readonly consumerId: string; readonly eventId: string };
type FakeCursor = { readonly businessDate: string; readonly sessionId: string };
type FakeStep = { readonly items: readonly BootstrapTipSession[]; readonly nextCursor: FakeCursor | null };
type FakeTransaction = { readonly log: string[]; readonly marks: FakeMark[] };

const CONSUMER = 'commissions.project-inputs';
const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const BUSINESS = '01920000-0000-7000-8000-0000000000a1';
const OTHER_BUSINESS = '01920000-0000-7000-8000-0000000000b1';
const BRANCH = '01920000-0000-7000-8000-0000000000a2';
const EMPLOYEE = '01920000-0000-7000-8000-00000000ee01';
const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const cursor = (sessionId: string): FakeCursor => ({ businessDate: '2026-12-01', sessionId });

/** خيارات المشغّل الوهمي: الصفحات لكل نشاط، والزيارات المرفوضة، وخطأ القارئ، والحسم المسبق. */
type FakeHarnessOptions = {
  readonly steps: Readonly<Record<string, readonly FakeStep[]>>;
  readonly failures?: Readonly<Record<string, string>>;
  readonly readerError?: unknown;
  readonly alreadyConsumed?: readonly string[];
};

/** حالة المشغّل الوهمي: الصفحات الجاهزة وما سُجّل وما ثبت وما انطوى. */
interface FakeHarnessState {
  readonly executed: string[];
  readonly committed: FakeMark[];
  readonly reads: { businessId: string; after: FakeCursor | null }[];
  readonly transactions: FakeTransaction[];
  readonly rollbacks: { count: number };
  readonly concurrency: { open: number; max: number };
  readonly queues: Map<string, FakeStep[]>;
}

/** يبني الحالة ويجهّز صفحات كل نشاط، فكل صفحة تُقرأ مرة واحدة. */
function createFakeState(options: FakeHarnessOptions): FakeHarnessState {
  const queues = new Map<string, FakeStep[]>();
  for (const [id, steps] of Object.entries(options.steps)) queues.set(id, [...steps]);
  return {
    executed: [],
    committed: [],
    reads: [],
    transactions: [],
    rollbacks: { count: 0 },
    concurrency: { open: 0, max: 0 },
    queues,
  };
}

/** قارئ الصفحات: يسجّل كل قراءة، ويرفع خطأ القارئ أو يبيّن أن النشاط بلا صفحة. */
function createFakeReader(
  options: FakeHarnessOptions,
  state: FakeHarnessState,
): CurrentTipSessionsReader {
  return {
    readPage: async (tx, _companyId, businessId, _range, page) => {
      (tx as unknown as FakeTransaction).log.push('read');
      state.reads.push({ businessId, after: page.after });
      if (options.readerError !== undefined) throw options.readerError;
      const step = state.queues.get(businessId)?.shift();
      if (step === undefined) throw new Error(`NO_PAGE_FOR_${businessId}`);
      return { items: [...step.items], nextCursor: step.nextCursor };
    },
  };
}

/** معاملة الشركة: لكل زيارة معاملة تسجّل نداءاتها وتثبّت علاماتها أو تلغاها. */
function createFakeWithTenant(state: FakeHarnessState): BootstrapDeps['withTenant'] {
  return async <T>(_companyId: string, fn: (tx: FakeTx) => Promise<T>) => {
    const tx: FakeTransaction = { log: [], marks: [] };
    state.transactions.push(tx);
    state.concurrency.open += 1;
    state.concurrency.max = Math.max(state.concurrency.max, state.concurrency.open);
    try {
      const result = await fn(tx as unknown as FakeTx);
      state.committed.push(...tx.marks);
      return result;
    } catch (error) {
      state.rollbacks.count += 1;
      tx.marks.length = 0;
      throw error;
    } finally {
      state.concurrency.open -= 1;
    }
  };
}

/** إسقاط البقشيش: يسجّل الزيارة المرفوضة برمزها فتُحسب غير مسلَّمة. */
function createFakeTipsFor(
  options: FakeHarnessOptions,
  state: FakeHarnessState,
): BootstrapDeps['tipsFor'] {
  return (tx) => ({
    execute: async (input) => {
      (tx as unknown as FakeTransaction).log.push(`execute:${input.sessionId}`);
      state.executed.push(input.sessionId);
      const code = options.failures?.[input.sessionId];
      if (code !== undefined) throw Object.assign(new Error(code), { code });
    },
  });
}

/** حسم الحدث: يعلّم الجديد ويتخطّى المُعلَّم مسبقاً. */
function createFakeMarkConsumed(options: FakeHarnessOptions): BootstrapDeps['markConsumed'] {
  return async (tx, consumerId, event) => {
    const fake = tx as unknown as FakeTransaction;
    fake.log.push(`mark:${event}`);
    if ((options.alreadyConsumed ?? []).includes(event)) return false;
    fake.marks.push({ consumerId, eventId: event });
    return true;
  };
}

// المشغّل الوهمي: معاملة لكل قراءة صفحة ولكل زيارة، وكل معاملة تسجّل نداءاتها وعلاماتها
// وتسقطها إن فشلت، فيبقى الفرق بين «ثابت» و«مُلغى» ظاهراً في العلامات نفسها.
function createFakeHarness(options: FakeHarnessOptions) {
  const state = createFakeState(options);
  return {
    deps: {
      withTenant: createFakeWithTenant(state),
      reader: createFakeReader(options, state),
      tipsFor: createFakeTipsFor(options, state),
      consumerId: CONSUMER,
      markConsumed: createFakeMarkConsumed(options),
    },
    executed: state.executed,
    committed: state.committed,
    reads: state.reads,
    transactions: state.transactions,
    rollbacks: state.rollbacks,
    concurrency: state.concurrency,
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
it('marks every event of a visit before its projection, in the listed order', async () => {
  // يثبت أن حسم كل أحداث الزيارة يسبق إسقاط بقشيشها وبالترتيب نفسه، مثل المسار الحي
  const harness = createFakeHarness({
    steps: { [BUSINESS]: [page([tipSession('s1', 1, [7, 8, 9])])] },
  });
  await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]));
  const visit = harness.transactions.find((tx) => tx.log.includes('execute:s1'));
  expect(visit?.log).toEqual([
    `mark:${eventId(7)}`,
    `mark:${eventId(8)}`,
    `mark:${eventId(9)}`,
    'execute:s1',
  ]);
});
it('runs every visit in its own transaction, apart from the page read', async () => {
  // يثبت أن لكل زيارة معاملة مستقلة لا تتداخل مع غيرها، وأن قراءة الصفحة في معاملة ثالثة
  const harness = createFakeHarness({
    steps: { [BUSINESS]: [page([tipSession('s1', 1, [11]), tipSession('s2', 1, [12])])] },
  });
  await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]));
  expect(harness.transactions).toHaveLength(3);
  expect(harness.transactions[0]?.log).toEqual(['read']);
  expect(harness.transactions[1]?.log).toEqual([`mark:${eventId(11)}`, 'execute:s1']);
  expect(harness.transactions[2]?.log).toEqual([`mark:${eventId(12)}`, 'execute:s2']);
  expect(harness.concurrency.max).toBe(1);
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
it('rolls back only the marks of the refused visit and applies the next visits', async () => {
  // يثبت أن رفض زيارة بسبب معروف يُسقط علاماتها وحدها، وما بعدها من زيارات يُطبَّق ويُعلَّم
  const harness = createFakeHarness({
    steps: {
      [BUSINESS]: [
        page([tipSession('ok1', 1, [20]), tipSession('bad', 1, [21]), tipSession('ok2', 1, [22])]),
      ],
    },
    failures: { bad: 'COMMISSION_PERIOD_CLOSED' },
  });
  const result = await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]));
  expect(result.status).toBe('UNDELIVERED');
  expect(result.counts).toEqual({ sessions: 2, events: 2 });
  expect(harness.committed.map((mark) => mark.eventId)).toEqual([eventId(20), eventId(22)]);
  const refused = harness.transactions.find((tx) => tx.log.includes('execute:bad'));
  expect(refused?.marks).toEqual([]);
});
it('treats the other known reasons as continuable and applies nothing for them', async () => {
  // يثبت أن سببَي العمل الناقص والمبلغ غير الصالح لا يوقفان الصفحة ولا يُطبَّقان
  const harness = createFakeHarness({
    steps: {
      [BUSINESS]: [page([tipSession('s1', 1, [30]), tipSession('s2', 1, [31])])],
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
it('aborts on an unknown reason and keeps the visits committed before it', async () => {
  // يثبت أن خطأً غير معروف يوقف التشغيل عند زيارة الصفحة الثانية، وما قبلها يبقى مطبَّقاً بعلاماته
  const harness = createFakeHarness({
    steps: {
      [BUSINESS]: [
        page([tipSession('s0', 1, [40])], cursor('s0')),
        page([tipSession('ok', 1, [41]), tipSession('bad', 1, [42])]),
      ],
    },
    failures: { bad: 'COMMISSION_SOMETHING_UNKNOWN' },
  });
  const result = await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]));
  expect(result.status).toBe('ABORTED');
  expect(result.abortedAt).toEqual({ businessId: BUSINESS, after: cursor('s0') });
  expect(result.counts).toEqual({ sessions: 2, events: 2 });
  expect(harness.committed.map((mark) => mark.eventId)).toEqual([eventId(40), eventId(41)]);
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
        page([tipSession('s1', 1, [50])], cursor('s1')),
        page([tipSession('s2', 1, [51])]),
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
it('lower-cases the business ids and drops the duplicates in the given order', async () => {
  // يثبت أن معرّفات الأنشطة تُوحَّد إلى حروف صغيرة بلا تكرار، وبالترتيب المُعطى
  const harness = createFakeHarness({
    steps: { [BUSINESS]: [page([])], [OTHER_BUSINESS]: [page([])] },
  });
  const result = await runSessionTipsBootstrap(
    harness.deps,
    scopeOf([BUSINESS.toUpperCase(), BUSINESS, OTHER_BUSINESS.toUpperCase(), BUSINESS]),
  );
  expect(result.status).toBe('COMPLETE');
  expect(harness.reads.map((read) => read.businessId)).toEqual([BUSINESS, OTHER_BUSINESS]);
  expect(normalizeBusinessIds([BUSINESS.toUpperCase(), BUSINESS])).toEqual([BUSINESS]);
});
it('counts only the events it claimed anew and still projects the visit', async () => {
  // يثبت أن الحدث المُعلَّم مسبقاً لا يُحسب جديداً، والإسقاط بينفَّذ رغم ذلك
  const harness = createFakeHarness({
    steps: { [BUSINESS]: [page([tipSession('s1', 1, [60, 61])])] },
    alreadyConsumed: [eventId(60)],
  });
  const result = await runSessionTipsBootstrap(harness.deps, scopeOf([BUSINESS]));
  expect(result.status).toBe('COMPLETE');
  expect(result.counts).toEqual({ sessions: 1, events: 1 });
  expect(harness.executed).toEqual(['s1']);
  expect(harness.committed.map((mark) => mark.eventId)).toEqual([eventId(61)]);
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
        page([tipSession('s1', 1, [70], [{ employeeId: EMPLOYEE, method: 'CASH', amount: '77.777' }])]),
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
