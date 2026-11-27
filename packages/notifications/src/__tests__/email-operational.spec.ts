import { describe, expect, it } from 'vitest';

import {
  OPERATIONAL_EMAIL_KEYS,
  renderOperationalEmail,
  type OperationalEmailKey,
} from '../index.ts';

const PROD = 'https://app.pospay.systems';
const STAGING = 'https://app.staging.pospay.systems';

/** نص القالب المتوقّع بلغة واحدة: العنوان والجسم. */
interface ExpectedCopy {
  readonly subject: string;
  readonly body: string;
}

/**
 * النص المقروء لكل قالب: العنوان والجسم باللغتين.
 * الجدول مثبّت هنا عشان الاختبار يفحص الناتج المرسوم نفسه، مش جدول الإنتاج.
 */
const EXPECTED: Readonly<Record<OperationalEmailKey, Readonly<Record<'ar' | 'en', ExpectedCopy>>>> =
  {
    shift_not_clocked_in: {
      ar: {
        subject: 'تنبيه عدم تسجيل الحضور',
        body: 'بدأت وردية في PosPay من غير تسجيل حضور. افتح PosPay لمراجعة التفاصيل.',
      },
      en: {
        subject: 'Shift not clocked in alert',
        body: 'A shift has started in PosPay with no clock-in recorded. Open PosPay to review the details.',
      },
    },
    break_not_returned: {
      ar: { subject: 'تنبيه عدم العودة من البريك', body: 'تجاوزت مدة البريك ولم تُسجَّل العودة.' },
      en: {
        subject: 'Break not returned alert',
        body: 'A break passed its expected return with no return recorded.',
      },
    },
    break_returned_other_branch: {
      ar: {
        subject: 'تنبيه رجوع البريك في فرع آخر',
        body: 'سُجِّلت العودة من البريك في فرع مختلف عن فرع الشيفت.',
      },
      en: {
        subject: 'Break returned at another branch alert',
        body: 'A break return was recorded at a branch other than the shift branch.',
      },
    },
    attendance_exception_raised: {
      ar: { subject: 'تنبيه استثناء حضور', body: 'فُتح استثناء حضور يحتاج مراجعة.' },
      en: {
        subject: 'Attendance exception alert',
        body: 'An attendance exception was raised and needs review.',
      },
    },
    document_expiring: {
      ar: { subject: 'تنبيه انتهاء مستند', body: 'يوجد مستند موظف يقترب موعد انتهائه.' },
      en: { subject: 'Document expiry alert', body: 'An employee document is nearing expiry.' },
    },
    late_service_session: {
      ar: {
        subject: 'تنبيه تأخر جلسة خدمة',
        body: 'تم تسجيل جلسة خدمة في PosPay بعد تاريخ عملها. افتح PosPay لمراجعة التفاصيل.',
      },
      en: {
        subject: 'Late service session alert',
        body: 'A service session was recorded in PosPay after its business date. Open PosPay to review the details.',
      },
    },
    service_line_price_edited: {
      ar: { subject: 'تنبيه تعديل سعر خدمة', body: 'تم تعديل سعر بند خدمة ويحتاج مراجعة.' },
      en: {
        subject: 'Service line price edited alert',
        body: 'A service line price was edited and needs review.',
      },
    },
    service_line_cancelled: {
      ar: { subject: 'تنبيه إلغاء بند خدمة', body: 'تم إلغاء بند خدمة ويحتاج مراجعة.' },
      en: {
        subject: 'Service line cancelled alert',
        body: 'A service line was cancelled and needs review.',
      },
    },
    service_line_performers_changed: {
      ar: { subject: 'تنبيه تغيير منفّذي الخدمة', body: 'تم تغيير منفّذي بند خدمة ويحتاج مراجعة.' },
      en: {
        subject: 'Service line performers changed alert',
        body: 'The performers of a service line changed and need review.',
      },
    },
    discount_self_approved: {
      ar: {
        subject: 'تنبيه اعتماد خصم ذاتي',
        body: 'تم اعتماد خصم في PosPay من منفّذ الخدمة نفسه. افتح PosPay لمراجعة التفاصيل.',
      },
      en: {
        subject: 'Self-approved discount alert',
        body: 'A discount was approved in PosPay by the person who performed the service. Open PosPay to review the details.',
      },
    },
    attendance_change_requested: {
      ar: { subject: 'تنبيه طلب تعديل حضور', body: 'يوجد طلب تعديل حضور ينتظر قرارًا.' },
      en: {
        subject: 'Attendance change requested alert',
        body: 'An attendance change request is waiting for a decision.',
      },
    },
    attendance_change_decided: {
      ar: { subject: 'تنبيه قرار تعديل حضور', body: 'تم اتخاذ قرار بشأن طلب تعديل حضور.' },
      en: {
        subject: 'Attendance change decided alert',
        body: 'A decision was taken on an attendance change request.',
      },
    },
    statement_awaiting_review: {
      ar: { subject: 'تنبيه كشف بانتظار المراجعة', body: 'يوجد كشف عمولات بانتظار المراجعة.' },
      en: {
        subject: 'Statement awaiting review alert',
        body: 'A commission statement is waiting for review.',
      },
    },
    statement_awaiting_approval: {
      ar: { subject: 'تنبيه كشف بانتظار الاعتماد', body: 'يوجد كشف عمولات بانتظار الاعتماد.' },
      en: {
        subject: 'Statement awaiting approval alert',
        body: 'A commission statement is waiting for approval.',
      },
    },
    low_rating: {
      ar: { subject: 'تنبيه تقييم منخفض', body: 'يوجد تقييم منخفض. افتح PosPay لمراجعته.' },
      en: { subject: 'Low rating alert', body: 'There is a low rating. Open PosPay to review it.' },
    },
  };

