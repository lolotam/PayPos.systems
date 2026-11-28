import { isSafeOnboardingLink } from '../onboarding-email-envelope.ts';
import { escapeHtml, formatEmailUtcTimestamp, renderEmailLayout } from './email-layout.ts';

/** مفتاح قالب بريد دعوة العضو — نفس المفتاح في حدث الطلب. */
export const MEMBER_INVITATION_KEY = 'member_invitation';
/** مراجعة القالب: نسخة واحدة معتمدة، أي تغيير بياخد مراجعة جديدة. */
export const MEMBER_INVITATION_REVISION = 1;

/** نسخة رسالة الدعوة: العنوان، والمقدمة، والدور، والمدة، والزر، والتحذير حسب المتلقي. */
interface MemberInvitationCopy {
  readonly subject: string;
  readonly inviteeIntro: string;
  readonly ownerIntro: string;
  readonly label: string;
  readonly inviteeAction: string;
  readonly ownerAction: string;
  readonly expiry: string;
  readonly inviteeShare: string;
  readonly ownerShare: string;
  readonly ownerTarget: string;
  readonly roles: Readonly<Record<string, string>>;
}

/** نسخ القالب بلغتين: الدعوة، والدور، والمدة، والزر، وتوجيه واضح للمدعو وللمالك. */
const COPY: Record<'ar' | 'en', MemberInvitationCopy> = {
  ar: {
    subject: 'دعوة الانضمام إلى PosPay',
    inviteeIntro: 'دعاك مالك الشركة تنضم لـ PosPay. اضغط الزر لإكمال بياناتك وتعيين كلمة المرور.',
    ownerIntro: 'صدر رابط دعوة لعضو جديد في PosPay لتعيين كلمة مروره وإكمال حسابه.',
    label: 'الدور',
    inviteeAction: 'إكمال بياناتك وتعيين كلمة المرور',
    ownerAction: 'رابط دعوة العضو',
    expiry: 'الرابط صالح لمدة 48 ساعة من وقت الإصدار حتى:',
    inviteeShare: 'لا تشاركي هذا الرابط مع أي شخص؛ هو مخصص لكِ فقط.',
    ownerShare:
      'مرّر هذا الرابط للمدعو فقط؛ الرابط يضبط كلمة المرور الخاصة بالمدعو ولا تستخدمه بدلاً منه.',
    ownerTarget: 'العضو المدعو:',
    roles: {
      general_manager: 'المدير العام',
      business_manager: 'مدير النشاط',
      branch_manager: 'مدير الفرع',
      accountant: 'محاسب',
      owner: 'المالك',
    },
  },
  en: {
    subject: 'You are invited to join PosPay',
    inviteeIntro:
      'The company owner invited you to join PosPay. Press the button to complete your details.',
    ownerIntro:
      'An invitation setup link was issued for a new PosPay member so they can set their password.',
    label: 'Role',
    inviteeAction: 'Complete your details',
    ownerAction: 'Member invitation link',
    expiry: 'The link is valid for 48 hours from issue until:',
    inviteeShare: 'Do not share this link with anyone; it is personal to you.',
    ownerShare:
      'Forward this link only to the invitee; it sets their password, so do not use it yourself.',
    ownerTarget: 'Invited member:',
    roles: {
      general_manager: 'General Manager',
      business_manager: 'Business Manager',
      branch_manager: 'Branch Manager',
      accountant: 'Accountant',
      owner: 'Owner',
    },
  },
};

/** النتيجة: بريد بصيغتيه أو null لما القالب أو البيانات مش مطابقة للمواصفة. */
export interface MemberInvitationEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** البيانات المقبولة بعد التحقق: الرابط والدور والمتلقي والعمر والإيميل المقنّع. */
interface MemberInvitationData {
  readonly link: string;
  readonly role: string;
  readonly recipient: 'invitee' | 'owner';
  readonly targetMaskedEmail: string | null;
  readonly expiresAt: string;
}

/**
 * يتحقق من حمولة بريد الدعوة: النوع، والرابط، والدور، والمتلقي، والعمر.
 *
 * @param data الحمولة بعد فك المظروف
 * @returns البيانات المقبولة، أو null لما أي حقل مش مطابق
 */
