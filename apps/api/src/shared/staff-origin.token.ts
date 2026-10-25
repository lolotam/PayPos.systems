export const STAFF_POS_ORIGIN = Symbol('STAFF_POS_ORIGIN');

// تجميع مصدر POS ومصادر التطبيق الأصلي يمنع تمرير إعداد ناقص كأنه مصدر صالح.
export interface StaffOrigins {
  readonly pos: string;
  readonly native: readonly string[];
}

// قاعدة CSRF واحدة لكل مسارات الموظفين حتى لا تختلف سياساتها.
export function isStaffOrigin(
  origins: StaffOrigins | null,
  origin: string | undefined,
): boolean {
  return (
    origins !== null &&
    origin !== undefined &&
    (origin === origins.pos || origins.native.includes(origin))
  );
}

// رفض أي مصدر أصلي غير معتمد عند بدء التشغيل يمنع فتح CSRF بقيمة بيئة خاطئة.
export function staffNativeOriginsFrom(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  if (origins.some((origin) => origin !== 'capacitor://localhost'))
    throw new Error('STAFF_NATIVE_ORIGINS accepts only capacitor://localhost');
  return origins;
}
