import { describe, expect, it, vi } from 'vitest';

import { switchBusiness, type SwitchBusinessIo } from './business-switch';

const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const NEXT = { company_id: COMPANY, business_id: BUSINESS };

function io(overrides: Partial<SwitchBusinessIo> = {}): SwitchBusinessIo {
  return {
    isOnline: vi.fn(() => true),
    endPersonalSession: vi.fn(async () => 'done' as const),
    rememberBusiness: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('switchBusiness', () => {
  it('refuses offline without calling anything', async () => {
    const deps = io({ isOnline: vi.fn(() => false) });

    await expect(switchBusiness(NEXT, deps)).resolves.toBe('offline');
    expect(deps.endPersonalSession).not.toHaveBeenCalled();
    expect(deps.rememberBusiness).not.toHaveBeenCalled();
  });

  it('keeps the old business when the sign-out fails', async () => {
    const deps = io({ endPersonalSession: vi.fn(async () => 'failed' as const) });

    await expect(switchBusiness(NEXT, deps)).resolves.toBe('failed');
    expect(deps.rememberBusiness).not.toHaveBeenCalled();
  });

  it('remembers the new business after the sign-out', async () => {
    const deps = io();

    await expect(switchBusiness(NEXT, deps)).resolves.toBe('switched');
    expect(deps.endPersonalSession).toHaveBeenCalledTimes(1);
    expect(deps.rememberBusiness).toHaveBeenCalledWith(NEXT);
  });

  it('lets a failed save reach the step queue', async () => {
    const deps = io({
      rememberBusiness: vi.fn(async () => {
        throw new Error('SYNTHETIC_SAVE_FAILURE');
      }),
    });

    await expect(switchBusiness(NEXT, deps)).rejects.toThrow('SYNTHETIC_SAVE_FAILURE');
  });
});
