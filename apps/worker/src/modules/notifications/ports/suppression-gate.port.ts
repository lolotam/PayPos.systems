export interface SuppressionGate {
  /** يقرأ قرار المنع على نفس اتصال الإذن وتحت قفل الهوية العام للهاتف.
   *
   * @param hash هوية الوجهة دون شركة
   */
  isSuppressed(hash: Uint8Array): Promise<boolean>;
}