/** يستخرج فقرة الجسم من نسخة HTML، عشان نفحصها لوحدها من غير أرقام التخطيط. */
function bodyParagraph(html: string): string {
  return html.match(/<p style="margin:0;">([^<]*)<\/p>/)?.[1] ?? '';
}

describe('renderOperationalEmail — the fifteen team-alert templates', () => {
  it('exposes exactly the fifteen operational keys', () => {
    expect(OPERATIONAL_EMAIL_KEYS).toHaveLength(15);
    expect(new Set(OPERATIONAL_EMAIL_KEYS).size).toBe(15);
    expect(OPERATIONAL_EMAIL_KEYS).not.toContain('shift_ends_soon');
  });

  it.each(OPERATIONAL_EMAIL_KEYS)('renders %s through the shared layout', (key) => {
    for (const locale of ['ar', 'en'] as const) {
      const content = renderOperationalEmail(key, 1, locale, [], PROD);
      expect(content).not.toBeNull();
      expect(content?.html).toContain(
        locale === 'ar' ? '<html lang="ar" dir="rtl">' : '<html lang="en" dir="ltr">',
      );
      expect(content?.html).toContain('<table role="presentation"');
      expect(content?.html).toContain(`<img src="${PROD}/brand/logo-mark-simple-tile.png"`);
      expect(content?.html).toContain(`${PROD}/`);
      expect(content?.text).toContain(`${PROD}/`);
      expect(content?.html).not.toContain('<style');
      expect(content?.html).not.toContain('class=');
      expect(content?.html).not.toContain('{{');
      expect(content?.text).not.toContain('{{');
    }
  });

  it.each(OPERATIONAL_EMAIL_KEYS)('carries the localized subject and body of %s', (key) => {
    const ar = renderOperationalEmail(key, 1, 'ar', [], PROD);
    const en = renderOperationalEmail(key, 1, 'en', [], PROD);
    expect(ar?.subject).toBe(EXPECTED[key].ar.subject);
    expect(en?.subject).toBe(EXPECTED[key].en.subject);
    expect(ar?.html).toContain(EXPECTED[key].ar.subject);
    expect(ar?.html).toContain(EXPECTED[key].ar.body);
    expect(ar?.text).toContain(EXPECTED[key].ar.subject);
    expect(ar?.text).toContain(EXPECTED[key].ar.body);
    expect(en?.html).toContain(EXPECTED[key].en.subject);
    expect(en?.html).toContain(EXPECTED[key].en.body);
    expect(en?.text).toContain(EXPECTED[key].en.subject);
    expect(en?.text).toContain(EXPECTED[key].en.body);
  });
});

