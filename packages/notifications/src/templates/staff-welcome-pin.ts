import { escapeHtml, renderEmailLayout } from './email-layout.ts';

/** مفتاح قالب بريد الترحيب بالموظفة — نفس المفتاح في حدث الطلب. */
export const STAFF_WELCOME_PIN_KEY = 'staff_welcome_pin';
/** مراجعة القالب: نسخة واحدة معتمدة، أي تغيير بياخد مراجعة جديدة. */
export const STAFF_WELCOME_PIN_REVISION = 1;

/** نسخة رسالة الترحيب: العنوان، والمقدمة، والرقم، وتغييره الإجباري، وانتهاء الصلاحية، والتحذير. */
interface StaffWelcomePinCopy {
  readonly subject: string;
  readonly intro: string;
  readonly label: string;
  readonly change: string;
  readonly expiry: string;
  readonly share: string;
  readonly managerTarget: string;
}

/** نسخ القالب بلغتين: الرقم المؤقت، تغييره إجباري، انتهاء الصلاحية، والتحذير. */
const COPY: Record<'ar' | 'en', StaffWelcomePinCopy> = {
  ar: {
    subject: 'رمز الدخول المؤقت للموظفة',
    intro: 'اتعمل حساب جديد للموظفة في PosPay. استخدموا الرمز المؤقت ده لأول دخول.',
    label: 'الرقم السري المؤقت',
    change: 'الرقم ده مؤقت، ولازم يتغيّر من أول دخول على شاشة الكاشير.',
    expiry: 'الرقم صالح لمدة 24 ساعة من وقت الإصدار، وبعدها مش هيشتغل تاني.',
    share: 'ما تشاركش الرقم مع أي حد، ولا تديه لأي حد طلبه منك على التليفون.',
    managerTarget: 'الموظفة الجديدة:',
  },
  en: {
    subject: 'Your temporary staff sign-in PIN',
    intro:
      'A new staff account was created in PosPay. Use this temporary PIN for the first sign-in.',
    label: 'Temporary PIN',
    change: 'This PIN is temporary and must be changed on the first cashier sign-in.',
    expiry:
      'The PIN is valid for 24 hours from the moment it was issued, and it stops working after that.',
    share: 'Do not share the PIN with anyone, and never give it to anyone who calls you.',
    managerTarget: 'New staff member:',
  },
};

/** النتيجة: بريد بصيغتيه أو null لما القالب أو البيانات مش مطابقة للمواصفة. */
export interface StaffWelcomePinEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** البيانات المقبولة بعد التحقق: الرقم والدور والمتلقي والعمر والإيميل المقنّع. */
interface StaffWelcomePinData {
  readonly pin: string;
  readonly role: string;
  readonly recipient: 'manager' | 'employee';
  readonly targetMaskedEmail: string | null;
  readonly expiresAt: string;
}

/**
 * يتحقق من حمولة بريد الترحيب: النوع، والرقم المكوّن من أربع أرقام، والدور، والمتلقي، والعمر.
 *
 * @param data الحمولة بعد فك المظروف
 * @returns البيانات المقبولة، أو null لما أي حقل مش مطابق
 */
function readStaffWelcomePinData(data: unknown): StaffWelcomePinData | null {
  if (typeof data !== 'object' || data === null) return null;
  const payload = data as Record<string, unknown>;
  if (payload['kind'] !== 'staff_welcome_pin') return null;
  const pin = payload['pin'];
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return null;
  const role = payload['role'];
  if (typeof role !== 'string' || role.length === 0 || role.length > 64) return null;
  const recipient = payload['recipient'];
  if (recipient !== 'manager' && recipient !== 'employee') return null;
  const targetMaskedEmail = payload['targetMaskedEmail'];
  if (
    targetMaskedEmail !== undefined &&
    targetMaskedEmail !== null &&
    typeof targetMaskedEmail !== 'string'
  )
    return null;
  const expiresAt = payload['expiresAt'];
  if (typeof expiresAt !== 'string' || expiresAt.length === 0 || expiresAt.length > 64) return null;
  return {
    pin,
    role,
    recipient,
    targetMaskedEmail: targetMaskedEmail ?? null,
    expiresAt,
  };
}

/**
 * يرسم بريد الترحيب بالموظفة: الرقم ظاهر وكبير، وتغييره إجباري، والتحذير تحته.
 *
 * @param revision مراجعة القالب
 * @param locale لغة الرسالة
 * @param data حمولة بريد الترحيب
 * @param adminOrigin أصل لوحة الإدارة الآمن، ومصدر صورة الهوية
 * @returns البريد بصيغتيه، أو null لما القالب أو البيانات مش مطابقة للمواصفة
 */
export function renderStaffWelcomePinEmail(
  revision: number,
  locale: string,
  data: unknown,
  adminOrigin: string,
): StaffWelcomePinEmail | null {
  if (revision !== STAFF_WELCOME_PIN_REVISION || (locale !== 'ar' && locale !== 'en')) return null;
  const parsed = readStaffWelcomePinData(data);
  if (parsed === null) return null;
  return renderStaffWelcomePin(COPY[locale], parsed, locale, adminOrigin);
}

/**
 * يبني بريد الترحيب بالتخطيط الموحّد: الرقم وتغييره الإجباري وانتهاء الصلاحية والتحذير.
 *
 * @param copy نص الرسالة بلغتها
 * @param data البيانات المقبولة
 * @param locale لغة الرسالة
 * @param adminOrigin أصل لوحة الإدارة
 * @returns البريد بصيغتيه
 */
function renderStaffWelcomePin(
  copy: StaffWelcomePinCopy,
  data: StaffWelcomePinData,
  locale: 'ar' | 'en',
  adminOrigin: string,
): StaffWelcomePinEmail {
  const pinStyle =
    'margin:16px 0 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#FF6421;';
  const noteStyle = 'margin:12px 0 0 0;font-size:13px;line-height:1.6;color:#5A6675;';
  const target =
    data.recipient === 'manager' && data.targetMaskedEmail !== null
      ? `<p style="${noteStyle}">${escapeHtml(copy.managerTarget)} ${escapeHtml(data.targetMaskedEmail)}</p>`
      : '';
  const roleLine = `<p style="${noteStyle}">${escapeHtml(data.role)}</p>`;
  const expiryLine = `<p style="${noteStyle}">${escapeHtml(copy.expiry)} ${escapeHtml(data.expiresAt)}</p>`;
  const layout = renderEmailLayout({
    locale,
    adminOrigin,
    title: copy.subject,
    bodyHtml: `<p style="margin:0;">${escapeHtml(copy.intro)}</p>
      <p style="margin:8px 0 0 0;font-size:13px;color:#5A6675;">${escapeHtml(copy.label)}</p>
      <p style="${pinStyle}">${escapeHtml(data.pin)}</p>
      ${roleLine}
      ${target}
      <p style="${noteStyle}">${escapeHtml(copy.change)}</p>
      ${expiryLine}
      <p style="${noteStyle}">${escapeHtml(copy.share)}</p>`,
    bodyText: [
      copy.intro,
      `${copy.label}: ${data.pin}`,
      data.role,
      ...(target === '' ? [] : [`${copy.managerTarget} ${data.targetMaskedEmail ?? ''}`]),
      copy.change,
      `${copy.expiry} ${data.expiresAt}`,
      copy.share,
    ].join('\n'),
  });
  return { subject: copy.subject, text: layout.text, html: layout.html };
}
