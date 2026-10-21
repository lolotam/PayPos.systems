import type { InAppNotification } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { renderNotification } from './render-notification';

const shift = (locale: 'ar' | 'en', arabic = 'ليلى', english = 'Laila'): InAppNotification => ({
  id: '01920000-0000-7000-8000-0000000000c1',
  company_id: '01920000-0000-7000-8000-0000000000a0',
  business_id: null,
  branch_id: null,
  source_event_id: '01920000-0000-7000-8000-0000000000c2',
  template_key: 'shift_not_clocked_in',
  template_revision: 1,
  locale,
  safe_parameters: [
    { name: 'employee_name_ar', type: 'text', value: arabic },
    { name: 'employee_name_en', type: 'text', value: english },
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'shift_start', type: 'text', value: '10:00' },
  ],
  created_at: '2026-10-01T12:00:00Z',
  read_at: null,
});

it('renders the cross-branch return in the viewer locale and falls back to English names', () => {
  const item = {
    ...shift('ar'), template_key: 'break_returned_other_branch',
    safe_parameters: [
      { name: 'employee_name_ar', type: 'text', value: 'سارة' },
      { name: 'employee_name_en', type: 'text', value: 'Sara' },
      { name: 'branch_name_ar', type: 'text', value: 'حولي' },
      { name: 'branch_name_en', type: 'text', value: 'Hawalli' },
    ],
  } as InAppNotification;
  expect(renderNotification(item, 'ar')).toBe('سارة رجعت من البريك في فرع حولي');
  expect(renderNotification(item, 'en')).toBe('Sara returned from the break at Hawalli');
  expect(renderNotification(item)).toBe('سارة رجعت من البريك في فرع حولي');
  const blank = { ...item, safe_parameters: item.safe_parameters.map((p) =>
    p.name.endsWith('_ar') ? { ...p, value: '   ' } : p,
  ) } as InAppNotification;
  expect(renderNotification(blank, 'ar')).toBe('Sara رجعت من البريك في فرع Hawalli');
});

function sentence(locale: 'ar' | 'en', employee: string, branch: string) {
  const employeeKey = locale === 'ar' ? 'employee_name_ar' : 'employee_name_en';
  const branchKey = locale === 'ar' ? 'branch_name_ar' : 'branch_name_en';
  return t(locale, 'inApp.shift_not_clocked_in')
    .replace('{{shift_start}}', '10:00')
    .replace(`{{${employeeKey}}}`, employee)
    .replace(`{{${branchKey}}}`, branch);
}

it('renders shift_not_clocked_in in the viewer locale when the stored locale differs', () => {
  expect(renderNotification(shift('ar'), 'en')).toBe(sentence('en', 'Laila', 'Salmiya'));
  expect(renderNotification(shift('en'), 'ar')).toBe(sentence('ar', 'ليلى', 'السالمية'));
});

it('falls back to the English name when the Arabic parameter is blank', () => {
  const blank = shift('en', '   ', 'Studio 2026');
  const branch = {
    ...blank,
    safe_parameters: blank.safe_parameters.map((parameter) =>
      parameter.name === 'branch_name_ar' ? { ...parameter, value: '   ' } : parameter,
    ),
  } as InAppNotification;
  expect(renderNotification(branch, 'ar')).toBe(sentence('ar', 'Studio 2026', 'Salmiya'));
});

