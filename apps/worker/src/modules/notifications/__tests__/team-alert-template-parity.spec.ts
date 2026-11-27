import { TEAM_ALERT_TEMPLATE_KEYS } from '@pospay/contracts';
import { OPERATIONAL_EMAIL_KEYS, renderOperationalEmail } from '@pospay/notifications';
import { expect, it } from 'vitest';

// AL-Q6 (صف 62b-1): المفاتيح الحرفية اللي بتكتبها المُرسِلات (في contracts) لازم تطابق قوالب البريد التشغيلية بالظبط،
// وإلا مستلم إيميل بيتخزّن بمفتاح مالوش قالب وبيتسجّل PARAMETERS_INVALID بدل ما يوصل.
const ADMIN_ORIGIN = 'https://app.pospay.systems';

it('the producers and the email templates carry exactly the same fifteen keys', () => {
  expect([...TEAM_ALERT_TEMPLATE_KEYS].sort()).toEqual([...OPERATIONAL_EMAIL_KEYS].sort());
  expect(TEAM_ALERT_TEMPLATE_KEYS).toHaveLength(15);
});

it.each(TEAM_ALERT_TEMPLATE_KEYS.map((key) => [key]))(
  '%s renders as a parameterless Arabic and English operational email',
  (key) => {
    for (const locale of ['ar', 'en'] as const) {
      const rendered = renderOperationalEmail(key, 1, locale, [], ADMIN_ORIGIN);
      expect(rendered?.subject.length).toBeGreaterThan(0);
      expect(rendered?.text).toContain(ADMIN_ORIGIN);
    }
    expect(renderOperationalEmail(key, 1, 'ar', [{ name: 'a' }], ADMIN_ORIGIN)).toBeNull();
  },
);
