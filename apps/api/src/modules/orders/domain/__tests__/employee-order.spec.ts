import { describe, expect, it } from 'vitest';
import { compareEmployeeId } from '../employee-order.ts';

describe('compareEmployeeId', () => {
  it('orders lowercase ids and treats case variants as the same employee', () => {
    expect(compareEmployeeId('a', 'b')).toBeLessThan(0);
    expect(compareEmployeeId('b', 'a')).toBeGreaterThan(0);
    expect(compareEmployeeId('B', 'b')).toBe(0);
    expect(compareEmployeeId('A', 'b')).toBeLessThan(0);
  });
});
