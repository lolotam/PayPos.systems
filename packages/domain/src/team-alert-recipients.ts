import type { AlertChannel, AlertRecipientRole, AlertRuleSettings } from './alert-rules.js';

/** أقصى عدد مستلمين في حدث إشعار واحد (نفس سقف عقد notification_recipients). */
export const TEAM_ALERT_EVENT_RECIPIENT_LIMIT = 100;

/** جهة اتصال عضو الفريق اللي رجّعتها دالة القراءة المحدودة؛ null = مفيش وجهة صالحة للقناة دي. */
export interface TeamAlertContact {
  readonly email: string | null;
  readonly phoneNumber: string | null;
}

/** مستلم بريد تشغيلي لتنبيه فريق: بدون أي معامل، بالعربي، مراجعة 1. */
export interface TeamAlertEmailRecipient {
  readonly channel: 'email';
  readonly email: string;
  readonly locale: 'ar';
  readonly template_key: string;
  readonly template_revision: 1;
  readonly safe_parameters: readonly [];
}

/** مستلم واتساب تشغيلي لتنبيه فريق: بنفس شكل البريد لكن بالهاتف. */
export interface TeamAlertWhatsappRecipient {
  readonly channel: 'whatsapp';
  readonly phone: string;
  readonly locale: 'ar';
  readonly template_key: string;
  readonly template_revision: 1;
  readonly safe_parameters: readonly [];
}

/** القرار اللي بيشغّل مُرسِل التنبيه: أدوار المستلمين والقنوات المفعّلة بعد المفتاح العام. */
export interface TeamAlertDelivery {
  readonly roles: readonly AlertRecipientRole[];
  readonly channels: readonly AlertChannel[];
}

/**
 * بيقرر توصيل التنبيه من القاعدة الفعلية: القاعدة المقفولة أو اللي ماعندهاش أي قناة ما بتوصّلش حد (أدوار وقنوات فاضية).
 * القاعدة اللي قناتها الإيميل بس بتفضل فعّالة، فالمُرسِل ما يعتمدش على وجود IN_APP عشان يحل المستلمين.
 *
 * @param rule القاعدة الفعلية بعد المفتاح العام
 * @returns أدوار المستلمين والقنوات المفعّلة
 */
export function teamAlertDelivery(
  rule: Pick<AlertRuleSettings, 'enabled' | 'recipientRoles' | 'channels'>,
): TeamAlertDelivery {
  if (!rule.enabled || rule.channels.length === 0) return { roles: [], channels: [] };
  return { roles: rule.recipientRoles, channels: rule.channels };
}

/**
 * بيحدد هل القناتين الخارجيتين (الإيميل والواتساب) مطلوبتين، عشان المُرسِل يقرا جهات الاتصال بس لما يحتاجها
 * وتفضل قواعد الجرس فقط من غير أي قراءة إضافية.
 *
 * @param channels القنوات المفعّلة في القاعدة
 * @returns true لو EMAIL أو WHATSAPP موجودة
 */
export function needsTeamAlertContacts(channels: readonly AlertChannel[]): boolean {
  return channels.includes('EMAIL') || channels.includes('WHATSAPP');
}

/**
 * بيبني قائمة المستلمين المسطّحة لتنبيه فريق عبر القنوات المفعّلة: لكل مستخدم بالترتيب جرسه ثم إيميله ثم واتسابه.
 * الإيميل والواتساب بيتبنوا لمن عنده وجهة صالحة بس، من قالب النوع التشغيلي نفسه بلا معاملات (ADR-0018 §11).
 * مفيش اسم ولا تعليق ولا مبلغ بيتحط في مستلم خارجي.
 *
 * @param input المدخلات
 * @param input.channels القنوات المفعّلة في القاعدة
 * @param input.userIds المستخدمين المؤهلين بالترتيب (بلا تكرار)
 * @param input.contacts جهات الاتصال لكل مستخدم؛ غياب المستخدم معناه مفيش وجهة
 * @param input.templateKey مفتاح قالب النوع التشغيلي للبريد والواتساب
 * @param input.inApp بيبني مستلم الجرس لمستخدم
 * @returns المستلمين مسطّحين، فاضية لو مفيش حد
 */
export function buildTeamAlertRecipients<InApp>(input: {
  readonly channels: readonly AlertChannel[];
  readonly userIds: readonly string[];
  readonly contacts: ReadonlyMap<string, TeamAlertContact>;
  readonly templateKey: string;
  readonly inApp: (userId: string) => InApp;
}): (InApp | TeamAlertEmailRecipient | TeamAlertWhatsappRecipient)[] {
  const recipients: (InApp | TeamAlertEmailRecipient | TeamAlertWhatsappRecipient)[] = [];
  const operational = {
    locale: 'ar',
    template_key: input.templateKey,
    template_revision: 1,
    safe_parameters: [],
  } as const;
  for (const userId of input.userIds) {
    if (input.channels.includes('IN_APP')) recipients.push(input.inApp(userId));
    const contact = input.contacts.get(userId);
    if (contact === undefined) continue;
    if (input.channels.includes('EMAIL') && contact.email !== null)
      recipients.push({ channel: 'email', email: contact.email, ...operational });
    if (input.channels.includes('WHATSAPP') && contact.phoneNumber !== null)
      recipients.push({ channel: 'whatsapp', phone: contact.phoneNumber, ...operational });
  }
  return recipients;
}

