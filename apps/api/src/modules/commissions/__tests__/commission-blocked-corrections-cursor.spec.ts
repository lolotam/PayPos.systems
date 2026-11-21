import { expect, it } from 'vitest';

import {
  decodeCommissionBlockedCorrectionCursor,
  encodeCommissionBlockedCorrectionCursor,
  type CommissionBlockedCorrectionCursorContext,
} from '../queries/commission-blocked-corrections-cursor.ts';

const context: CommissionBlockedCorrectionCursorContext = {
  companyId: '0193ae01-0000-7000-8000-000000000001',
  businessId: '0193ae01-0000-7000-8000-000000000002',
  status: 'open',
};
const position = {
  createdAt: '2026-11-01T08:00:00.000000Z',
  id: '0193ae01-0000-7000-8000-000000000003',
};

it('the encoded cursor decodes back to its own context and position', () => {
  const cursor = encodeCommissionBlockedCorrectionCursor(context, position);
  const decoded = decodeCommissionBlockedCorrectionCursor(cursor, context);
  expect(decoded).toEqual({ kind: 'valid', position });
});

it('a missing cursor is the first page', () => {
  expect(decodeCommissionBlockedCorrectionCursor(undefined, context)).toEqual({ kind: 'none' });
});

it.each([
  ['not-a-cursor'],
  ['abc/123+def'],
  [''],
  [Buffer.from('{"v":1,"c":"x"}', 'utf8').toString('base64url')],
  [
    encodeCommissionBlockedCorrectionCursor(
      { ...context, companyId: '0193ae01-0000-7000-8000-000000000009' },
      position,
    ),
  ],
  [
    encodeCommissionBlockedCorrectionCursor(
      { ...context, businessId: '0193ae01-0000-7000-8000-000000000009' },
      position,
    ),
  ],
  [encodeCommissionBlockedCorrectionCursor({ ...context, status: 'all' }, position)],
])('a malformed or foreign cursor %j is refused', (cursor) => {
  expect(decodeCommissionBlockedCorrectionCursor(cursor, context)).toEqual({ kind: 'invalid' });
});

it('a payload whose timestamp is not raw microseconds is refused', () => {
  const payload = {
    v: 1,
    c: context.companyId,
    b: context.businessId,
    s: 'open',
    i: position.id,
    t: '2026-11-01T08:00:00.000Z',
  };
  const cursor = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  expect(decodeCommissionBlockedCorrectionCursor(cursor, context)).toEqual({ kind: 'invalid' });
});

it('a payload whose month is not a real calendar month is refused', () => {
  const payload = {
    v: 1,
    c: context.companyId,
    b: context.businessId,
    s: 'open',
    i: position.id,
    t: '2026-13-01T08:00:00.000000Z',
  };
  const cursor = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  expect(decodeCommissionBlockedCorrectionCursor(cursor, context)).toEqual({ kind: 'invalid' });
});

it('a non-canonical base64url form is refused even with a valid payload', () => {
  const cursor = encodeCommissionBlockedCorrectionCursor(context, position);
  const unpadded = cursor.replace(/=+$/, '');
  if (unpadded !== cursor) {
    expect(decodeCommissionBlockedCorrectionCursor(unpadded, context)).toEqual({ kind: 'invalid' });
  }
  const padded = `${cursor}=`.replace(/==+$/, '=');
  if (padded !== cursor) {
    expect(decodeCommissionBlockedCorrectionCursor(padded, context)).toEqual({ kind: 'invalid' });
  }
});
