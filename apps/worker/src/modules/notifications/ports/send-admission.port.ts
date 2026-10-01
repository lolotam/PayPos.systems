export interface SendAdmission {
  /** يحجز سعة الوجهة خارج المعاملة دون نوم أو تخزين هاتف في Redis.
   *
   * @param hash هوية الوجهة
   * @param deadline الموعد الذي لا يسمح الحجز بتجاوزه
   */
  reserve(hash: Uint8Array, deadline: Date | null): Promise<boolean>;
}
