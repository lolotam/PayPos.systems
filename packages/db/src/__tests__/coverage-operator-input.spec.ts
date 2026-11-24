import { describe, expect, it } from 'vitest';

import { parseExpiry } from '../coverage-operator-input.ts';

// وحدة تحليل --expiry لأمر المشغّل: مركّبات الـoffset تُفحص عنصراً عنصراً (ساعات ≤ 14، دقائق ≤ 59)
// قبل أي ضرب أو تطبيع، فـ+00:90 لا تُقبل كـ90 دقيقة؛ والساعة المرجعية UTC فقط (بلا قاعدة بيانات).

describe('parseExpiry offset components', () => {
  it('rejects offset minutes above 59 even though the total normalises', () => {
    expect(() => parseExpiry('2026-12-01T12:00:00+00:90')).toThrow(
      'COVERAGE_OPERATOR_INPUT_INVALID',
    );
    expect(() => parseExpiry('2026-12-01T12:00:00-02:75')).toThrow(
      'COVERAGE_OPERATOR_INPUT_INVALID',
    );
  });

  it('rejects offset hours above 14', () => {
    expect(() => parseExpiry('2026-12-01T12:00:00+15:00')).toThrow(
      'COVERAGE_OPERATOR_INPUT_INVALID',
    );
    expect(() => parseExpiry('2026-12-01T12:00:00+14:60')).toThrow(
      'COVERAGE_OPERATOR_INPUT_INVALID',
    );
  });

  it('accepts Z and a full valid offset at the boundary', () => {
    expect(parseExpiry('2026-12-01T12:00:00Z')).toEqual(new Date(Date.UTC(2026, 11, 1, 12)));
    expect(parseExpiry('2026-12-01T12:00:00+14:00')).toEqual(
      new Date(Date.UTC(2026, 11, 1, 12) - 14 * 60 * 60_000),
    );
    expect(parseExpiry('2026-12-01T12:00:00-14:00')).toEqual(
      new Date(Date.UTC(2026, 11, 1, 12) + 14 * 60 * 60_000),
    );
  });

  it('keeps the legacy total cap that rejects a total beyond fourteen hours', () => {
    expect(() => parseExpiry('2026-12-01T12:00:00+14:59')).toThrow(
      'COVERAGE_OPERATOR_INPUT_INVALID',
    );
  });

  it('accepts the compact offset spellings +0300 and +03 as +03:00', () => {
    const colon = parseExpiry('2026-12-01T12:00:00+03:00').getTime();
    expect(parseExpiry('2026-12-01T12:00:00+0300').getTime()).toBe(colon);
    expect(parseExpiry('2026-12-01T12:00:00+03').getTime()).toBe(colon);
    expect(parseExpiry('2026-12-01T12:00:00-0300').getTime()).toBe(
      parseExpiry('2026-12-01T12:00:00-03:00').getTime(),
    );
  });

  it('rejects more than three fractional-second digits instead of truncating them', () => {
    expect(() => parseExpiry('2026-12-01T12:00:00.1234Z')).toThrow(
      'COVERAGE_OPERATOR_INPUT_INVALID',
    );
    expect(parseExpiry('2026-12-01T12:00:00.123Z').getTime()).toBe(
      Date.UTC(2026, 11, 1, 12, 0, 0, 123),
    );
  });

  it('keeps the existing refusals for malformed and rolled values', () => {
    expect(() => parseExpiry('2026-12-01T12:00:00')).toThrow('COVERAGE_OPERATOR_INPUT_INVALID');
    expect(() => parseExpiry('2026-12-01 12:00:00Z')).toThrow('COVERAGE_OPERATOR_INPUT_INVALID');
    expect(() => parseExpiry('2026-02-31T12:00:00Z')).toThrow('COVERAGE_OPERATOR_INPUT_INVALID');
    expect(() => parseExpiry('2026-12-01T25:00:00Z')).toThrow('COVERAGE_OPERATOR_INPUT_INVALID');
    expect(() => parseExpiry('2026-12-01T12:00:00+25:00')).toThrow(
      'COVERAGE_OPERATOR_INPUT_INVALID',
    );
  });
});
