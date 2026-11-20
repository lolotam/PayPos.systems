import { expect, it } from 'vitest';

import {
  decideCommissionBlock,
  type CommissionOpenBlock,
} from '../commission-blocked-correction.ts';

const open = (code: 'NO_PLAN' | 'NO_SALARY'): CommissionOpenBlock => ({
  id: 'block-1',
  code,
});

it('B1 a priced month without an open block decides nothing', () => {
  expect(decideCommissionBlock(null, { ok: true })).toEqual({ kind: 'NONE' });
});

it('B2 a priced month with an open block resolves it by its id', () => {
  expect(decideCommissionBlock(open('NO_PLAN'), { ok: true })).toEqual({
    kind: 'RESOLVE',
    blockId: 'block-1',
  });
});

it('B3 a NO_PLAN month without an open block records a NO_PLAN block', () => {
  expect(decideCommissionBlock(null, { ok: false, code: 'NO_PLAN' })).toEqual({
    kind: 'RECORD',
    code: 'NO_PLAN',
  });
});

it('B4 a NO_SALARY month without an open block records a NO_SALARY block', () => {
  expect(decideCommissionBlock(null, { ok: false, code: 'NO_SALARY' })).toEqual({
    kind: 'RECORD',
    code: 'NO_SALARY',
  });
});

it('B5 an open NO_PLAN block under a NO_SALARY month flips to UPDATE_CODE', () => {
  expect(decideCommissionBlock(open('NO_PLAN'), { ok: false, code: 'NO_SALARY' })).toEqual({
    kind: 'UPDATE_CODE',
    blockId: 'block-1',
    code: 'NO_SALARY',
  });
});

it('B6 an open NO_SALARY block under a NO_PLAN month flips to UPDATE_CODE', () => {
  expect(decideCommissionBlock(open('NO_SALARY'), { ok: false, code: 'NO_PLAN' })).toEqual({
    kind: 'UPDATE_CODE',
    blockId: 'block-1',
    code: 'NO_PLAN',
  });
});

it('B7 an open block whose code matches the month keeps it without a write', () => {
  expect(decideCommissionBlock(open('NO_PLAN'), { ok: false, code: 'NO_PLAN' })).toEqual({
    kind: 'KEEP',
    blockId: 'block-1',
  });
});
