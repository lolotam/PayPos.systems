import { renderEmailLayout } from './email-layout.ts';
import { PASSWORD_RESET_OTP_KEY, renderPasswordResetEmail } from './password-reset-otp.ts';

export interface EmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * مفاتيح بريد تنبيهات الفريق: خمسة عشر نوع تنبيه ليها قناة بريد.
 * `shift_ends_soon` مش منها، لأنه إشعار للموظفة على الموبايل فقط (صف 28c)،
 * وما ليهاش قناة بريد ولا واتساب.
 */
export const OPERATIONAL_EMAIL_KEYS = [
  'shift_not_clocked_in',
  'break_not_returned',
  'break_returned_other_branch',
  'attendance_exception_raised',
  'document_expiring',
  'late_service_session',
  'service_line_price_edited',
  'service_line_cancelled',
  'service_line_performers_changed',
  'discount_self_approved',
  'attendance_change_requested',
  'attendance_change_decided',
  'statement_awaiting_review',
  'statement_awaiting_approval',
  'low_rating',
] as const;

/** نوع مفتاح بريد تنبيه الفريق: واحد من مفاتيح {@link OPERATIONAL_EMAIL_KEYS}. */
export type OperationalEmailKey = (typeof OPERATIONAL_EMAIL_KEYS)[number];

/** أصول لوحة الإدارة المسموح إرسال روابط عليها؛ أي أصل تاني يُرفض قبل الإرسال. */
const ADMIN_ORIGINS: readonly string[] = [
  'https://app.pospay.systems',
  'https://app.staging.pospay.systems',
];

/** نص زر الإجراء الافتراضي لكل قوالب تنبيهات الفريق. */
const ACTION = {
  ar: 'افتح لوحة الإدارة.',
  en: 'Open the admin dashboard.',
} as const;

/** نص القالب بلغة واحدة: العنوان والجسم ونص الزر. */
interface OperationalEmailCopy {
  readonly subject: string;
  readonly body: string;
  readonly action: string;
}

// TODO(spec): اعتماد النسخ ar/en من المالك قبل التفعيل؛ كلها نصوص عامة بلا اسم موظف أو زبون ولا تعليق.
const COPY = {
  shift_not_clocked_in: {
    ar: {
      subject: 'تنبيه عدم تسجيل الحضور',
      body: 'بدأت وردية في PosPay من غير تسجيل حضور. افتح PosPay لمراجعة التفاصيل.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Shift not clocked in alert',
      body: 'A shift has started in PosPay with no clock-in recorded. Open PosPay to review the details.',
      action: ACTION.en,
    },
  },
  break_not_returned: {
    ar: {
      subject: 'تنبيه عدم العودة من البريك',
      body: 'تجاوزت مدة البريك ولم تُسجَّل العودة.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Break not returned alert',
      body: 'A break passed its expected return with no return recorded.',
      action: ACTION.en,
    },
  },
  break_returned_other_branch: {
    ar: {
      subject: 'تنبيه رجوع البريك في فرع آخر',
      body: 'سُجِّلت العودة من البريك في فرع مختلف عن فرع الشيفت.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Break returned at another branch alert',
      body: 'A break return was recorded at a branch other than the shift branch.',
      action: ACTION.en,
    },
  },
  attendance_exception_raised: {
    ar: {
      subject: 'تنبيه استثناء حضور',
      body: 'فُتح استثناء حضور يحتاج مراجعة.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Attendance exception alert',
      body: 'An attendance exception was raised and needs review.',
      action: ACTION.en,
    },
  },
  document_expiring: {
    ar: {
      subject: 'تنبيه انتهاء مستند',
      body: 'يوجد مستند موظف يقترب موعد انتهائه.',
      // نص الزر الأصلي محفوظ زي ما هو: رسالة قائمة ما بتتغيّرش بمجرد إضافة قالب جديد.
      action: 'افتح لوحة الإدارة بعد تسجيل الدخول.',
    },
    en: {
      subject: 'Document expiry alert',
      body: 'An employee document is nearing expiry.',
      action: 'Sign in to the admin dashboard to review it.',
    },
  },
  late_service_session: {
    ar: {
      subject: 'تنبيه تأخر جلسة خدمة',
      body: 'تم تسجيل جلسة خدمة في PosPay بعد تاريخ عملها. افتح PosPay لمراجعة التفاصيل.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Late service session alert',
      body: 'A service session was recorded in PosPay after its business date. Open PosPay to review the details.',
      action: ACTION.en,
    },
  },
  service_line_price_edited: {
    ar: {
      subject: 'تنبيه تعديل سعر خدمة',
      body: 'تم تعديل سعر بند خدمة ويحتاج مراجعة.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Service line price edited alert',
      body: 'A service line price was edited and needs review.',
      action: ACTION.en,
    },
  },
  service_line_cancelled: {
    ar: {
      subject: 'تنبيه إلغاء بند خدمة',
      body: 'تم إلغاء بند خدمة ويحتاج مراجعة.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Service line cancelled alert',
      body: 'A service line was cancelled and needs review.',
      action: ACTION.en,
    },
  },
  service_line_performers_changed: {
    ar: {
      subject: 'تنبيه تغيير منفّذي الخدمة',
      body: 'تم تغيير منفّذي بند خدمة ويحتاج مراجعة.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Service line performers changed alert',
      body: 'The performers of a service line changed and need review.',
      action: ACTION.en,
    },
  },
  discount_self_approved: {
    ar: {
      subject: 'تنبيه اعتماد خصم ذاتي',
      body: 'تم اعتماد خصم في PosPay من منفّذ الخدمة نفسه. افتح PosPay لمراجعة التفاصيل.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Self-approved discount alert',
      body: 'A discount was approved in PosPay by the person who performed the service. Open PosPay to review the details.',
      action: ACTION.en,
    },
  },
  attendance_change_requested: {
    ar: {
      subject: 'تنبيه طلب تعديل حضور',
      body: 'يوجد طلب تعديل حضور ينتظر قرارًا.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Attendance change requested alert',
      body: 'An attendance change request is waiting for a decision.',
      action: ACTION.en,
    },
  },
  attendance_change_decided: {
    ar: {
      subject: 'تنبيه قرار تعديل حضور',
      body: 'تم اتخاذ قرار بشأن طلب تعديل حضور.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Attendance change decided alert',
      body: 'A decision was taken on an attendance change request.',
      action: ACTION.en,
    },
  },
  statement_awaiting_review: {
    ar: {
      subject: 'تنبيه كشف بانتظار المراجعة',
      body: 'يوجد كشف عمولات بانتظار المراجعة.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Statement awaiting review alert',
      body: 'A commission statement is waiting for review.',
      action: ACTION.en,
    },
  },
  statement_awaiting_approval: {
    ar: {
      subject: 'تنبيه كشف بانتظار الاعتماد',
      body: 'يوجد كشف عمولات بانتظار الاعتماد.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Statement awaiting approval alert',
      body: 'A commission statement is waiting for approval.',
      action: ACTION.en,
    },
  },
  low_rating: {
    ar: {
      subject: 'تنبيه تقييم منخفض',
      body: 'يوجد تقييم منخفض. افتح PosPay لمراجعته.',
      action: ACTION.ar,
    },
    en: {
      subject: 'Low rating alert',
      body: 'There is a low rating. Open PosPay to review it.',
      action: ACTION.en,
    },
  },
} as const satisfies Readonly<
  Record<OperationalEmailKey, Readonly<Record<'ar' | 'en', OperationalEmailCopy>>>
