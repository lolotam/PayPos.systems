/** جرس تنبيه الحدث الموقوف: المستلمون في مجموعة واحدة، وهوية الحدث الموقوف المرجعية. */
export interface ParkedAlertNotice {
  readonly eventId: string;
  readonly eventType: string;
  readonly groupIndex: number;
  readonly recipients: readonly string[];
}

/**
 * مشغّل معاملة شركة واحدة؛ فتح المعاملة يبقى خارج حالة الاستخدام.
 *
 * @param companyId الشركة
 * @param fn الشغل جوه معاملة الشركة
 * @returns نتيجة الشغل
 */
export type ParkedAlertTenantRunner<Transaction> = <T>(
  companyId: string,
  fn: (tx: Transaction) => Promise<T>,
) => Promise<T>;

/**
 * قارئ مالكي الشركة: عضويات المالك الحقيقية السارية وقت التنبيه، لأن التنبيه
 * لازم يوصل لصاحب القرار في الشركة كلها (ADR-0012 §3، A4).
 *
 * @param tx معاملة الشركة التي يقرأ منها القارئ
 * @param companyId الشركة
 * @param at لحظة سريان العضوية
 * @returns معرفات المستخدمين المالكين
 */
export type ParkedAlertOwnersReader<Transaction> = (
  tx: Transaction,
  companyId: string,
  at: Date,
) => Promise<readonly string[]>;

/**
 * قارئ علامة إسقاط المستهلِك: هل مستهلك مدخلات العمولة طبّق الحدث ده؟ الحدث الموقوف
 * اللي اتسجل عليه مش بيمنع الاعتماد، فالتنبيه عليه مالهوش لازمة (ADR-0012 §3.1).
 *
 * @param tx      معاملة الشركة التي يقرأ منها القارئ
 * @param eventId معرّف الحدث الموقوف
 * @returns true لو المستهلِك طبّق الحدث قبل كده
 */
export type ParkedAlertProjectionReader<Transaction> = (
  tx: Transaction,
  eventId: string,
) => Promise<boolean>;

/**
 * كاتب جرس التنبيه على معاملة التنبيه نفسها، عشان علامة التكرار والجرس
 * يتثبتوا مع بعض أو يلغوا مع بعض.
 *
 * @param tx معاملة التنبيه
 * @param notice الجرس المطلوب
 */
export type ParkedAlertNotifier<Transaction> = (
  tx: Transaction,
  notice: ParkedAlertNotice,
) => Promise<void>;
