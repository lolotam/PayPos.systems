import type { InAppNotification } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { renderNotification } from './render-notification';

type RefundNotice = Extract<InAppNotification, { template_key: 'package_refund_recorded' }>;

it('renders package_refund_recorded in the viewer locale and falls back to English names', () => {
  const parameters = [
    { name: 'package_name_ar', type: 'text', value: 'باقة شعر' },
    { name: 'package_name_en', type: 'text', value: 'Hair package' },
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'sessions', type: 'text', value: '2' },
    { name: 'amount', type: 'text', value: '4.500' },
    { name: 'business_date', type: 'text', value: '2026-11-20' },
  ] as unknown as RefundNotice['safe_parameters'];
  const item: RefundNotice = {
    id: '01920000-0000-7000-8000-0000000000c1',
    company_id: '01920000-0000-7000-8000-0000000000a0',
    business_id: null,
    branch_id: null,
    source_event_id: '01920000-0000-7000-8000-0000000000c2',
    template_key: 'package_refund_recorded',
    template_revision: 1,
    locale: 'ar',
    safe_parameters: parameters,
    created_at: '2026-10-01T12:00:00Z',
    read_at: null,
  };
  expect(renderNotification(item, 'ar')).toBe(
    'استُردت 2 جلسة من باقة باقة شعر في فرع السالمية بتاريخ 2026-11-20: المبلغ 4.500 دينار.',
  );
  expect(renderNotification(item, 'en')).toBe(
    '2 session(s) refunded from Hair package at Salmiya dated 2026-11-20: amount 4.500 KWD.',
  );
  expect(
    renderNotification(
      {
        ...item,
        safe_parameters: parameters.map((p) =>
          p.name.endsWith('_ar') ? { ...p, value: ' ' } : p,
        ) as unknown as RefundNotice['safe_parameters'],
      },
      'ar',
    ),
  ).toBe(
    'استُردت 2 جلسة من باقة Hair package في فرع Salmiya بتاريخ 2026-11-20: المبلغ 4.500 دينار.',
  );
});
