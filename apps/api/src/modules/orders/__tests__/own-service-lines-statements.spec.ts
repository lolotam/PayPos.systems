import { afterAll, beforeAll, expect, it } from 'vitest';
import type { StaffColumnCode } from '@pospay/contracts';
import { ownWorkReads } from '../orders.module.ts';
import { readOwnServiceLines } from '../queries/own-service-lines.query.ts';
import {
  cancelLine,
  ids,
  interceptDatabase,
  must,
  recordVisitAt,
  tipFixture,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';
import { MAX_OWN_LINES_STATEMENTS, statementsFor } from './own-service-lines.plans.ts';

let f: TipFixture;
const now = new Date('2026-10-15T08:00:00Z');
beforeAll(async () => {
  f = await tipFixture();
  await f.linkEmployee(must(f.employees[0]), f.ownerId);
});
afterAll(async () => {
  await f?.close();
});

const context = () => ({ companyId: f.company, businessId: f.business, userId: f.ownerId });
const withColumns = (...codes: StaffColumnCode[]) => ({
  ...ownWorkReads,
  allowed: async () => new Set<StaffColumnCode>(codes),
});
const noNames = withColumns('date', 'service', 'net');
const withNames = withColumns('date', 'service', 'net', 'customer_name');
const READER_TABLES =
  /FROM\s+(line_performers|service_lines|service_sessions|service_line_cancellations)\b/;

/** يشغّل الطلب كاملاً (السلطة ثم القارئ) ويعدّ جمل `execute` في معاملته، مفصولة إلى جمل القارئ وجمل السلطة. */
async function run(query: object, reads: typeof noNames) {
  const statements: string[] = [];
  const db = interceptDatabase(f.db, async (text) => void statements.push(text));
  const outcome = await db
    .withTenant(f.company, (tx) => readOwnServiceLines(tx, context(), query, now, reads), {
      userId: f.ownerId,
      readOnly: true,
    })
    .then(
      (page) => ({ page, error: undefined as unknown }),
      (error: unknown) => ({ page: undefined, error }),
    );
  const reader = statements.filter((text) => READER_TABLES.test(text)).length;
  return { ...outcome, reader, authority: statements.length - reader };
}

const observed = new Map<string, number>();
const authority = new Set<number>();
async function expectStatements(
  label: string,
  query: object,
  reads: typeof noNames,
  expected: number,
) {
  const result = await run(query, reads);
  observed.set(label, result.reader);
  authority.add(result.authority);
  expect(result.reader, label).toBe(expected);
  return result;
}

it('counts the reader statements for every column and cancellation combination, and the maximum is six (F6)', async () => {
  const month = { month: '2026-10' };
  const noRows = await expectStatements('no performer rows', month, noNames, 1);
  expect(noRows.page?.items).toEqual([]);
  expect(noRows.page?.time_zone).toBe('Asia/Kuwait');

  const older = await recordVisitAt(f, '2026-10-10T08:00:00.000Z');
  const newer = await recordVisitAt(f, '2026-10-12T08:00:00.000Z');
  const olderLine = must(older.lineIds[0]);
  await expectStatements('no visit in the month', { month: '2026-09' }, noNames, 3);
  const foreign = await expectStatements(
    'foreign cursor',
    { ...month, cursor: ids.newId() },
    noNames,
    3,
  );
  expect(foreign.error).toMatchObject({ code: 'VALIDATION_FAILED' });

  const plain = { names: false, cancelled: false };
  await expectStatements('page', month, noNames, statementsFor(plain));
  await expectStatements('page, names', month, withNames, statementsFor({ ...plain, names: true }));

  await cancelLine(f, olderLine);
  const whole = await run(month, withNames);
  expect(whole.page?.items.filter((line) => line.cancelled).map((line) => line.line_id)).toEqual([
    olderLine,
  ]);
  await expectStatements(
    'page, cancelled',
    month,
    noNames,
    statementsFor({ ...plain, cancelled: true }),
  );
  await expectStatements('page, names, cancelled', month, withNames, MAX_OWN_LINES_STATEMENTS);

  const newest = { ...month, limit: 1 };
  const first = await expectStatements('cancelled line off the page', newest, withNames, 5);
  expect(first.page?.items.map((line) => line.line_id)).toEqual([must(newer.lineIds[0])]);
  const second = { ...newest, cursor: first.page?.next_cursor ?? undefined };
  await expectStatements('cancelled line on the page', second, withNames, 6);

  expect(Math.max(...observed.values())).toBe(MAX_OWN_LINES_STATEMENTS);
  expect(MAX_OWN_LINES_STATEMENTS).toBe(6);
  expect([...authority]).toHaveLength(1);
  console.info(
    '57-2b statements',
    JSON.stringify({ reader: Object.fromEntries(observed), authority: [...authority] }),
  );
});

it('walks the page from the uppercase form of a returned cursor, like the lowercase one (F5)', async () => {
  const visit = await recordVisitAt(f, '2026-10-13T08:00:00.000Z', [f.line(), f.line(), f.line()]);
  const first = await run({ limit: 2 }, noNames);
  const cursor = must(first.page?.next_cursor);
  expect(cursor).toBe(cursor.toLowerCase());
  const lower = await run({ limit: 2, cursor }, noNames);
  const upper = await run({ limit: 2, cursor: cursor.toUpperCase() }, noNames);
  expect(upper.error).toBeUndefined();
  expect(upper.page).toEqual(lower.page);
  expect(upper.page?.items.length).toBeGreaterThan(0);
  expect(visit.lineIds.length).toBe(3);
  const bogus = await run({ limit: 2, cursor: ids.newId().toUpperCase() }, noNames);
  expect(bogus.error).toMatchObject({ code: 'VALIDATION_FAILED' });
});
