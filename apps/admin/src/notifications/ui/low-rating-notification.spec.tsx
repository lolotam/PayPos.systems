import { readInAppNotificationPage, type InAppNotification } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { NotificationPanel } from './notification-panel';

// الأسماء إنجليزي بس وname_ar = null: ملف tsx ممنوع فيه نص عربي، والرجوع للإنجليزي بيتغطى في اختبار الـ model.
const detailsOf = {
  stars: 2,
  branch_name_ar: null,
  branch_name_en: 'Salmiya',
  business_date: '2026-11-20',
  performers: [
    { name_ar: null, name_en: 'Sara' },
    { name_ar: null, name_en: 'Hind' },
  ],
  customer_name: 'Noura',
  phone_last3: '766',
};
const COMMENT_LABEL = t('en', 'inApp.low_rating_comment_label');
const row = (id: string, revision: number) => ({
  id: `01920000-0000-7000-8000-0000000000${id}`,
  company_id: '01920000-0000-7000-8000-0000000000a0',
  business_id: null,
  branch_id: null,
  source_event_id: '01920000-0000-7000-8000-0000000000c2',
  template_key: 'low_rating',
  template_revision: revision,
  locale: 'en',
  safe_parameters: [{ name: 'details', type: 'details', value: detailsOf }],
  created_at: '2026-11-20T12:00:00Z',
  read_at: null,
});

function show(items: readonly InAppNotification[]) {
  render(
    <NotificationPanel
      id="panel"
      locale="en"
      items={items}
      documentNumbers={new Map()}
      loading={false}
      error={false}
      pending={false}
      unread={items.length}
      onRead={() => undefined}
      onReadAll={() => undefined}
    />,
  );
}
const page = (...items: unknown[]) => readInAppNotificationPage({ items, next_cursor: null });

it('shows the notice with both performers and the masked phone but no comment block', () => {
  show(page(row('c1', 1)).items);
  const text = screen.getByText(/Low rating/).textContent ?? '';
  for (const expected of ['2 stars', 'Salmiya', 'Sara', 'Hind', 'Noura', '766'])
    expect(text).toContain(expected);
  expect(screen.queryByText(COMMENT_LABEL)).toBeNull();
});

it('shows the comment as plain text, not a link or markup, for the with-comment key', () => {
  // التعليق هنا بيتخطى قارئ العقد عمدًا: العرض لازم يفضل نص حتى لو وصل ترميز.
  const comment = 'Slow <a href="https://x.test">link</a> <b>bold</b>\nsecond line';
  const item: InAppNotification = {
    id: '01920000-0000-7000-8000-0000000000c2',
    company_id: '01920000-0000-7000-8000-0000000000a0',
    business_id: null,
    branch_id: null,
    source_event_id: '01920000-0000-7000-8000-0000000000c2',
    template_key: 'low_rating_with_comment',
    template_revision: 1,
    locale: 'en',
    safe_parameters: [
      { name: 'details', type: 'details', value: { ...detailsOf, stars: 2, comment } },
    ],
    created_at: '2026-11-20T12:00:00Z',
    read_at: null,
  };
  show([item]);
  expect(screen.getByText(COMMENT_LABEL)).not.toBeNull();
  const block = screen.getByText(/Slow/);
  expect(block.textContent).toBe(comment);
  expect(block.querySelector('a, b')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});

it('skips a row with an unknown newer revision and still renders the rest of the list', () => {
  const items = page(row('c3', 2), row('c4', 1)).items;
  expect(items).toHaveLength(1);
  show(items);
  expect(screen.getAllByText(/Low rating/)).toHaveLength(1);
});