describe('renderOperationalEmail — the preserved document-expiry copy', () => {
  it('keeps the original Arabic subject, body and action', () => {
    const content = renderOperationalEmail('document_expiring', 1, 'ar', [], PROD);
    expect(content?.subject).toBe('تنبيه انتهاء مستند');
    expect(content?.text).toContain('يوجد مستند موظف يقترب موعد انتهائه.');
    expect(content?.text).toContain('افتح لوحة الإدارة بعد تسجيل الدخول.');
  });

  it('keeps the original English subject, body and action', () => {
    const content = renderOperationalEmail('document_expiring', 1, 'en', [], PROD);
    expect(content?.subject).toBe('Document expiry alert');
    expect(content?.text).toContain('An employee document is nearing expiry.');
    expect(content?.text).toContain('Sign in to the admin dashboard to review it.');
  });
});

describe('renderOperationalEmail — the low-rating copy', () => {
  it('carries the generic copy without a comment or any identifier', () => {
    const ar = renderOperationalEmail('low_rating', 1, 'ar', [], PROD);
    const en = renderOperationalEmail('low_rating', 1, 'en', [], PROD);
    expect(ar?.subject).toBe('تنبيه تقييم منخفض');
    expect(en?.subject).toBe('Low rating alert');
    expect(ar?.text).toContain('يوجد تقييم منخفض. افتح PosPay لمراجعته.');
    expect(en?.text).toContain('There is a low rating. Open PosPay to review it.');
    expect(EXPECTED.low_rating.ar.subject).not.toMatch(/\d/);
    expect(EXPECTED.low_rating.ar.body).not.toMatch(/\d/);
    expect(EXPECTED.low_rating.en.subject).not.toMatch(/\d/);
    expect(EXPECTED.low_rating.en.body).not.toMatch(/\d/);
    for (const content of [ar, en]) {
      expect(bodyParagraph(content?.html ?? '')).not.toMatch(/\d/);
      expect(content?.text).not.toContain('تعليق');
      expect(content?.text).not.toMatch(/comment/i);
    }
  });

  it('renders the staging admin origin CTA link when configured for staging', () => {
    const ar = renderOperationalEmail('low_rating', 1, 'ar', [], STAGING);
    const en = renderOperationalEmail('low_rating', 1, 'en', [], STAGING);
    for (const content of [ar, en]) {
      expect(content?.html).toContain(`<img src="${STAGING}/brand/logo-mark-simple-tile.png"`);
      expect(content?.html).toContain(`href="${STAGING}/"`);
      expect(content?.text).toContain(`${STAGING}/`);
    }
  });
});

describe('renderOperationalEmail — the refusals', () => {
  it('refuses a key that is not an operational team alert', () => {
    expect(renderOperationalEmail('shift_ends_soon', 1, 'ar', [], PROD)).toBeNull();
    expect(renderOperationalEmail('staff_otp', 1, 'ar', [], PROD)).toBeNull();
    expect(renderOperationalEmail('', 1, 'ar', [], PROD)).toBeNull();
  });

  it('refuses a prototype property name', () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__'])
      expect(renderOperationalEmail(key, 1, 'ar', [], PROD)).toBeNull();
  });

  it('refuses another revision', () => {
    expect(renderOperationalEmail('low_rating', 0, 'ar', [], PROD)).toBeNull();
    expect(renderOperationalEmail('low_rating', 2, 'ar', [], PROD)).toBeNull();
  });

  it('refuses an unsupported locale', () => {
    for (const locale of ['fr', '', 'AR', 'ar-EG'])
      expect(renderOperationalEmail('low_rating', 1, locale, [], PROD)).toBeNull();
  });

  it('refuses any parameter', () => {
    expect(
      renderOperationalEmail(
        'low_rating',
        1,
        'ar',
        [{ name: 'body', type: 'text', value: 'x' }],
        PROD,
      ),
    ).toBeNull();
    expect(renderOperationalEmail('low_rating', 1, 'ar', [null], PROD)).toBeNull();
  });

  it('refuses an untrusted origin', () => {
    for (const origin of ['http://app.pospay.systems', 'https://evil.test', 'not-a-url'])
      expect(renderOperationalEmail('low_rating', 1, 'ar', [], origin)).toBeNull();
  });
});
