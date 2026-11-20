import type { InAppNotification } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { renderNotification } from './render-notification';

const bell = (locale: 'ar' | 'en'): InAppNotification => ({
  id: '01920000-0000-7000-8000-0000000000c1',
  company_id: '01920000-0000-7000-8000-0000000000a0',
  business_id: null,
  branch_id: null,
  source_event_id: '01920000-0000-7000-8000-0000000000c2',
  template_key: 'commission_correction_blocked',
  template_revision: 1,
  locale,
  safe_parameters: [{ name: 'period', type: 'text', value: '2026-09' }],
  created_at: '2026-11-01T12:00:00Z',
  read_at: null,
});

it('N8 renders the blocked-correction bell in the viewer locale with the month', () => {
  const item = bell('ar');
  const arabic = renderNotification(item, 'ar');
  expect(arabic).toBe(
    'فيه تصحيح عمولة موقوف عن شهر 2026-09: موظفة ناقصها خطة عمولة أو مرتب. افتح التصحيحات الموقوفة عشان يتصلّح.',
  );
  expect(arabic).toContain('2026-09');
  expect(renderNotification(item, 'en')).toBe(
    'A commission correction for 2026-09 is on hold: an employee has no commission plan or no salary for that month. Open the blocked corrections to fix it.',
  );
  expect(renderNotification(item)).toBe(arabic);
});
