import type { TemplateDefinition } from './definition.ts';

// TODO(spec): owner/Meta approval of exact ar/en AUTHENTICATION copy, actual Meta names and button components; live activation stays closed until supplied.
export const staffOtp: TemplateDefinition = {
  key: 'staff_otp',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'AUTHENTICATION',
  parameters: [
    { name: 'code', type: 'text', required: true, sensitivity: 'sensitive', component: 'body' },
  ],
  copy: { ar: 'رمز التحقق الخاص بك: {{code}}', en: 'Your verification code: {{code}}' },
};
