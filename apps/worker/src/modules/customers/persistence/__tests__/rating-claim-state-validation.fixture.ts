/** حالات تلف مستقلة: تغيير حقل واحد يثبت أن الرفض يسبق أي كتابة أو حساب. */
export interface StateDamage {
  readonly name: string;
  readonly path: readonly string[];
  readonly value: unknown;
}

export const REQUEST_A = '019b0000-0000-7000-8000-000000000001';
export const REQUEST_B = '019b0000-0000-7000-8000-000000000002';
export const REQUEST_C = '019b0000-0000-7000-8000-000000000003';
const BEFORE_A = '019b0000-0000-7000-8000-000000000000';
const SWEEP = '019b0000-0000-7000-8000-000000000004';
const PAGE = '019b0000-0000-7000-8000-000000000005';
const WORK = '019b0000-0000-7000-8000-000000000006';
const OTHER_WORK = '019b0000-0000-7000-8000-000000000007';

/** لقطة جولة كاملة فيها صفحة وحجز إعادة، حتى نختبر الحقول الاختيارية وهي موجودة. */
export function sweepingState(acquired: Record<string, unknown>): Record<string, unknown> {
  return {
    ...acquired,
    nextTicket: 2,
    phase: 'SWEEP',
    sweepId: SWEEP,
    upperId: REQUEST_C,
    cursorId: REQUEST_B,
    page: {
      pageId: PAGE,
      sweepId: SWEEP,
      fromId: BEFORE_A,
      throughId: REQUEST_B,
      exhausted: false,
      entries: [
        { requestId: REQUEST_A, workToken: WORK },
        { requestId: REQUEST_B, workToken: OTHER_WORK },
      ],
    },
    retries: {
      [REQUEST_A]: {
        ticket: 1,
        eligibleAt: 0,
        ownerToken: acquired['ownerToken'],
        leaseUntil: acquired['leaseUntil'],
        workToken: WORK,
      },
    },
    overflowCount: 2,
    overflowSince: 0,
    sweepOverflowCount: 1,
    reconcileRequired: true,
    lastCompletedSweepId: PAGE,
  };
}

/** القيم الغائبة وnull والأنواع الأخرى لا تتحول ضمنيًا إلى قيم بروتوكول صحيحة. */
function variants(paths: readonly string[], values: readonly unknown[]): StateDamage[] {
  return paths.flatMap((path) =>
    values.map((value) => ({
      name: `${path} = ${value === undefined ? 'missing' : JSON.stringify(value)}`,
      path: path.split('.'),
      value,
    })),
  );
}

const BAD_NUMBER = [null, '1', true, {}, [], 0.5, Number.MAX_SAFE_INTEGER + 1];
const RETRY = `retries.${REQUEST_A}`;
const ENTRY = 'page.entries.0';
const entry = { requestId: REQUEST_B, workToken: WORK };

