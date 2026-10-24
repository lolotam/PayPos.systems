import { buildEmployeeAppLink, POS_HOSTS } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { parseManagerLink } from './manager-link';

const company = '01920000-0000-7000-8000-0000000000c1';
const business = '01920000-0000-7000-8000-0000000000b1';

// الإدمن بيبني اللينك والتطبيق بيقرأه، فالاختبار ده بيمنع الناحيتين يختلفوا (spec 069 cross-check).
it.each(Object.values(POS_HOSTS))('keeps the admin link readable by the app on %s', (host) => {
  const link = buildEmployeeAppLink(`https://${host}`, company, business) as string;
  expect(parseManagerLink(link, host)).toEqual({ company_id: company, business_id: business });
});