>;

/**
 * يفحص إن كان المفتاح من مفاتيح بريد تنبيهات الفريق.
 * الفحص بـ `Object.hasOwn` عشان مفاتيح النماذج الأولية زي `constructor` ما تتفتحش.
 *
 * @param key المفتاح المرشّح
 * @returns true لما المفتاح واحد من مفاتيح بريد تنبيهات الفريق
 */
function isOperationalEmailKey(key: string): key is OperationalEmailKey {
  return Object.hasOwn(COPY, key);
}

/**
 * يرسم بريد تنبيه فريق تشغيلي بالتخطيط الموحّد: نفس الجدول وال header والتذييل لكل رسالة.
 * الأصل بيتفحص قبل أي بناء، فلو مش من الأصول المسموحة ما بتبعتش رسالة أصلاً.
 * النصوص كلها جداول ثابتة مغلقة: ولا اسم موظف ولا اسم زبون ولا تعليق ولا مبلغ ولا `{{...}}`.
 *
 * @param key مفتاح القالب
 * @param revision مراجعة القالب
 * @param locale لغة الرسالة
 * @param parameters معاملات القالب الآمنة
 * @param adminOrigin أصل لوحة الإدارة
 * @returns البريد بصيغتيه، أو null لما القالب أو الأصل مش مطابق للمواصفة
 */
export function renderOperationalEmail(
  key: string,
  revision: number,
  locale: string,
  parameters: readonly unknown[],
  adminOrigin: string,
): EmailContent | null {
  if (key === PASSWORD_RESET_OTP_KEY) {
    const reset = renderPasswordResetEmail(revision, locale, parameters[0], adminOrigin);
    return reset === null ? null : { subject: reset.subject, text: reset.text, html: reset.html };
  }
  if (revision !== 1 || parameters.length !== 0) return null;
  if (locale !== 'ar' && locale !== 'en') return null;
  if (!isOperationalEmailKey(key)) return null;
  if (!ADMIN_ORIGINS.includes(adminOrigin)) return null;
  const copy = COPY[key][locale];
  const link = `${adminOrigin}/`;
  const layout = renderEmailLayout({
    locale,
    adminOrigin,
    title: copy.subject,
    bodyHtml: `<p style="margin:0;">${copy.body}</p>`,
    bodyText: copy.body,
    action: { label: copy.action, url: link },
  });
  return { subject: copy.subject, text: layout.text, html: layout.html };
}