function readMemberInvitationData(data: unknown): MemberInvitationData | null {
  if (typeof data !== 'object' || data === null) return null;
  const payload = data as Record<string, unknown>;
  if (payload['kind'] !== 'member_invitation') return null;
  const link = payload['link'];
  if (typeof link !== 'string' || !isSafeOnboardingLink(link)) return null;
  const role = payload['role'];
  if (typeof role !== 'string' || role.length === 0 || role.length > 64) return null;
  const recipient = payload['recipient'];
  if (recipient !== 'invitee' && recipient !== 'owner') return null;
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
    link,
    role,
    recipient,
    targetMaskedEmail: targetMaskedEmail ?? null,
    expiresAt,
  };
}

/**
 * يرسم بريد دعوة العضو: الدور والمدة والزر، بنص مخصوص للمدعو ولصاحب الدعوة.
 *
 * @param revision مراجعة القالب
 * @param locale لغة الرسالة
 * @param data حمولة بريد الدعوة
 * @param adminOrigin أصل لوحة الإدارة الآمن، ومصدر صورة الهوية
 * @returns البريد بصيغتيه، أو null لما القالب أو البيانات مش مطابقة للمواصفة
 */
export function renderMemberInvitationEmail(
  revision: number,
  locale: string,
  data: unknown,
  adminOrigin: string,
): MemberInvitationEmail | null {
  if (revision !== MEMBER_INVITATION_REVISION || (locale !== 'ar' && locale !== 'en')) return null;
  const parsed = readMemberInvitationData(data);
  if (parsed === null) return null;
  return renderMemberInvitation(COPY[locale], parsed, locale, adminOrigin);
}

/**
 * يبني بريد الدعوة بالتخطيط الموحّد: الزر جوه الجسم لأن أصل رابط الدعوة مش أصل اللوحة.
 *
 * @param copy نص الرسالة بلغتها
 * @param data البيانات المقبولة
 * @param locale لغة الرسالة
 * @param adminOrigin أصل لوحة الإدارة
 * @returns البريد بصيغتيه
 */
function renderMemberInvitation(
  copy: MemberInvitationCopy,
  data: MemberInvitationData,
  locale: 'ar' | 'en',
  adminOrigin: string,
): MemberInvitationEmail {
  const noteStyle = 'margin:12px 0 0 0;font-size:13px;line-height:1.6;color:#5A6675;';
  const buttonStyle =
    "display:inline-block;background-color:#FF6421;color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1;text-decoration:none;padding:14px 24px;border-radius:10px;margin:16px 0 0 0;";
  const isOwner = data.recipient === 'owner';
  const intro = isOwner ? copy.ownerIntro : copy.inviteeIntro;
  const action = isOwner ? copy.ownerAction : copy.inviteeAction;
  const share = isOwner ? copy.ownerShare : copy.inviteeShare;
  const roleDisplay = copy.roles[data.role] ?? data.role;
  const expiresDisplay = formatEmailUtcTimestamp(data.expiresAt);
  const target =
    isOwner && data.targetMaskedEmail !== null
      ? `<p style="${noteStyle}">${escapeHtml(copy.ownerTarget)} ${escapeHtml(data.targetMaskedEmail)}</p>`
      : '';
  const button = `<a href="${escapeHtml(data.link)}" style="${buttonStyle}">${escapeHtml(action)}</a>`;
  const layout = renderEmailLayout({
    locale,
    adminOrigin,
    title: copy.subject,
    bodyHtml: `<p style="margin:0;">${escapeHtml(intro)}</p>
      <p style="${noteStyle}">${escapeHtml(copy.label)}: ${escapeHtml(roleDisplay)}</p>
      ${target}
      ${button}
      <p style="${noteStyle}">${escapeHtml(copy.expiry)} ${escapeHtml(expiresDisplay)}</p>
      <p style="${noteStyle}">${escapeHtml(share)}</p>`,
    bodyText: [
      intro,
      `${copy.label}: ${roleDisplay}`,
      ...(target === '' ? [] : [`${copy.ownerTarget} ${data.targetMaskedEmail ?? ''}`]),
      `${action}\n${data.link}`,
      `${copy.expiry} ${expiresDisplay}`,
      share,
    ].join('\n'),
  });
  return { subject: copy.subject, text: layout.text, html: layout.html };
}
