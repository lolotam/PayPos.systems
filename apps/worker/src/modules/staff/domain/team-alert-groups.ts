import {
  buildTeamAlertRecipients,
  chunkTeamAlertRecipients,
  type AlertChannel,
  type TeamAlertContact,
} from '@pospay/domain';

/** قنوات التنبيه وجهات الاتصال اللي بتتحدد وقت القرار، وتسافر مع الإشعار لحد كتابة الأوتبوكس. */
export interface TeamAlertAudience {
  readonly channels: readonly AlertChannel[];
  readonly contacts: ReadonlyMap<string, TeamAlertContact>;
}

/** الافتراضي لمن لا يحمل جمهورًا: الجرس داخل التطبيق وحده كما كان قبل صف 62b-1. */
const IN_APP_ONLY: TeamAlertAudience = { channels: ['IN_APP'], contacts: new Map() };

/**
 * المستخدمون بلا تكرار ومرتبون، بنفس ترتيب كل تشغيل؛ هو عدد المستلمين في الدفتر (مستخدم واحد مهما كثرت قنواته).
 *
 * @param userIds معرفات المستخدمين بأي ترتيب
 * @returns معرفات فريدة مرتبة
 */
export function distinctRecipients(userIds: readonly string[]): readonly string[] {
  return [...new Set(userIds)].sort();
}

/**
 * مجموعات مستلمي تنبيه فريق جاهزة للأوتبوكس (مئة مستلم على الأكثر): لكل مستخدم جرسه ثم إيميله ثم واتسابه
 * حسب القنوات وجهات الاتصال في الجمهور. من غير جمهور تتصرف زي الجرس وحده.
 *
 * @param userIds المستخدمين المؤهلين بأي ترتيب
 * @param audience القنوات وجهات الاتصال؛ غيابها معناه الجرس وحده
 * @param templateKey مفتاح قالب النوع التشغيلي للبريد والواتساب
 * @param inApp بيبني مستلم الجرس لمستخدم
 * @returns مجموعات غير فاضية؛ فارغة لما مفيش مستلم
 */
export function teamAlertGroups<InApp>(
  userIds: readonly string[],
  audience: TeamAlertAudience | undefined,
  templateKey: string,
  inApp: (userId: string) => InApp,
) {
  const { channels, contacts } = audience ?? IN_APP_ONLY;
  return chunkTeamAlertRecipients(
    buildTeamAlertRecipients({
      channels,
      userIds: distinctRecipients(userIds),
      contacts,
      templateKey,
      inApp,
    }),
  );
}
