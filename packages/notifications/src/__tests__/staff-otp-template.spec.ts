import { present } from '../../../db/test/present.ts';
import { describe, expect, it } from 'vitest';
import { prepareStaffOtp, readOtpTemplateApproval } from '../templates/staff-otp-preparation.ts';
import { validateParameters } from '../templates/definition.ts';
import { staffOtp } from '../templates/staff-otp.ts';

const componentManifest = JSON.stringify([
  { type: 'body' },
  { type: 'button', sub_type: 'url', index: '0' },
]);
const config = {
  STAFF_OTP_TEMPLATES_APPROVED: 'true',
  STAFF_OTP_TEMPLATE_AR: 'synthetic_ar',
  STAFF_OTP_TEMPLATE_EN: 'synthetic_en',
  STAFF_OTP_COMPONENTS_AR: componentManifest,
  STAFF_OTP_COMPONENTS_EN: componentManifest,
};

describe('sensitive rendering exists only on the approved OTP path', () => {
  it.each(['ar', 'en'] as const)(
    'preserves exact %s name and body/button order in transient memory',
    (locale) => {
      const approval = present(readOtpTemplateApproval(config)),
        code = String(7).padStart(6, '0');
      const result = present(prepareStaffOtp(approval, locale, approval.names[locale], code));
      expect(result.name).toBe(approval.names[locale]);
      expect(result.components.map((c) => c.type)).toEqual(['body', 'button']);
      expect(result.components.every((c) => c.parameters?.[0]?.text === code)).toBe(true);
    },
  );
  it('closes for missing approval/name/locale and does not introduce a fallback', () => {
    expect(readOtpTemplateApproval({})).toBeNull();
    expect(readOtpTemplateApproval({ ...config, STAFF_OTP_COMPONENTS_AR: '[]' })).toBeNull();
    expect(
      prepareStaffOtp(
        readOtpTemplateApproval(config),
        'ar',
        'synthetic_en',
        String(7).padStart(6, '0'),
      ),
    ).toBeNull();
    expect(prepareStaffOtp(null, 'ar', 'synthetic_ar', String(7).padStart(6, '0'))).toBeNull();
  });
  it('keeps the tenant safe-parameter path closed to the sensitive descriptor', () => {
    expect(
      validateParameters(staffOtp, 'ar', [
        { name: 'code', type: 'text', value: String(7).padStart(6, '0') },
      ]),
    ).toBe(false);
  });
});
