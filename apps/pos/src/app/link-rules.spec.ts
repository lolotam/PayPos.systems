import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectEmployee,
  readDeviceRole,
  readRememberedBusiness,
  rememberBusiness,
} from './device-role';
import { endPersonalSession } from './end-sessions';
import { resolveLink, stateAfterFailure, stateAfterLink, stateFromLink } from './link-rules';

vi.mock('./device-role', () => ({
  clearDeviceRole: vi.fn(),
  connectEmployee: vi.fn(async () => undefined),
  readDeviceRole: vi.fn(),
  readRememberedBusiness: vi.fn(),
  rememberBusiness: vi.fn(async () => undefined),
  saveDeviceRole: vi.fn(),
}));
vi.mock('./end-sessions', () => ({
  endPersonalSession: vi.fn(async () => 'done' as const),
}));

const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const SAVED = { company_id: COMPANY, business_id: BUSINESS };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(endPersonalSession).mockResolvedValue('done');
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
});

describe('link-rules leftover session clearance', () => {
  it('signs out any leftover session before saving on first link and aborts persistence if sign-out fails', async () => {
    const order: string[] = [];
    vi.mocked(endPersonalSession).mockImplementationOnce(async () => {
      order.push('end');
      return 'done';
    });
    vi.mocked(connectEmployee).mockImplementationOnce(async () => {
      order.push('connect');
    });
    await expect(stateAfterLink(null, null, SAVED)).resolves.toEqual({
      kind: 'flow',
      role: 'employee',
      business: SAVED,
    });
    expect(order).toEqual(['end', 'connect']);

    vi.mocked(endPersonalSession).mockResolvedValueOnce('failed');
    await expect(stateAfterLink(null, null, SAVED)).resolves.toEqual({
      kind: 'start',
      business: null,
      alert: 'saveFailed',
    });
    expect(connectEmployee).toHaveBeenCalledTimes(1);

    vi.mocked(endPersonalSession).mockResolvedValueOnce('failed');
    await expect(stateAfterLink('employee', null, SAVED)).resolves.toEqual({
      kind: 'flow',
      role: 'employee',
      business: null,
      alert: 'roleChangeFailed',
    });
    expect(rememberBusiness).not.toHaveBeenCalled();

    await expect(stateAfterLink('employee', null, SAVED)).resolves.toEqual({
      kind: 'flow',
      role: 'employee',
      business: SAVED,
    });
    expect(rememberBusiness).toHaveBeenCalledWith(SAVED);
  });
});

describe('link-rules partial recovery', () => {
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

  it('clears a stale business and unreadable flag when partial recovery confirms no business is saved', async () => {
    vi.mocked(readDeviceRole).mockRejectedValue(new Error('ROLE_READ_FAILED'));
    vi.mocked(readRememberedBusiness).mockResolvedValue(null);

    const outcome = await resolveLink(SAVED);
    expect(stateFromLink({ kind: 'flow', role: 'employee', business: SAVED }, outcome)).toEqual({
      kind: 'flow',
      role: 'employee',
      business: null,
      alert: 'saveFailed',
    });
    expect(
      stateFromLink(
        { kind: 'flow', role: 'employee', business: null, businessUnreadable: true },
        outcome,
      ),
    ).toEqual({
      kind: 'flow',
      role: 'employee',
      business: null,
      alert: 'saveFailed',
    });
  });
});
