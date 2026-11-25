import type { InAppNotification } from '@pospay/contracts';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { expect, it } from 'vitest';
import { NotificationItem } from '../ui/notification-item';
import { renderNotification } from './render-notification';

const bell = (locale: 'ar' | 'en'): InAppNotification => ({
  id: '01920000-0000-7000-8000-0000000000d1',
  company_id: '01920000-0000-7000-8000-0000000000a0',
  business_id: null,
  branch_id: null,
  source_event_id: '01920000-0000-7000-8000-0000000000d2',
  template_key: 'statement_awaiting_review',
  template_revision: 1,
  locale,
  safe_parameters: [{ name: 'period', type: 'text', value: '2026-10' }],
  created_at: '2026-11-01T12:00:00Z',
  read_at: null,
});

it('FR-055 renders the awaiting-review bell in the viewer locale with the month', () => {
  const item = bell('ar');
  const arabic = renderNotification(item, 'ar');
  expect(arabic).toBe('كشف العمولة عن شهر 2026-10 جاهز ومستني المراجعة.');
  expect(arabic).toContain('2026-10');
  expect(renderNotification(item, 'en')).toBe(
    'The commission statement for 2026-10 is ready and waiting for review.',
  );
  expect(renderNotification(item)).toBe(arabic);
  render(
    createElement(NotificationItem, {
      item,
      locale: 'ar',
      documentNumbers: new Map(),
      pending: false,
      onRead: () => {},
    }),
  );
  expect(screen.getByRole('paragraph').textContent).toBe(arabic);
});
