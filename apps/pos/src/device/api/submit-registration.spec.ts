import { registerDeviceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { submitRegistration } from './submit-registration';

const mockRegisterDevice = vi.fn();
const mockSaveRegistration = vi.fn();

vi.mock('./device-calls', () => ({
  registerDevice: (...args: unknown[]) => mockRegisterDevice(...args),
}));

vi.mock('../model/credentials', () => ({
  saveRegistration: (...args: unknown[]) => mockSaveRegistration(...args),
}));

function testSuccess(): void {
  it('saves { company_id, device_id, claim_secret } and returns null on success', async () => {
    mockRegisterDevice.mockResolvedValue({
      ok: true,
      data: {
        company_id: '01923f66-3d2b-7c00-8000-000000000001',
        device_id: '01923f66-3d2b-7c00-8000-000000000002',
        claim_secret: 'test-claim-secret',
      },
    });

    const input = { pairing_code: 'ABCD1234', label: 'Main Register' };
    const result = await submitRegistration(input, 'ar');

    expect(result).toBeNull();
    expect(mockSaveRegistration).toHaveBeenCalledWith({
      company_id: '01923f66-3d2b-7c00-8000-000000000001',
      device_id: '01923f66-3d2b-7c00-8000-000000000002',
      claim_secret: 'test-claim-secret',
    });
  });
}

function testInvalidCode(): void {
  it('returns the envelope message for the current locale on PAIRING_CODE_INVALID', async () => {
    const errorEnvelope = {
      code: 'PAIRING_CODE_INVALID',
      message_ar: t('ar', 'errors.PAIRING_CODE_INVALID'),
      message_en: t('en', 'errors.PAIRING_CODE_INVALID'),
    };

    mockRegisterDevice.mockResolvedValue({
      ok: false,
      failure: { kind: 'http', status: 400, envelope: errorEnvelope },
    });

    const input = { pairing_code: 'ABCD1234', label: 'Main Register' };

    const resultAr = await submitRegistration(input, 'ar');
    expect(resultAr).toBe(t('ar', 'errors.PAIRING_CODE_INVALID'));
    expect(mockSaveRegistration).not.toHaveBeenCalled();

    const resultEn = await submitRegistration(input, 'en');
    expect(resultEn).toBe(t('en', 'errors.PAIRING_CODE_INVALID'));
  });
}

function testSchemaNormalization(): void {
  it('normalizes the pairing code by trimming and upper-casing through the contract schema', async () => {
    mockRegisterDevice.mockResolvedValue({
      ok: true,
      data: {
        company_id: '01923f66-3d2b-7c00-8000-000000000001',
        device_id: '01923f66-3d2b-7c00-8000-000000000002',
        claim_secret: 'test-claim-secret',
      },
    });

    const parsed = registerDeviceInput.parse({
      pairing_code: '  ab12cd34  ',
      label: '  Checkout Counter  ',
    });
    expect(parsed.pairing_code).toBe('AB12CD34');
    expect(parsed.label).toBe('Checkout Counter');

    await submitRegistration(parsed, 'ar');
    expect(mockRegisterDevice).toHaveBeenCalledWith({
      pairing_code: 'AB12CD34',
      label: 'Checkout Counter',
    });
  });
}

function testNetworkError(): void {
  it('returns network error translation when the call rejects', async () => {
    mockRegisterDevice.mockRejectedValue(new Error('Network down'));

    const input = { pairing_code: 'ABCD1234', label: 'Main Register' };

    const resultAr = await submitRegistration(input, 'ar');
    expect(resultAr).toBe(t('ar', 'pos.networkError'));

    const resultEn = await submitRegistration(input, 'en');
    expect(resultEn).toBe(t('en', 'pos.networkError'));
  });
}

describe('submitRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  testSuccess();
  testInvalidCode();
  testSchemaNormalization();
  testNetworkError();
});
