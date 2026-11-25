/**
 * حالة الرقم السري للموظفة: مستعملة، ولا لازم يتغيّر، ولا خلصت مدته.
 */
export type StaffPinState = 'USABLE' | 'CHANGE_REQUIRED' | 'EXPIRED';

/** الصف اللي بيتقاس عليه الحالة — самه اللي بيتخزن في cashier_pins. */
export interface StaffPinStateRow {
  /** الرقم مؤقت: حدّده غير صاحبه، ولازم صاحبه يغيّره قبل ما يدخل. */
  readonly temporary?: boolean;
  /** لحظة انتهاء الرقم المؤقت؛ null يعني إن مفيش انتهاء. */
  readonly expiresAt?: Date | null;
}

/**
 * حالة الرقم السري في اللحظة دي: الدالة pure، فبتتقاس من غير ساعة حقيقية.
 * - `USABLE`: رقم دائم، صاحبه يدخل بيه على طول.
 * - `CHANGE_REQUIRED`: رقم مؤقت لسه-living، صاحبه لازم يغيّره الأول.
 * - `EXPIRED`: خلصت مدته (24 ساعة من ضبط المانح)، ومينفعش يدخل بيه.
 *
 * @param row الصف المخزن: مؤقت ولا لأ، وله انتهاء ولا لأ
 * @param now اللحظة دي
 * @returns حالة الرقم السري
 */
export function pinState(row: StaffPinStateRow, now: Date): StaffPinState {
  const expiresAt = row.expiresAt ?? null;
  if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (row.temporary === true) return 'CHANGE_REQUIRED';
  return 'USABLE';
}
