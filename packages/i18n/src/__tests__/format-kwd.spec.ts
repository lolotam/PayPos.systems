import { describe, expect, it } from 'vitest';

import { formatKwd } from '../format-kwd.js';

describe('formatKwd — KWD with three decimals', () => {
  it('shows mills as dinars with exactly three decimals', () => {
    expect(formatKwd(12500n)).toBe('12.500');
    expect(formatKwd(0n)).toBe('0.000');
    expect(formatKwd(5n)).toBe('0.005');
    expect(formatKwd(1000n)).toBe('1.000');
  });

  it('groups thousands of dinars, never the fils', () => {
    expect(formatKwd(1_234_567n)).toBe('1,234.567');
    expect(formatKwd(999_999n)).toBe('999.999');
    expect(formatKwd(1_000_000_000n)).toBe('1,000,000.000');
  });

  it('keeps the sign of a refund or a negative entry', () => {
    expect(formatKwd(-12500n)).toBe('-12.500');
    expect(formatKwd(-1_234_567n)).toBe('-1,234.567');
    expect(formatKwd(-5n)).toBe('-0.005');
  });
});
