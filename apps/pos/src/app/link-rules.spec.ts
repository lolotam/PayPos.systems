import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectEmployee,
  readDeviceRole,
  readRememberedBusiness,
  rememberBusiness,
} from './device-role';
import { resolveLink, stateAfterFailure, stateAfterLink, stateFromLink } from './link-rules';

vi.mock('./device-role', () => ({
  clearDeviceRole: vi.fn(),
  connectEmployee: vi.fn(async () => undefined),
  readDeviceRole: vi.fn(),
  readRememberedBusiness: vi.fn(),
  rememberBusiness: vi.fn(async () => undefined),
  saveDeviceRole: vi.fn(),
}));

const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const SAVED = { company_id: COMPANY, business_id: BUSINESS };

describe('link-rules leftover session and partial recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  });

  it('marks newly connected flows to clear any leftover same-business session first', async () => {
    await expect(stateAfterLink(null, null, SAVED)).resolves.toMatchObject({
      kind: 'flow',
      role: 'employee',
      business: SAVED,
      mustClearLeftoverSession: true,
    });
    expect(connectEmployee).toHaveBeenCalledWith(SAVED);

    await expect(stateAfterLink('employee', null, SAVED)).resolves.toMatchObject({
      kind: 'flow',
      role: 'employee',
      business: SAVED,
      mustClearLeftoverSession: true,
    });
    expect(rememberBusiness).toHaveBeenCalledWith(SAVED);
  });

  it('retains a recovered business and clears businessUnreadable when a retry partially succeeds', async () => {
    vi.mocked(readDeviceRole).mockRejectedValue(new Error('ROLE_READ_FAILED'));
    vi.mocked(readRememberedBusiness).mockResolvedValue(SAVED);

    const outcome = await resolveLink(SAVED, {
      role: 'employee',
      business: null,
      businessUnreadable: true,
    });
    const next = stateFromLink(
      { kind: 'flow', role: 'employee', business: null, businessUnreadable: true },
      outcome,
    );

    expect(next).toEqual({
      kind: 'flow',
      role: 'employee',
      business: SAVED,
      alert: 'saveFailed',
    });
    expect(
      stateAfterFailure({ kind: 'flow', role: 'employee', business: null }, 'employee', SAVED),
    ).toEqual({
      kind: 'flow',
      role: 'employee',
      business: SAVED,
      alert: 'saveFailed',
    });
  });
});