it('keeps generic_notice on the stored locale', () => {
  const item: InAppNotification = {
    ...shift('ar'),
    template_key: 'generic_notice',
    safe_parameters: [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
  };
  const arabic = t('ar', 'inApp.generic_notice').replace('{{subject}}', 'Synthetic subject');
  expect(renderNotification(item, 'en')).toBe(arabic);
  expect(renderNotification(item, 'ar')).toBe(arabic);
});

it('renders placeholders within a display name literally', () => {
  expect(renderNotification(shift('ar', 'ليلى', '{{shift_start}}'), 'en')).toBe(
    sentence('en', '{{shift_start}}', 'Salmiya'),
  );
});

it.each(['ar', 'en'] as const)(
  'renders attendance requests and decisions in viewer language %s',
  (locale) => {
    const requested: InAppNotification = {
      ...shift(locale === 'ar' ? 'en' : 'ar'),
      template_key: 'attendance_change_requested',
      safe_parameters: [
        { name: 'employee_name_ar', type: 'text', value: 'ليلى' },
        { name: 'employee_name_en', type: 'text', value: 'Laila' },
        { name: 'change', type: 'text', value: 'ADD_SESSION' },
      ],
    };
    const fill = (text: string) =>
      text.replace('{{employee_name_ar}}', 'ليلى').replace('{{employee_name_en}}', 'Laila');
    expect(renderNotification(requested, locale)).toBe(
      fill(t(locale, 'inApp.attendance_change_requested')).replace(
        '{{change}}',
        t(locale, 'inApp.attendance_change_add'),
      ),
    );
    for (const decision of ['APPROVED', 'REJECTED'] as const) {
      const decided: InAppNotification = {
        ...requested,
        template_key: 'attendance_change_decided',
        safe_parameters: [
          requested.safe_parameters[0],
          requested.safe_parameters[1],
          { name: 'change', type: 'text', value: 'VOID_SESSION' },
          { name: 'decision', type: 'text', value: decision },
          { name: 'reason', type: 'text', value: '{{change}}' },
        ],
      };
      expect(renderNotification(decided, locale)).toBe(
        fill(t(locale, 'inApp.attendance_change_decided'))
          .replace('{{change}}', t(locale, 'inApp.attendance_change_void'))
          .replace(
            '{{decision}}',
            t(
              locale,
              decision === 'APPROVED'
                ? 'inApp.attendance_change_approved'
                : 'inApp.attendance_change_rejected',
            ),
          )
          .replace('{{reason}}', '{{change}}'),
      );
    }
  },
);

it.each(['ar', 'en'] as const)('renders restore requests and decisions in %s', (locale) => {
  const requested: InAppNotification = {
    ...shift(locale === 'ar' ? 'en' : 'ar'),
    template_key: 'attendance_change_requested',
    safe_parameters: [
      { name: 'employee_name_ar', type: 'text', value: 'ليلى' },
      { name: 'employee_name_en', type: 'text', value: 'Laila' },
      { name: 'change', type: 'text', value: 'RESTORE_SESSION' },
    ],
  };
  const decided: InAppNotification = {
    ...requested,
    template_key: 'attendance_change_decided',
    safe_parameters: [
      ...requested.safe_parameters,
      { name: 'decision', type: 'text', value: 'APPROVED' },
      { name: 'reason', type: 'text', value: '-' },
    ],
  };
  for (const notice of [requested, decided]) {
    expect(renderNotification(notice, locale)).toBe(
      t(locale, `inApp.${notice.template_key}`)
        .replace('{{employee_name_ar}}', 'ليلى')
        .replace('{{employee_name_en}}', 'Laila')
        .replace('{{change}}', t(locale, 'inApp.attendance_change_restore'))
        .replace('{{decision}}', t(locale, 'inApp.attendance_change_approved'))
        .replace('{{reason}}', '-'),
    );
  }
});

it('renders break_not_returned in the viewer locale with the break end', () => {
  const base = shift('ar');
  const item = {
    ...base,
    template_key: 'break_not_returned',
    safe_parameters: [
      ...base.safe_parameters.slice(0, 4),
      { name: 'break_end', type: 'text', value: '14:00' },
    ],
  } as InAppNotification;
  const text = (locale: 'ar' | 'en', employee: string, branch: string) =>
    t(locale, 'inApp.break_not_returned')
      .replace('{{break_end}}', '14:00')
      .replace(`{{${locale === 'ar' ? 'employee_name_ar' : 'employee_name_en'}}}`, employee)
      .replace(`{{${locale === 'ar' ? 'branch_name_ar' : 'branch_name_en'}}}`, branch);
  expect(renderNotification(item, 'en')).toBe(text('en', 'Laila', 'Salmiya'));
  expect(renderNotification(item, 'ar')).toBe(text('ar', 'ليلى', 'السالمية'));
  expect(renderNotification(item, 'en')).toContain('14:00');
});

it('late session copy follows viewer locale, saved date and English fallback', () => {
  const item: InAppNotification = {
    ...shift('ar'),
    template_key: 'late_service_session',
    safe_parameters: [
      { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
      { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
      { name: 'business_date', type: 'text', value: '2026-10-14' },
    ],
  };
  expect(renderNotification(item, 'ar')).toBe(
    'سُجّلت جلسة متأخرة بتاريخ 2026-10-14 في فرع السالمية.',
  );
  expect(renderNotification(item, 'en')).toBe(
    'A late service session dated 2026-10-14 was recorded at Salmiya.',
  );
  expect(
    renderNotification(
      {
        ...item,
        safe_parameters: [
          { name: 'branch_name_ar', type: 'text', value: '   ' },
          item.safe_parameters[1],
          item.safe_parameters[2],
        ],
      },
      'ar',
    ),
  ).toBe('سُجّلت جلسة متأخرة بتاريخ 2026-10-14 في فرع Salmiya.');
});

it('renders a price edit in the viewer locale, falling back to English names and the owner role label', () => {
  const parameters = [
    { name: 'service_name_ar', type: 'text', value: 'قص' },
    { name: 'service_name_en', type: 'text', value: 'Cut' },
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'business_date', type: 'text', value: '2026-10-16' },
    { name: 'previous_net', type: 'text', value: '25.000' },
    { name: 'new_net', type: 'text', value: '20.000' },
    { name: 'editor_name_ar', type: 'text', value: 'ليلى' },
    { name: 'editor_name_en', type: 'text', value: 'Laila' },
  ];
  const item = {
    ...shift('ar'),
    template_key: 'service_line_price_edited',
    safe_parameters: parameters,
  } as InAppNotification;
  expect(renderNotification(item, 'ar')).toBe(
    'عدّل ليلى خدمة قص في فرع السالمية بتاريخ 2026-10-16: كان الصافي 25.000 دينار وأصبح 20.000 دينار.',
  );
  expect(renderNotification(item, 'en')).toBe(
    'Laila edited Cut at Salmiya dated 2026-10-16: the net was 25.000 KWD and is now 20.000 KWD.',
  );
  expect(
    renderNotification(
      {
        ...item,
        safe_parameters: parameters.map((parameter) =>
          parameter.name.endsWith('_ar') ? { ...parameter, value: '   ' } : parameter,
        ),
      } as InAppNotification,
      'ar',
    ),
  ).toBe(
    'عدّل Laila خدمة Cut في فرع Salmiya بتاريخ 2026-10-16: كان الصافي 25.000 دينار وأصبح 20.000 دينار.',
  );
  const owner = parameters.map((parameter) =>
    parameter.name === 'editor_name_ar'
      ? { ...parameter, value: 'المالك' }
      : parameter.name === 'editor_name_en'
        ? { ...parameter, value: 'Owner' }
        : parameter,
  );
  expect(renderNotification({ ...item, safe_parameters: owner } as InAppNotification, 'ar')).toBe(
    'عدّل المالك خدمة قص في فرع السالمية بتاريخ 2026-10-16: كان الصافي 25.000 دينار وأصبح 20.000 دينار.',
  );
  expect(renderNotification({ ...item, safe_parameters: owner } as InAppNotification, 'en')).toBe(
    'Owner edited Cut at Salmiya dated 2026-10-16: the net was 25.000 KWD and is now 20.000 KWD.',
  );
});

it('renders a cancellation in the viewer locale and falls back to English names', () => {
  const parameters = [
    { name: 'service_name_ar', type: 'text', value: 'قص' },
    { name: 'service_name_en', type: 'text', value: 'Cut' },
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'business_date', type: 'text', value: '2026-10-16' },
    { name: 'cancelled_net', type: 'text', value: '20.000' },
  ];
  const item = {
    ...shift('ar'),
    template_key: 'service_line_cancelled',
    safe_parameters: parameters,
  } as InAppNotification;
  expect(renderNotification(item, 'ar')).toBe(
    'أُلغيت خدمة قص في فرع السالمية بتاريخ 2026-10-16: كان صافي السطر 20.000 دينار.',
  );
  expect(renderNotification(item, 'en')).toBe(
    'Cut was cancelled at Salmiya dated 2026-10-16: the line net was 20.000 KWD.',
  );
  expect(
    renderNotification(
      {
        ...item,
        safe_parameters: parameters.map((parameter) =>
          parameter.name.endsWith('_ar') ? { ...parameter, value: '   ' } : parameter,
        ),
      } as InAppNotification,
      'ar',
    ),
  ).toBe('أُلغيت خدمة Cut في فرع Salmiya بتاريخ 2026-10-16: كان صافي السطر 20.000 دينار.');
});

it('renders a performers change in the viewer locale and falls back to English names', () => {
  const parameters = [
    { name: 'service_name_ar', type: 'text', value: 'قص' },
    { name: 'service_name_en', type: 'text', value: 'Cut' },
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'business_date', type: 'text', value: '2026-10-16' },
    { name: 'line_net', type: 'text', value: '20.000' },
  ];
  const item = {
    ...shift('ar'),
    template_key: 'service_line_performers_changed',
    safe_parameters: parameters,
  } as InAppNotification;
  expect(renderNotification(item, 'ar')).toBe(
    'تغيّر منفّذو خدمة قص في فرع السالمية بتاريخ 2026-10-16: صافي السطر 20.000 دينار.',
  );
  expect(renderNotification(item, 'en')).toBe(
    'The performers of Cut at Salmiya dated 2026-10-16 were changed: the line net is 20.000 KWD.',
  );
  expect(
    renderNotification(
      {
        ...item,
        safe_parameters: parameters.map((parameter) =>
          parameter.name.endsWith('_ar') ? { ...parameter, value: '   ' } : parameter,
        ),
      } as InAppNotification,
      'ar',
    ),
  ).toBe('تغيّر منفّذو خدمة Cut في فرع Salmiya بتاريخ 2026-10-16: صافي السطر 20.000 دينار.');
});

