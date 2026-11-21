import { expect, it } from 'vitest';

import { commissionCorrectionBlockedNoticeRequested } from '../correction-blocked-notice.js';

const uuid = (suffix: string): string => `01920000-0000-7000-8000-${suffix}`;
const userId = (index: number): string => uuid(String(index).padStart(12, '0'));

const payload = (recipients: readonly string[]) => ({
  schema_version: 1,
  block_id: uuid('0000000000b1'),
  group_index: 0,
  business_id: uuid('0000000000b2'),
  source_period: '2026-09',
  notification_recipients: recipients.map((user_id) => ({
    channel: 'IN_APP',
    user_id,
    locale: 'ar',
    template_key: 'commission_correction_blocked',
    template_revision: 1,
    safe_parameters: [{ name: 'period', type: 'text', value: '2026-09' }],
  })),
});

it('N2 accepts one hundred recipients and keeps the exact payload shape', () => {
  const accepted = payload(Array.from({ length: 100 }, (_, index) => userId(index)));
  expect(commissionCorrectionBlockedNoticeRequested.parse(accepted)).toEqual(accepted);
});

it('N2 refuses zero recipients and one hundred and one recipients', () => {
  const none = payload([]);
  expect(commissionCorrectionBlockedNoticeRequested.safeParse(none).success).toBe(false);
  const oneMore = payload(Array.from({ length: 101 }, (_, index) => userId(index)));
  expect(commissionCorrectionBlockedNoticeRequested.safeParse(oneMore).success).toBe(false);
});

it('N2 refuses an unknown field, a non-period month and a non-arabic locale', () => {
  const unknownField = { ...payload([userId(1)]), employee_id: uuid('0000000000b3') };
  expect(commissionCorrectionBlockedNoticeRequested.safeParse(unknownField).success).toBe(false);
  const badMonth = payload([userId(1)]);
  badMonth.source_period = '2026-13';
  expect(commissionCorrectionBlockedNoticeRequested.safeParse(badMonth).success).toBe(false);
  const badLocale = payload([userId(1)]);
  (badLocale.notification_recipients[0] as Record<string, unknown>).locale = 'en';
  expect(commissionCorrectionBlockedNoticeRequested.safeParse(badLocale).success).toBe(false);
});