/**
 * بيبني مستلمي الإيميل والواتساب بس (من غير الجرس) لمُرسِل بيعامل الجرس لوحده، زي تنبيه التقييم المنخفض
 * اللي جرسه فيه تعليق وقالبين وخارجه قالب واحد بلا تعليق (RT-Q9).
 *
 * @param input المدخلات
 * @param input.channels القنوات المفعّلة؛ الجرس بيتجاهل هنا
 * @param input.userIds المستخدمين المؤهلين بالترتيب (بلا تكرار)
 * @param input.contacts جهات الاتصال لكل مستخدم
 * @param input.templateKey مفتاح قالب النوع التشغيلي
 * @returns المستلمين الخارجيين مسطّحين
 */
export function buildExternalTeamAlertRecipients(input: {
  readonly channels: readonly AlertChannel[];
  readonly userIds: readonly string[];
  readonly contacts: ReadonlyMap<string, TeamAlertContact>;
  readonly templateKey: string;
}): (TeamAlertEmailRecipient | TeamAlertWhatsappRecipient)[] {
  return buildTeamAlertRecipients<never>({
    ...input,
    channels: input.channels.filter((channel) => channel !== 'IN_APP'),
    inApp: () => {
      throw new Error('TEAM_ALERT_IN_APP_NOT_EXPECTED');
    },
  }) as (TeamAlertEmailRecipient | TeamAlertWhatsappRecipient)[];
}

/**
 * بيقسّم قائمة المستلمين لمجموعات لا تتعدى سقف الحدث الواحد، لأن مستخدم واحد ممكن يطلع منه ثلاث مستلمين
 * فتقسيم المستخدمين بالمئة لوحده كان هيعدّي السقف.
 *
 * @param recipients المستلمين مسطّحين
 * @param size أقصى حجم للمجموعة (افتراضي 100)
 * @returns مجموعات غير فاضية بنفس الترتيب
 */
export function chunkTeamAlertRecipients<T>(
  recipients: readonly T[],
  size: number = TEAM_ALERT_EVENT_RECIPIENT_LIMIT,
): T[][] {
  const groups: T[][] = [];
  for (let start = 0; start < recipients.length; start += size)
    groups.push(recipients.slice(start, start + size));
  return groups;
}

/** منفذ قراءة جهات الاتصال على معاملة المُرسِل (دالة AL-Q6 المحدودة)؛ المنفّذ بيربطه الجذر بقارئ identity. */
export interface TeamAlertContactsPort {
  /**
   * بيرجّع جهة اتصال لكل مستخدم عنده وجهة صالحة وعضوية سارية في اللحظة دي.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @param userIds المستخدمين المطلوبين
   * @param at لحظة نافذة العضوية
   * @returns جهات الاتصال بمفتاح المستخدم
   */
  read(
    companyId: string,
    userIds: readonly string[],
    at: Date,
  ): Promise<ReadonlyMap<string, TeamAlertContact>>;
}

/**
 * بيحوّل المستخدمين المؤهلين لمجموعات مستلمين جاهزة لأحداث الإشعار (مئة مستلم على الأكثر في الحدث):
 * دالة نطاق متزامنة ونقية بتتحقق إن جهات الاتصال اتمرّرت لما قناة خارجية مفعّلة وفي مستلمين، وبعدين تبني
 * المستلمين المسطّحين وتقسّمهم. غياب جهات الاتصال مع قناة خارجية خطأ تركيب ظاهر، مش إيميل بيضيع في صمت.
 *
 * @param input المدخلات
 * @param input.channels القنوات المفعّلة في القاعدة
 * @param input.userIds المستخدمين المؤهلين بالترتيب (بلا تكرار)
 * @param input.templateKey مفتاح قالب النوع التشغيلي للبريد والواتساب
 * @param input.inApp بيبني مستلم الجرس لمستخدم
 * @param input.contacts خريطة جهات الاتصال المقروءة مسبقاً؛ غير لازمة لقاعدة جرس فقط
 * @returns مجموعات غير فاضية من المستلمين، فاضية لو مفيش مستلم
 */
export function teamAlertRecipientGroups<InApp>(input: {
  readonly channels: readonly AlertChannel[];
  readonly userIds: readonly string[];
  readonly templateKey: string;
  readonly inApp: (userId: string) => InApp;
  readonly contacts?: ReadonlyMap<string, TeamAlertContact> | undefined;
}): (InApp | TeamAlertEmailRecipient | TeamAlertWhatsappRecipient)[][] {
  let contacts: ReadonlyMap<string, TeamAlertContact> = new Map();
  if (needsTeamAlertContacts(input.channels) && input.userIds.length > 0) {
    if (input.contacts === undefined) throw new Error('TEAM_ALERT_CONTACTS_UNAVAILABLE');
    contacts = input.contacts;
  }
  return chunkTeamAlertRecipients(
    buildTeamAlertRecipients({
      channels: input.channels,
      userIds: input.userIds,
      contacts,
      templateKey: input.templateKey,
      inApp: input.inApp,
    }),
  );
}
