import type { InAppNotification } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { renderNotification } from './render-notification';

const DOCUMENT = '01920000-0000-7000-8000-0000000000d1';

const exception = (employeeAr = 'سارة'): InAppNotification => ({
  id: '01920000-0000-7000-8000-0000000000c1',
  company_id: '01920000-0000-7000-8000-0000000000a0',
  business_id: null,
  branch_id: null,
  source_event_id: '01920000-0000-7000-8000-0000000000c2',
  template_key: 'attendance_exception_raised',
  template_revision: 1,
  locale: 'ar',
  safe_parameters: [
    { name: 'employee_name_ar', type: 'text', value: employeeAr },
    { name: 'employee_name_en', type: 'text', value: 'Sara' },
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'clock_in_date', type: 'text', value: '2026-10-23' },
    { name: 'clock_in_time', type: 'text', value: '09:02' },
  ],
  created_at: '2026-10-23T09:02:00Z',
  read_at: null,
});

const document = (employeeAr = 'سارة'): InAppNotification => ({
  id: '01920000-0000-7000-8000-0000000000c1',
  company_id: '01920000-0000-7000-8000-0000000000a0',
  business_id: null,
  branch_id: null,
  source_event_id: '01920000-0000-7000-8000-0000000000c2',
  template_key: 'document_expiring',
  template_revision: 1,
  locale: 'ar',
  safe_parameters: [
    { name: 'employee_name_ar', type: 'text', value: employeeAr },
    { name: 'employee_name_en', type: 'text', value: 'Sara' },
    { name: 'document_type_ar', type: 'text', value: 'إقامة' },
    { name: 'document_type_en', type: 'text', value: 'Residency' },
    { name: 'expires_on', type: 'text', value: '2026-11-04' },
    { name: 'document_id', type: 'text', value: DOCUMENT },
  ],
  created_at: '2026-10-23T09:02:00Z',
  read_at: null,
});

it('renders the attendance exception bell in the viewer locale', () => {
  expect(renderNotification(exception(), 'ar')).toBe(
    'سارة سجّلت دخول في السالمية يوم 2026-10-23 الساعة 09:02 ولم تسجّل خروج',
  );
  expect(renderNotification(exception(), 'en')).toBe(
    'Sara clocked in at Salmiya on 2026-10-23 at 09:02 and has not clocked out',
  );
});

it('falls back to the English employee name when the Arabic one is blank', () => {
  expect(renderNotification(exception('   '), 'ar')).toBe(
    'Sara سجّلت دخول في السالمية يوم 2026-10-23 الساعة 09:02 ولم تسجّل خروج',
  );
});

it('renders the document expiry bell in the viewer locale without the document id', () => {
  expect(renderNotification(document(), 'ar')).toBe('مستند إقامة الخاص بـ سارة ينتهي يوم 2026-11-04');
  expect(renderNotification(document(), 'en')).toBe("Sara's Residency expires on 2026-11-04");
  const rendered = renderNotification(document(), 'ar');
  expect(rendered).toContain('2026-11-04');
  expect(rendered).toContain('إقامة');
  expect(rendered).not.toContain(DOCUMENT);
});

it('falls back to the English employee name in the document bell too', () => {
  expect(renderNotification(document('   '), 'ar')).toBe(
    'مستند إقامة الخاص بـ Sara ينتهي يوم 2026-11-04',
  );
});
