import { expect, it } from 'vitest';

import { commissionEventParkedNoticeRequested } from '../parked-commission-event.js';

const uuid = (suffix: string): string => `01920000-0000-7000-8000-${suffix}`;
const userId = (index: number): string => uuid(String(index).padStart(12, '0'));

const payload = (recipients: readonly string[]) => ({
  schema_version: 1,
  event_id: uuid('0000000000c1'),
  event_type: 'SessionTipsChanged',
  group_index: 0,
  notification_recipients: recipients.map((user_id) => ({
    channel: 'IN_APP',
    user_id,
    locale: 'ar',
    template_key: 'commission_event_parked',
    template_revision: 1,
    safe_parameters: [
      { name: 'event_type', type: 'text', value: 'SessionTipsChanged' },
      { name: 'event_id', type: 'text', value: uuid('0000000000c1') },
    ],
  })),
});

it('accepts one hundred recipients and keeps the exact payload shape', () => {
  const accepted = payload(Array.from({ length: 100 }, (_, index) => userId(index)));
  expect(commissionEventParkedNoticeRequested.parse(accepted)).toEqual(accepted);
});

it('refuses zero recipients and one hundred and one recipients', () => {
  expect(commissionEventParkedNoticeRequested.safeParse(payload([])).success).toBe(false);
  const oneMore = payload(Array.from({ length: 101 }, (_, index) => userId(index)));
  expect(commissionEventParkedNoticeRequested.safeParse(oneMore).success).toBe(false);
});

it('refuses an unknown field, a non-arabic locale and an event type that is not a type name', () => {
  const unknownField = { ...payload([userId(1)]), employee_id: uuid('0000000000b3') };
  expect(commissionEventParkedNoticeRequested.safeParse(unknownField).success).toBe(false);
  const badLocale = payload([userId(1)]);
  (badLocale.notification_recipients[0] as Record<string, unknown>).locale = 'en';
  expect(commissionEventParkedNoticeRequested.safeParse(badLocale).success).toBe(false);
  const badType = payload([userId(1)]);
  badType.event_type = 'session tips';
  expect(commissionEventParkedNoticeRequested.safeParse(badType).success).toBe(false);
});

it('refuses parameters that are not the event type and its id, in that order', () => {
  const swapped = payload([userId(1)]);
  const recipient = swapped.notification_recipients[0] as {
    safe_parameters: { name: string; type: string; value: string }[];
  };
  recipient.safe_parameters = [
    { name: 'event_id', type: 'text', value: uuid('0000000000c1') },
    { name: 'event_type', type: 'text', value: 'SessionTipsChanged' },
  ];
  expect(commissionEventParkedNoticeRequested.safeParse(swapped).success).toBe(false);
});
