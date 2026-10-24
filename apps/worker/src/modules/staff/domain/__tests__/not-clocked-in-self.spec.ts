import { validPushTemplate } from '@pospay/notifications';
import { describe, expect, it } from 'vitest';
import { shiftNotClockedInSelfParameters } from '../not-clocked-in-self.ts';

const CATALOG = {
  employeeAr: 'موظف',
  employeeEn: 'Employee',
  branchAr: 'فرع',
  branchEn: 'Branch',
};

describe('shiftNotClockedInSelfParameters', () => {
  it('carries the shift start first and the branch names in both languages', () => {
    expect(shiftNotClockedInSelfParameters('السالمية', 'Salmiya', '10:00')).toEqual([
      { name: 'shift_start', type: 'text', value: '10:00' },
      { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
      { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    ]);
  });

  it('keeps the order of the three parameters the template expects', () => {
    const parameters = shiftNotClockedInSelfParameters('السالمية', 'Salmiya', '10:00');
    expect(parameters?.map((parameter) => parameter.name)).toEqual([
      'shift_start',
      'branch_name_ar',
      'branch_name_en',
    ]);
  });

  it('falls back to the English name when the Arabic one is missing or refused', () => {
    expect(shiftNotClockedInSelfParameters(null, 'Salmiya', '10:00')?.[1]).toEqual({
      name: 'branch_name_ar',
      type: 'text',
      value: 'Salmiya',
    });
    expect(
      shiftNotClockedInSelfParameters('https://example.test', 'Salmiya', '10:00')?.[1],
    ).toEqual({
      name: 'branch_name_ar',
      type: 'text',
      value: 'Salmiya',
    });
  });

  it('falls back to the generic label when the English name is refused', () => {
    expect(shiftNotClockedInSelfParameters(null, 'https://example.test', '10:00')?.[2]).toEqual({
      name: 'branch_name_en',
      type: 'text',
      value: 'Branch',
    });
    expect(shiftNotClockedInSelfParameters(null, '+96500000001', '10:00')?.[2]).toEqual({
      name: 'branch_name_en',
      type: 'text',
      value: 'Branch',
    });
  });

  it('uses the catalog fallback it is given', () => {
    const parameters = shiftNotClockedInSelfParameters(
      null,
      'https://example.test',
      '10:00',
      CATALOG,
    );
    expect(parameters?.map((parameter) => parameter.value)).toEqual(['10:00', 'فرع', 'Branch']);
  });
});

describe('the shift start and the template acceptance', () => {
  it('refuses a shift start that is not a 24-hour time', () => {
    for (const shiftStart of ['24:00', '9:00', '10:60', ''])
      expect(shiftNotClockedInSelfParameters(null, 'Salmiya', shiftStart)).toBeNull();
  });

  it('accepts the edges of the 24-hour day', () => {
    expect(shiftNotClockedInSelfParameters(null, 'Salmiya', '00:00')?.[0]).toEqual({
      name: 'shift_start',
      type: 'text',
      value: '00:00',
    });
    expect(shiftNotClockedInSelfParameters(null, 'Salmiya', '23:59')?.[0]).toEqual({
      name: 'shift_start',
      type: 'text',
      value: '23:59',
    });
  });

  it('produces parameters the push template accepts', () => {
    const parameters = shiftNotClockedInSelfParameters('السالمية', 'Salmiya', '10:00');
    expect(parameters).not.toBeNull();
    expect(validPushTemplate('shift_not_clocked_in_self', 1, parameters ?? [])).toBe(true);
  });
});
