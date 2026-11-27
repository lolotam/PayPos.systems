import { describe, expect, it } from 'vitest';

import { computeDeviceCheckCode, DEVICE_CHECK_CODE_ALPHABET } from '../device-check-code.ts';

const uuid = (tail: string): string => `01920000-0000-7000-8000-${tail}`;

describe('the identity module check code', () => {
  it('uses the pairing-code alphabet', () => {
    expect(DEVICE_CHECK_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  });

  it('gives a device a stable code of four alphabet characters', () => {
    const code = computeDeviceCheckCode(uuid('0000000000aa'));
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    expect(computeDeviceCheckCode(uuid('0000000000aa'))).toBe(code);
  });

  it('ignores case and surrounding spaces', () => {
    expect(computeDeviceCheckCode(`  ${uuid('0000000000AA')}  `)).toBe(
      computeDeviceCheckCode(uuid('0000000000aa')),
    );
  });
});
