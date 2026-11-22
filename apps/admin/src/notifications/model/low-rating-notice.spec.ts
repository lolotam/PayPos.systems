import type { InAppNotification } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { renderNotification } from './render-notification';

type Details = {
  stars: 1 | 2;
  branch_name_ar: string | null;
  branch_name_en: string | null;
  business_date: string;
  performers: { name_ar: string | null; name_en: string | null }[];
  customer_name: string | null;
  phone_last3: string;
};

const details: Details = {
  stars: 2,
  branch_name_ar: 'السالمية',
  branch_name_en: 'Salmiya',
  business_date: '2026-11-20',
  performers: [
    { name_ar: 'سارة', name_en: 'Sara' },
    { name_ar: 'هند', name_en: 'Hind' },
  ],
  customer_name: 'نورة',
  phone_last3: '766',
};

const base = {
  id: '01920000-0000-7000-8000-0000000000c1',
  company_id: '01920000-0000-7000-8000-0000000000a0',
  business_id: null,
  branch_id: null,
  source_event_id: '01920000-0000-7000-8000-0000000000c2',
  template_revision: 1,
  created_at: '2026-11-20T12:00:00Z',
  read_at: null,
} as const;

export const lowRating = (over: Partial<Details> = {}): InAppNotification => ({
  ...base,
  template_key: 'low_rating',
  locale: 'ar',
  safe_parameters: [{ name: 'details', type: 'details', value: { ...details, ...over } }],
});

// عزل الاتجاه مش جزء من اللي بيشوفه المستخدم، فبنشيله قبل المقارنة.
const visible = (text: string) => text.replace(/[\u2066-\u2069]/g, '');

it('shows stars, branch, date, every performer and the masked phone, with no comment text', () => {
  const text = visible(renderNotification(lowRating(), 'ar'));
  expect(text).toBe(
    'تقييم منخفض: نجمتان في السالمية بتاريخ 2026-11-20. المنفّذون: سارة، هند. العميل: نورة، الهاتف المنتهي بـ 766.',
  );
  expect(visible(renderNotification(lowRating(), 'en'))).toBe(
    'Low rating: 2 stars at Salmiya on 2026-11-20. Performed by Sara, Hind. Customer: نورة, phone ending 766.',
  );
});

it('shows the generic customer label when the customer name is null', () => {
  expect(visible(renderNotification(lowRating({ customer_name: null }), 'ar'))).toContain(
    'العميل: عميل،',
  );
  expect(visible(renderNotification(lowRating({ customer_name: null }), 'en'))).toContain(
    'Customer: A customer,',
  );
});

it('falls back from Arabic to English per name and to the generic label when both are missing', () => {
  const item = lowRating({
    branch_name_ar: null,
    performers: [
      { name_ar: null, name_en: 'Sara' },
      { name_ar: null, name_en: null },
    ],
  });
  expect(visible(renderNotification(item, 'ar'))).toContain('في Salmiya');
  expect(visible(renderNotification(item, 'ar'))).toContain('المنفّذون: Sara، موظف.');
});
