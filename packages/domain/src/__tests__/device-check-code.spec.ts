import { describe, expect, it } from 'vitest';

import { computeDeviceCheckCode, DEVICE_CHECK_CODE_ALPHABET } from '../device-check-code.js';

const uuid = (tail: string): string => `01920000-0000-7000-8000-${tail}`;

describe('computeDeviceCheckCode', () => {
  it('is four characters of the alphabet, with no look-alikes', () => {
    expect(DEVICE_CHECK_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    for (const character of '01ILO') expect(DEVICE_CHECK_CODE_ALPHABET).not.toContain(character);
    for (const tail of ['000000000001', '000000000002', '0000000000ff']) {
      const code = computeDeviceCheckCode(uuid(tail));
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    }
  });

  it('is stable for the same id', () => {
    const deviceId = uuid('0000000000aa');
    expect(computeDeviceCheckCode(deviceId)).toBe(computeDeviceCheckCode(deviceId));
  });

  it('ignores case and surrounding spaces', () => {
    expect(computeDeviceCheckCode(`  ${uuid('0000000000aa').toUpperCase()}  `)).toBe(
      computeDeviceCheckCode(uuid('0000000000aa')),
    );
  });

  it('depends on the last characters of the id', () => {
    expect(computeDeviceCheckCode(uuid('000000000001'))).not.toBe(
      computeDeviceCheckCode(uuid('000000000002')),
    );
  });

  it('gives 200 same-millisecond ids distinct codes', () => {
    const codes = new Set(
      Array.from({ length: 200 }, (_, index) =>
        computeDeviceCheckCode(uuid(index.toString(16).padStart(12, '0'))),
      ),
    );
    expect(codes.size).toBe(200);
  });
});
