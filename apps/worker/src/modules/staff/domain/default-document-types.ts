/** نوع وثيقة افتراضي يزرع لكل شركة جديدة بنفس كود الهجرة؛ الاسمان من كتالوج i18n بالمفتاح. */
export interface DefaultDocumentType {
  readonly code: string;
  readonly name_key:
    'seedCivilId' | 'seedPassport' | 'seedResidency' | 'seedHealthCertificate' | 'seedWorkContract';
  readonly alert_days: number;
  readonly requires_expiry: boolean;
}

/**
 * الأنواع الخمسة الموصى بها لكل شركة؛ عقد العمل وحده بلا انتهاء إلزامي، والتنبيه قبل شهر.
 * القائمة نفسها في هجرة الشركات الموجودة، والكود الفريد يجعل التكرار بلا أثر.
 *
 * @returns الأنواع الافتراضية بترتيب ثابت
 */
export function defaultDocumentTypes(): readonly DefaultDocumentType[] {
  // قرار المالك 2026-10-04 (DOC-Q1، الخيار الموصى به): خمسة أنواع افتراضية بتنبيه ثلاثين يوماً، وكل شركة تقدر تعدّلها.
  return [
    { code: 'civil_id', name_key: 'seedCivilId', alert_days: 30, requires_expiry: true },
    { code: 'passport', name_key: 'seedPassport', alert_days: 30, requires_expiry: true },
    { code: 'residency', name_key: 'seedResidency', alert_days: 30, requires_expiry: true },
    {
      code: 'health_certificate',
      name_key: 'seedHealthCertificate',
      alert_days: 30,
      requires_expiry: true,
    },
    { code: 'work_contract', name_key: 'seedWorkContract', alert_days: 30, requires_expiry: false },
  ];
}
