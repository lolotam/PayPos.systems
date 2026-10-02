import type { TemplateComponent } from '../channel.ts';
import { staffOtp } from './staff-otp.ts';

export interface OtpTemplateApproval {
  readonly names: Readonly<Record<'ar' | 'en', string>>;
  readonly components: Readonly<
    Record<'ar' | 'en', readonly { type: 'body' | 'button'; sub_type?: 'url'; index?: string }[]>
  >;
}

export function readOtpTemplateApproval(env: NodeJS.ProcessEnv): OtpTemplateApproval | null {
  try {
    if (env['STAFF_OTP_TEMPLATES_APPROVED'] !== 'true') return null;
    const names = {
      ar: env['STAFF_OTP_TEMPLATE_AR'] ?? '',
      en: env['STAFF_OTP_TEMPLATE_EN'] ?? '',
    };
    if (Object.values(names).some((name) => !/^[a-z][a-z0-9_]{0,511}$/.test(name))) return null;
    const components = {
      ar: JSON.parse(env['STAFF_OTP_COMPONENTS_AR'] ?? ''),
      en: JSON.parse(env['STAFF_OTP_COMPONENTS_EN'] ?? ''),
    };
    for (const value of Object.values(components)) {
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        value[0]?.type !== 'body' ||
        value[1]?.type !== 'button' ||
        value[1]?.sub_type !== 'url' ||
        value[1]?.index !== '0' ||
        Object.keys(value[0]).length !== 1 ||
        Object.keys(value[1]).length !== 3
      )
        return null;
    }
    return { names, components };
  } catch {
    return null;
  }
}

export function prepareStaffOtp(
  approval: OtpTemplateApproval | null,
  locale: 'ar' | 'en',
  name: string,
  code: string,
) {
  const descriptor = staffOtp.parameters[0];
  if (
    approval === null ||
    staffOtp.key !== 'staff_otp' ||
    staffOtp.revision !== 1 ||
    staffOtp.category !== 'AUTHENTICATION' ||
    descriptor?.name !== 'code' ||
    descriptor.sensitivity !== 'sensitive' ||
    descriptor.component !== 'body' ||
    descriptor.type !== 'text' ||
    !descriptor.required ||
    !/^\d{6}$/.test(code) ||
    approval.names[locale] !== name
  )
    return null;
  const components: TemplateComponent[] = approval.components[locale].map((component) => ({
    ...component,
    parameters: [{ type: 'text', text: code }],
  }));
  return { name, components };
}