it('renders a discount approval request in the viewer locale and falls back to English names', () => {
  const parameters = [
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'service_name_ar', type: 'text', value: 'صبغة' },
    { name: 'service_name_en', type: 'text', value: 'Colour' },
    { name: 'line_count', type: 'text', value: '3' },
    { name: 'max_percent', type: 'text', value: '20.5' },
  ];
  const item = {
    ...shift('ar'),
    template_key: 'discount_approval_requested',
    safe_parameters: parameters,
  } as InAppNotification;
  expect(renderNotification(item, 'ar')).toBe(
    'طلب موافقة على خصم في فرع السالمية: صبغة، عدد السطور 3، الخصم حتى 20.5%.',
  );
  expect(renderNotification(item, 'en')).toBe(
    'Discount approval requested at Salmiya: Colour, 3 line(s), discount up to 20.5%.',
  );
  expect(
    renderNotification(
      {
        ...item,
        safe_parameters: parameters.map((parameter) =>
          parameter.name.endsWith('_ar') ? { ...parameter, value: '   ' } : parameter,
        ),
      } as InAppNotification,
      'ar',
    ),
  ).toBe('طلب موافقة على خصم في فرع Salmiya: Colour، عدد السطور 3، الخصم حتى 20.5%.');
});

it('renders a performer approval for the owner in the viewer locale with the English fallback', () => {
  const parameters = [
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'approver_name_ar', type: 'text', value: 'هبة' },
    { name: 'approver_name_en', type: 'text', value: 'Heba' },
    { name: 'service_name_ar', type: 'text', value: 'صبغة' },
    { name: 'service_name_en', type: 'text', value: 'Colour' },
    { name: 'max_percent', type: 'text', value: '30' },
  ];
  const item = {
    ...shift('ar'),
    template_key: 'discount_approved_by_performer',
    safe_parameters: parameters,
  } as InAppNotification;
  expect(renderNotification(item, 'ar')).toBe(
    'وافق هبة على خصم حتى 30% على خدمة صبغة نفّذها بنفسه في فرع السالمية.',
  );
  expect(renderNotification(item, 'en')).toBe(
    'Heba approved a discount of up to 30% on Colour, a service they performed, at Salmiya.',
  );
  expect(
    renderNotification(
      {
        ...item,
        safe_parameters: parameters.map((parameter) =>
          parameter.name.endsWith('_ar') ? { ...parameter, value: ' ' } : parameter,
        ),
      } as InAppNotification,
      'ar',
    ),
  ).toBe('وافق Heba على خصم حتى 30% على خدمة Colour نفّذها بنفسه في فرع Salmiya.');
});
