/**
 * يصنّف الرسالة كاملة حتى لا يتحول طلب إلغاء حجز إلى منع رسائل المنصة.
 *
 * @param type نوع رسالة المزود
 * @param text النص المؤقت قبل التخلص منه
 * @param buttonId معرّف الزر بدون استخدام عنوانه
 * @param approvedButtonId الزر المعتمد فقط
 * @returns الأمر المحدود دون الاحتفاظ بالنص
 */
export function classifyWhatsappCommand(
  type: string,
  text: string | undefined,
  buttonId: string | undefined,
  approvedButtonId: string | undefined,
): 'STOP' | 'OTHER' {
  if (type === 'text' && text !== undefined) {
    const normalized = text.trim().normalize('NFKC').toLowerCase();
    if (['stop', 'unsubscribe', 'إيقاف', 'ايقاف', 'توقف'].includes(normalized)) return 'STOP';
  }
  if (
    (type === 'button' || type === 'interactive') &&
    approvedButtonId !== undefined &&
    buttonId === approvedButtonId
  )
    return 'STOP';
  return 'OTHER';
}

/** الرسالة الدائمة تحتوي بصمات وأوامر محدودة ولا تحمل أي هوية هاتف أصلية. */
export interface ScrubbedWhatsappMessage {
  readonly digest: Uint8Array;
  readonly recipientHash: Uint8Array;
  readonly hashKeyId: string;
  readonly command: 'STOP' | 'OTHER';
  readonly providerTimestamp: Date;
  readonly rawEvent: Readonly<Record<string, unknown>>;
}

/**
 * يقسم الدفعة الموقعة حتى تبقى كل معاملة استقبال محدودة دون إهمال STOP الصحيح.
 *
 * @param messages الرسائل الصحيحة بعد التنقيح
 * @returns مجموعات لا تزيد عن مئة رسالة
 */
export function whatsappMessageBatches(
  messages: readonly ScrubbedWhatsappMessage[],
): readonly ScrubbedWhatsappMessage[][] {
  const batches: ScrubbedWhatsappMessage[][] = [];
  for (let offset = 0; offset < messages.length; offset += 100)
    batches.push(messages.slice(offset, offset + 100));
  return batches;
}
