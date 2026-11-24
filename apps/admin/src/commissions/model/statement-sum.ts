const MILLS_PER_KWD = 1000n;

/** مبلغ الكشف النصي بالفلس: النمط من العقد بيضمن علامة اختيارية وأرقام وثلاث خانات عشرية. */
function toMills(amount: string): bigint {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = '0'] = amount.slice(negative ? 1 : 0).split('.');
  const mills = BigInt(whole) * MILLS_PER_KWD + BigInt(fraction);
  return negative ? -mills : mills;
}

/**
 * يجمع مبالغ كشف نصية من غير سقف: مجموع صفوف صالحة ممكن يعدّي سقف الصف الواحد في Money (numeric(14,3))،
 * و`sumMoney` بيرفضه. المبالغ بتتجمع بالفلس في bigint فمفيش كسور عائمة.
 *
 * @param amounts مبالغ بالدينار كنص بثلاث خانات عشرية، والسالب محفوظ
 * @returns المجموع بنفس الصيغة، أو 0.000 لو القائمة فاضية
 */
export function sumAmounts(amounts: readonly string[]): string {
  const total = amounts.reduce((sum, amount) => sum + toMills(amount), 0n);
  const abs = total < 0n ? -total : total;
  const fraction = (abs % MILLS_PER_KWD).toString().padStart(3, '0');
  return `${total < 0n ? '-' : ''}${abs / MILLS_PER_KWD}.${fraction}`;
}
