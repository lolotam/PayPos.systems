import type { InAppNotification } from '@pospay/contracts';
import { expect, it } from 'vitest';

import { renderNotification } from './render-notification';

const EVENT_ID = '01920000-0000-7000-8000-0000000000b1';

const bell = (locale: 'ar' | 'en'): InAppNotification => ({
  id: '01920000-0000-7000-8000-0000000000d1',
  company_id: '01920000-0000-7000-8000-0000000000a0',
  business_id: null,
  branch_id: null,
  source_event_id: '01920000-0000-7000-8000-0000000000d2',
  template_key: 'commission_event_parked',
  template_revision: 1,
  locale,
  safe_parameters: [
    { name: 'event_type', type: 'text', value: 'SessionTipsChanged' },
    { name: 'event_id', type: 'text', value: EVENT_ID },
  ],
  created_at: '2026-11-24T09:00:00Z',
  read_at: null,
});

it('renders the stopped-event bell with its type and its reference', () => {
  const item = bell('ar');
  const arabic = renderNotification(item, 'ar');
  expect(arabic).toContain('SessionTipsChanged');
  expect(arabic).toContain(EVENT_ID);
  expect(renderNotification(item, 'en')).toContain('Contact support');
  expect(renderNotification(item)).toBe(arabic);
});
