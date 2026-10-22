/** هاشات اشتراك الدفع: الدالة البحتة في packages/notifications، والموديول بياخدها من port مش مباشرة. */
export interface PushHashes {
  /**
   * هاش معرّف التثبيت داخل الشركة — عشان المعرّف الخام ما يتخزّنش في أي عمود.
   *
   * @param companyId      الشركة
   * @param installationId معرّف التثبيت الخام
   * @returns 64 حرف hex
   */
  installationHash(companyId: string, installationId: string): string;
  /**
   * هاش وجهة الدفع — بيخلي كل شركة يبقى ليها صف حيّ واحد لكل وجهة، ويفضل الهاش بعد السحب وقت
   * العنوان الخام يتمسح فالتشخيص يعرف الوجهة؛ والعنوان الخام بيفضل بس طول ما الصف حيّ.
   *
   * @param endpoint وجهة الدفع كما أرسلها المتصفح
   * @returns 64 حرف hex
   */
  endpointHash(endpoint: string): string;
}