export const STATE_DAMAGE: readonly StateDamage[] = [
  ...variants(['schema'], [undefined, null, '1', true, {}, [], 0, 1.5, 2]),
  ...variants(['companyId'], [undefined, null, '', 1, false, {}, [], REQUEST_C]),
  ...variants(
    ['version', 'nextTicket', 'overflowCount', `${RETRY}.ticket`],
    [undefined, ...BAD_NUMBER, -1],
  ),
  ...variants(['version', 'nextTicket', `${RETRY}.ticket`], [0]),
  ...variants(['sweepOverflowCount'], [...BAD_NUMBER, -1]),
  ...variants(['reconcileRequired', 'page.exhausted'], [undefined, null, 'true', 0, 1, {}, []]),
  ...variants(
    [
      'incarnation',
      'ownerToken',
      'sweepId',
      'page.pageId',
      'page.sweepId',
      `${ENTRY}.requestId`,
      `${ENTRY}.workToken`,
      `${RETRY}.ownerToken`,
      `${RETRY}.workToken`,
    ],
    [undefined, null, '', 1, false, {}, []],
  ),
  ...variants(
    ['upperId', 'cursorId', 'lastCompletedSweepId', 'page.fromId', 'page.throughId'],
    [null, '', 1, false, {}, []],
  ),
  ...variants(
    ['leaseUntil', 'turnStartedAt', `${RETRY}.eligibleAt`, `${RETRY}.leaseUntil`],
    [undefined, ...BAD_NUMBER],
  ),
  ...variants(['overflowSince'], BAD_NUMBER),
  ...variants(['phase'], [undefined, null, '', 'UNKNOWN', 1, false, {}, []]),
  ...variants(['page'], [null, 1, false, 'page', []]),
  ...variants(
    ['page.entries'],
    [
      undefined,
      null,
      1,
      false,
      'entries',
      { item: entry },
      { 1: entry },
      { 1: entry, 3: entry },
      { 0: entry },
      { 1: entry, extra: entry },
      [entry, null, entry],
      [null],
      [1],
      [[]],
    ],
  ),
  ...variants(['retries'], [undefined, null, false, 1, 'retries', [{ ticket: 1, eligibleAt: 0 }]]),
  ...variants([RETRY], [null, false, 1, 'entry', [], {}]),
  {
    name: 'empty retry request ID',
    path: ['retries'],
    value: { '': { ticket: 1, eligibleAt: 0 } },
  },
  { name: 'page belongs to another sweep', path: ['page', 'sweepId'], value: PAGE },
  { name: 'cursor without captured bound', path: ['upperId'], value: undefined },
  { name: 'retry ticket equals next ticket', path: ['nextTicket'], value: 1 },
  { name: 'retry ticket exceeds next ticket', path: ['retries', REQUEST_A, 'ticket'], value: 100 },
  {
    name: 'duplicate retry tickets below next ticket',
    path: ['retries'],
    value: {
      [REQUEST_A]: { ticket: 1, eligibleAt: 0 },
      [REQUEST_B]: { ticket: 1, eligibleAt: 0 },
    },
  },
];

/** R1: لكل تلف مجموعة تقدم متماسكة في بقية الحقول، حتى يثبت الاختبار الفجوة المحددة. */
export const PAGE_DAMAGE: readonly StateDamage[] = [
  { name: 'cursor missing with a page', path: ['cursorId'], value: undefined },
  { name: 'cursor without a page', path: ['page'], value: undefined },
  { name: 'throughId missing with a cursor', path: ['page', 'throughId'], value: undefined },
  { name: 'throughId differs from cursor', path: ['page', 'throughId'], value: REQUEST_C },
  { name: 'fromId beyond cursor', path: ['page', 'fromId'], value: REQUEST_C },
  { name: 'cursor beyond captured upper bound', path: ['upperId'], value: REQUEST_A },
  { name: 'entry not after fromId', path: ['page', 'entries', '0', 'requestId'], value: BEFORE_A },
  { name: 'entry beyond cursor', path: ['page', 'entries', '1', 'requestId'], value: REQUEST_C },
  {
    name: 'entries descending',
    path: ['page', 'entries'],
    value: [
      { requestId: REQUEST_B, workToken: WORK },
      { requestId: REQUEST_A, workToken: OTHER_WORK },
    ],
  },
  {
    name: 'duplicate request IDs',
    path: ['page', 'entries'],
    value: [
      { requestId: REQUEST_A, workToken: WORK },
      { requestId: REQUEST_A, workToken: OTHER_WORK },
    ],
  },
  {
    name: 'duplicate work tokens',
    path: ['page', 'entries'],
    value: [
      { requestId: REQUEST_A, workToken: WORK },
      { requestId: REQUEST_B, workToken: WORK },
    ],
  },
  { name: 'overflow without reconciliation', path: ['reconcileRequired'], value: false },
];

/** حذف الحقل يختبر الغياب الحقيقي؛ null تبقى قيمة JSON مستقلة، وخصوصًا داخل المصفوفات. */
export function damageState(state: Record<string, unknown>, damage: StateDamage): void {
  let target = state;
  for (const part of damage.path.slice(0, -1)) target = target[part] as Record<string, unknown>;
  const field = damage.path.at(-1);
  if (field === undefined) throw new Error('RATING_CLAIM_TEST_DAMAGE_PATH_EMPTY');
  if (damage.value === undefined) Reflect.deleteProperty(target, field);
  else target[field] = damage.value;
}
