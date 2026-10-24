import { describe, expect, it } from 'vitest';
import { buildEmployeeAppLink, POS_HOSTS } from './employee-app-link.js';

const company = '01920000-0000-7000-8000-0000000000c1';
const business = '01920000-0000-7000-8000-0000000000b1';

describe('buildEmployeeAppLink', () => {
  it.each(Object.values(POS_HOSTS))('builds the exact staff link for %s', (host) => {
    expect(buildEmployeeAppLink(`https://${host}`, company, business)).toBe(
      `https://${host}/personal?company=${company}&business=${business}`,
    );
  });

  it.each([
    undefined,
    '',
    'http://pos.pospay.systems',
    'https://pos.pospay.systems:8443',
    'https://evil.pospay.systems',
    'https://pos.pospay.systems.evil.test',
    'https://pos.pospay.systems/x',
    'https://user@pos.pospay.systems',
    'not a url',
  ])('refuses an unsafe or invalid origin: %s', (origin) => {
    expect(buildEmployeeAppLink(origin, company, business)).toBeNull();
  });

  it('accepts an origin with a trailing slash', () => {
    expect(buildEmployeeAppLink('https://pos.pospay.systems/', company, business)).toBe(
      `https://pos.pospay.systems/personal?company=${company}&business=${business}`,
    );
  });
});
