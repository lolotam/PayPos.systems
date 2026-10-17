import { describe, expect, it } from 'vitest';

import { EMPLOYEE_NUMBER_MAX, firstFreeEmployeeNumber } from '../employee-number.js';

describe('firstFreeEmployeeNumber', () => {
  it('starts at the counter when nothing is used', () => {
    expect(firstFreeEmployeeNumber(1, [])).toBe(1);
    expect(firstFreeEmployeeNumber(1000, [])).toBe(1000);
  });

  it('skips a single used number and consecutive used numbers', () => {
    expect(firstFreeEmployeeNumber(1, [1])).toBe(2);
    expect(firstFreeEmployeeNumber(4, [4, 5, 6, 8])).toBe(7);
  });

  it('is not moved by a hand number far above the counter (the 1050 example)', () => {
    const used = [1050];
    let counter = 1002;
    for (let n = 1002; n < 1050; n++) {
      const next = firstFreeEmployeeNumber(counter, used);
      expect(next).toBe(n);
      counter = (next ?? 0) + 1;
    }
    expect(firstFreeEmployeeNumber(counter, used)).toBe(1051);
  });

  it('does not need the used list to be sorted or free of smaller numbers', () => {
    expect(firstFreeEmployeeNumber(10, [12, 3, 10, 11, 1])).toBe(13);
  });

  it('reaches the last allowed number and then refuses', () => {
    expect(firstFreeEmployeeNumber(EMPLOYEE_NUMBER_MAX, [])).toBe(EMPLOYEE_NUMBER_MAX);
    expect(firstFreeEmployeeNumber(EMPLOYEE_NUMBER_MAX, [EMPLOYEE_NUMBER_MAX])).toBeNull();
    expect(
      firstFreeEmployeeNumber(EMPLOYEE_NUMBER_MAX - 1, [
        EMPLOYEE_NUMBER_MAX - 1,
        EMPLOYEE_NUMBER_MAX,
      ]),
    ).toBeNull();
  });

  it.each([0, -1, 1.5, EMPLOYEE_NUMBER_MAX + 1, 1_000_000, Number.NaN])(
    'refuses the counter %s',
    (counter) => {
      expect(firstFreeEmployeeNumber(counter, [])).toBeNull();
    },
  );
});
