/** يحذف أوامر الاتجاه القديمة من النص المعروض. */
export function documentNumberText(value: string | null | undefined): string | undefined {
  return value?.replace(/\p{Bidi_Control}/gu, '').trim() || undefined;
}
