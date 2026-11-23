import { expect, it } from 'vitest';
import { pageOwnLines, type OwnLineKey } from '../queries/own-service-lines.page.ts';

const line = (n: number): OwnLineKey => ({
  lineId: `018f0000-0000-7000-8000-00000000000${n}`,
  sessionId: `018f0000-0000-7000-9000-00000000000${n}`,
  businessDate: '2026-10-14',
  occurredAt: `2026-10-14T08:0${n}:00.000000`,
  branchId: '018f0000-0000-7000-a000-000000000001',
});
const owned = [line(1), line(2), line(3), line(4)];
const abc = '018f0000-0000-7000-8000-00000000000a';

it('walks the same page from the lowercase and the uppercase form of the same cursor (F5)', () => {
  const first = pageOwnLines(owned, undefined, 2);
  const cursor = first?.nextCursor ?? undefined;
  expect(cursor).toBe(line(3).lineId);
  const lower = pageOwnLines(owned, cursor, 2);
  expect(lower?.keys.map((key) => key.lineId)).toEqual([line(2).lineId, line(1).lineId]);
  expect(pageOwnLines(owned, cursor?.toUpperCase(), 2)).toEqual(lower);
});

it('matches a hex-letter id in any case, and still refuses a foreign or malformed anchor', () => {
  const lettered = [{ ...line(1), lineId: abc }, line(2)];
  expect(pageOwnLines(lettered, abc.toUpperCase(), 5)?.keys).toEqual([]);
  expect(pageOwnLines(lettered, abc, 5)?.keys).toEqual([]);
  expect(pageOwnLines(owned, abc.toUpperCase(), 5)).toBeNull();
  expect(pageOwnLines(owned, 'not-a-line', 5)).toBeNull();
});
